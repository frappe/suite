"""Backfill durable finalization state on old and current recording schemas.

Publication now commits atomically with the artifact, so do not read or write
the obsolete publication key: new sites need not have its database column.
"""

import frappe
from frappe.utils import add_to_date, cint, now_datetime


def execute():
    if not frappe.db.table_exists("Meet Recording") or not frappe.db.has_column(
        "Meet Recording", "metadata_accepted_at"
    ):
        return

    migration_time = now_datetime()
    for recording in frappe.get_all(
        "Meet Recording",
        filters={"status": "Processing"},
        fields=[
            "name",
            "modified",
            "upload_id",
            "upload_offset",
            "upload_size",
            "finalization_stage",
            "metadata_accepted_at",
            "upload_completed_at",
            "finalization_deadline",
            "finalization_next_retry_at",
        ],
    ):
        accepted_at = recording.metadata_accepted_at or recording.modified or migration_time
        upload_complete = (
            recording.upload_id
            and cint(recording.upload_size) > 0
            and cint(recording.upload_offset) == cint(recording.upload_size)
        )
        frappe.db.set_value(
            "Meet Recording",
            recording.name,
            {
                "metadata_accepted_at": accepted_at,
                "finalization_deadline": recording.finalization_deadline
                or add_to_date(accepted_at, hours=24),
                "finalization_stage": (
                    "Pending" if upload_complete else recording.finalization_stage or "Awaiting Upload"
                ),
                "upload_completed_at": recording.upload_completed_at
                or (recording.modified if upload_complete else None),
                "finalization_next_retry_at": recording.finalization_next_retry_at
                or (migration_time if upload_complete else None),
            },
            update_modified=False,
        )
