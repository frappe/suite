"""Pictures and videos a deck shows, stored as Drive media nodes below the deck (§10.7).

The body names each one by its node id, so Drive signs its URL for anyone who
can read the deck, a link holder included (§6.8). `suite/slides/api/file.py`
still serves the media older decks name by `/private/files/` URL.
"""

import frappe
from frappe import _

from suite import drive
from suite.slides import drive as slides_drive

MEDIA_TYPES = ("image/", "video/")


@frappe.whitelist(methods=["POST"])
def add(docname: str) -> dict:
    """Store one uploaded file below the deck `docname` and answer its node id.

    Drive's UPLOAD check on the deck node is the only authorization. The
    answer's `file_url` carries the node id because that is the field the
    editor's uploader reads; the body stores it as the element's `src`.
    """
    node = slides_drive.node_of(docname)
    upload = frappe.request.files.get("file")
    if not upload or not upload.filename:
        frappe.throw(_("Choose a file to upload"), frappe.ValidationError)
    if not upload.mimetype.startswith(MEDIA_TYPES):
        frappe.throw(_("A slide can show only pictures and videos"), frappe.ValidationError)
    media = drive.store_file(node, upload.filename, upload.stream)
    return {"file_url": media, "file_name": upload.filename}
