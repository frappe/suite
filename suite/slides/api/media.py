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
# Pillow reports a multi-picture JPEG, as phones and cameras write, as MPO.
WEBP_SOURCE_FORMATS = ("PNG", "JPEG", "MPO")
# The 8-bit modes the encoder keeps faithfully. It brings 16-bit grey out nearly
# white, and it converts CMYK to RGB without using the picture's colour profile.
WEBP_SOURCE_MODES = ("1", "L", "LA", "P", "RGB", "RGBA")
# Decoding runs inside the web request at about 4 bytes a pixel, and the header
# gives the size before any of that. This passes a 61 Mpx camera's photo. A larger
# one is stored as uploaded, as is any picture WebP cannot hold.
MAX_WEBP_SOURCE_PIXELS = 64_000_000
JPEG_START_OF_SCAN = 0xDA
JPEG_END_OF_IMAGE = b"\xff\xd9"


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
        webp = _encode_webp(original)
    # Pillow answers bad input with many error types, and every one means "keep the upload".
    except Exception:
        webp = None
    if webp is None:
        return file_name, BytesIO(original)
    return f"{file_name.rsplit('.', 1)[0]}.webp", BytesIO(webp)


def _encode_webp(picture: bytes) -> bytes | None:
    """Answer `picture` as WebP, or None when it should stay as uploaded."""
    with Image.open(BytesIO(picture)) as image:
        width, height = image.size
        animated = getattr(image, "is_animated", False) and image.format != "MPO"
        if (
            image.format not in WEBP_SOURCE_FORMATS
            or animated
            or image.mode not in WEBP_SOURCE_MODES
            # The encoder drops an RGB PNG's transparent colour (tRNS). Other modes keep theirs.
            or (image.mode == "RGB" and "transparency" in image.info)
            or width * height > MAX_WEBP_SOURCE_PIXELS
            or not _is_whole(picture, image.format)
        ):
            return None
        output = BytesIO()
        ImageOps.exif_transpose(image).save(output, format="WEBP", icc_profile=image.info.get("icc_profile"))
    return output.getvalue()


def _is_whole(picture: bytes, image_format: str) -> bool:
    """Answer whether the file is complete, so a decode has no missing pixels to fill in.

    `frappe.utils.image` turns on Pillow's process-wide `LOAD_TRUNCATED_IMAGES`, and
    then a decode pads damage instead of raising. Workers are threaded, so turning
    it off around a decode would race with other requests. This looks at the file
    itself, which gives the same answer whatever the flag says.
    """
    if image_format != "PNG":
        return _jpeg_has_an_end(picture)
    with Image.open(BytesIO(picture)) as image:
        # Checks every chunk's checksum through to the last chunk, and raises otherwise.
        image.verify()
    return True


def _jpeg_has_an_end(picture: bytes) -> bool:
    """Skip the header segments, which can hold a whole thumbnail, then look for the end marker."""
    position = 2
    while position + 4 <= len(picture) and picture[position] == 0xFF:
        if picture[position + 1] == JPEG_START_OF_SCAN:
            # The scan data escapes every 0xFF byte, so this pair can only be the marker.
            return JPEG_END_OF_IMAGE in picture[position:]
        position += 2 + int.from_bytes(picture[position + 2 : position + 4])
    return False
