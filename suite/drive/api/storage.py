import frappe
from frappe import _
from pypika import functions as fn

from suite.drive.utils import STATUS_ACTIVE

MEGA_BYTE = 1024**2
DriveFile = frappe.qb.DocType("File")


def acquire_owner_storage_lock(owner: str):
    key = f"drive-storage:{frappe.local.site}:{owner}"
    held_locks = getattr(frappe.local, "drive_storage_locks", None)
    if held_locks is None:
        held_locks = frappe.local.drive_storage_locks = {}
    if key in held_locks:
        return

    lock = frappe.cache.lock(key, timeout=300)
    if not lock.acquire(blocking=True, blocking_timeout=10):
        frappe.throw(_("Drive storage is being updated; try again"))
    held_locks[key] = lock

    def release():
        held_locks.pop(key, None)
        lock.release()

    frappe.db.after_commit.add(release)
    frappe.db.after_rollback.add(release)


def get_quota(user: str | None = None):
    """Effective quota in bytes: the user's override, else the site default. 0 = unlimited."""
    user = user or frappe.session.user
    quota = frappe.get_value("Drive Settings", user, "quota") or frappe.db.get_single_value(
        "Drive Disk Settings", "quota"
    )
    return (quota or 0) * MEGA_BYTE


@frappe.whitelist()
def storage_breakdown():
    limit = get_quota()
    filters = {
        "is_folder": False,
        "status": STATUS_ACTIVE,
        "owner": frappe.session.user,
    }
    if limit:
        filters["file_size"] = [">=", limit / 200]

    entities = frappe.db.get_list(
        "File",
        filters=filters,
        order_by="file_size desc",
        fields=["name", "file_name", "owner", "file_size", "file_type"],
    )

    query = (
        frappe.qb.from_(DriveFile)
        .select(DriveFile.file_type, fn.Sum(DriveFile.file_size).as_("file_size"))
        .where(
            (DriveFile.is_folder == 0)
            & (DriveFile.status == STATUS_ACTIVE)
            & (DriveFile.owner == frappe.session.user)
        )
    )

    return {
        "limit": limit,
        "total": query.groupby(DriveFile.file_type).run(as_dict=True),
        "entities": entities,
    }


@frappe.whitelist()
def storage_bar_data():
    return get_storage_usage()


def get_storage_usage(user: str | None = None):
    user = user or frappe.session.user
    query = (
        frappe.qb.from_(DriveFile)
        .where((DriveFile.is_folder == 0) & (DriveFile.owner == user) & (DriveFile.status == STATUS_ACTIVE))
        .select(fn.Coalesce(fn.Sum(DriveFile.file_size), 0).as_("total_size"))
    )
    result = query.run(as_dict=True)[0]
    if frappe.db.table_exists("Meet Recording"):
        recording = frappe.qb.DocType("Meet Recording")
        reserved = (
            frappe.qb.from_(recording)
            .select(fn.Coalesce(fn.Sum(recording.budget_bytes), 0))
            .where(
                (recording.room_owner == user)
                & recording.status.isin(("Pending", "Recording", "Interrupted", "Stopping", "Processing"))
            )
        ).run()
        result["reserved_size"] = reserved[0][0]
        result["total_size"] += result["reserved_size"]
    result["limit"] = get_quota(user)
    return result


def validate_quota(user: str | None = None, incoming_size: int = 0):
    """Throw if adding `incoming_size` bytes would push the user past their quota."""
    usage = get_storage_usage(user)
    if usage["limit"] and (usage["limit"] - usage["total_size"]) < incoming_size:
        frappe.throw(_("You're out of storage!"), ValueError)
