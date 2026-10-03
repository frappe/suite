import frappe
from frappe import _
from frappe.model.document import Document


class DriveNodePreview(Document):
    def validate(self) -> None:
        node = frappe.db.get_value("Drive Node", self.node, ["kind", "blob"], as_dict=True)
        if not node:
            frappe.throw(_("The preview Drive node does not exist"))
        if self.source_blob:
            if node.kind != "file" or node.blob != self.source_blob:
                frappe.throw(_("A rendered preview must name its file node's current blob"))
        elif node.kind != "document":
            frappe.throw(_("Only a content document can have an app-supplied preview"))

        preview_blob = frappe.db.get_value(
            "File Blob",
            self.blob,
            ["mime_type", "is_private", "status"],
            as_dict=True,
        )
        if (
            not preview_blob
            or preview_blob.mime_type != "image/webp"
            or not preview_blob.is_private
            or preview_blob.status != "Ready"
        ):
            frappe.throw(_("A Drive preview must be a ready private WebP blob"))
