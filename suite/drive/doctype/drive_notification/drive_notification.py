import frappe
from frappe import _
from frappe.model.document import Document


class DriveNotification(Document):
    """One person's inbox entry."""

    def validate(self):
        if sum(map(bool, (self.activity, self.download, self.inbox_message))) != 1:
            frappe.throw(_("A Drive notification contains one activity, download, or message"))


def on_doctype_update() -> None:
    frappe.db.add_unique("Drive Notification", ["activity", "to_user"], constraint_name="notif_activity_user")
    frappe.db.add_index("Drive Notification", ["to_user", "`read`", "creation"], "notif_inbox")
