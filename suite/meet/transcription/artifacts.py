"""Drive publication and capture grouping shared by video and transcript."""

from io import BytesIO

import frappe
from frappe.utils import get_datetime

from suite import drive


def capture_folder(capture, drive_root, room_title, started_at, existing=None):
    if existing:
        # A paired output follows the original folder even if it was renamed.
        # If it was trashed or moved to a different root, Drive still checks
        # whether publication there is permitted and the reservation matches.
        return existing
    parent = drive.ensure_folder(drive_root, "Meet")
    title = "".join(c for c in room_title if c not in "/\\\x00").strip()[:120] or "Meet"
    display = f"{title} - {get_datetime(started_at).strftime('%Y-%m-%d %H-%M')} - {capture[:10]}"
    return drive.ensure_folder(parent, display)


def publish(job, text):
    # The caller holds the transcription job lock. Lock the shared capture row
    # before choosing a folder, as video finalization does. The folder reference
    # and output commit together, so either output can finish first.
    recording = frappe.db.get_value(
        "Meet Recording",
        job.capture,
        ["capture_folder", "drive_home_folder"],
        as_dict=True,
        for_update=True,
    )
    drive_root = recording.drive_home_folder if recording else drive.personal_root_for(job.room_owner)
    if not drive_root:
        raise drive.DriveNotFound("The Room Owner has no Active Personal Drive root")
    callback_user = frappe.session.user
    try:
        frappe.set_user(job.room_owner)
        parent = capture_folder(
            job.capture,
            drive_root,
            job.room_title,
            job.capture_started_at,
            (recording.capture_folder if recording else None) or job.capture_folder,
        )
        artifact = drive.store_file(
            parent,
            "Original Transcript.txt",
            BytesIO(text.encode("utf-8")),
            read_only=True,
        )
    finally:
        frappe.set_user(callback_user)
    job.capture_folder = parent
    if recording and not recording.capture_folder:
        frappe.db.set_value("Meet Recording", job.capture, "capture_folder", parent, update_modified=False)
    return artifact


def reconcile_purged_artifact(job):
    if not job.artifact or frappe.db.exists("Drive Node", job.artifact):
        return
    # A missing node is a permanent purge. A trashed node remains restorable.
    # Keep a tombstone until source cleanup succeeds to fence stale workers.
    job.update(
        {
            "status": "Deleted",
            "artifact": None,
            "capture_folder": None,
            "completed_segments": "[]",
            "recognition_hints": "{}",
            "manifest": "{}",
            "gaps": "[]",
            "lease_token_hash": None,
            "notification_pending": 0,
        }
    )
    job.save(ignore_permissions=True)
