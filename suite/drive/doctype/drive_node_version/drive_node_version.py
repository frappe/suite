import frappe
from frappe import _
from frappe.model.document import Document


class DriveNodeVersion(Document):
    def validate(self) -> None:
        if isinstance(self.seq, bool) or not isinstance(self.seq, int) or self.seq < 1:
            frappe.throw(_("Drive node version sequence must be a positive integer"))
        if self.kind not in ("auto", "named", "milestone"):
            frappe.throw(_("Drive node version kind is invalid"))
        if isinstance(self.size, bool) or not isinstance(self.size, int) or self.size < 0:
            frappe.throw(_("Drive node version size must be a nonnegative integer"))
        if not self.is_new() and any(
            self.has_value_changed(field)
            for field in ("node", "seq", "kind", "actor", "owner", "size", "blob", "creation")
        ):
            frappe.throw(_("Drive node version bytes and identity are immutable"))


def on_doctype_update() -> None:
    frappe.db.add_unique("Drive Node Version", ["node", "seq"], constraint_name="version_node_seq")
    frappe.db.add_index("Drive Node Version", ["kind", "pinned", "creation"], "version_thin")
