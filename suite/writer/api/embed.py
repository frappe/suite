import frappe

from suite.drive.api.files import get_file_content, get_file_internal, upload_file
from suite.drive.api.permissions import user_has_permission
from suite.writer.drive import DOCTYPE as WRITER_DOCTYPE


@frappe.whitelist()
def add(file_id: str):
    """Upload one picture into the document the editor has open.

    `file_id` is a document id in whichever store holds it. Ticket 29
    registered `Writer Document`, so every document written since is a
    `Drive Node` with no `File` row, and reading the `File` first refused the
    upload with `DoesNotExistError` before `upload_file` was ever reached.

    Authorization is `upload_file`'s own, on the document as the destination:
    UPLOAD at the node on the Drive branch, `user_has_permission(parent,
    "upload")` on the legacy one. Nothing is decided here, and the id is
    refused before the upload when neither store holds it, so a caller cannot
    name a folder of somebody else's and have the workflow place a file there.
    """
    document = _document_id(file_id)
    file = frappe.request.files["file"]
    file.filename = f"{document} embed -{file.filename}"
    # §11.7 turned `upload_file` into a forwarder that answers a plain dict of
    # the legacy columns, not a Document.
    embed = upload_file(parent=document, embed=1)
    return {"file_url": f"/api/method/suite.writer.api.embed.get?id={embed['name']}"}


def _document_id(file_id: str) -> str:
    """Answer the id of one Writer document, or refuse. Either store may hold it."""
    if frappe.db.get_value("Drive Node", file_id, "content_doctype") == WRITER_DOCTYPE:
        return file_id
    if frappe.db.exists("File", file_id):
        return file_id
    frappe.throw("This document does not exist", frappe.DoesNotExistError)


@frappe.whitelist(allow_guest=True)
def get(id: str):
    """Serve one embedded picture, off whichever store holds it.

    A picture in a linked document is a media node below the document node
    (§9.4). Drive signs its bytes for fifteen minutes and answers a redirect,
    which is what an `<img src>` needs and what every other node byte path
    already does (§6.8); the READ check is the forwarder's own, on the node.

    A picture in a legacy document is a `File` in the document's `.embeds`
    folder, and keeps the reader it has always had.
    """
    parent = frappe.db.get_value("Drive Node", id, "parent")
    if parent:
        if frappe.db.get_value("Drive Node", parent, "content_doctype") != WRITER_DOCTYPE:
            frappe.throw("This is not an embed", ValueError)
        return get_file_content(id)

    embed = frappe.get_cached_doc("File", id)
    parent = frappe.db.get_value("File", embed.folder, ["name", "content_docname"], as_dict=True)
    if not parent.content_docname:
        frappe.throw("This is not an embed", ValueError)
    if not user_has_permission(parent.name, "read"):
        frappe.throw("You do not have permission to view this file", frappe.PermissionError)
    return get_file_internal(embed)
