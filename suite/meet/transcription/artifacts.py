"""Owner-private publication and capture grouping shared by video and transcript."""

from pathlib import Path

import frappe
from frappe.utils import get_datetime

from suite.drive.utils import PERMISSION_TYPES, create_drive_file, get_user_folder
from suite.drive.utils.files import FileManager, get_s3_key, get_s3_url


def owner_boundary(entity, owner):
    for principal in ("$GENERAL", ""):
        frappe.get_doc(
            {
                "doctype": "Drive Permission",
                "entity": entity,
                "user": principal,
                "deny": 1,
                **dict.fromkeys(PERMISSION_TYPES, 1),
            }
        ).insert(ignore_permissions=True)


def private_folder(name, parent, owner, identity=None):
    # Reuse only folders that carry our private boundary. Never adopt an existing
    # shared Meet folder, even when it happens to have the expected name.
    candidates = frappe.get_all(
        "File",
        filters={"folder": parent, "file_name": name, "is_folder": 1, "owner": owner, "status": "Active"},
        pluck="name",
    )
    for candidate in candidates:
        if frappe.db.exists(
            "Drive Permission", {"entity": candidate, "user": "$GENERAL", "deny": 1, "read": 1}
        ) and frappe.db.exists("Drive Permission", {"entity": candidate, "user": "", "deny": 1, "read": 1}):
            # A subsequently explicitly shared generated folder is not a safe
            # destination for a new independent capture.
            rows = frappe.get_all(
                "Drive Permission", filters={"entity": candidate, "deny": 0}, fields=["user"]
            )
            if all(row.user == owner for row in rows):
                return candidate
    manager = FileManager()
    used = {
        r.file_name
        for r in frappe.get_all("File", filters={"folder": parent, "status": "Active"}, fields=["file_name"])
    }
    display = name
    suffix = 2
    while display in used:
        display = f"{name} ({suffix})"
        suffix += 1
    folder = create_drive_file(
        display, parent, "Folder", lambda entity: manager.create_folder(entity), owner=owner, name=identity
    )
    owner_boundary(folder.name, owner)
    return folder.name


def capture_folder(capture, owner, room_title, started_at, existing=None):
    identity = "meet-capture-" + capture
    pinned = frappe.db.get_value("File", identity, ["name", "owner", "status"], as_dict=True, for_update=True)
    if pinned:
        if pinned.owner != owner or pinned.status != "Active":
            raise ValueError("Capture destination is unavailable")
        return pinned.name
    if existing and frappe.db.exists(
        "File", {"name": existing, "owner": owner, "status": "Active", "is_folder": 1}
    ):
        return existing
    # Capture identity suffix prevents two captures with the same displayed time
    # from accidentally sharing a destination.
    parent = private_folder("Meet", get_user_folder(owner).name, owner)
    title = "".join(c for c in room_title if c not in "/\\\x00").strip()[:120] or "Meet"
    display = f"{title} - {get_datetime(started_at).strftime('%Y-%m-%d %H-%M')} - {capture[:10]}"
    return private_folder(display, parent, owner, identity=identity)


def publish(job, text):
    from suite.drive.api.storage import acquire_owner_storage_lock, get_storage_usage
    from suite.drive.utils import update_file_size

    acquire_owner_storage_lock(job.room_owner)
    name = "transcript-" + job.name
    if frappe.db.exists("File", name):
        file = frappe.get_doc("File", name)
        # A trashed or removed artifact is never recreated by a retry.
        if file.owner != job.room_owner:
            raise ValueError("Transcript publication identity mismatch")
        return file.name
    content = text.encode("utf-8")
    usage = get_storage_usage(job.room_owner)
    if usage["limit"] and usage["total_size"] + len(content) > usage["limit"]:
        raise ValueError("Transcript storage quota exceeded")
    recording = frappe.db.get_value("Meet Recording", job.capture, ["capture_folder"], as_dict=True)
    parent = capture_folder(
        job.capture,
        job.room_owner,
        job.room_title,
        job.capture_started_at,
        job.capture_folder or (recording.capture_folder if recording else None),
    )
    job.capture_folder = parent
    manager = FileManager()
    file = create_drive_file(
        "Original Transcript.txt",
        parent,
        "Text",
        lambda entity: "/" + str(manager.get_disk_path(entity)),
        mime_type="text/plain",
        file_size=len(content),
        owner=job.room_owner,
        name=name,
    )
    owner_boundary(file.name, job.room_owner)
    frappe.db.after_rollback.add(lambda: manager.delete_file(file))
    temporary = Path(frappe.get_site_path("private", "files")) / (frappe.generate_hash(length=32) + ".txt")
    temporary.parent.mkdir(parents=True, exist_ok=True)
    temporary.write_bytes(content)
    try:
        manager.upload_file(temporary, file)
        if manager.s3_enabled:
            file.file_url = get_s3_url(get_s3_key(file.file_url))
            file.save(ignore_permissions=True)
        update_file_size(parent, len(content))
    except Exception:
        manager.delete_file(file)
        raise
    finally:
        temporary.unlink(missing_ok=True)
    return file.name


def removed_artifact(doc, _method=None):
    if doc.status != "Removed" or not frappe.db.table_exists("Meet Transcription Job"):
        return
    name = frappe.db.get_value("Meet Transcription Job", {"artifact": doc.name}, "name")
    if name:
        # Keep a tombstone until sources are purged; stale worker callbacks cannot
        # resurrect a permanently removed result.
        frappe.db.set_value(
            "Meet Transcription Job",
            name,
            {
                "status": "Deleted",
                "artifact": None,
                "completed_segments": "[]",
                "recognition_hints": "{}",
                "manifest": "{}",
                "gaps": "[]",
                "lease_token_hash": None,
                "notification_pending": 0,
            },
        )
