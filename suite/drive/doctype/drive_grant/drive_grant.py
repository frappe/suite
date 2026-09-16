import frappe
from frappe import _
from frappe.model.document import Document

from suite.drive._core.roles import ROLES


class DriveGrant(Document):
    def validate(self) -> None:
        if self.role not in ROLES:
            frappe.throw(_("Drive grant role is invalid"))


def on_doctype_update() -> None:
    frappe.db.add_unique(
        "Drive Grant", ["node", "principal"], constraint_name="grant_node_principal"
    )
    frappe.db.add_index("Drive Grant", ["principal", "node"], "grant_principal")
