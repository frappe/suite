import frappe
from frappe.utils import cint


def execute() -> None:
    """Give accounts left at 0, which means no limit, the default message cache quota."""

    field = frappe.get_meta("JMAP Account").get_field("message_cache_quota_mb")
    frappe.db.set_value(
        "JMAP Account",
        {"message_cache_quota_mb": 0},
        "message_cache_quota_mb",
        cint(field.default),
        update_modified=False,
    )
