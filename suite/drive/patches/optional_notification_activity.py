import frappe


def execute() -> None:
    """Drop the setter an earlier Cleanup run used to make `Drive Notification.activity` required.

    A notification now points at an activity or at a download, and the DocType
    controller requires exactly one of them. Idempotent.
    """
    frappe.db.delete(
        "Property Setter",
        {"doc_type": "Drive Notification", "field_name": "activity", "property": "reqd"},
    )
    frappe.clear_cache(doctype="Drive Notification")
