import frappe
from frappe import _
from frappe.model.document import Document


class DriveNotification(Document):
    """One person's inbox pointer: to an activity on a node, or to their own download."""

    def validate(self):
        if bool(self.activity) == bool(self.download):
            frappe.throw(_("A Drive notification points at one activity or one download"))


def on_doctype_update() -> None:
    frappe.db.add_unique("Drive Notification", ["activity", "to_user"], constraint_name="notif_activity_user")
    frappe.db.add_index("Drive Notification", ["to_user", "`read`", "creation"], "notif_inbox")
