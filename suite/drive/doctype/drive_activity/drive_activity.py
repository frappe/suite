import frappe
from frappe import _
from frappe.model.document import Document


class DriveActivity(Document):
    def validate(self) -> None:
        if not self.is_new():
            frappe.throw(_("Drive Activity rows are immutable"))

    def on_trash(self) -> None:
        if not self.flags.get("drive_node_purge"):
            frappe.throw(_("Drive Activity rows are removed only when their node is purged"))


def on_doctype_update() -> None:
    frappe.db.add_index("Drive Activity", ["node", "at"], "activity_node_at")
