import frappe

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
        key = f"meet-recording:{recording.name}"
        reserved_bytes = _reserved_bytes(recording)
        existing = frappe.db.get_value(
            "Drive Storage Reservation", key, ["storage_owner", "reserved_bytes"], as_dict=True
        )

        if reserved_bytes is None:
            if existing:
                frappe.delete_doc("Drive Storage Reservation", key, ignore_permissions=True)
            continue

        if not existing:
            frappe.get_doc(
                {
                    "doctype": "Drive Storage Reservation",
                    "name": key,
                    "storage_owner": recording.room_owner,
                    "reserved_bytes": reserved_bytes,
                }
            ).insert(ignore_permissions=True)
        elif existing.storage_owner != recording.room_owner or existing.reserved_bytes != reserved_bytes:
            frappe.db.set_value(
                "Drive Storage Reservation",
                key,
                {"storage_owner": recording.room_owner, "reserved_bytes": reserved_bytes},
                update_modified=False,
            )


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
