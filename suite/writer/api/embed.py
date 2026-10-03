import frappe
from werkzeug.wrappers import Response

from suite import drive
from suite.writer.drive import DOCTYPE


@frappe.whitelist()
def add(file_id: str):
    """Upload one picture into the document the editor has open.

    §9.4: an embed is a media node below the document node, so the document
    is the upload destination and Drive's UPLOAD check on it is the only
    authorization. The id is refused by name when it is not a Writer document,
    so a caller cannot name a folder of somebody else's and have the picture
    placed there. The answer is the `embed.get?id=` URL the editor writes into
    the body.
    """
    if frappe.db.get_value("Drive Node", file_id, "content_doctype") != DOCTYPE:
        frappe.throw("This document does not exist", frappe.DoesNotExistError)
    upload = frappe.request.files["file"]
    node = drive.store_file(file_id, f"{file_id} embed -{upload.filename}", upload.stream)
    return {"file_url": f"/api/method/suite.writer.api.embed.get?id={node}"}


@frappe.whitelist(allow_guest=True)
def get(id: str):
    """Serve one embedded picture's bytes.

    The READ check is Drive's, on the media node, with the request's link
    credentials in play the way they are for every other Drive read; a reader
    of the document reads its pictures because they hang under it. A node that
    is not below a Writer document is not an embed, and this guest-reachable
    endpoint must not become a byte reader for any node id a caller can name.
    """
    drive.check(id, drive.READ)
    parent = frappe.db.get_value("Drive Node", id, "parent_node")
    if frappe.db.get_value("Drive Node", parent, "content_doctype") != DOCTYPE:
        frappe.throw("This is not an embed", ValueError)
    stream, mime = drive.read_file(id)
    return Response(stream, mimetype=mime, direct_passthrough=True)
