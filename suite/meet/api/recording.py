# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import frappe
import isodate
from frappe import _
from frappe.utils import add_to_date, cint, get_datetime, now_datetime

from suite.drive.api.storage import (
    acquire_owner_storage_lock,
    create_storage_reservation,
    get_storage_usage,
    grow_storage_reservation,
)
from suite.drive.utils import get_user_folder
from suite.meet.doctype.meet_recording.meet_recording import (
    ACTIVE_RECORDING_STATUSES,
    recording_storage_reservation_key,
)
from suite.meet.recording.callback_auth import authenticate_callback
from suite.meet.recording.grants import (
    mint_recording_grant,
    normalize_public_jwk,
    public_jwk_thumbprint,
)
from suite.meet.recording.ingest import (
    CHUNK_SIZE,
    _upload_path,
    append_chunk,
    begin_upload,
    complete_upload,
)
from suite.meet.recording.recorder_client import RecorderClient, RecorderOutcome

MAX_SECONDS = 4 * 60 * 60
DEFAULT_ESTIMATE_SECONDS = 60 * 60
BYTES_PER_SECOND = int(((5_000_000 + 128_000) / 8) * 1.1)
MAX_BUDGET_BYTES = MAX_SECONDS * BYTES_PER_SECOND
# Successor-gated adoption, validation, and callback shutdown can leave up to
# three full segments in flight before capture stops.
MINIMUM_BUDGET_BYTES = BYTES_PER_SECOND * 90 + 5 * 1024 * 1024
RECONCILIATION_GRACE_SECONDS = 5 * 60
PROCESSING_TIMEOUT_SECONDS = 24 * 60 * 60
FAILED_RETENTION_DAYS = 30
STARTUP_TIMEOUT_SECONDS = 60
STARTUP_MILESTONES = {
    "configured": "configured_at",
    "proof_complete": "proof_completed_at",
    "joined": "joined_at",
    "capture_started": "capture_started_at",
}


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
        return MAX_BUDGET_BYTES
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

    budget_bytes = min(MAX_BUDGET_BYTES, free_bytes)
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
    state = frappe.db.get_value(
        "Meet Recording",
        {"meet_room": meeting_id, "status": ["in", ACTIVE_RECORDING_STATUSES]},
        [
            "name",
            "status",
            "started_at",
            "capture_started_at",
            "state_revision",
            "interruption_id",
            "interrupted_at",
            "interruption_deadline",
        ],
        as_dict=True,
    )
    if state and state.status == "Starting":
        room = frappe.get_doc("Meet Room", meeting_id)
        if not room.is_host_or_cohost(frappe.session.user):
            return None
    return state


def _validate_request_id(request_id: str):
    try:
        if str(uuid.UUID(request_id)) != request_id.lower():
            raise ValueError
    except (ValueError, AttributeError):
        frappe.throw(_("Request ID must be a UUID"))


def _publish_state(room, recording, *, hosts_only: bool = False):
    payload = {
        "meeting_id": room.name,
        "recording": (
            {
                "name": recording.name,
                "status": recording.status,
                "started_at": recording.started_at,
                "capture_started_at": recording.capture_started_at,
                "state_revision": recording.state_revision,
                "interruption_id": recording.interruption_id,
                "interrupted_at": recording.interrupted_at,
                "interruption_deadline": recording.interruption_deadline,
            }
            if recording
            else None
        ),
    }
    users = (
        {room.owner, *room.get_co_hosts()}
        if hosts_only or (recording and recording.status == "Starting")
        else set(room.get_members())
    )
    for user in users:
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


def _utc_now_naive():
    return _system_datetime_as_utc(now_datetime()).replace(tzinfo=None)


def _bounded_end(recording):
    ended_at = _utc_now_naive()
    if recording.max_ends_at:
        maximum = _system_datetime_as_utc(recording.max_ends_at).replace(tzinfo=None)
        ended_at = min(ended_at, maximum)
    return ended_at


def _locked_recording(recording_id: str):
    frappe.db.get_value("Meet Recording", recording_id, "name", for_update=True)
    return frappe.get_doc("Meet Recording", recording_id)


def _fixture_outcome(recording) -> RecorderOutcome:
    accepted_at = _system_datetime_as_utc(recording.creation)
    return RecorderOutcome("accepted", accepted_at=accepted_at, public_jwk=FIXTURE_JWK, endpoint_generation=0)


def _stored_public_jwk(recording) -> dict[str, str]:
    return frappe.parse_json(recording.recorder_public_jwk)


def _accept(room, recording, outcome: RecorderOutcome):
    room.reload()
    if not frappe.get_cached_doc("Meet Settings").enable_recording or room.e2ee_enabled:
        frappe.throw(_("Recording policy changed before the recorder accepted the job"))
    accepted_at = outcome.accepted_at
    if not isinstance(accepted_at, datetime) or accepted_at.tzinfo is None:
        frappe.throw(_("Recorder acceptance time must include a timezone"))
    accepted_at = accepted_at.astimezone(UTC)
    if (
        accepted_at < _system_datetime_as_utc(recording.creation) - timedelta(minutes=5)
        or accepted_at > _system_datetime_as_utc(now_datetime()) + timedelta(minutes=5)
        or accepted_at > _system_datetime_as_utc(recording.max_ends_at)
    ):
        frappe.throw(_("Recorder acceptance time is outside the recording interval"))
    if outcome.endpoint_generation != 0:
        frappe.throw(_("An initial Recorder Endpoint must use generation 0"))
    recording.recorder_public_jwk = outcome.public_jwk
    recording.recorder_key_thumbprint = public_jwk_thumbprint(outcome.public_jwk)
    recording.endpoint_generation = outcome.endpoint_generation
    recording.status = "Starting"
    recording.recorder_event_sequence = max(1, recording.recorder_event_sequence)
    recording.recorder_accepted_at = accepted_at.replace(tzinfo=None)
    recording.save(ignore_permissions=True)
    _publish_state(room, recording, hosts_only=True)
    frappe.db.commit()
    return recording


def _policy_allows_recording(room) -> bool:
    return bool(frappe.get_cached_doc("Meet Settings").enable_recording and not room.e2ee_enabled)


def _reject_pending(room, recording):
    room.recording_policy_lock()
    current = frappe.get_doc("Meet Recording", recording.name)
    if current.status in ("Pending", "Starting"):
        _fail_startup(room, current, "recorder_rejected")
        frappe.db.commit()


def _fail_startup(room, recording, failure_code: str):
    if recording.status not in ("Pending", "Starting"):
        return
    recording.status = "Failed"
    recording.state_revision += 1
    recording.failure_code = failure_code
    recording.flags.startup_failure = True
    recording.save(ignore_permissions=True)
    _publish_state(room, None, hosts_only=True)


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
            if existing.status in ("Starting", "Recording"):
                recording = frappe.get_doc("Meet Recording", existing.name)
                if existing.status == "Starting" and not recording.recorder_accepted_at:
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
                if recording.grant_delivered:
                    return {"name": existing.name, "status": existing.status, "grant_delivered": True}
                outcome = RecorderOutcome(
                    "accepted",
                    accepted_at=get_datetime(recording.recorder_accepted_at).replace(tzinfo=UTC),
                    public_jwk=_stored_public_jwk(recording),
                    endpoint_generation=cint(recording.endpoint_generation),
                )
                return _finish_start(room, recording, outcome, None if _fixture_enabled() else _client())
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
    active = frappe.db.get_value(
        "Meet Recording",
        {"meet_room": meeting_id, "status": ["in", ACTIVE_RECORDING_STATUSES]},
        ["name", "status", "grant_delivered"],
        as_dict=True,
    )
    if active:
        return active
    destination = _get_drive_destination(room.owner)
    acquire_owner_storage_lock(room.owner)
    owner_limit = max(1, cint(frappe.conf.get("recorder_max_concurrent_per_owner") or 1))
    if (
        frappe.db.count(
            "Meet Recording",
            {
                "room_owner": room.owner,
                "status": ["in", ("Pending", *ACTIVE_RECORDING_STATUSES)],
            },
        )
        >= owner_limit
    ):
        frappe.throw(_("The Room Owner already has the maximum number of active recordings"))
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
            "status": "Starting",
            "estimated_seconds": preflight["estimated_seconds"],
            "estimated_bytes": preflight["estimated_bytes"],
            "budget_bytes": preflight["budget_bytes"],
            "max_ends_at": add_to_date(now, seconds=MAX_SECONDS + STARTUP_TIMEOUT_SECONDS),
            "recorder_job_id": frappe.generate_hash(length=32),
            "request_id": request_id,
            "pending_deadline": add_to_date(now, seconds=STARTUP_TIMEOUT_SECONDS),
            "drive_home_folder": destination,
        }
    ).insert(ignore_permissions=True)
    create_storage_reservation(
        room.owner,
        recording_storage_reservation_key(recording.name),
        cint(recording.budget_bytes),
    )
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
        return {"name": recording.name, "status": recording.status}

    room = frappe.get_doc("Meet Room", recording.meet_room)
    if not room_locked:
        room.recording_policy_lock()
    current = frappe.get_doc("Meet Recording", recording.name)
    if current.status in ("Pending", "Starting") and not current.recorder_accepted_at:
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
    if current.status != "Starting":
        return {"name": current.name, "status": current.status}
    if current.grant_delivered:
        return {"name": current.name, "status": current.status, "grant_delivered": True}

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
            endpoint_generation=cint(current.endpoint_generation),
        )
    )
    if not delivered:
        return _stop_after_grant_delivery_failure(room, current, client)
    current.grant_delivered = True
    current.grant_delivered_at = _utc_now_naive()
    current.save(ignore_permissions=True)
    frappe.db.commit()
    if client is None:
        timestamp = (
            _system_datetime_as_utc(now_datetime()).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        )
        for sequence, milestone in enumerate(
            ("configured", "proof_complete", "joined", "capture_started"), 2
        ):
            _apply_startup_milestone(current.name, sequence, milestone, timestamp)
        current = frappe.get_doc("Meet Recording", current.name)
    return {"name": current.name, "status": current.status, "grant_delivered": delivered}


def _stop_after_grant_delivery_failure(room, recording, client: RecorderClient | None) -> dict:
    recording.status = "Failed"
    recording.state_revision += 1
    recording.failure_code = "grant_delivery_failed"
    recording.flags.startup_failure = True
    operation_id = _stop_operation_id(recording)
    recording.save(ignore_permissions=True)
    _publish_state(room, None, hosts_only=True)
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
    recording = _locked_recording(recording_name)
    if recording.status == "Starting":
        recording.status = "Cancelled"
        recording.state_revision += 1
        _stop_operation_id(recording)
        recording.save(ignore_permissions=True)
    elif recording.status in ("Recording", "Interrupted"):
        recording.status = "Stopping"
        recording.state_revision += 1
        recording.end_reason = "host_stop"
        _stop_operation_id(recording)
        recording.save(ignore_permissions=True)
        if _fixture_enabled():
            recording.status = "Processing"
            recording.state_revision += 1
            recording.recorder_event_sequence += 1
            recording.ended_at = _bounded_end(recording)
            recording.save(ignore_permissions=True)
    _publish_state(room, recording, hosts_only=recording.status == "Cancelled")
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


def _startup_timestamp(value: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        frappe.throw(_("Recording startup timestamp must be UTC"))
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        frappe.throw(_("Recording startup timestamp is invalid"))
    if parsed.tzinfo is None:
        frappe.throw(_("Recording startup timestamp must include a timezone"))
    return parsed.astimezone(UTC)


def _apply_startup_milestone(
    recording_id: str,
    event_sequence: int,
    milestone: str,
    occurred_at: str,
) -> dict:
    fieldname = STARTUP_MILESTONES.get(milestone)
    if not fieldname:
        frappe.throw(_("Invalid Recording Startup milestone"))
    recording = _locked_recording(recording_id)
    if recording.status == "Recording" and milestone == "capture_started":
        return {"status": "Recording"}
    if recording.status != "Starting":
        return {"status": recording.status}
    sequence = cint(event_sequence)
    if sequence <= recording.recorder_event_sequence:
        if recording.get(fieldname):
            return {"status": recording.status}
        frappe.throw(_("Recorder startup event is out of order"))
    if sequence != recording.recorder_event_sequence + 1:
        frappe.throw(_("Recorder startup event sequence has a gap"))

    occurred = _startup_timestamp(occurred_at)
    accepted = get_datetime(recording.recorder_accepted_at).replace(tzinfo=UTC)
    if occurred + timedelta(milliseconds=1) < accepted or occurred > _system_datetime_as_utc(
        now_datetime()
    ) + timedelta(minutes=5):
        frappe.throw(_("Recording startup timestamp is outside the startup interval"))
    previous_fields = list(STARTUP_MILESTONES.values())[: list(STARTUP_MILESTONES).index(milestone)]
    if any(not recording.get(previous) for previous in previous_fields):
        frappe.throw(_("Recording Startup milestones must be ordered"))
    if previous_fields and occurred.replace(tzinfo=None) < get_datetime(recording.get(previous_fields[-1])):
        frappe.throw(_("Recording Startup milestone time is out of order"))

    occurred_naive = occurred.replace(tzinfo=None)
    recording.set(fieldname, occurred_naive)
    recording.recorder_event_sequence = sequence
    if milestone == "capture_started":
        recording.started_at = occurred_naive
        recording.max_ends_at = (
            (occurred + timedelta(seconds=MAX_SECONDS))
            .astimezone(ZoneInfo(frappe.utils.get_system_timezone()))
            .replace(tzinfo=None)
        )
        recording.status = "Recording"
        recording.state_revision += 1
    recording.save(ignore_permissions=True)
    room = frappe.get_doc("Meet Room", recording.meet_room)
    _publish_state(room, recording, hosts_only=recording.status == "Starting")
    return {"status": recording.status}


@frappe.whitelist(allow_guest=True, methods=["POST"])
def recorder_startup_progress(
    recording_id: str,
    job: str,
    event_sequence: int,
    milestone: str,
    occurred_at: str,
) -> dict:
    """Apply one authenticated, strictly ordered Recorder Startup milestone."""
    authenticate_callback(
        recording=recording_id,
        job=job,
        operation="startup_progress",
        operation_id=str(event_sequence),
    )
    return _apply_startup_milestone(recording_id, event_sequence, milestone, occurred_at)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def recorder_interrupted(
    recording_id: str,
    job: str,
    event_sequence: int,
    reason: str,
    interruption_id: str,
    interrupted_at: str,
    interruption_deadline: str,
    omission_started_at: str,
) -> dict:
    authenticate_callback(
        recording=recording_id,
        job=job,
        operation="interrupted",
        operation_id=str(event_sequence),
    )
    return _apply_interruption(
        recording_id,
        event_sequence,
        reason,
        interruption_id,
        interrupted_at,
        interruption_deadline,
        omission_started_at,
    )


@frappe.whitelist(allow_guest=True, methods=["POST"])
def recorder_segment_progress(recording_id: str, job: str, captured_bytes: int) -> dict:
    """Grow one active Recording Session's budget after a durable segment."""
    authenticate_callback(
        recording=recording_id,
        job=job,
        operation="segment_progress",
        operation_id=str(captured_bytes),
    )
    return _apply_segment_progress(recording_id, captured_bytes)


def _apply_segment_progress(recording_id: str, captured_bytes: int, *, grow_budget: bool = True) -> dict:
    if isinstance(captured_bytes, bool) or not isinstance(captured_bytes, int) or captured_bytes < 0:
        frappe.throw(_("Captured bytes must be a nonnegative integer"))

    recording = _locked_recording(recording_id)
    if captured_bytes < cint(recording.captured_bytes):
        frappe.throw(_("Captured bytes cannot decrease"))
    if captured_bytes == cint(recording.captured_bytes):
        return {"budget_bytes": cint(recording.budget_bytes)}
    if recording.status not in ("Recording", "Interrupted", "Stopping"):
        frappe.throw(_("Recording Session is not accepting segment progress"))
    if captured_bytes > cint(recording.budget_bytes):
        frappe.throw(_("Captured bytes exceed the Recording Budget"))

    if recording.status == "Stopping" or not grow_budget:
        recording.captured_bytes = captured_bytes
        recording.flags.budget_update = True
        recording.save(ignore_permissions=True)
        return {"budget_bytes": cint(recording.budget_bytes)}

    acquire_owner_storage_lock(recording.room_owner)
    free_bytes = _get_free_bytes(recording.room_owner)
    budget_bytes = min(MAX_BUDGET_BYTES, cint(recording.budget_bytes) + free_bytes)
    if budget_bytes > cint(recording.budget_bytes):
        grow_storage_reservation(
            recording.room_owner,
            recording_storage_reservation_key(recording.name),
            budget_bytes,
        )

    warnings = []
    remaining_seconds = max(0, budget_bytes - captured_bytes) // BYTES_PER_SECOND
    if budget_bytes < MAX_BUDGET_BYTES:
        if remaining_seconds <= 10 * 60 and not recording.budget_warning_10m_sent:
            recording.budget_warning_10m_sent = True
            warnings.append(10 * 60)
        if remaining_seconds <= 2 * 60 and not recording.budget_warning_2m_sent:
            recording.budget_warning_2m_sent = True
            warnings.append(2 * 60)

    recording.budget_bytes = budget_bytes
    recording.captured_bytes = captured_bytes
    recording.flags.budget_update = True
    recording.save(ignore_permissions=True)
    room = frappe.get_doc("Meet Room", recording.meet_room)
    for threshold_seconds in warnings:
        _publish_budget_warning(room, recording, threshold_seconds, remaining_seconds)
    return {"budget_bytes": budget_bytes}


def _publish_budget_warning(room, recording, threshold_seconds: int, remaining_seconds: int):
    payload = {
        "meeting_id": room.name,
        "recording_id": recording.name,
        "threshold_seconds": threshold_seconds,
        "remaining_seconds": remaining_seconds,
    }
    for user in {room.owner, *room.get_co_hosts()}:
        frappe.publish_realtime(
            "meeting:recording_budget_warning",
            message=payload,
            user=user,
            after_commit=True,
        )


def _apply_interruption(
    recording_id: str,
    event_sequence: int,
    reason: str,
    interruption_id: str,
    interrupted_at: str,
    interruption_deadline: str,
    omission_started_at: str,
) -> dict:
    recording = _locked_recording(recording_id)
    if recording.status == "Interrupted":
        if recording.interruption_id != interruption_id:
            frappe.throw(_("Recorder interruption does not match the active interruption"))
        return {"status": "Interrupted"}
    if recording.status != "Recording":
        return {"status": recording.status}
    if cint(event_sequence) != recording.recorder_event_sequence + 1:
        frappe.throw(_("Recorder event is out of order"))
    if not isinstance(reason, str) or not reason or len(reason) > 256:
        frappe.throw(_("Invalid recording interruption reason"))
    try:
        if str(uuid.UUID(interruption_id)) != interruption_id.lower():
            raise ValueError
    except (ValueError, AttributeError):
        frappe.throw(_("Invalid recording interruption ID"))
    interrupted = _startup_timestamp(interrupted_at)
    deadline = _startup_timestamp(interruption_deadline)
    omission_started = _startup_timestamp(omission_started_at)
    if deadline != interrupted + timedelta(seconds=60):
        frappe.throw(_("Recording interruption deadline must be fixed at 60 seconds"))
    started = get_datetime(recording.started_at).replace(tzinfo=UTC)
    if omission_started < started or omission_started > interrupted:
        frappe.throw(_("Recording omission start is outside the Recording Session"))
    recording.status = "Interrupted"
    recording.state_revision += 1
    recording.recorder_event_sequence = cint(event_sequence)
    recording.interruption_id = interruption_id
    recording.interrupted_at = interrupted.replace(tzinfo=None)
    recording.interruption_deadline = deadline.replace(tzinfo=None)
    recording.interruption_reason = reason
    recording.omission_started_at = omission_started.replace(tzinfo=None)
    recording.resumed_capture_started_at = None
    recording.recovered_at = None
    recording.replacement_ready_at = None
    recording.replacement_event_sequence = 0
    recording.save(ignore_permissions=True)
    _publish_state(frappe.get_doc("Meet Room", recording.meet_room), recording)
    return {"status": "Interrupted"}


@frappe.whitelist(allow_guest=True, methods=["POST"])
def recorder_replacement_ready(
    recording_id: str,
    job: str,
    event_sequence: int,
    interruption_id: str,
    endpoint_generation: int,
    public_jwk: str | dict,
    ready_at: str,
) -> dict:
    """Authorize one strictly ordered replacement Recorder Endpoint."""
    authenticate_callback(
        recording=recording_id,
        job=job,
        operation="replacement_ready",
        operation_id=str(event_sequence),
    )
    return _apply_replacement_ready(
        recording_id,
        event_sequence,
        interruption_id,
        endpoint_generation,
        public_jwk,
        ready_at,
        _client(),
    )


def _apply_replacement_ready(
    recording_id: str,
    event_sequence: int,
    interruption_id: str,
    endpoint_generation: int,
    public_jwk: str | dict,
    ready_at: str,
    client: RecorderClient,
    *,
    reconcile: bool = False,
) -> dict:
    recording = _locked_recording(recording_id)
    sequence = cint(event_sequence)
    if isinstance(endpoint_generation, bool) or not isinstance(endpoint_generation, int):
        frappe.throw(_("Replacement Recorder Endpoint generation must be a nonnegative integer"))
    generation = cint(endpoint_generation)
    try:
        normalized_jwk = normalize_public_jwk(frappe.parse_json(public_jwk))
    except (TypeError, ValueError):
        frappe.throw(_("Invalid replacement Recorder Endpoint key"))
    ready = _startup_timestamp(ready_at)

    exact_retry = (
        generation == cint(recording.endpoint_generation)
        and sequence == cint(recording.replacement_event_sequence)
        and interruption_id == recording.interruption_id
        and recording.replacement_ready_at
        and ready.replace(tzinfo=None) == get_datetime(recording.replacement_ready_at)
        and normalized_jwk == _stored_public_jwk(recording)
    )
    if exact_retry:
        if recording.status == "Interrupted" and not recording.grant_delivered:
            frappe.db.commit()
            _deliver_replacement_grant(recording, client)
            recording.reload()
        return {
            "status": recording.status,
            "grant_delivered": bool(recording.grant_delivered),
        }
    if recording.status != "Interrupted":
        frappe.throw(_("A replacement Recorder Endpoint requires an active interruption"))
    if interruption_id != recording.interruption_id:
        frappe.throw(_("Replacement Recorder Endpoint does not match the active interruption"))
    sequence_delta = sequence - cint(recording.recorder_event_sequence)
    generation_delta = generation - cint(recording.endpoint_generation)
    if reconcile:
        if generation_delta <= 0 or sequence_delta != generation_delta:
            frappe.throw(_("Replacement Recorder Endpoint state is contradictory"))
    elif sequence_delta != 1 or generation_delta != 1:
        frappe.throw(_("Replacement Recorder Endpoint event is stale, out of order, or has a gap"))
    if normalized_jwk == _stored_public_jwk(recording):
        frappe.throw(_("Replacement Recorder Endpoint must use a fresh key"))

    interrupted = get_datetime(recording.interrupted_at).replace(tzinfo=UTC)
    deadline = get_datetime(recording.interruption_deadline).replace(tzinfo=UTC)
    maximum = _system_datetime_as_utc(recording.max_ends_at)
    now = _system_datetime_as_utc(now_datetime())
    if ready <= interrupted or ready > min(deadline, maximum) or ready > now + timedelta(minutes=5):
        frappe.throw(_("Replacement readiness is outside the active interruption interval"))
    if now >= min(deadline, maximum):
        frappe.throw(_("The Recording Interruption no longer accepts a replacement endpoint"))

    issued_at = int(ready.timestamp())
    expires_at = int(min(deadline, maximum).timestamp())
    if expires_at <= issued_at:
        frappe.throw(_("The Recording Interruption no longer accepts a replacement endpoint"))
    recording.endpoint_generation = generation
    recording.replacement_event_sequence = sequence
    recording.replacement_ready_at = ready.replace(tzinfo=None)
    recording.recorder_event_sequence = sequence
    recording.recorder_public_jwk = normalized_jwk
    recording.recorder_key_thumbprint = public_jwk_thumbprint(normalized_jwk)
    recording.grant_jti = str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"{frappe.local.site}:{recording.name}:{interruption_id}:{generation}",
        )
    )
    recording.grant_issued_at = issued_at
    recording.grant_expires_at = expires_at
    recording.grant_delivered = False
    recording.grant_delivered_at = None
    recording.flags.replacement_reconciliation = reconcile
    recording.save(ignore_permissions=True)
    _deliver_replacement_grant(recording, client)
    recording.reload()
    return {
        "status": recording.status,
        "grant_delivered": bool(recording.grant_delivered),
    }


def _deliver_replacement_grant(recording, client: RecorderClient) -> bool:
    if recording.status != "Interrupted" or recording.grant_delivered:
        return bool(recording.grant_delivered)
    now = int(time.time())
    if now >= cint(recording.grant_expires_at):
        return False
    grant = mint_recording_grant(
        secret=frappe.conf.get("sfu_secret"),
        site=frappe.local.site,
        meeting_id=recording.meet_room,
        recording_id=recording.name,
        recorder_job_id=recording.recorder_job_id,
        public_jwk=_stored_public_jwk(recording),
        max_ends_at=_system_datetime_as_utc(recording.max_ends_at),
        authorization_expires_at=cint(recording.grant_expires_at),
        issued_at=cint(recording.grant_issued_at),
        expires_in=cint(recording.grant_expires_at) - cint(recording.grant_issued_at),
        jti=recording.grant_jti,
    )
    delivered = client.deliver_grant(
        room=recording.meet_room,
        recording=recording.name,
        job=recording.recorder_job_id,
        limits=_limits(recording),
        grant=grant,
        endpoint_generation=cint(recording.endpoint_generation),
    )
    if not delivered:
        return False
    current = frappe.get_doc("Meet Recording", recording.name)
    if (
        current.status == "Interrupted"
        and cint(current.endpoint_generation) == cint(recording.endpoint_generation)
        and current.grant_jti == recording.grant_jti
        and not current.grant_delivered
    ):
        current.grant_delivered = True
        current.grant_delivered_at = _utc_now_naive()
        current.save(ignore_permissions=True)
        frappe.db.commit()
    return True


@frappe.whitelist(allow_guest=True, methods=["POST"])
def recorder_recovered(
    recording_id: str,
    job: str,
    event_sequence: int,
    interruption_id: str,
    resumed_capture_started_at: str,
    recovered_at: str,
) -> dict:
    authenticate_callback(
        recording=recording_id,
        job=job,
        operation="recovered",
        operation_id=str(event_sequence),
    )
    return _apply_recovery(
        recording_id,
        event_sequence,
        interruption_id,
        resumed_capture_started_at,
        recovered_at,
    )


def _apply_recovery(
    recording_id: str,
    event_sequence: int,
    interruption_id: str,
    resumed_capture_started_at: str,
    recovered_at: str,
) -> dict:
    recording = _locked_recording(recording_id)
    if recording.status == "Recording":
        return {"status": "Recording"}
    if recording.status != "Interrupted":
        return {"status": recording.status}
    if interruption_id != recording.interruption_id:
        frappe.throw(_("Recorder recovery does not match the active interruption"))
    if recording.replacement_ready_at and not recording.grant_delivered:
        frappe.throw(_("Replacement Recorder Endpoint grant has not been delivered"))
    if cint(event_sequence) != recording.recorder_event_sequence + 1:
        frappe.throw(_("Recorder recovery event is out of order"))
    resumed = _startup_timestamp(resumed_capture_started_at)
    recovered = _startup_timestamp(recovered_at)
    deadline = get_datetime(recording.interruption_deadline).replace(tzinfo=UTC)
    omission_started = get_datetime(recording.omission_started_at).replace(tzinfo=UTC)
    if resumed < omission_started or recovered < resumed or recovered > deadline:
        frappe.throw(_("Recorder recovery is outside the active interruption interval"))
    recording.status = "Recording"
    recording.state_revision += 1
    recording.recorder_event_sequence = cint(event_sequence)
    recording.resumed_capture_started_at = resumed.replace(tzinfo=None)
    recording.recovered_at = recovered.replace(tzinfo=None)
    gaps = frappe.parse_json(recording.capture_gaps) or []
    reason = recording.interruption_reason or "capture_interrupted"
    if reason.startswith("renderer:"):
        reason = "renderer_interrupted"
    elif reason != "ffmpeg_exited":
        reason = "capture_interrupted"
    gaps.append(
        {
            "started_at": omission_started.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "ended_at": resumed.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "reason": reason,
        }
    )
    recording.capture_gaps = frappe.as_json(gaps)
    recording.flags.recovery_update = True
    recording.save(ignore_permissions=True)
    _publish_state(frappe.get_doc("Meet Room", recording.meet_room), recording)
    return {"status": "Recording"}


@frappe.whitelist(allow_guest=True, methods=["POST"])
def recorder_stopped(
    recording_id: str,
    job: str,
    event_sequence: int,
    captured_bytes: int,
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
    if not ended_at:
        frappe.throw(_("Recording stop callback requires an end time"))
    _apply_segment_progress(recording_id, captured_bytes, grow_budget=False)
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


@frappe.whitelist(allow_guest=True, methods=["POST"])
def recorder_upload_chunk(recording_id: str, job: str, offset: int, chunk_sha256: str) -> dict:
    authenticate_callback(
        recording=recording_id,
        job=job,
        operation="upload_chunk",
        operation_id=f"{offset}:{chunk_sha256}",
    )
    if frappe.request.content_type != "application/octet-stream":
        frappe.throw(_("Recording upload chunks must be binary data"))
    if frappe.request.content_length is not None and frappe.request.content_length > CHUNK_SIZE:
        frappe.throw(_("Recording upload chunk is too large"))
    return append_chunk(
        recording_id,
        offset=offset,
        chunk=frappe.request.get_data(cache=True),
        chunk_sha256=chunk_sha256,
    )


@frappe.whitelist(allow_guest=True, methods=["POST"])
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


@frappe.whitelist(allow_guest=True, methods=["POST"])
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
    recording = _locked_recording(recording_id)
    if recording.status == "Failed":
        return {"status": "Failed"}
    if recording.status == "Cancelled":
        return {"status": "Cancelled"}
    if recording.status not in ("Starting", "Recording", "Interrupted", "Stopping", "Processing"):
        frappe.throw(_("Recording cannot accept a failure callback"))
    if cint(event_sequence) <= recording.recorder_event_sequence:
        frappe.throw(_("Recorder event is out of order"))
    if failure_code not in ("capture_failed", "processing_failed", "storage_unavailable", "quota_exhausted"):
        frappe.throw(_("Invalid recording failure code"))
    startup_failure = recording.status == "Starting"
    recording.status = "Failed"
    recording.state_revision += 1
    recording.recorder_event_sequence = cint(event_sequence)
    recording.failure_code = failure_code
    if recording.started_at:
        recording.ended_at = recording.ended_at or _bounded_end(recording)
    if startup_failure:
        recording.flags.startup_failure = True
    recording.save(ignore_permissions=True)
    _publish_state(
        frappe.get_doc("Meet Room", recording.meet_room),
        None if startup_failure else recording,
        hosts_only=startup_failure,
    )
    return {"status": "Failed"}


def reconcile_pending_recordings():
    # Pending/Stopping reconciliation needs the recorder server. Without one configured,
    # skip those phases instead of erroring per recording; the stale sweep below fails
    # such recordings with "recorder_unavailable" once they pass max_ends_at.
    utc_now = _utc_now_naive()
    fixture_enabled = _fixture_enabled()
    recorder_available = not fixture_enabled and _recorder_available()
    if recorder_available:
        for name in frappe.get_all("Meet Recording", filters={"status": "Recording"}, pluck="name"):
            _run_reconciliation(name, _reconcile_recording)

        for name in frappe.get_all("Meet Recording", filters={"status": "Interrupted"}, pluck="name"):
            _run_reconciliation(name, _reconcile_interrupted)

    for name in frappe.get_all(
        "Meet Recording",
        filters={"status": "Interrupted", "interruption_deadline": ["<=", utc_now]},
        pluck="name",
    ):
        _run_reconciliation(name, _timeout_interruption)

    if fixture_enabled or recorder_available:
        names = frappe.get_all(
            "Meet Recording",
            filters={"status": ["in", ("Pending", "Starting")], "pending_deadline": ["<=", now_datetime()]},
            pluck="name",
        )
        for name in names:
            _run_reconciliation(name, _reconcile_pending)

        for name in frappe.get_all("Meet Recording", filters={"status": "Stopping"}, pluck="name"):
            _run_reconciliation(name, _retry_stopping)

    stale_active_cutoff = add_to_date(now_datetime(), seconds=-RECONCILIATION_GRACE_SECONDS)
    for name in frappe.get_all(
        "Meet Recording",
        filters={
            "status": ["in", ("Pending", "Starting", "Recording", "Interrupted", "Stopping")],
            "max_ends_at": ["<=", stale_active_cutoff],
        },
        pluck="name",
    ):
        _run_reconciliation(name, _fail_stale_recording)

    processing_cutoff = add_to_date(now_datetime(), seconds=-PROCESSING_TIMEOUT_SECONDS)
    for name in frappe.get_all(
        "Meet Recording",
        filters={"status": "Processing", "modified": ["<=", processing_cutoff]},
        pluck="name",
    ):
        _run_reconciliation(name, _fail_stale_recording)

    failed_cutoff = add_to_date(now_datetime(), days=-FAILED_RETENTION_DAYS)
    for name in frappe.get_all(
        "Meet Recording",
        filters={"status": ["in", ("Failed", "Cancelled")], "modified": ["<", failed_cutoff]},
        pluck="name",
    ):
        _run_reconciliation(name, _delete_expired_failed_recording)


def cleanup_failed_recordings():
    failed_cutoff = add_to_date(now_datetime(), days=-FAILED_RETENTION_DAYS)
    for name in frappe.get_all(
        "Meet Recording",
        filters={"status": ["in", ("Failed", "Cancelled")], "modified": ["<=", failed_cutoff]},
        pluck="name",
    ):
        _run_reconciliation(name, _delete_expired_failed_recording)


def _run_reconciliation(name: str, operation):
    try:
        operation(name)
        frappe.db.commit()
    except Exception:
        frappe.db.rollback()
        frappe.log_error(
            title=f"Meet recording reconciliation failed for {name}",
            message=frappe.get_traceback(),
        )


def _fail_stale_recording(name: str):
    recording = frappe.get_doc("Meet Recording", name)
    if recording.status not in ("Pending", "Starting", "Recording", "Interrupted", "Stopping", "Processing"):
        return
    if recording.status == "Processing" and recording.modified > add_to_date(
        now_datetime(), seconds=-PROCESSING_TIMEOUT_SECONDS
    ):
        return
    if recording.status != "Processing" and recording.max_ends_at > add_to_date(
        now_datetime(), seconds=-RECONCILIATION_GRACE_SECONDS
    ):
        return
    previous_status = recording.status
    recording.status = "Failed"
    recording.state_revision += 1
    recording.failure_code = (
        "processing_failed" if previous_status == "Processing" else "recorder_unavailable"
    )
    if recording.started_at:
        recording.ended_at = recording.ended_at or _bounded_end(recording)
    recording.flags.reconciliation_update = True
    recording.save(ignore_permissions=True)
    startup_failure = previous_status in ("Pending", "Starting")
    _publish_state(
        frappe.get_doc("Meet Room", recording.meet_room),
        None if startup_failure else recording,
        hosts_only=startup_failure,
    )


def _delete_expired_failed_recording(name: str):
    recording = frappe.get_doc("Meet Recording", name)
    upload_path = _upload_path(recording.upload_id) if recording.upload_id else None
    if upload_path:
        upload_path.unlink(missing_ok=True)
    frappe.delete_doc("Meet Recording", name, ignore_permissions=True)


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


def _timeout_interruption(name: str):
    recording = frappe.get_doc("Meet Recording", name)
    if recording.status != "Interrupted" or recording.interruption_deadline > _utc_now_naive():
        return
    recording.status = "Stopping"
    recording.state_revision += 1
    recording.end_reason = "interruption_timeout"
    _stop_operation_id(recording)
    recording.save(ignore_permissions=True)
    _publish_state(frappe.get_doc("Meet Room", recording.meet_room), recording)


def _reconcile_recording(name: str):
    recording = frappe.get_doc("Meet Recording", name)
    client = _client()
    outcome = client.query(
        room=recording.meet_room,
        recording=recording.name,
        job=recording.recorder_job_id,
        limits=_limits(recording),
    )
    interruption = outcome.interruption or {}
    if (
        outcome.outcome != "accepted"
        or outcome.state not in {"interrupted", "capture_ready"}
        or outcome.event_sequence is None
        or not interruption.get("id")
        or not interruption.get("interrupted_at")
        or not interruption.get("deadline")
        or not interruption.get("omission_started_at")
    ):
        return
    replacement_events = max(0, outcome.endpoint_generation - cint(recording.endpoint_generation))
    interruption_sequence = outcome.event_sequence
    if outcome.state == "capture_ready":
        interruption_sequence -= 1
    interruption_sequence -= replacement_events
    if interruption_sequence <= recording.recorder_event_sequence:
        return
    _apply_interruption(
        recording.name,
        interruption_sequence,
        outcome.health_reason or "capture_interrupted",
        interruption["id"],
        _callback_timestamp(interruption["interrupted_at"]),
        _callback_timestamp(interruption["deadline"]),
        _callback_timestamp(interruption["omission_started_at"]),
    )
    recording = frappe.get_doc("Meet Recording", recording.name)
    if outcome.endpoint_generation > cint(recording.endpoint_generation):
        if not outcome.public_jwk or not outcome.replacement_ready_at:
            return
        replacement_sequence = outcome.event_sequence - (1 if outcome.state == "capture_ready" else 0)
        _apply_replacement_ready(
            recording.name,
            replacement_sequence,
            interruption["id"],
            outcome.endpoint_generation,
            outcome.public_jwk,
            _callback_timestamp(outcome.replacement_ready_at),
            client,
            reconcile=True,
        )
    if (
        outcome.state == "capture_ready"
        and interruption.get("resumed_capture_started_at")
        and interruption.get("recovered_at")
    ):
        _apply_recovery(
            recording.name,
            outcome.event_sequence,
            interruption["id"],
            _callback_timestamp(interruption["resumed_capture_started_at"]),
            _callback_timestamp(interruption["recovered_at"]),
        )


def _reconcile_interrupted(name: str):
    recording = frappe.get_doc("Meet Recording", name)
    client = _client()
    outcome = client.query(
        room=recording.meet_room,
        recording=recording.name,
        job=recording.recorder_job_id,
        limits=_limits(recording),
    )
    interruption = outcome.interruption or {}
    if (
        outcome.outcome != "accepted"
        or outcome.state not in {"interrupted", "capture_ready"}
        or outcome.event_sequence is None
        or interruption.get("id") != recording.interruption_id
    ):
        return
    if outcome.endpoint_generation > cint(recording.endpoint_generation):
        if not outcome.public_jwk or not outcome.replacement_ready_at:
            return
        replacement_sequence = outcome.event_sequence - (1 if outcome.state == "capture_ready" else 0)
        _apply_replacement_ready(
            recording.name,
            replacement_sequence,
            interruption["id"],
            outcome.endpoint_generation,
            outcome.public_jwk,
            _callback_timestamp(outcome.replacement_ready_at),
            client,
            reconcile=True,
        )
        recording.reload()
    elif outcome.endpoint_generation < cint(recording.endpoint_generation):
        return
    elif recording.replacement_ready_at:
        if outcome.public_jwk != _stored_public_jwk(recording):
            return
        if not recording.grant_delivered:
            _deliver_replacement_grant(recording, client)
            recording.reload()
    if (
        outcome.state != "capture_ready"
        or outcome.event_sequence <= recording.recorder_event_sequence
        or not interruption.get("resumed_capture_started_at")
        or not interruption.get("recovered_at")
    ):
        return
    _apply_recovery(
        recording.name,
        outcome.event_sequence,
        interruption["id"],
        _callback_timestamp(interruption["resumed_capture_started_at"]),
        _callback_timestamp(interruption["recovered_at"]),
    )


def _callback_timestamp(value: datetime) -> str:
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


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
        room.recording_policy_lock()
        current = frappe.get_doc("Meet Recording", name)
        _fail_startup(room, current, "startup_timeout")
        return

    room.recording_policy_lock()
    current = frappe.get_doc("Meet Recording", name)
    if current.status not in ("Pending", "Starting"):
        frappe.db.commit()
        return
    room.reload()
    if _policy_allows_recording(room):
        _finish_start(room, current, outcome, client, room_locked=True)
        for sequence, milestone in enumerate(
            ("configured", "proof_complete", "joined", "capture_started"), 2
        ):
            occurred = (outcome.milestones or {}).get(milestone)
            if occurred and (outcome.event_sequence or 0) >= sequence:
                _apply_startup_milestone(
                    current.name,
                    sequence,
                    milestone,
                    occurred.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                )
        current = frappe.get_doc("Meet Recording", name)
        if current.status == "Starting":
            operation_id = _stop_operation_id(current)
            _fail_startup(room, current, "startup_timeout")
            frappe.db.commit()
            if client:
                client.stop(
                    room=current.meet_room,
                    recording=current.name,
                    job=current.recorder_job_id,
                    limits=_limits(current),
                    operation_id=operation_id,
                )
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
