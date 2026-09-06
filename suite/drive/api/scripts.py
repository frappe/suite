from datetime import UTC, date, datetime, timedelta, timezone

import frappe

from suite.drive.api.files import delete_entities
from suite.drive.api.product import is_drive_site_admin
from suite.drive.http import shims
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
    """
    List files present on disk but not yet registered in Drive.

    Admin-only: these files have no `File` record yet, so there is no share or
    folder permission to filter them by - the listing exposes the raw storage
    tree (paths, sizes, mtimes) of everything staged under the site folder.
    """
    if not is_drive_site_admin():
        frappe.throw(
            "You do not have permission to view files on disk.",
            frappe.PermissionError,
        )

    manager = FileManager()
    files = manager.fetch_new_files()
    sorted_files = sorted(files.items(), key=lambda p: len(p[0].parts))
    # For just checking, strip the root folder
    if json:
        return map(lambda x: (str(x[0]), x[1]), sorted_files)
    return sorted_files


@frappe.whitelist()
def sync_from_disk():
    """Retired. §14 makes the Build migration the disk import.

    It refuses rather than answering an empty list: the caller reads the length
    of the result, and an empty list reads as a successful run that found
    nothing.
    """
    return shims.sync_from_disk()


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
