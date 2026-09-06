import frappe

from suite.drive.api.files import get_file_internal, upload_file
from suite.drive.api.permissions import user_has_permission


@frappe.whitelist()
def add(file_id: str):
    file_doc = frappe.get_doc("File", file_id)
    file = frappe.request.files["file"]
    file.filename = f"{file_doc.name} embed -{file.filename}"
    # §11.7 turned `upload_file` into a forwarder that answers a plain dict of
    # the legacy columns, not a Document.
    embed = upload_file(parent=file_doc.name, embed=1)
    return {"file_url": f"/api/method/suite.writer.api.embed.get?id={embed['name']}"}


@frappe.whitelist(allow_guest=True)
def get(id: str):
    embed = frappe.get_cached_doc("File", id)
    parent = frappe.db.get_value("File", embed.folder, ["name", "content_docname"], as_dict=True)
    if not parent.content_docname:
        frappe.throw("This is not an embed", ValueError)
    if not user_has_permission(parent.name, "read"):
        frappe.throw("You do not have permission to view this file", frappe.PermissionError)
    return get_file_internal(embed)
