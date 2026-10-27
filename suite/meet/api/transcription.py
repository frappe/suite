"""Internal leased transcription queue. Workers authenticate separately from users."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from datetime import timedelta

import frappe
from frappe.utils import cint, get_datetime, now_datetime

from suite.meet.transcription import client
from suite.meet.transcription.protocol import (
    MODEL,
    render_transcript,
    validate_gaps,
    validate_manifest,
    validate_results,
)

LEASE_SECONDS = 300
RETRY_DELAYS = (60, 300, 1800)


def _authenticate():
    secret = frappe.conf.get("transcription_worker_secret") or ""
    supplied = frappe.get_request_header("X-Meet-Transcription-Authorization") or ""
    if len(secret) < 32 or not hmac.compare_digest(supplied, "Bearer " + secret):
        frappe.throw("Invalid transcription worker credentials", frappe.AuthenticationError)


def _locked(name):
    frappe.db.sql("select name from `tabMeet Transcription Job` where name=%s for update", name)
    return frappe.get_doc("Meet Transcription Job", name)


def _json(value, default):
    return frappe.parse_json(value) if value else default


def _local(value):
    from zoneinfo import ZoneInfo

    parsed = get_datetime(value)
    return (
        parsed.astimezone(ZoneInfo(frappe.utils.get_system_timezone())).replace(tzinfo=None)
        if parsed.tzinfo
        else parsed
    )


def _iso(value):
    # Frappe stores system-local naive datetime; convert through configured zone.
    from datetime import UTC
    from zoneinfo import ZoneInfo

    return (
        get_datetime(value)
        .replace(tzinfo=ZoneInfo(frappe.utils.get_system_timezone()))
        .astimezone(UTC)
        .isoformat()
    )


def _lease(job, lease_token, worker_id):
    if (
        job.status != "Processing"
        or job.lease_worker != worker_id
        or not job.lease_expires_at
        or get_datetime(job.lease_expires_at) <= now_datetime()
        or not hmac.compare_digest(
            job.lease_token_hash or "", hashlib.sha256(lease_token.encode()).hexdigest()
        )
    ):
        frappe.throw("Transcription lease expired or revoked", frappe.PermissionError)


def _checkpoint(job, segments=None, processed_source_ids=None):
    if segments is None:
        return
    incoming = validate_results(_json(segments, []), _json(job.manifest, {}))
    if processed_source_ids is not None and set(_json(processed_source_ids, [])) != {
        s["source_id"] for s in incoming
    }:
        raise ValueError("Processed transcription sources do not match results")
    previous = {s["source_id"]: s for s in _json(job.completed_segments, [])}
    for segment in incoming:
        if segment["source_id"] in previous and previous[segment["source_id"]] != segment:
            raise ValueError("Completed transcription source cannot change")
        previous[segment["source_id"]] = segment
    job.completed_segments = json.dumps(list(previous.values()))


def queue_stats():
    now = now_datetime()
    rows = frappe.get_all(
        "Meet Transcription Job",
        filters={"status": ["in", ["Queued", "Processing"]]},
        fields=["status", "audio_seconds", "creation", "queued_at", "lease_expires_at"],
    )
    queued = [r for r in rows if r.status == "Queued"]
    window = now - timedelta(seconds=300)
    incoming = frappe.get_all(
        "Meet Transcription Job", filters={"queued_at": [">=", window]}, fields=["audio_seconds"]
    )
    completed = frappe.get_all(
        "Meet Transcription Job", filters={"ready_at": [">=", window]}, fields=["audio_seconds"]
    )

    return {
        "incoming_audio_seconds_per_second": sum(r.audio_seconds or 0 for r in incoming) / 300,
        "completed_audio_seconds_per_second": sum(r.audio_seconds or 0 for r in completed) / 300,
        "jobs": len(queued),
        "audio_seconds": sum(r.audio_seconds or 0 for r in queued),
        "oldest_age_seconds": max(
            [max(0, (now - get_datetime(r.queued_at or r.creation)).total_seconds()) for r in queued] or [0]
        ),
        "stalled_jobs": sum(
            r.status == "Processing" and (not r.lease_expires_at or get_datetime(r.lease_expires_at) < now)
            for r in rows
        ),
    }


@frappe.whitelist(allow_guest=True, methods=["POST"])
def queue_status() -> dict:
    _authenticate()
    return {"queue": queue_stats()}


@frappe.whitelist(allow_guest=True, methods=["POST"])
def claim(worker_id: str) -> dict:
    _authenticate()
    if not isinstance(worker_id, str) or not 1 <= len(worker_id) <= 128:
        raise ValueError("Invalid worker identity")
    # Row locking plus a rechecked state serializes competing workers. Scheduling
    # across sites belongs to the shared pool's round-robin coordinator.
    candidates = frappe.get_all(
        "Meet Transcription Job",
        filters={"status": "Queued", "retry_at": ["<=", now_datetime()]},
        order_by="creation asc",
        limit=10,
        pluck="name",
    )
    for name in candidates:
        job = _locked(name)
        if job.status != "Queued" or get_datetime(job.retry_at) > now_datetime():
            continue
        if get_datetime(job.retention_deadline) <= now_datetime():
            _failure(job, "source_expired", False)
            continue
        token = secrets.token_urlsafe(32)
        job.status = "Processing"
        job.lease_worker = worker_id
        job.lease_token_hash = hashlib.sha256(token.encode()).hexdigest()
        job.lease_expires_at = now_datetime() + timedelta(seconds=LEASE_SECONDS)
        job.processing_started_at = now_datetime()
        job.save(ignore_permissions=True)
        completed = _json(job.completed_segments, [])
        return {
            "job": job.name,
            "capture": job.capture,
            "lease_token": token,
            "lease_expires_at": _iso(job.lease_expires_at),
            "model": _json(job.model_configuration, {}),
            "hints": _json(job.recognition_hints, {}),
            "manifest": client.authorize_manifest(job),
            "completed_segments": completed,
            "processed_source_ids": [s["source_id"] for s in completed],
            "queue": queue_stats(),
            "queue_wait_seconds": max(
                0, (now_datetime() - get_datetime(job.queued_at or job.creation)).total_seconds()
            ),
        }
    return {"job": None, "queue": queue_stats()}


@frappe.whitelist(allow_guest=True, methods=["POST"])
def heartbeat(
    job: str,
    lease_token: str,
    worker_id: str,
    segments: list | str | None = None,
    processed_source_ids: list | str | None = None,
) -> dict:
    _authenticate()
    doc = _locked(job)
    _lease(doc, lease_token, worker_id)
    _checkpoint(doc, segments, processed_source_ids)
    doc.lease_expires_at = now_datetime() + timedelta(seconds=LEASE_SECONDS)
    doc.save(ignore_permissions=True)
    return {"lease_expires_at": _iso(doc.lease_expires_at), "manifest": client.authorize_manifest(doc)}


@frappe.whitelist(allow_guest=True, methods=["POST"])
def complete(
    job: str,
    lease_token: str,
    worker_id: str,
    segments: list | str,
    gaps: list | str | None = None,
    partial: bool = False,
    processed_source_ids: list | str | None = None,
) -> dict:
    _authenticate()
    doc = _locked(job)
    # Idempotent retry of a successful request requires the same lease identity.
    if (
        doc.status in ("Ready", "Partial")
        and doc.lease_worker == worker_id
        and hmac.compare_digest(doc.lease_token_hash or "", hashlib.sha256(lease_token.encode()).hexdigest())
    ):
        return {"status": doc.status, "artifact": doc.artifact}
    _lease(doc, lease_token, worker_id)
    _checkpoint(doc, segments, processed_source_ids)
    manifest = _json(doc.manifest, {})
    successful = _json(doc.completed_segments, [])
    missing = {
        s["source_id"]: s
        for s in manifest["segments"]
        if s["source_id"] not in {r["source_id"] for r in successful}
    }
    # A worker cannot declare every failed/omitted input to be a complete empty
    # transcript; only successfully processed empty sources establish silence.
    provided = validate_gaps(_json(gaps, []))
    if not successful and (
        missing
        or manifest.get("gaps")
        or provided
        or partial
        or manifest.get("state") in ("failed", "partial")
    ):
        return _failure(doc, "no_usable_segments", False)
    all_gaps = (
        manifest.get("gaps", [])
        + provided
        + [
            {"start_ms": s["start_ms"], "end_ms": s["end_ms"], "reason": "transcription_failed"}
            for s in missing.values()
        ]
    )
    all_gaps = [
        dict(zip(("start_ms", "end_ms", "reason"), values, strict=True))
        for values in sorted({(g["start_ms"], g["end_ms"], g["reason"]) for g in all_gaps})
    ]
    partial = bool(all_gaps) or bool(partial)
    return _publish(doc, successful, all_gaps, partial)


def _publish(doc, segments, gaps, partial):
    from suite.meet.transcription.artifacts import publish

    doc.artifact = publish(doc, render_transcript(segments, gaps, partial))
    doc.status = "Partial" if partial else "Ready"
    doc.gaps = json.dumps(gaps)
    doc.ready_at = now_datetime()
    doc.notification_pending = 1
    doc.save(ignore_permissions=True)
    # Source deletion is retried by maintenance after publication transaction
    # commits, so an external cleanup failure cannot roll back a usable artifact.
    return {
        "status": doc.status,
        "artifact": doc.artifact,
        "capture_end_to_ready_seconds": max(
            0,
            (
                now_datetime() - _local(_json(doc.manifest, {}).get("ended_at") or doc.capture_started_at)
            ).total_seconds(),
        ),
    }


@frappe.whitelist(allow_guest=True, methods=["POST"])
def fail(
    job: str,
    lease_token: str,
    worker_id: str,
    code: str,
    transient: bool = True,
    segments: list | str | None = None,
    gaps: list | str | None = None,
    processed_source_ids: list | str | None = None,
) -> dict:
    _authenticate()
    doc = _locked(job)
    _lease(doc, lease_token, worker_id)
    _checkpoint(doc, segments, processed_source_ids)
    return _failure(doc, code, bool(transient))


def _failure(doc, code, transient):
    import re

    capture_was_active = doc.status == "Capturing"

    doc.attempts = cint(doc.attempts)
    doc.failure_code = (
        code if isinstance(code, str) and re.fullmatch(r"[a-z_]{1,64}", code) else "processing_failed"
    )
    doc.lease_expires_at = None
    doc.lease_token_hash = None
    if transient and doc.attempts < 3 and get_datetime(doc.retention_deadline) > now_datetime():
        doc.retry_at = now_datetime() + timedelta(seconds=RETRY_DELAYS[doc.attempts])
        doc.attempts += 1
        doc.status = "Queued"
    else:
        segments = _json(doc.completed_segments, [])
        if any(segment["text"].strip() for segment in segments):
            manifest = _json(doc.manifest, {})
            ids = {s["source_id"] for s in segments}
            gaps = manifest.get("gaps", []) + [
                {"start_ms": s["start_ms"], "end_ms": s["end_ms"], "reason": "transcription_failed"}
                for s in manifest["segments"]
                if s["source_id"] not in ids
            ]
            return _publish(doc, segments, gaps, True)
        doc.status = "Failed"
        doc.notification_pending = 1
    if capture_was_active:
        doc.participant_revision = cint(doc.participant_revision) + 1
    doc.save(ignore_permissions=True)
    if capture_was_active:
        from suite.meet.transcription.capture import finish_capture_state

        finish_capture_state(doc)
    return {"status": doc.status, "retry_at": _iso(doc.retry_at) if doc.status == "Queued" else None}


@frappe.whitelist(methods=["POST"])
def operator_retry(job: str) -> dict:
    frappe.only_for("System Manager")
    doc = _locked(job)
    if doc.status != "Failed" or doc.source_deleted or get_datetime(doc.retention_deadline) <= now_datetime():
        frappe.throw("Transcription source is no longer retryable")
    doc.status = "Queued"
    doc.retry_at = now_datetime()
    doc.attempts = 0
    doc.notification_pending = 0
    doc.notification_sent_at = None
    doc.save(ignore_permissions=True)
    return {"status": "Queued"}


def maintenance():
    """Recover abandoned leases, enqueue finalized sources, notify and purge."""
    from suite.meet.transcription.capture import reconcile_capture

    for name in frappe.get_all(
        "Meet Transcription Job",
        or_filters={
            "status": ["in", ["Capturing", "Queued", "Processing", "Deleted"]],
            "source_deleted": 0,
            "notification_pending": 1,
        },
        pluck="name",
    ):
        try:
            doc = _locked(name)
            now = now_datetime()
            expired = get_datetime(doc.retention_deadline) <= now
            if expired and doc.status in ("Capturing", "Queued", "Processing"):
                _failure(doc, "source_expired", False)
            if doc.status == "Capturing":
                reconcile_capture(doc)
            elif doc.status == "Processing" and get_datetime(doc.lease_expires_at) <= now:
                _failure(doc, "worker_lost", True)
            # Persist processing recovery independently of notification and
            # recorder cleanup. Either downstream service may be unavailable.
            frappe.db.commit()
            doc = _locked(name)
            if doc.notification_pending:
                try:
                    _notify(doc)
                    frappe.db.commit()
                except Exception:
                    frappe.db.rollback()
                    frappe.logger("meet_transcription").warning("Transcription notification deferred")
                doc = _locked(name)
            if not doc.source_deleted and (
                doc.status in ("Ready", "Partial", "Deleted") or get_datetime(doc.retention_deadline) <= now
            ):
                if doc.status in ("Capturing", "Queued", "Processing"):
                    _failure(doc, "source_expired", False)
                client.recorder(doc.capture, doc.meet_room, "delete")
                doc.source_deleted = 1
                doc.save(ignore_permissions=True)
            if doc.status == "Deleted" and doc.source_deleted:
                capture = frappe.db.get_value(
                    "Meet Recording",
                    doc.capture,
                    ["name", "video_enabled", "artifact", "status"],
                    as_dict=True,
                )
                if capture and (
                    not capture.video_enabled
                    or (
                        capture.status in ("Ready", "Partial", "Failed", "Cancelled")
                        and not frappe.db.exists(
                            "File", {"name": capture.artifact, "status": ["!=", "Removed"]}
                        )
                    )
                ):
                    frappe.delete_doc("Meet Recording", capture.name, ignore_permissions=True)
                frappe.delete_doc("Meet Transcription Job", doc.name, ignore_permissions=True)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            # Operational logs deliberately contain neither participant content
            # nor exception response bodies, which may include source tokens.
            frappe.logger("meet_transcription").warning("Transcription maintenance deferred")


def _notify(doc):
    from html import escape

    ready = doc.status in ("Ready", "Partial")
    subject = "Your Meet transcript is ready" if ready else "Your Meet transcript could not be processed"
    link = frappe.utils.get_url("/drive/f/" + doc.artifact) if ready else None
    message = (
        (
            f'<p>{"A partial transcript is ready; missing intervals are marked." if doc.status == "Partial" else "Your transcript is ready."}</p><p><a href="{escape(link, quote=True)}">Open transcript in Drive</a></p>'
        )
        if ready
        else "<p>We could not produce a usable transcript for your capture. Contact your administrator for assistance.</p>"
    )
    frappe.sendmail(
        recipients=[doc.room_owner],
        subject=subject,
        message=message,
        reference_doctype="Meet Transcription Job",
        reference_name=doc.name,
    )
    doc.notification_pending = 0
    doc.notification_sent_at = now_datetime()
    doc.save(ignore_permissions=True)
