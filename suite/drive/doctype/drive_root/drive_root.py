import frappe
from frappe import _
from frappe.model.document import Document


class DriveRoot(Document):
    def before_insert(self) -> None:
        if not self.flags.get("drive_root_lifecycle"):
            frappe.throw(_("Drive Root metadata can only be created by the Drive root lifecycle"))

    def validate(self) -> None:
        node = frappe.db.get_value("Drive Node", self.node, ["name", "kind"], as_dict=True)
        if not node or node.kind != "root":
            frappe.throw(_("Drive Root metadata must link to a root node"))
        if self.name and self.name != self.node:
            frappe.throw(_("Drive Root metadata must use its node id as its name"))
        if self.kind == "Personal":
            if not self.user or not frappe.db.exists("User", self.user):
                frappe.throw(_("A Personal Drive root must name an existing user"))
        elif self.kind == "Shared":
            if self.user:
                frappe.throw(_("A Shared Drive root cannot name a user"))
        else:
            frappe.throw(_("Drive root kind must be Personal or Shared"))
        if self.state not in ("Active", "Archived"):
            frappe.throw(_("Drive root state must be Active or Archived"))
        if (
            isinstance(self.quota_bytes, bool)
            or not isinstance(self.quota_bytes, int)
            or self.quota_bytes < 0
        ):
            frappe.throw(_("Drive root quota must be a nonnegative integer"))
        self._validate_immutable_identity()
        self._validate_active_uniqueness()

    def on_trash(self) -> None:
        if not self.flags.get("drive_root_lifecycle"):
            frappe.throw(_("Drive Root metadata can only be removed by the Drive root lifecycle"))

    def _validate_immutable_identity(self) -> None:
        if self.is_new():
            return
        previous = self.get_doc_before_save()
        if previous and any(previous.get(field) != self.get(field) for field in ("node", "kind", "user")):
            frappe.throw(_("A Drive root's node, kind, and user cannot change"))

    def _validate_active_uniqueness(self) -> None:
        if self.state != "Active":
            return
        filters = {"kind": self.kind, "state": "Active", "name": ["!=", self.name or ""]}
        if self.kind == "Personal":
            filters["user"] = self.user
        if frappe.db.exists("Drive Root", filters):
            frappe.throw(_("Only one active Drive root is allowed for this identity"))


def on_doctype_update() -> None:
    frappe.db.add_index("Drive Root", ["user", "kind", "state"], "root_owner")
    frappe.db.add_index("Drive Root", ["kind", "state"], "root_kind")
