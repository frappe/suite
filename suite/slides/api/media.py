"""Pictures and videos a deck shows, stored as Drive media nodes below the deck (§10.7).

The body names each one by its node id, so Drive signs its URL for anyone who
can read the deck, a link holder included (§6.8). `suite/slides/api/file.py`
still serves the media older decks name by `/private/files/` URL.
"""

from io import BytesIO
from typing import IO

import frappe
from frappe import _
from PIL import Image, ImageOps

from suite import drive
from suite.slides import drive as slides_drive

MEDIA_TYPES = ("image/", "video/")
# Still PNG and JPEG pictures are stored as WebP, which is smaller. GIF keeps its
# animation, SVG stays a vector, and WebP and video are stored as uploaded.
WEBP_SOURCE_TYPES = ("image/png", "image/jpeg")


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
    file_name, stream = upload.filename, upload.stream
    if upload.mimetype in WEBP_SOURCE_TYPES:
        file_name, stream = as_webp(file_name, stream)
    media = drive.store_file(node, file_name, stream)
    return {"file_url": media, "file_name": file_name}


def as_webp(file_name: str, stream: IO[bytes]) -> tuple[str, IO[bytes]]:
    """Re-encode a still PNG or JPEG as WebP, upright. Anything else is kept as uploaded."""
    original = stream.read()
    try:
        with Image.open(BytesIO(original)) as image:
            if getattr(image, "is_animated", False):
                return file_name, BytesIO(original)
            output = BytesIO()
            ImageOps.exif_transpose(image).save(output, format="WEBP")
    except (OSError, Image.DecompressionBombError):
        return file_name, BytesIO(original)
    output.seek(0)
    return f"{file_name.rsplit('.', 1)[0]}.webp", output
