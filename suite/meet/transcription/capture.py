"""Capture admission and durable reconciliation, independent of video delivery."""

import json
from datetime import timedelta

import frappe
import requests
from frappe.utils import cint, get_datetime, now_datetime

from suite.meet.speech_context import make_hints, validate_hints
from suite.meet.transcription import client
from suite.meet.transcription.protocol import MODEL, validate_manifest

DEFAULT_SOURCE_BYTES = 2 * 1024**3


def enabled():
    try:
        client._url("recorder_server_url")
        client._url("sfu_server_url")
    except ValueError:
        return False
    return bool(
        frappe.conf.get("transcription_enabled")
        and frappe.conf.get("transcription_worker_secret")
        and frappe.conf.get("recorder_server_url")
        and frappe.conf.get("sfu_server_url")
        and frappe.conf.get("recorder_secret")
        and frappe.conf.get("sfu_secret")
    )


def admission():
    jobs = frappe.get_all(
        "Meet Transcription Job",
        filters={"source_deleted": 0},
        fields=["status", "audio_seconds", "source_bytes"],
    )
    active = sum(j.status == "Capturing" for j in jobs)
    queued = sum(j.audio_seconds or 0 for j in jobs if j.status in ("Queued", "Processing"))
    stored = sum(j.source_bytes or 0 for j in jobs)
    reservation = cint(frappe.conf.get("transcription_capture_max_bytes") or DEFAULT_SOURCE_BYTES)
    return (
        enabled()
        and active < cint(frappe.conf.get("transcription_max_concurrent") or 2)
        and queued < cint(frappe.conf.get("transcription_max_queued_audio_seconds") or 86400)
        and stored + reservation <= cint(frappe.conf.get("transcription_max_source_bytes") or 10 * 1024**3)
    )


def prepare(recording):
    # Serialize site admission, including unknown current capture sizes. Reserve
    # each active capture's full allowance until its bounded manifest arrives.
    lock = frappe.cache.lock(f"meet-transcription-admission:{frappe.local.site}", timeout=30)
    if not lock.acquire(blocking=True, blocking_timeout=5):
        frappe.throw("Transcription admission is busy; please try again")
    try:
        if not admission():
            frappe.throw("Transcription capacity is currently unavailable")
        maximum = cint(frappe.conf.get("transcription_capture_max_bytes") or DEFAULT_SOURCE_BYTES)
        job = frappe.get_doc(
            {
                "doctype": "Meet Transcription Job",
                "capture": recording.name,
                "meet_room": recording.meet_room,
                "room_owner": recording.room_owner,
                "room_title": frappe.db.get_value("Meet Room", recording.meet_room, "title") or "Meet",
                "capture_started_at": now_datetime(),
                "status": "Capturing",
                "participant_revision": 1,
                "retention_deadline": now_datetime() + timedelta(days=7),
                "source_bytes": maximum,
                "model_configuration": json.dumps(MODEL),
                "recognition_hints": json.dumps(
                    make_hints(frappe.db.get_value("Meet Room", recording.meet_room, "title") or "", [])
                ),
                "manifest": "{}",
                "completed_segments": "[]",
            }
        ).insert(ignore_permissions=True)
        # Persist admission before contacting services. Interrupted startup is
        # reconciled rather than losing a source retention obligation.
        frappe.db.commit()
    finally:
        lock.release()
    try:
        client.recorder(
            recording.name,
            recording.meet_room,
            "reserve",
            body={"max_bytes": maximum, "max_duration_ms": 14400000},
        )
        result = client.sfu(recording.name, recording.meet_room, "start")
        if result.get("started_at"):
            from zoneinfo import ZoneInfo

            started = get_datetime(result["started_at"])
            if started.tzinfo is not None:
                started = started.astimezone(ZoneInfo(frappe.utils.get_system_timezone())).replace(
                    tzinfo=None
                )
            job.capture_started_at = started
        job.save(ignore_permissions=True)
        return result
    except Exception:
        # A timed-out start may already be capturing. Retain its durable
        # obligation and stop intent until the recorder/SFU can resolve it.
        job.stop_requested = 1
        job.participant_revision = cint(job.participant_revision) + 1
        job.failure_code = "capture_start_unconfirmed"
        job.save(ignore_permissions=True)
        raise


def stop(recording):
    if recording.transcription_enabled:
        client.sfu(recording.name, recording.meet_room, "stop")


def reconcile_capture(job):
    from suite.meet.api.recording import _publish_state
    from suite.meet.api.transcription import _failure

    recording = (
        frappe.get_doc("Meet Recording", job.capture)
        if frappe.db.exists("Meet Recording", job.capture)
        else None
    )
    # Stop explicitly at four hours even when SFU has restarted. SFU also enforces
    # this bound independently, along with last-human-leaves.
    if recording and now_datetime() - get_datetime(job.capture_started_at) > timedelta(hours=4):
        try:
            client.sfu(job.capture, job.meet_room, "stop")
        except Exception:
            pass
    try:
        result = client.recorder(job.capture, job.meet_room, "manifest")
    except requests.HTTPError as error:
        if error.response is None or error.response.status_code != 404:
            raise
        _failure(job, "source_missing", False)
        job.source_deleted = 1
        job.save(ignore_permissions=True)
        return
    if result.get("state") == "capturing":
        try:
            live = client.sfu(job.capture, job.meet_room, "query")
            if live.get("state") in ("complete", "partial"):
                client.recorder(job.capture, job.meet_room, "complete", body={"gaps": live.get("gaps", [])})
                result = client.recorder(job.capture, job.meet_room, "manifest")
        except requests.HTTPError as error:
            if error.response is None or error.response.status_code != 404:
                raise
            last = max([s["end_ms"] for s in result.get("segments", [])] or [0])
            elapsed = min(
                14400000,
                max(
                    last, int((now_datetime() - get_datetime(job.capture_started_at)).total_seconds() * 1000)
                ),
            )
            gaps = [{"start_ms": 0, "end_ms": elapsed, "reason": "source_interrupted"}] if elapsed > 0 else []
            client.recorder(
                job.capture, job.meet_room, "complete", body={"gaps": gaps, "reason": "service_shutdown"}
            )
            result = client.recorder(job.capture, job.meet_room, "manifest")
    if result.get("state") not in ("complete", "partial", "failed"):
        if job.stop_requested or (recording and recording.status in ("Stopping", "Cancelled")):
            client.sfu(job.capture, job.meet_room, "stop")
        return
    manifest = validate_manifest(
        result, job.capture, frappe.local.site, job.meet_room, cint(job.source_bytes)
    )
    model = frappe.parse_json(job.model_configuration)
    context = manifest.get("speech_context") or {
        "vocabulary_version": model["configuration"]["vocabulary_version"],
        "title": job.room_title,
    }
    names = manifest.get("participant_names", [])
    hints = make_hints(
        context["title"],
        [*names, *(s["speaker_name"] for s in manifest["segments"])],
        context["vocabulary_version"],
    )
    validate_hints(hints)
    model["configuration"]["vocabulary_version"] = hints["vocabulary_version"]
    job.model_configuration = json.dumps(model)
    job.recognition_hints = json.dumps(hints)
    job.participant_revision = cint(job.participant_revision) + 1
    job.manifest = json.dumps(manifest)
    job.audio_seconds = manifest["audio_seconds"]
    job.source_bytes = manifest["source_bytes"]
    # Retention is bounded from capture end, not each retry.
    from suite.meet.api.transcription import _local

    job.retention_deadline = _local(result.get("ended_at") or now_datetime()) + timedelta(days=7)
    job.retry_at = now_datetime()
    job.queued_at = job.queued_at or now_datetime()
    job.status = "Queued"
    if result.get("state") in ("failed", "partial") and not manifest["segments"]:
        _failure(job, "capture_failed", False)
    else:
        job.save(ignore_permissions=True)
    if (
        recording
        and not recording.video_enabled
        and recording.status in ("Starting", "Recording", "Stopping", "Interrupted")
    ):
        frappe.db.set_value(
            "Meet Recording",
            recording.name,
            {
                "status": "Captured",
                "ended_at": get_datetime(result.get("ended_at") or now_datetime()),
                "state_revision": recording.state_revision + 1,
            },
            update_modified=False,
        )
        recording.reload()
        _publish_state(frappe.get_doc("Meet Room", recording.meet_room), recording)
    elif recording:
        _publish_state(frappe.get_doc("Meet Room", recording.meet_room), recording)


def participant_state(capture):
    """Only the live capture outcome; queued inference is never exposed as UI."""
    job = frappe.db.get_value(
        "Meet Transcription Job", {"capture": capture}, ["status", "manifest"], as_dict=True
    )
    if not job:
        return None
    manifest = frappe.parse_json(job.manifest) or {}
    if manifest.get("state") in ("complete", "partial", "failed"):
        return manifest["state"]
    if job.status == "Capturing":
        return "capturing"
    return "failed" if job.status == "Failed" else "complete"


def request_stop(capture):
    name = frappe.db.get_value("Meet Transcription Job", {"capture": capture, "status": "Capturing"}, "name")
    if name:
        frappe.db.sql("select name from `tabMeet Transcription Job` where name=%s for update", name)
        job = frappe.get_doc("Meet Transcription Job", name)
        if not job.stop_requested:
            job.stop_requested = 1
            job.participant_revision = cint(job.participant_revision) + 1
            job.save(ignore_permissions=True)


def finish_capture_state(job):
    from suite.meet.api.recording import _publish_state, _utc_now_naive

    if not frappe.db.exists("Meet Recording", job.capture):
        return
    recording = frappe.get_doc("Meet Recording", job.capture)
    if not recording.video_enabled and recording.status in (
        "Starting",
        "Recording",
        "Interrupted",
        "Stopping",
    ):
        frappe.db.set_value(
            "Meet Recording",
            recording.name,
            {
                "status": "Captured",
                "ended_at": _utc_now_naive(),
                "state_revision": cint(recording.state_revision) + 1,
            },
            update_modified=False,
        )
        recording.reload()
    _publish_state(frappe.get_doc("Meet Room", recording.meet_room), recording)
