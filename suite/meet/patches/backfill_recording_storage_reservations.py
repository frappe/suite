"""Charge every live Meet recording to its Room Owner's Personal Drive Root.

Reruns are safe. The patch never writes a `Drive *` table itself: every byte it
moves goes through the `suite.drive` facade, so `Drive Root.used_bytes` is
corrected in the same transaction as the reservation row (ARCHITECTURE.md rule
5.5). One recording is one transaction, so a failure part-way through keeps
every recording processed before it and repeats only the rest on the next run.

A reservation that already names a root is never rebound. A recording whose
owner has no Personal Root and cannot be given one, such as a deleted user,
is skipped and logged rather than failing the migration.
"""

import frappe

from suite import drive

ACTIVE_STATUSES = ("Pending", "Starting", "Recording", "Interrupted", "Stopping")


def execute():
    if not frappe.db.table_exists("Meet Recording") or not frappe.db.table_exists(
        "Drive Storage Reservation"
    ):
        return

    for recording in frappe.get_all(
        "Meet Recording",
        fields=["name", "room_owner", "status", "budget_bytes", "upload_size"],
    ):
        try:
            _backfill(recording)
        except Exception:
            frappe.db.rollback()
            frappe.log_error(
                title="Meet: could not charge a recording reservation to a Drive root",
                message=f"{recording.name}\n{frappe.get_traceback()}",
            )
        frappe.db.commit()


def _backfill(recording) -> None:
    key = f"meet-recording:{recording.name}"
    reserved_bytes = _reserved_bytes(recording)

    if reserved_bytes is None:
        # Terminal recording: release the charge and provision nothing.
        drive.release_storage_reservation(None, key)
        return

    existing = drive.get_storage_reservation(key)
    root = existing.root if existing else None
    if not root and frappe.db.exists("User", recording.room_owner):
        root = drive.personal_root_for(recording.room_owner) or drive.ensure_personal_root(
            recording.room_owner
        )
    if not root:
        frappe.log_error(
            title="Meet: recording owner has no Drive root to charge",
            message=f"{recording.name} ({recording.room_owner})",
        )
        return

    drive.bind_legacy_storage_reservation(root, key, reserved_bytes)


def _reserved_bytes(recording):
    if recording.status in ACTIVE_STATUSES:
        return int(recording.budget_bytes or 0)
    if recording.status == "Processing":
        upload_size = recording.upload_size
        return (
            upload_size
            if isinstance(upload_size, int) and upload_size > 0
            else int(recording.budget_bytes or 0)
        )
    return None
