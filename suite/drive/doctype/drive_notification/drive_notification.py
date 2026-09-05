import frappe
from frappe.model.document import Document


class DriveNotification(Document):
    pass


def on_doctype_update() -> None:
    frappe.db.add_unique("Drive Notification", ["activity", "to_user"], constraint_name="notif_activity_user")
    frappe.db.add_index("Drive Notification", ["to_user", "`read`", "creation"], "notif_inbox")
