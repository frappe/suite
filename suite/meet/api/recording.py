# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

from __future__ import annotations

import time
import uuid
from datetime import UTC, timedelta
from zoneinfo import ZoneInfo

import frappe
import isodate
from frappe import _
from frappe.utils import add_to_date, cint, get_datetime, now_datetime

from suite.drive.api.storage import acquire_owner_storage_lock, get_storage_usage
from suite.drive.utils import get_user_folder
from suite.meet.doctype.meet_recording.meet_recording import ACTIVE_RECORDING_STATUSES
from suite.meet.recording.callback_auth import authenticate_callback
from suite.meet.recording.grants import mint_recording_grant, public_jwk_thumbprint
from suite.meet.recording.ingest import append_chunk, begin_upload, complete_upload
from suite.meet.recording.recorder_client import RecorderClient, RecorderOutcome

MAX_SECONDS = 4 * 60 * 60
DEFAULT_ESTIMATE_SECONDS = 60 * 60
BYTES_PER_SECOND = int(((5_000_000 + 128_000) / 8) * 1.1)
MINIMUM_BUDGET_BYTES = BYTES_PER_SECOND * 30 + 5 * 1024 * 1024


def _get_room(meeting_id: str):
    room = frappe.get_doc("Meet Room", meeting_id)
    if not room.is_host_or_cohost(frappe.session.user):
        frappe.throw(_("Only the meeting host or co-host can manage recording"), frappe.PermissionError)
    return room


def _get_drive_destination(owner: str) -> str:
    return get_user_folder(owner).name


def _get_free_bytes(owner: str) -> int:
    usage = get_storage_usage(owner)
    if not usage["limit"]:
        return MAX_SECONDS * BYTES_PER_SECOND
    return max(0, cint(usage["limit"]) - cint(usage["total_size"]))


def _get_estimate(room) -> tuple[int, int]:
    seconds = DEFAULT_ESTIMATE_SECONDS
    if room.calendar_event:
        try:
            event = frappe.get_doc("Calendar Event", room.calendar_event)
            if (
                event.get("status") != "Cancelled"
                and not event.get("show_without_time")
                and event.get("start")
                and event.get("duration")
            ):
                start = get_datetime(event.start)
                duration = isodate.parse_duration(event.duration)
                if not isinstance(duration, timedelta):
                    duration = duration.totimedelta(start)
                end = start + duration
                if event.get("recurrence_rule"):
                    seconds = int(duration.total_seconds()) + 15 * 60
                elif end > now_datetime():
                    seconds = int((end - max(start, now_datetime())).total_seconds()) + 15 * 60
        except Exception:
            pass
    seconds = min(seconds, MAX_SECONDS)
    return seconds, seconds * BYTES_PER_SECOND


def _recorder_available() -> bool:
    if not (
        frappe.conf.get("recorder_server_url")
        and frappe.conf.get("recorder_secret")
        and frappe.conf.get("sfu_secret")
    ):
        return False
    if _fixture_enabled():
        return True
    try:
        _client()
    except ValueError:
        return False
    return True


@frappe.whitelist()
def get_preflight(meeting_id: str) -> dict:
    room = _get_room(meeting_id)
    estimated_seconds, estimated_bytes = _get_estimate(room)
    global_enabled = bool(frappe.get_cached_doc("Meet Settings").enable_recording)
    free_bytes = 0
    storage_available = True
    try:
        _get_drive_destination(room.owner)
        free_bytes = _get_free_bytes(room.owner)
    except frappe.ValidationError:
        storage_available = False

    budget_bytes = min(estimated_bytes, free_bytes)
    return {
        "eligible": global_enabled
        and not bool(room.e2ee_enabled)
        and storage_available
        and budget_bytes >= MINIMUM_BUDGET_BYTES
        and _recorder_available(),
        "global_enabled": global_enabled,
        "e2ee_conflict": bool(room.e2ee_enabled),
        "storage_available": storage_available,
        "recorder_available": _recorder_available(),
        "estimated_seconds": estimated_seconds,
        "estimated_bytes": estimated_bytes,
        "free_bytes": free_bytes,
        "budget_bytes": budget_bytes,
        "budget_seconds": min(MAX_SECONDS, budget_bytes // BYTES_PER_SECOND),
        "maximum_seconds": MAX_SECONDS,
    }


@frappe.whitelist()
def get_state(meeting_id: str) -> dict | None:
    room = frappe.get_doc("Meet Room", meeting_id)
    if not room.can_join(frappe.session.user) or not room.is_user_approved(frappe.session.user):
        frappe.throw(_("You do not have access to this meeting"), frappe.PermissionError)
    return get_active_recording_state(meeting_id)


def get_active_recording_state(meeting_id: str) -> dict | None:
    return frappe.db.get_value(
        "Meet Recording",
        {"meet_room": meeting_id, "status": ["in", ACTIVE_RECORDING_STATUSES]},
        ["name", "status", "started_at", "capture_started_at", "state_revision"],
        as_dict=True,
    )


def _validate_request_id(request_id: str):
    try:
        if str(uuid.UUID(request_id)) != request_id.lower():
            raise ValueError
    except (ValueError, AttributeError):
        frappe.throw(_("Request ID must be a UUID"))


def _publish_state(room, recording):
    payload = {
        "meeting_id": room.name,
        "recording": (
            {
                "name": recording.name,
                "status": recording.status,
                "started_at": recording.started_at,
                "capture_started_at": recording.capture_started_at,
                "state_revision": recording.state_revision,
            }
            if recording
            else None
        ),
    }
    for user in set(room.get_members()):
        if user.startswith("guest_"):
            frappe.publish_realtime(
                "meeting:recording_state", payload, room=f"guest:{user}", after_commit=True
            )
        else:
            frappe.publish_realtime("meeting:recording_state", message=payload, user=user, after_commit=True)


FIXTURE_JWK = {
    "kty": "EC",
    "crv": "P-256",
    "x": "axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY",
    "y": "T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU",
}


def _client() -> RecorderClient:
    return RecorderClient(
        base_url=frappe.conf.get("recorder_server_url"),
        secret=frappe.conf.get("recorder_secret"),
        site=frappe.local.site,
        origin=frappe.conf.get("recorder_site_origin") or frappe.utils.get_url(),
        allow_http=bool(frappe.conf.get("developer_mode") or getattr(frappe.flags, "in_test", False)),
    )


def _limits(recording) -> dict:
    return {
        "budget_bytes": recording.budget_bytes,
        "max_ends_at": _system_datetime_as_utc(recording.max_ends_at)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
        "output": {"width": 1920, "height": 1080, "fps": 30, "video": "h264", "audio": "aac"},
    }


def _system_datetime_as_utc(value):
    return get_datetime(value).replace(tzinfo=ZoneInfo(frappe.utils.get_system_timezone())).astimezone(UTC)


def _fixture_outcome(recording) -> RecorderOutcome:
    accepted_at = get_datetime(recording.creation).replace(tzinfo=UTC)
    return RecorderOutcome("accepted", accepted_at=accepted_at, public_jwk=FIXTURE_JWK)


def _stored_public_jwk(recording) -> dict[str, str]:
    return frappe.parse_json(recording.recorder_public_jwk)


def _accept(room, recording, outcome: RecorderOutcome):
    room.reload()
    if not frappe.get_cached_doc("Meet Settings").enable_recording or room.e2ee_enabled:
        frappe.throw(_("Recording policy changed before the recorder accepted the job"))
    recording.recorder_public_jwk = outcome.public_jwk
    recording.recorder_key_thumbprint = public_jwk_thumbprint(outcome.public_jwk)
    recording.status = "Recording"
    recording.state_revision += 1
    recording.recorder_event_sequence += 1
    recording.started_at = outcome.accepted_at.astimezone(UTC).replace(tzinfo=None)
    recording.save(ignore_permissions=True)
    _publish_state(room, recording)
    frappe.db.commit()
    return recording


def _policy_allows_recording(room) -> bool:
    return bool(frappe.get_cached_doc("Meet Settings").enable_recording and not room.e2ee_enabled)


def _reject_pending(room, recording):
    room.recording_policy_lock()
    current = frappe.get_doc("Meet Recording", recording.name)
    if current.status == "Pending":
        frappe.delete_doc("Meet Recording", current.name, ignore_permissions=True)
        _publish_state(room, None)
        frappe.db.commit()


def _fixture_enabled() -> bool:
    return bool(
        frappe.conf.get("recording_fixture_mode")
        and (frappe.conf.get("developer_mode") or getattr(frappe.flags, "in_test", False))
    )


@frappe.whitelist()
def start(meeting_id: str, request_id: str) -> dict:
    _validate_request_id(request_id)
    room = _get_room(meeting_id)
    existing = frappe.db.get_value(
        "Meet Recording",
        {"request_id": request_id, "meet_room": meeting_id},
        ["name", "status"],
        as_dict=True,
    )
    if existing:
        if existing.status != "Pending":
            if existing.status == "Recording":
                return {"name": existing.name, "status": existing.status, "grant_delivered": True}
            return existing
        recording = frappe.get_doc("Meet Recording", existing.name)
        client = None if _fixture_enabled() else _client()
        outcome = (
            _fixture_outcome(recording)
            if _fixture_enabled()
            else client.query(
                room=meeting_id,
                recording=recording.name,
                job=recording.recorder_job_id,
                limits=_limits(recording),
            )
        )
        return _finish_start(room, recording, outcome, client)

    room.recording_policy_lock()
    room.reload()
    if not room.is_host_or_cohost(frappe.session.user):
        frappe.throw(_("Only the meeting host or co-host can manage recording"), frappe.PermissionError)
    existing = frappe.db.get_value(
        "Meet Recording",
        {"request_id": request_id, "meet_room": meeting_id},
        ["name", "status"],
        as_dict=True,
    )
    if existing:
        return existing
    destination = _get_drive_destination(room.owner)
    acquire_owner_storage_lock(room.owner)
    preflight = get_preflight(meeting_id)
    if not preflight["eligible"]:
        frappe.throw(_("Recording is not currently available for this meeting"))
    if frappe.db.exists(
        "Meet Recording", {"meet_room": meeting_id, "status": ["in", ("Pending", *ACTIVE_RECORDING_STATUSES)]}
    ):
        frappe.throw(_("A recording is already starting or active"))

    now = now_datetime()
    recording = frappe.get_doc(
        {
            "doctype": "Meet Recording",
            "meet_room": room.name,
            "room_owner": room.owner,
            "initiated_by": frappe.session.user,
            "calendar_event": room.calendar_event,
            "status": "Pending",
            "estimated_seconds": preflight["estimated_seconds"],
            "estimated_bytes": preflight["estimated_bytes"],
            "budget_bytes": preflight["budget_bytes"],
            "max_ends_at": add_to_date(now, seconds=MAX_SECONDS),
            "recorder_job_id": frappe.generate_hash(length=32),
            "request_id": request_id,
            "pending_deadline": add_to_date(now, seconds=30),
            "drive_home_folder": destination,
        }
    ).insert(ignore_permissions=True)
    frappe.db.commit()
    client = None if _fixture_enabled() else _client()
    outcome = (
        _fixture_outcome(recording)
        if _fixture_enabled()
        else client.reserve(
            room=meeting_id,
            recording=recording.name,
            job=recording.recorder_job_id,
            limits=_limits(recording),
        )
    )
    return _finish_start(room, recording, outcome, client)


def _finish_start(
    room,
    recording,
    outcome: RecorderOutcome,
    client: RecorderClient | None,
    *,
    room_locked: bool = False,
) -> dict:
    if outcome.outcome == "rejected":
        _reject_pending(room, recording)
        return {"status": "Rejected"}
    if outcome.outcome != "accepted":
        return {"name": recording.name, "status": "Pending"}

    room = frappe.get_doc("Meet Room", recording.meet_room)
    if not room_locked:
        room.recording_policy_lock()
    current = frappe.get_doc("Meet Recording", recording.name)
    if current.status == "Pending":
        room.reload()
        if not _policy_allows_recording(room):
            frappe.db.commit()
            if client and client.stop(
                room=current.meet_room,
                recording=current.name,
                job=current.recorder_job_id,
                limits=_limits(current),
                operation_id=_stop_operation_id(current),
            ):
                _reject_pending(room, current)
                return {"status": "Rejected"}
            return {"name": current.name, "status": "Pending"}
        current = _accept(room, current, outcome)
    if current.status != "Recording":
        return {"name": current.name, "status": current.status}

    now = int(time.time())
    if not current.grant_jti:
        current.grant_jti = str(uuid.uuid4())
        current.grant_issued_at = now
        current.grant_expires_at = min(
            now + 30, int(_system_datetime_as_utc(current.max_ends_at).timestamp())
        )
        current.save(ignore_permissions=True)
        frappe.db.commit()
    elif now >= current.grant_expires_at:
        return _stop_after_grant_delivery_failure(room, current, client)
    grant = mint_recording_grant(
        secret=frappe.conf.get("sfu_secret"),
        site=frappe.local.site,
        meeting_id=current.meet_room,
        recording_id=current.name,
        recorder_job_id=current.recorder_job_id,
        public_jwk=_stored_public_jwk(current),
        max_ends_at=_system_datetime_as_utc(current.max_ends_at),
        issued_at=current.grant_issued_at,
        expires_in=current.grant_expires_at - current.grant_issued_at,
        jti=current.grant_jti,
    )
    delivered = (
        True
        if client is None
        else client.deliver_grant(
            room=current.meet_room,
            recording=current.name,
            job=current.recorder_job_id,
            limits=_limits(current),
            grant=grant,
        )
    )
    if not delivered:
        return _stop_after_grant_delivery_failure(room, current, client)
    return {"name": current.name, "status": current.status, "grant_delivered": delivered}


def _stop_after_grant_delivery_failure(room, recording, client: RecorderClient | None) -> dict:
    recording.status = "Stopping"
    recording.state_revision += 1
    operation_id = _stop_operation_id(recording)
    recording.save(ignore_permissions=True)
    _publish_state(room, recording)
    frappe.db.commit()
    if client:
        client.stop(
            room=recording.meet_room,
            recording=recording.name,
            job=recording.recorder_job_id,
            limits=_limits(recording),
            operation_id=operation_id,
        )
    return {"name": recording.name, "status": recording.status, "grant_delivered": False}


@frappe.whitelist()
def stop(meeting_id: str) -> dict | None:
    room = _get_room(meeting_id)
    room.recording_policy_lock()
    room.reload()
    if not room.is_host_or_cohost(frappe.session.user):
        frappe.throw(_("Only the meeting host or co-host can manage recording"), frappe.PermissionError)
    recording_name = frappe.db.get_value(
        "Meet Recording", {"meet_room": meeting_id, "status": ["in", ACTIVE_RECORDING_STATUSES]}, "name"
    )
    if not recording_name:
        return None
    recording = frappe.get_doc("Meet Recording", recording_name)
    if recording.status in ("Recording", "Interrupted"):
        recording.status = "Stopping"
        recording.state_revision += 1
        recording.end_reason = "host_stop"
        _stop_operation_id(recording)
        recording.save(ignore_permissions=True)
        if _fixture_enabled():
            recording.status = "Processing"
            recording.state_revision += 1
            recording.recorder_event_sequence += 1
            recording.ended_at = now_datetime()
            recording.save(ignore_permissions=True)
    _publish_state(room, recording)
    frappe.db.commit()
    if not _fixture_enabled():
        _client().stop(
            room=recording.meet_room,
            recording=recording.name,
            job=recording.recorder_job_id,
            limits=_limits(recording),
            operation_id=recording.stop_operation_id,
        )
    return {"name": recording.name, "status": recording.status}


def _stop_operation_id(recording) -> str:
    if not recording.stop_operation_id:
        recording.stop_operation_id = str(uuid.uuid4())
        recording.db_set("stop_operation_id", recording.stop_operation_id, update_modified=False)
    return recording.stop_operation_id


@frappe.whitelist(allow_guest=True)
def recorder_interrupted(
    recording_id: str,
    job: str,
    event_sequence: int,
    reason: str,
) -> dict:
    authenticate_callback(
        recording=recording_id,
        job=job,
        operation="interrupted",
        operation_id=str(event_sequence),
    )
    recording = frappe.get_doc("Meet Recording", recording_id)
    if recording.status == "Interrupted":
        return {"status": "Interrupted"}
    if recording.status != "Recording":
        return {"status": recording.status}
    if cint(event_sequence) <= recording.recorder_event_sequence:
        frappe.throw(_("Recorder event is out of order"))
    if not isinstance(reason, str) or not reason or len(reason) > 256:
        frappe.throw(_("Invalid recording interruption reason"))
    recording.status = "Interrupted"
    recording.state_revision += 1
    recording.recorder_event_sequence = cint(event_sequence)
    recording.save(ignore_permissions=True)
    _publish_state(frappe.get_doc("Meet Room", recording.meet_room), recording)
    return {"status": "Interrupted"}


@frappe.whitelist(allow_guest=True)
def recorder_stopped(
    recording_id: str,
    job: str,
    event_sequence: int,
    size: int,
    sha256: str,
    duration_ms: int,
    ended_at: str,
    end_reason: str,
    gaps: str | list | None = None,
) -> dict:
    authenticate_callback(
        recording=recording_id,
        job=job,
        operation="stopped",
        operation_id=str(event_sequence),
    )
    result = begin_upload(
        recording_id,
        event_sequence=event_sequence,
        size=size,
        sha256=sha256,
        duration_ms=duration_ms,
        gaps=frappe.parse_json(gaps) if isinstance(gaps, str) else gaps,
        ended_at=ended_at,
        end_reason=end_reason,
    )
    recording = frappe.get_doc("Meet Recording", recording_id)
    _publish_state(frappe.get_doc("Meet Room", recording.meet_room), recording)
    return result


@frappe.whitelist(allow_guest=True)
def recorder_upload_chunk(recording_id: str, job: str, offset: int, chunk_sha256: str) -> dict:
    authenticate_callback(
        recording=recording_id,
        job=job,
        operation="upload_chunk",
        operation_id=f"{offset}:{chunk_sha256}",
    )
    if frappe.request.content_type != "application/octet-stream":
        frappe.throw(_("Recording upload chunks must be binary data"))
    return append_chunk(
        recording_id,
        offset=offset,
        chunk=frappe.request.get_data(cache=False),
        chunk_sha256=chunk_sha256,
    )


@frappe.whitelist(allow_guest=True)
def recorder_complete_upload(recording_id: str, job: str, event_sequence: int) -> dict:
    authenticate_callback(
        recording=recording_id,
        job=job,
        operation="complete_upload",
        operation_id=str(event_sequence),
    )
    result = complete_upload(recording_id, event_sequence=event_sequence)
    recording = frappe.get_doc("Meet Recording", recording_id)
    _publish_state(frappe.get_doc("Meet Room", recording.meet_room), recording)
    return result


@frappe.whitelist(allow_guest=True)
def recorder_failed(
    recording_id: str,
    job: str,
    event_sequence: int,
    failure_code: str = "capture_failed",
) -> dict:
    authenticate_callback(
        recording=recording_id,
        job=job,
        operation="failed",
        operation_id=str(event_sequence),
    )
    recording = frappe.get_doc("Meet Recording", recording_id)
    if recording.status == "Failed":
        return {"status": "Failed"}
    if recording.status not in ("Recording", "Interrupted", "Stopping", "Processing"):
        frappe.throw(_("Recording cannot accept a failure callback"))
    if cint(event_sequence) <= recording.recorder_event_sequence:
        frappe.throw(_("Recorder event is out of order"))
    if failure_code not in ("capture_failed", "processing_failed", "storage_unavailable", "quota_exhausted"):
        frappe.throw(_("Invalid recording failure code"))
    recording.status = "Failed"
    recording.state_revision += 1
    recording.recorder_event_sequence = cint(event_sequence)
    recording.failure_code = failure_code
    recording.save(ignore_permissions=True)
    _publish_state(frappe.get_doc("Meet Room", recording.meet_room), recording)
    return {"status": "Failed"}


def reconcile_pending_recordings():
    names = frappe.get_all(
        "Meet Recording",
        filters={"status": "Pending", "pending_deadline": ["<=", now_datetime()]},
        pluck="name",
    )
    for name in names:
        try:
            _reconcile_pending(name)
        except Exception:
            frappe.log_error(title="Meet recording reconciliation failed", message=frappe.get_traceback())

    for name in frappe.get_all("Meet Recording", filters={"status": "Stopping"}, pluck="name"):
        try:
            _retry_stopping(name)
        except Exception:
            frappe.log_error(title="Meet recording stop retry failed", message=frappe.get_traceback())


def _retry_stopping(name: str):
    recording = frappe.get_doc("Meet Recording", name)
    if _fixture_enabled():
        return
    _client().stop(
        room=recording.meet_room,
        recording=recording.name,
        job=recording.recorder_job_id,
        limits=_limits(recording),
        operation_id=_stop_operation_id(recording),
    )


def _reconcile_pending(name: str):
    recording = frappe.get_doc("Meet Recording", name)
    client = None if _fixture_enabled() else _client()
    outcome = (
        _fixture_outcome(recording)
        if _fixture_enabled()
        else client.query(
            room=recording.meet_room,
            recording=recording.name,
            job=recording.recorder_job_id,
            limits=_limits(recording),
        )
    )
    room = frappe.get_doc("Meet Room", recording.meet_room)
    if outcome.outcome == "rejected":
        _reject_pending(room, recording)
        return
    if outcome.outcome != "accepted":
        return

    room.recording_policy_lock()
    current = frappe.get_doc("Meet Recording", name)
    if current.status != "Pending":
        frappe.db.commit()
        return
    room.reload()
    if _policy_allows_recording(room):
        _finish_start(room, current, outcome, client, room_locked=True)
        return

    operation_id = _stop_operation_id(current)
    frappe.db.commit()
    if client and client.stop(
        room=current.meet_room,
        recording=current.name,
        job=current.recorder_job_id,
        limits=_limits(current),
        operation_id=operation_id,
    ):
        _reject_pending(room, current)
