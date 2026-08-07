from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from contextlib import suppress
from datetime import UTC
from fractions import Fraction
from pathlib import Path
from zoneinfo import ZoneInfo

import frappe
from frappe import _
from frappe.utils import cint, get_datetime, get_system_timezone, now_datetime

from suite.drive.api.storage import acquire_owner_storage_lock, get_storage_usage
from suite.drive.utils import create_drive_file, get_new_file_name, update_file_size
from suite.drive.utils.files import FileManager, get_s3_key, get_s3_url

CHUNK_SIZE = 8 * 1024 * 1024
UPLOAD_DIRECTORY = ".recording-uploads"


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
        recording.ended_at = (
            get_datetime(ended_at).astimezone(ZoneInfo(get_system_timezone())).replace(tzinfo=None)
            if ended_at
            else now_datetime()
        )
        recording.end_reason = end_reason or recording.end_reason
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
    recording.save(ignore_permissions=True)
    return {"offset": recording.upload_offset, "complete": False}


def append_chunk(recording_name: str, *, offset: int, chunk: bytes, chunk_sha256: str) -> dict:
    offset = cint(offset)
    if not chunk or len(chunk) > CHUNK_SIZE or not _sha256(chunk_sha256):
        frappe.throw(_("Invalid recording upload chunk"))
    if hashlib.sha256(chunk).hexdigest() != chunk_sha256:
        frappe.throw(_("Recording upload chunk hash does not match"))

    recording = _locked_recording(recording_name)
    if recording.status != "Processing" or not recording.upload_id:
        frappe.throw(_("Recording upload is not active"))
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
    if cint(event_sequence) <= recording.recorder_event_sequence:
        frappe.throw(_("Recorder event is out of order"))

    path = _upload_path(recording.upload_id)
    digest = _file_digest(path)
    if digest != (recording.upload_size, recording.upload_sha256):
        frappe.throw(_("Recording artifact size or hash does not match"))
    probe = _validate_media(path)
    if abs(probe["duration_ms"] - recording.upload_duration_ms) > max(
        1000, recording.upload_duration_ms * 0.05
    ):
        frappe.throw(_("Recording artifact duration does not match"))

    acquire_owner_storage_lock(recording.room_owner)
    usage = get_storage_usage(recording.room_owner)
    final_usage = usage["total_size"] - recording.budget_bytes + recording.upload_size
    if usage["limit"] and final_usage > usage["limit"]:
        frappe.throw(_("The Room Owner does not have enough Drive storage"))

    callback_user = frappe.session.user
    try:
        frappe.set_user(recording.room_owner)
        parent = _recordings_folder(recording)
        file_name = get_new_file_name(_artifact_name(recording), parent, "Video")
    finally:
        frappe.set_user(callback_user)
    manager = FileManager()
    drive_file = create_drive_file(
        file_name,
        parent,
        "Video",
        lambda entity: "/" + str(manager.get_disk_path(entity)),
        mime_type="video/mp4",
        file_size=recording.upload_size,
        owner=recording.room_owner,
    )
    frappe.db.after_rollback.add(lambda: _delete_drive_blob(manager, drive_file))
    transfer_path = path.with_name(f"{path.name}.{frappe.generate_hash(length=12)}.transfer")
    try:
        shutil.copyfile(path, transfer_path)
        manager.upload_file(transfer_path, drive_file)
        if manager.s3_enabled:
            drive_file.file_url = get_s3_url(get_s3_key(drive_file.file_url))
            drive_file.save(ignore_permissions=True)
        update_file_size(parent, recording.upload_size)

        recording.artifact = drive_file.name
        recording.artifact_size = recording.upload_size
        recording.artifact_duration = recording.upload_duration_ms / 1000
        recording.artifact_sha256 = recording.upload_sha256
        capture_gaps = frappe.parse_json(recording.capture_gaps) or []
        recording.capture_gaps = json.dumps(capture_gaps)
        recording.status = "Partial" if capture_gaps else "Ready"
        recording.state_revision += 1
        recording.recorder_event_sequence = cint(event_sequence)
        recording.save(ignore_permissions=True)
        frappe.db.after_commit.add(lambda: path.unlink(missing_ok=True))
    except Exception:
        _delete_drive_blob(manager, drive_file)
        raise
    finally:
        transfer_path.unlink(missing_ok=True)
    return {"artifact": drive_file.name, "status": recording.status}


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
    return len(value) == 64 and all(character in "0123456789abcdef" for character in value)


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
    if len(result.stdout) > 1024 * 1024:
        frappe.throw(_("Recording media metadata is too large"))
    media = json.loads(result.stdout)
    streams = media.get("streams", [])
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    if (
        len(streams) != 2
        or not video
        or video.get("codec_name") != "h264"
        or video.get("profile") != "High"
        or video.get("pix_fmt") != "yuv420p"
        or video.get("width") != 1920
        or video.get("height") != 1080
        or abs(float(Fraction(video.get("avg_frame_rate", "0/1"))) - 30) > 1
        or not audio
        or audio.get("codec_name") != "aac"
        or audio.get("profile") != "LC"
        or cint(audio.get("sample_rate")) != 48000
        or audio.get("channels") != 2
        or float(video.get("start_time", -1)) < 0
        or float(audio.get("start_time", -1)) < 0
        or abs(float(video.get("start_time", 0)) - float(audio.get("start_time", 0))) > 0.1
    ):
        frappe.throw(_("Recording artifact media profile is invalid"))
    duration = float(media.get("format", {}).get("duration", 0))
    if duration <= 0:
        frappe.throw(_("Recording artifact duration is invalid"))
    subprocess.run(
        [frappe.conf.get("ffmpeg_executable") or "ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=6 * 60 * 60,
    )
    return {"duration_ms": round(duration * 1000)}


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
    folder = create_drive_file(
        "Meet Recordings",
        recording.drive_home_folder,
        "Folder",
        lambda entity: manager.create_folder(entity),
        owner=recording.room_owner,
    )
    return folder.name


def _artifact_name(recording) -> str:
    title = frappe.db.get_value("Meet Room", recording.meet_room, "title") or "Meet Recording"
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
