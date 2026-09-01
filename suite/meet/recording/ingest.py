from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import subprocess
from contextlib import suppress
from datetime import UTC
from fractions import Fraction
from pathlib import Path
from zoneinfo import ZoneInfo

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, get_datetime, get_system_timezone, now_datetime

from suite.drive.api.storage import acquire_owner_storage_lock, reduce_storage_reservation
from suite.drive.utils import create_drive_file, get_new_file_name, update_file_size
from suite.drive.utils.files import FileManager, get_s3_key, get_s3_url
from suite.meet.doctype.meet_recording.meet_recording import recording_storage_reservation_key

CHUNK_SIZE = 8 * 1024 * 1024
UPLOAD_DIRECTORY = ".recording-uploads"
FINALIZATION_TIMEOUT_HOURS = 24
FINALIZATION_LEASE_SECONDS = 6 * 60 * 60 + 10 * 60
FINALIZATION_RETRY_MAX_SECONDS = 60 * 60
NOTIFICATION_RETRY_MAX_SECONDS = 60 * 60


class DeterministicFinalizationError(frappe.ValidationError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


class InfrastructureFinalizationError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def begin_upload(
    recording_name: str,
    *,
    event_sequence: int,
    size: int,
    sha256: str,
    duration_ms: int,
    gaps: list[dict] | None = None,
    ended_at=None,
    end_reason: str | None = None,
) -> dict:
    size = cint(size)
    duration_ms = cint(duration_ms)
    if size <= 0 or duration_ms <= 0 or not isinstance(sha256, str) or not _sha256(sha256):
        frappe.throw(_("Invalid recording artifact metadata"))

    recording = _locked_recording(recording_name)
    if recording.status in ("Ready", "Partial"):
        if recording.artifact_size == size and recording.artifact_sha256 == sha256:
            return {"offset": size, "complete": True, "artifact": recording.artifact}
        frappe.throw(_("Recording artifact metadata conflicts with the completed upload"))
    if (
        recording.status == "Failed"
        and recording.finalization_stage == "Terminal"
        and recording.finalization_failure_code == "invalid_terminal_metadata"
    ):
        return {"offset": 0, "complete": True}
    if recording.status not in ("Recording", "Interrupted", "Stopping", "Processing"):
        frappe.throw(_("Recording is not ready for artifact upload"))
    if size > recording.budget_bytes:
        frappe.throw(_("Recording artifact exceeds its storage budget"))

    if recording.status in ("Recording", "Interrupted"):
        if cint(event_sequence) <= recording.recorder_event_sequence:
            frappe.throw(_("Recorder event is out of order"))
        recording.status = "Stopping"
        recording.state_revision += 1
        recording.end_reason = end_reason
        recording.save(ignore_permissions=True)

    if recording.status == "Stopping":
        if cint(event_sequence) <= recording.recorder_event_sequence:
            frappe.throw(_("Recorder event is out of order"))
        recording.status = "Processing"
        recording.state_revision += 1
        recording.recorder_event_sequence = cint(event_sequence)
        current_utc = (
            get_datetime(now_datetime())
            .replace(tzinfo=ZoneInfo(get_system_timezone()))
            .astimezone(UTC)
            .replace(tzinfo=None)
        )
        recording.ended_at = _callback_datetime(ended_at) if ended_at else current_utc
        if recording.ended_at > add_to_date(current_utc, minutes=5):
            frappe.throw(_("Recording end time is too far in the future"))
        recording.end_reason = recording.end_reason or end_reason
        recording.capture_gaps = json.dumps(gaps or [])
    elif recording.upload_size and (
        recording.upload_size != size
        or recording.upload_sha256 != sha256
        or recording.upload_duration_ms != duration_ms
    ):
        frappe.throw(_("Recording upload metadata cannot change"))

    if not recording.upload_id:
        recording.upload_id = frappe.generate_hash(length=40)
        recording.upload_offset = 0
        recording.upload_size = size
        recording.upload_sha256 = sha256
        recording.upload_duration_ms = duration_ms
        if gaps is not None:
            recording.capture_gaps = json.dumps(gaps)
    if not recording.metadata_accepted_at:
        accepted_at = now_datetime()
        recording.metadata_accepted_at = accepted_at
        recording.finalization_deadline = add_to_date(accepted_at, hours=FINALIZATION_TIMEOUT_HOURS)
        recording.publication_key = f"meet-recording-{recording.name}"
    recording.finalization_stage = recording.finalization_stage or "Awaiting Upload"
    reduce_storage_reservation(
        recording.room_owner,
        recording_storage_reservation_key(recording.name),
        size,
    )
    recording.save(ignore_permissions=True)
    return {"offset": recording.upload_offset, "complete": False}


def reject_upload_metadata(recording_name: str, *, event_sequence: int, error: Exception) -> dict:
    from suite.meet.api.recording import _publish_state

    recording = _locked_recording(recording_name)
    if recording.metadata_accepted_at:
        raise error
    if recording.status not in ("Recording", "Interrupted", "Stopping"):
        raise error
    if cint(event_sequence) <= cint(recording.recorder_event_sequence):
        raise error

    now = now_datetime()
    recording.metadata_accepted_at = now
    recording.finalization_deadline = add_to_date(now, hours=FINALIZATION_TIMEOUT_HOURS)
    recording.publication_key = f"meet-recording-{recording.name}"
    recording.status = "Failed"
    recording.state_revision += 1
    recording.recorder_event_sequence = cint(event_sequence)
    recording.failure_code = "processing_failed"
    recording.finalization_stage = "Terminal"
    recording.finalization_failure_type = "deterministic"
    recording.finalization_failure_code = "invalid_terminal_metadata"
    recording.finalization_diagnostic = str(error)[:1000]
    recording.notification_pending = 1
    recording.notification_next_retry_at = now
    recording.flags.reconciliation_update = True
    recording.save(ignore_permissions=True)
    _publish_state(frappe.get_doc("Meet Room", recording.meet_room), recording)
    return {"offset": 0, "complete": True}


def append_chunk(recording_name: str, *, offset: int, chunk: bytes, chunk_sha256: str) -> dict:
    offset = cint(offset)
    if not isinstance(chunk, bytes) or not chunk or len(chunk) > CHUNK_SIZE or not _sha256(chunk_sha256):
        frappe.throw(_("Invalid recording upload chunk"))
    if hashlib.sha256(chunk).hexdigest() != chunk_sha256:
        frappe.throw(_("Recording upload chunk hash does not match"))

    recording = _locked_recording(recording_name)
    if recording.status != "Processing" or not recording.upload_id:
        frappe.throw(_("Recording upload is not active"))
    if recording.upload_completed_at:
        frappe.throw(_("Recording upload is already complete"))
    if offset < 0 or offset + len(chunk) > recording.upload_size:
        frappe.throw(_("Recording upload chunk is outside the expected artifact"))

    path = _upload_path(recording.upload_id)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    current = path.stat().st_size if path.exists() else 0
    if current > recording.upload_offset:
        with path.open("r+b") as stream:
            stream.truncate(recording.upload_offset)
            stream.flush()
            os.fsync(stream.fileno())
        current = recording.upload_offset
    if current != recording.upload_offset:
        frappe.throw(_("Recording upload state is inconsistent"))
    if offset < current:
        with path.open("rb") as stream:
            stream.seek(offset)
            if stream.read(len(chunk)) != chunk:
                frappe.throw(_("Recording upload chunk conflicts with existing data"))
        return {"offset": current}
    if offset != current:
        frappe.throw(_("Recording upload chunk is out of order"))

    with path.open("ab") as stream:
        stream.write(chunk)
        stream.flush()
        os.fsync(stream.fileno())
    frappe.db.after_rollback.add(lambda: _truncate_upload(path, offset))
    recording.upload_offset = offset + len(chunk)
    recording.save(ignore_permissions=True)
    return {"offset": recording.upload_offset}


def complete_upload(recording_name: str, *, event_sequence: int) -> dict:
    recording = _locked_recording(recording_name)
    if recording.status in ("Ready", "Partial"):
        return {"artifact": recording.artifact, "status": recording.status}
    if recording.status != "Processing" or not recording.upload_id:
        frappe.throw(_("Recording upload is not ready to complete"))
    if recording.upload_completed_at:
        return {"status": "Processing"}
    if cint(event_sequence) <= recording.recorder_event_sequence:
        frappe.throw(_("Recorder event is out of order"))
    if recording.upload_offset != recording.upload_size:
        frappe.throw(_("Recording upload is incomplete"))

    recording.upload_completed_at = now_datetime()
    recording.finalization_stage = "Pending"
    recording.finalization_next_retry_at = now_datetime()
    recording.recorder_event_sequence = cint(event_sequence)
    recording.save(ignore_permissions=True)
    _enqueue_finalization(recording_name)
    return {"status": "Processing"}


def finalization_status(recording_name: str) -> dict:
    recording = _locked_recording(recording_name)
    if recording.status in ("Ready", "Partial", "Failed", "Cancelled"):
        if not recording.terminal_acknowledged_at:
            recording.terminal_acknowledged_at = now_datetime()
            recording.flags.finalization_update = True
            recording.save(ignore_permissions=True)
        terminal_result = recording.status if recording.status in ("Ready", "Partial") else "Failed"
        return {"action": "delete_local", "terminal_result": terminal_result}
    if recording.status != "Processing" or not recording.upload_id:
        return {"action": "wait"}

    path = _upload_path(recording.upload_id)
    actual_size = path.stat().st_size if path.exists() else 0
    committed_offset = min(cint(recording.upload_offset), cint(recording.upload_size))
    if actual_size > committed_offset:
        _truncate_upload(path, committed_offset)
        actual_size = committed_offset
    verified_offset = min(actual_size, committed_offset)
    if verified_offset < cint(recording.upload_offset):
        recording.upload_offset = verified_offset
        recording.upload_completed_at = None
        recording.validated_at = None
        recording.finalization_stage = "Awaiting Upload"
        recording.finalization_next_retry_at = None
        recording.save(ignore_permissions=True)
    if verified_offset < cint(recording.upload_size) or not recording.upload_completed_at:
        return {"action": "resume_upload", "offset": verified_offset}
    return {"action": "wait"}


def _enqueue_finalization(recording_name: str):
    frappe.enqueue(
        process_upload,
        recording_name=recording_name,
        queue="long",
        timeout=6 * 60 * 60 + 5 * 60,
        enqueue_after_commit=True,
        job_id=f"meet-recording-upload::{recording_name}",
        deduplicate=True,
    )


def process_upload(recording_name: str) -> dict:
    from suite.meet.api.recording import _publish_state

    try:
        recording = _claim_finalization(recording_name)
        if not recording:
            current = frappe.get_doc("Meet Recording", recording_name)
            result = {"status": current.status}
            if current.artifact:
                result["artifact"] = current.artifact
            return result
        path = _upload_path(recording.upload_id)
        if not recording.validated_at:
            digest = _file_digest(path)
            if digest != (cint(recording.upload_size), recording.upload_sha256):
                raise DeterministicFinalizationError(
                    "size_hash_mismatch", _("Recording artifact size or hash does not match")
                )
            probe = _validate_media(path)
            if abs(probe["duration_ms"] - cint(recording.upload_duration_ms)) > max(
                1000, cint(recording.upload_duration_ms) * 0.05
            ):
                raise DeterministicFinalizationError(
                    "duration_mismatch", _("Recording artifact duration does not match")
                )
            recording = _locked_recording(recording_name)
            if recording.status != "Processing":
                return {"status": recording.status}
            recording.validated_at = now_datetime()
            recording.finalization_stage = "Validated"
            recording.finalization_next_retry_at = now_datetime()
            recording.save(ignore_permissions=True)
            frappe.db.commit()

        result = _publish_artifact(recording_name, path)
        completed = frappe.get_doc("Meet Recording", recording_name)
        _publish_state(frappe.get_doc("Meet Room", completed.meet_room), completed)
        return result
    except DeterministicFinalizationError as error:
        frappe.db.rollback()
        return _record_finalization_failure(recording_name, error, deterministic=True)
    except Exception as error:
        frappe.db.rollback()
        return _record_finalization_failure(recording_name, error, deterministic=False)


def _claim_finalization(recording_name: str):
    recording = _locked_recording(recording_name)
    if recording.status != "Processing" or not recording.upload_completed_at:
        return None
    now = now_datetime()
    if recording.finalization_deadline and get_datetime(recording.finalization_deadline) <= now:
        raise InfrastructureFinalizationError(
            "deadline_exceeded", _("Recording finalization deadline was exceeded")
        )
    if recording.finalization_next_retry_at and get_datetime(recording.finalization_next_retry_at) > now:
        return None
    if recording.finalization_stage not in ("Pending", "Validating", "Validated", "Publishing"):
        return None
    recording.finalization_attempts = cint(recording.finalization_attempts) + 1
    recording.finalization_stage = "Publishing" if recording.validated_at else "Validating"
    recording.finalization_next_retry_at = add_to_date(now, seconds=FINALIZATION_LEASE_SECONDS)
    recording.finalization_failure_type = None
    recording.finalization_failure_code = None
    recording.finalization_diagnostic = None
    recording.save(ignore_permissions=True)
    frappe.db.commit()
    return frappe.get_doc("Meet Recording", recording_name)


def _publish_artifact(recording_name: str, path: Path) -> dict:
    recording = _locked_recording(recording_name)
    if recording.status in ("Ready", "Partial"):
        return {"artifact": recording.artifact, "status": recording.status}
    if recording.status != "Processing" or not recording.validated_at:
        return {"status": recording.status}
    recording.finalization_stage = "Publishing"
    recording.save(ignore_permissions=True)
    acquire_owner_storage_lock(recording.room_owner)

    callback_user = frappe.session.user
    try:
        frappe.set_user(recording.room_owner)
        parent = _recordings_folder(recording)
        existing_name = frappe.db.get_value("File", recording.publication_key, "file_name")
        file_name = existing_name or get_new_file_name(_artifact_name(recording), parent, "Video")
    finally:
        frappe.set_user(callback_user)

    manager = FileManager()
    drive_file = _reconcile_publication(manager, recording, parent, file_name)
    created = drive_file is None
    if created:
        drive_file = create_drive_file(
            file_name,
            parent,
            "Video",
            lambda entity: "/" + str(manager.get_disk_path(entity)),
            mime_type="video/mp4",
            file_size=recording.upload_size,
            owner=recording.room_owner,
            name=recording.publication_key,
        )
        frappe.db.after_rollback.add(lambda: _delete_drive_blob(manager, drive_file))
        transfer_path = path.with_name(f"{path.name}.{frappe.generate_hash(length=12)}.transfer")
        try:
            shutil.copyfile(path, transfer_path)
            manager.upload_file(transfer_path, drive_file)
            if manager.s3_enabled:
                drive_file.file_url = get_s3_url(get_s3_key(drive_file.file_url))
            drive_file.content_hash = recording.upload_sha256
            drive_file.save(ignore_permissions=True)
            update_file_size(parent, recording.upload_size)
        except Exception:
            _delete_drive_blob(manager, drive_file)
            raise
        finally:
            transfer_path.unlink(missing_ok=True)

    recording.artifact = drive_file.name
    recording.artifact_size = recording.upload_size
    recording.artifact_duration = recording.upload_duration_ms / 1000
    recording.artifact_sha256 = recording.upload_sha256
    capture_gaps = frappe.parse_json(recording.capture_gaps) or []
    recording.capture_gaps = json.dumps(capture_gaps)
    recording.status = "Partial" if capture_gaps else "Ready"
    recording.state_revision += 1
    recording.published_at = now_datetime()
    recording.finalization_stage = "Terminal"
    recording.finalization_next_retry_at = None
    recording.notification_pending = 1
    recording.notification_next_retry_at = now_datetime()
    recording.flags.reconciliation_update = True
    recording.save(ignore_permissions=True)
    frappe.db.after_commit.add(lambda: path.unlink(missing_ok=True))
    return {"artifact": drive_file.name, "status": recording.status}


def _reconcile_publication(manager: FileManager, recording, parent: str, file_name: str):
    if not frappe.db.exists("File", recording.publication_key):
        return None
    drive_file = frappe.get_doc("File", recording.publication_key)
    if (
        drive_file.owner == recording.room_owner
        and drive_file.folder == parent
        and drive_file.file_name == file_name
        and drive_file.file_type == "Video"
        and drive_file.status == "Active"
        and cint(drive_file.file_size) == cint(recording.upload_size)
        and drive_file.content_hash == recording.upload_sha256
    ):
        return drive_file
    _delete_drive_blob(manager, drive_file)
    frappe.delete_doc("File", drive_file.name, force=True, ignore_permissions=True)
    return None


def _record_finalization_failure(recording_name: str, error: Exception, *, deterministic: bool) -> dict:
    from suite.meet.api.recording import _publish_state

    recording = _locked_recording(recording_name)
    if recording.status != "Processing":
        return {"status": recording.status}
    now = now_datetime()
    code = getattr(error, "code", "publication_failed")
    recording.finalization_failure_type = "deterministic" if deterministic else "infrastructure"
    recording.finalization_failure_code = code
    recording.finalization_diagnostic = str(error)[:1000]
    deadline_reached = (
        recording.finalization_deadline and get_datetime(recording.finalization_deadline) <= now
    )
    if deterministic or deadline_reached:
        recording.status = "Failed"
        recording.state_revision += 1
        recording.failure_code = "processing_failed"
        recording.finalization_stage = "Terminal"
        recording.finalization_next_retry_at = None
        recording.notification_pending = 1
        recording.notification_next_retry_at = now
        recording.flags.reconciliation_update = True
        recording.save(ignore_permissions=True)
        _publish_state(frappe.get_doc("Meet Room", recording.meet_room), recording)
        return {"status": "Failed"}
    delay = min(60 * (2 ** max(cint(recording.finalization_attempts) - 1, 0)), FINALIZATION_RETRY_MAX_SECONDS)
    recording.finalization_stage = "Pending"
    recording.finalization_next_retry_at = add_to_date(now, seconds=delay)
    recording.save(ignore_permissions=True)
    return {"status": "Processing"}


def reconcile_due_finalizations():
    now = now_datetime()
    for name in frappe.get_all(
        "Meet Recording",
        filters={"status": "Processing", "metadata_accepted_at": ["is", "not set"]},
        pluck="name",
    ):
        recording = _locked_recording(name)
        if recording.status != "Processing" or recording.metadata_accepted_at:
            continue
        accepted_at = get_datetime(recording.modified) or now
        recording.metadata_accepted_at = accepted_at
        recording.finalization_deadline = add_to_date(accepted_at, hours=FINALIZATION_TIMEOUT_HOURS)
        recording.publication_key = f"meet-recording-{recording.name}"
        if cint(recording.upload_size) > 0 and cint(recording.upload_offset) == cint(recording.upload_size):
            recording.upload_completed_at = accepted_at
            recording.finalization_stage = "Pending"
            recording.finalization_next_retry_at = now
        else:
            recording.finalization_stage = "Awaiting Upload"
        recording.save(ignore_permissions=True)
    for name in frappe.get_all(
        "Meet Recording",
        filters={"status": "Processing", "finalization_deadline": ["<=", now]},
        pluck="name",
    ):
        try:
            _record_finalization_failure(
                name,
                InfrastructureFinalizationError(
                    "deadline_exceeded", _("Recording finalization deadline was exceeded")
                ),
                deterministic=False,
            )
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            frappe.log_error(
                title=f"Meet recording finalization deadline failed for {name}",
                message=frappe.get_traceback(),
            )
    for name in frappe.get_all(
        "Meet Recording",
        filters={
            "status": "Processing",
            "upload_completed_at": ["is", "set"],
            "finalization_next_retry_at": ["<=", now],
        },
        pluck="name",
    ):
        _enqueue_finalization(name)
    for name in frappe.get_all(
        "Meet Recording",
        filters={
            "notification_pending": 1,
            "notification_next_retry_at": ["<=", now],
        },
        pluck="name",
    ):
        frappe.enqueue(
            deliver_recording_notification,
            recording_name=name,
            enqueue_after_commit=True,
            job_id=f"meet-recording-notification::{name}",
            deduplicate=True,
        )


def deliver_recording_notification(recording_name: str):
    recording = _locked_recording(recording_name)
    if recording.status not in ("Ready", "Partial", "Failed") or not recording.notification_pending:
        return
    now = now_datetime()
    if recording.notification_next_retry_at and get_datetime(recording.notification_next_retry_at) > now:
        return
    recording.notification_attempts = cint(recording.notification_attempts) + 1
    recording.notification_next_retry_at = add_to_date(now, minutes=10)
    recording.flags.finalization_update = True
    recording.save(ignore_permissions=True)
    frappe.db.commit()
    try:
        recording = frappe.get_doc("Meet Recording", recording_name)
        subject = {
            "Ready": _("Your recording is ready"),
            "Partial": _("Your partial recording is ready"),
            "Failed": _("Your recording could not be processed"),
        }[recording.status]
        if not frappe.db.exists(
            "Notification Log",
            {
                "for_user": recording.room_owner,
                "document_type": "Meet Recording",
                "document_name": recording.name,
                "type": "Alert",
            },
        ):
            frappe.get_doc(
                {
                    "doctype": "Notification Log",
                    "subject": subject,
                    "for_user": recording.room_owner,
                    "type": "Alert",
                    "document_type": "Meet Recording",
                    "document_name": recording.name,
                    "from_user": "Administrator",
                }
            ).insert(ignore_permissions=True)
        message_id = f"meet-recording-finalization-{recording.name}@{frappe.local.site}"
        if not frappe.db.exists("Email Queue", {"message_id": message_id}):
            frappe.sendmail(
                recipients=[recording.room_owner],
                subject=subject,
                message=subject,
                reference_doctype="Meet Recording",
                reference_name=recording.name,
                message_id=message_id,
                now=False,
            )
        recording = _locked_recording(recording_name)
        recording.notification_pending = 0
        recording.notification_next_retry_at = None
        recording.notification_sent_at = now_datetime()
        recording.flags.finalization_update = True
        recording.save(ignore_permissions=True)
    except Exception:
        traceback = frappe.get_traceback()
        frappe.db.rollback()
        recording = _locked_recording(recording_name)
        delay = min(
            60 * (2 ** max(cint(recording.notification_attempts) - 1, 0)),
            NOTIFICATION_RETRY_MAX_SECONDS,
        )
        recording.notification_next_retry_at = add_to_date(now_datetime(), seconds=delay)
        recording.flags.finalization_update = True
        recording.save(ignore_permissions=True)
        frappe.db.commit()
        frappe.log_error(
            title=f"Meet recording notification failed for {recording_name}",
            message=traceback,
        )


def _locked_recording(name: str):
    frappe.db.get_value("Meet Recording", name, "name", for_update=True)
    return frappe.get_doc("Meet Recording", name)


def _upload_path(upload_id: str) -> Path:
    if not isinstance(upload_id, str) or not upload_id.isalnum() or len(upload_id) != 40:
        frappe.throw(_("Invalid recording upload identifier"))
    return Path(frappe.get_site_path("private", "files", UPLOAD_DIRECTORY, upload_id))


def _truncate_upload(path: Path, offset: int):
    with suppress(FileNotFoundError):
        with path.open("r+b") as stream:
            stream.truncate(offset)
            stream.flush()
            os.fsync(stream.fileno())


def _delete_drive_blob(manager: FileManager, drive_file):
    with suppress(Exception):
        manager.delete_file(drive_file)


def _sha256(value: str) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def _file_digest(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    try:
        with path.open("rb") as stream:
            while block := stream.read(1024 * 1024):
                size += len(block)
                digest.update(block)
    except FileNotFoundError:
        frappe.throw(_("Recording upload data is unavailable"))
    return size, digest.hexdigest()


def _validate_media(path: Path) -> dict:
    try:
        result = subprocess.run(
            [
                frappe.conf.get("ffprobe_executable") or "ffprobe",
                "-v",
                "error",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                str(path),
            ],
            capture_output=True,
            check=True,
            text=True,
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise InfrastructureFinalizationError(
            "media_tool_unavailable", _("Recording media metadata could not be read")
        ) from error
    except subprocess.CalledProcessError as error:
        raise DeterministicFinalizationError(
            "invalid_media", _("Recording media metadata could not be read")
        ) from error
    if len(result.stdout) > 1024 * 1024:
        raise DeterministicFinalizationError("invalid_media", _("Recording media metadata is too large"))
    try:
        media = json.loads(result.stdout)
    except (json.JSONDecodeError, TypeError):
        raise DeterministicFinalizationError("invalid_media", _("Recording media metadata is invalid"))
    if not isinstance(media, dict):
        raise DeterministicFinalizationError("invalid_media", _("Recording media metadata is invalid"))
    streams = media.get("streams", [])
    if not isinstance(streams, list) or any(not isinstance(stream, dict) for stream in streams):
        raise DeterministicFinalizationError("invalid_media", _("Recording media metadata is invalid"))
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    try:
        valid_profile = (
            len(streams) == 2
            and video
            and video.get("codec_name") == "h264"
            and video.get("profile") == "High"
            and video.get("pix_fmt") == "yuv420p"
            and video.get("width") == 1920
            and video.get("height") == 1080
            and abs(float(Fraction(video.get("avg_frame_rate", "0/1"))) - 30) <= 1
            and audio
            and audio.get("codec_name") == "aac"
            and audio.get("profile") == "LC"
            and cint(audio.get("sample_rate")) == 48000
            and audio.get("channels") == 2
            and float(video.get("start_time", -1)) >= 0
            and float(audio.get("start_time", -1)) >= 0
            and abs(float(video.get("start_time", 0)) - float(audio.get("start_time", 0))) <= 0.1
        )
    except (TypeError, ValueError, ZeroDivisionError):
        valid_profile = False
    if not valid_profile:
        raise DeterministicFinalizationError(
            "invalid_media_profile", _("Recording artifact media profile is invalid")
        )
    try:
        media_format = media.get("format", {})
        duration = float(media_format.get("duration", 0)) if isinstance(media_format, dict) else 0
    except (TypeError, ValueError):
        duration = 0
    if not math.isfinite(duration) or duration <= 0:
        raise DeterministicFinalizationError("invalid_duration", _("Recording artifact duration is invalid"))
    try:
        subprocess.run(
            [
                frappe.conf.get("ffmpeg_executable") or "ffmpeg",
                "-v",
                "error",
                "-i",
                str(path),
                "-f",
                "null",
                "-",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=6 * 60 * 60,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise InfrastructureFinalizationError(
            "media_tool_unavailable", _("Recording artifact could not be decoded")
        ) from error
    except subprocess.CalledProcessError as error:
        raise DeterministicFinalizationError(
            "decode_failed", _("Recording artifact could not be decoded")
        ) from error
    return {"duration_ms": round(duration * 1000)}


def _callback_datetime(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value):
        frappe.throw(_("Recording callback timestamps must use canonical UTC milliseconds"))
    try:
        parsed = get_datetime(value)
    except (TypeError, ValueError, OverflowError):
        frappe.throw(_("Recording callback timestamp is invalid"))
    if parsed.tzinfo is None:
        frappe.throw(_("Recording callback timestamps must include a timezone"))
    return parsed.astimezone(UTC).replace(tzinfo=None)


def _recordings_folder(recording) -> str:
    existing = frappe.db.get_value(
        "File",
        {
            "folder": recording.drive_home_folder,
            "file_name": "Meet Recordings",
            "is_folder": 1,
            "status": "Active",
            "owner": recording.room_owner,
        },
        "name",
    )
    if existing:
        return existing
    manager = FileManager()
    folder_name = "Meet Recordings"
    suffix = 1
    while frappe.db.exists(
        "File",
        {
            "folder": recording.drive_home_folder,
            "file_name": folder_name,
            "is_folder": 1,
            "status": "Active",
        },
    ):
        folder_name = f"Meet Recordings ({suffix})"
        suffix += 1
    folder = create_drive_file(
        folder_name,
        recording.drive_home_folder,
        "Folder",
        lambda entity: manager.create_folder(entity),
        owner=recording.room_owner,
    )
    return folder.name


def _artifact_name(recording) -> str:
    title = frappe.db.get_value("Meet Room", recording.meet_room, "title")
    title = title or recording.meet_room or "Meet Recording"
    timezone = frappe.db.get_value("User", recording.room_owner, "time_zone") or get_system_timezone()
    started = (
        get_datetime(recording.started_at)
        .replace(tzinfo=UTC)
        .astimezone(ZoneInfo(timezone))
        .strftime("%Y-%m-%d %H-%M")
    )
    safe_title = "".join(character for character in title if character not in "/\\\0").strip()
    return f"{safe_title or 'Meet Recording'} - {started}.mp4"


def delete_recording_metadata_for_removed_artifact(doc, _method=None):
    if doc.status != "Removed":
        return
    recording = frappe.db.get_value("Meet Recording", {"artifact": doc.name}, "name")
    if recording:
        frappe.delete_doc("Meet Recording", recording, ignore_permissions=True)
