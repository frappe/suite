import frappe
from frappe import _
from frappe.model.document import Document


class DriveCommentThread(Document):
    def validate(self) -> None:
        if frappe.db.get_value("Drive Node", self.node, "kind") != "document":
            frappe.throw(_("Drive comment threads require a content document node"))
        if bool(self.resolved) != bool(self.resolved_by or self.resolved_at):
            frappe.throw(_("A Drive comment thread has an incomplete resolution stamp"))
        if bool(self.resolved_by) != bool(self.resolved_at):
            frappe.throw(_("A Drive comment thread has an incomplete resolution stamp"))


def on_doctype_update() -> None:
    frappe.db.add_index("Drive Comment Thread", ["node", "resolved"], "thread_node")
