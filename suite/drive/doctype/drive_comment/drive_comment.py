import frappe
from frappe import _
from frappe.model.document import Document


class DriveComment(Document):
    def validate(self) -> None:
        thread_node = frappe.db.get_value("Drive Comment Thread", self.thread, "node")
        if not thread_node or thread_node != self.node:
            frappe.throw(_("A Drive comment must name the same node as its thread"))


def on_doctype_update() -> None:
    frappe.db.add_index("Drive Comment", ["thread", "creation"], "comment_thread")
