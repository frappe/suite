from datetime import UTC, date, datetime, timedelta, timezone

import frappe

from suite.drive.api.files import delete_entities
from suite.drive.api.product import is_drive_site_admin
from suite.drive.utils import (
    STATUS_REMOVED,
    STATUS_TRASHED,
    create_drive_file,
    get_file_type,
    get_root_folder,
    update_file_size,
)
from suite.drive.utils.files import FileManager


@frappe.whitelist()
def sync_preview(json: bool = True):
    manager = FileManager()
    files = manager.fetch_new_files()
    sorted_files = sorted(files.items(), key=lambda p: len(p[0].parts))
    # For just checking, strip the root folder
    if json:
        return map(lambda x: (str(x[0]), x[1]), sorted_files)
    return sorted_files


@frappe.whitelist()
def sync_from_disk():
    """
    One-way sync from disk to Drive. Ignores hidden files.
    """
    if not is_drive_site_admin():
        frappe.throw(
            "You do not have permission to sync files from disk.",
            frappe.PermissionError,
        )

    sorted_files = sync_preview(json=False)
    files_added = []
    root_folder = get_root_folder().name

    def get_or_create_parent(parent_path, owner):
        if not parent_path:
            return root_folder
        # Check if the parent folder exists
        parent = frappe.get_value(
            "File",
            {"file_url": (parent_path + "/") if parent_path else ""},
            "name",
        )
        if parent:
            return parent

        # If not, recursively create its own parent first
        grandparent_path = "/".join(parent_path.strip("/").split("/")[:-1])
        grandparent = get_or_create_parent(grandparent_path, owner)

        # Now create this parent folder
        new_parent = create_drive_file(
            file_name=parent_path.strip("/").split("/")[-1],
            parent=grandparent,
            file_type="Folder",
            entity_path=lambda _: str(parent_path) + "/",
            mime_type="folder",
            file_size=0,
            owner=owner,
        )
        return new_parent.name

    for file, (file_size, file_modified, mime_type, actual_path) in sorted_files:
        parent_path = str(file.parent).strip("./")
        parent = get_or_create_parent(parent_path, frappe.session.user)

        files_added.append(
            create_drive_file(
                file.name,
                parent,
                "Folder" if mime_type == "folder" else get_file_type(mime_type),
                lambda _: actual_path if mime_type != "folder" else actual_path.strip("/") + "/",
                mime_type=mime_type,
                file_modified=file_modified,
                file_size=file_size,
                owner=frappe.session.user,
            )
        )
        update_file_size(parent, file_size)

    return files_added


def auto_delete_from_trash():
    days_before = (date.today() - timedelta(days=30)).isoformat()
    result = frappe.db.get_all(
        "File",
        filters={"status": STATUS_TRASHED, "file_modified": ["<", days_before]},
        fields=["name"],
    )
    if result:
        delete_entities(result)


def clear_deleted_files():
    days_before = (date.today() - timedelta(days=30)).isoformat()
    result = frappe.db.get_all(
        "File",
        filters={"status": STATUS_REMOVED, "modified": ["<", days_before]},
        fields=["name"],
    )
    failed = 0
    for entity in result:
        # One undeletable file must not stop the sweep: it ran nightly for weeks
        # refusing at the first document and reclaiming nothing behind it.
        try:
            frappe.get_doc("File", entity, ignore_permissions=True).delete()
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            failed += 1
            frappe.log_error("Drive: could not purge a removed file", frappe.get_traceback())
    if failed:
        print(f"Drive: {failed} of {len(result)} removed file(s) could not be purged")


def clear_download_archives():
    """Sweep expired folder-download zip artifacts from disk and S3."""
    import os
    import time

    from suite.drive.api.files import ARCHIVE_DIR, DOWNLOAD_TTL

    cutoff = time.time() - DOWNLOAD_TTL
    manager = FileManager()

    local_dir = manager.site_folder / ARCHIVE_DIR
    if local_dir.exists():
        for path in local_dir.iterdir():
            if path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)

    if manager.s3_enabled:
        cutoff_dt = datetime.now(UTC) - timedelta(seconds=DOWNLOAD_TTL)
        for bucket in filter(None, {manager.bucket}):
            objects = manager.conn.list_objects_v2(Bucket=bucket, Prefix=".drive-downloads/").get(
                "Contents", []
            )
            stale = [{"Key": o["Key"]} for o in objects if o["LastModified"] < cutoff_dt]
            if stale:
                manager.conn.delete_objects(Bucket=bucket, Delete={"Objects": stale})
