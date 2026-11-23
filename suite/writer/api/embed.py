import mimetypes

import frappe
from frappe import _
from frappe.storage.blob import served_type, sniff_mime
from werkzeug.wrappers import Response

from suite import drive
from suite.composition.http import BadRequest
from suite.writer.drive import DOCTYPE

# What the editor shows inline: pictures and videos. SVG is a picture that can
# carry script, so it is neither accepted nor shown.
MEDIA_TYPES = ("image/", "video/")
SCRIPTABLE_TYPES = ("image/svg+xml",)


def is_media(mime: str | None) -> bool:
    """Answer whether `mime` is a picture or video the editor may show inline."""
    return bool(mime) and mime.startswith(MEDIA_TYPES) and mime not in SCRIPTABLE_TYPES


@frappe.whitelist(methods=["POST"])
def add(file_id: str):
    """Upload one picture or video into the document the editor has open.

    §9.4: an embed is a media node below the document node, so the document
    is the upload destination and Drive's UPLOAD check on it is the only
    authorization. The id is refused by name when it is not a Writer document,
    so a caller cannot name a folder of somebody else's and have the picture
    placed there. The answer is the `embed.get?id=` URL the editor writes into
    the body. Anything but a picture or video is refused.
    """
    if frappe.db.get_value("Drive Node", file_id, "content_doctype") != DOCTYPE:
        frappe.throw("This document does not exist", frappe.DoesNotExistError)
    upload = frappe.request.files.get("file")
    if not upload or not upload.filename:
        frappe.throw(_("Choose a file to upload"), frappe.ValidationError)
    # The browser declares one type, Drive may take another from the name, and
    # the stored type comes from the bytes when they can be recognised.
    named = mimetypes.guess_type(upload.filename)[0]
    sniffed = sniff_mime(upload.stream)
    recognised = sniffed != "application/octet-stream"
    if not (is_media(upload.mimetype) and is_media(named)) or (recognised and not is_media(sniffed)):
        frappe.throw(_("A document can show only pictures and videos"), frappe.ValidationError)
    node = drive.store_file(file_id, f"{file_id} embed -{upload.filename}", upload.stream)
    return {"file_url": f"/api/method/suite.writer.api.embed.get?id={node}"}


@frappe.whitelist(allow_guest=True)
def get(id: str | None = None) -> Response:
    """Serve one embedded picture's or video's bytes.

    The READ check is Drive's, on the media node, with the request's link
    credentials in play the way they are for every other Drive read; a reader
    of the document reads its pictures because they hang under it. A node that
    is not below a Writer document is not an embed, and this guest-reachable
    endpoint must not become a byte reader for any node id a caller can name.
    A request without an id is refused as a bad request.

    The editor uploads through Drive's transfer, which takes any file, so the
    type is decided here too: a picture or video is shown inline, and anything
    else downloads. The type decided on is the one the framework serves: the
    node's stored type, or the type its title names when the stored one is
    empty or `application/octet-stream`, as older uploads can leave it.
    `nosniff` keeps the browser from reading the bytes as a type other than
    the one sent.
    """
    if not id:
        frappe.throw(_("Writer argument id is required"), BadRequest)
    drive.check(id, drive.READ)
    node = frappe.db.get_value("Drive Node", id, ["parent_node", "mime", "title"], as_dict=True)
    if frappe.db.get_value("Drive Node", node.parent_node, "content_doctype") != DOCTYPE:
        frappe.throw("This is not an embed", ValueError)
    mime = served_type(node.title, node.mime)[0]
    response = drive.stream_file(id, as_attachment=not is_media(mime))
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response
