import frappe
from frappe.model.document import Document


class DriveRecent(Document):
    pass


def on_doctype_update() -> None:
    frappe.db.add_unique("Drive Recent", ["user", "node"], constraint_name="recent_user_node")
    frappe.db.add_index("Drive Recent", ["user", "opened_at"], "recent_user_opened")
