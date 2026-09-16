import frappe
from frappe import _
from frappe.model.document import Document


class DriveNode(Document):
    def before_insert(self) -> None:
        if self.kind == "root" and not self.flags.get("drive_root_lifecycle"):
            frappe.throw(_("Root nodes can only be created by the Drive root lifecycle"))

    def validate(self) -> None:
        self.path = self.path or ""
        if not isinstance(self.title, str) or not self.title.strip():
            frappe.throw(_("A Drive node title is required"))
        if self.state == "Active" and (self.trashed_at or self.trash_root):
            frappe.throw(_("An active Drive node cannot carry a trash stamp"))
        if self.state == "Trashed" and (not self.trashed_at or not self.trash_root):
            frappe.throw(_("A trashed Drive node requires a complete trash stamp"))
        if self.state not in ("Active", "Trashed"):
            frappe.throw(_("A Drive node lifecycle state is invalid"))
        if self.kind == "root":
            self._validate_root_shape()
        else:
            self._validate_tree_position()
            self._validate_kind_shape()
        self._validate_immutable_identity()

    def on_trash(self) -> None:
        if self.kind == "root" and not self.flags.get("drive_root_lifecycle"):
            frappe.throw(_("Root nodes can only be removed by the Drive root lifecycle"))

    def _validate_root_shape(self) -> None:
        invalid = (
            any(
                (
                    self.parent,
                    self.root,
                    self.path,
                    self.blob,
                    self.size,
                    self.mime,
                    self.url,
                    self.content_doctype,
                    self.content_docname,
                    self.trashed_at,
                    self.trash_root,
                    self.is_template,
                )
            )
            or self.state != "Active"
        )
        if invalid:
            frappe.throw(_("A root node must have the canonical empty root shape"))

        if not self.is_new() and not self.flags.get("drive_root_lifecycle"):
            metadata = frappe.db.get_value("Drive Root", {"node": self.name}, ["name", "node"], as_dict=True)
            if not metadata or metadata.name != self.name or metadata.node != self.name:
                frappe.throw(_("A root node must have matching Drive Root metadata"))

    def _validate_tree_position(self) -> None:
        if not self.parent or not self.root:
            frappe.throw(_("Every non-root node must name its parent and root"))
        parent = frappe.db.get_value(
            "Drive Node",
            self.parent,
            ["name", "kind", "root", "path", "state"],
            as_dict=True,
            for_update=True,
        )
        if not parent:
            frappe.throw(_("The parent Drive node does not exist"))
        if parent.kind not in ("root", "folder", "document"):
            frappe.throw(_("A Drive node parent must be a container"))
        effective_parent_root = parent.name if parent.kind == "root" else parent.root
        if self.root != effective_parent_root:
            frappe.throw(_("The parent and root Drive nodes do not agree"))
        if frappe.db.get_value("Drive Node", self.root, "kind", for_update=True) != "root":
            frappe.throw(_("A Drive node's root must name a root node"))

        expected_path = "" if parent.kind == "root" else f"{parent.path or '/'}{parent.name}/"
        if self.path != expected_path:
            frappe.throw(_("The Drive node path does not match its parent"))
        if len([part for part in self.path.split("/") if part]) + 1 > 40:
            frappe.throw(_("A Drive tree cannot be deeper than 40 levels"))

    def _validate_kind_shape(self) -> None:
        if self.kind not in ("folder", "file", "link", "document"):
            frappe.throw(_("A Drive node kind is invalid"))
        if self.size is None or self.size == "":
            self.size = 0
        elif isinstance(self.size, str) and self.size.isdigit():
            self.size = int(self.size)
        if isinstance(self.size, bool) or not isinstance(self.size, int) or self.size < 0:
            frappe.throw(_("Drive node size must be a nonnegative integer"))

        if self.kind == "folder":
            invalid = (
                self.blob
                or self.size
                or self.mime
                or self.url
                or self.content_doctype
                or self.content_docname
                or self.is_template
            )
        elif self.kind == "link":
            invalid = (
                not self.url
                or self.blob
                or self.size
                or self.mime
                or self.content_doctype
                or self.content_docname
                or self.is_template
            )
        elif self.kind == "file":
            invalid = (
                self.url
                or self.content_doctype
                or self.content_docname
                or self.is_template
                or (not self.blob and (self.size or self.mime))
                or (self.blob and not self.mime)
            )
        else:
            invalid = self.blob or self.size or self.url
        if invalid:
            frappe.throw(_("The Drive node fields do not match its kind"))

    def _validate_immutable_identity(self) -> None:
        if self.is_new():
            return
        previous = self.get_doc_before_save()
        if previous and previous.kind != self.kind:
            frappe.throw(_("A Drive node's kind cannot change"))
        if previous and any(
            previous.get(field) != self.get(field) for field in ("content_doctype", "content_docname")
        ):
            frappe.throw(_("A Drive content document identity cannot change"))
        if self.kind == "root" and previous:
            immutable = ("parent", "root", "path", "state")
            if any(previous.get(field) != self.get(field) for field in immutable):
                frappe.throw(_("A root node cannot be moved, trashed, or restored"))


def on_doctype_update() -> None:
    frappe.db.add_index("Drive Node", ["parent", "state", "title"], "node_parent_page")
    frappe.db.add_index("Drive Node", ["root", "path"], "node_subtree")
    frappe.db.add_index("Drive Node", ["content_doctype", "content_docname"], "node_content")
