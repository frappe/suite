# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import base64
import uuid

import frappe

PNG_1PX = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
WEBP_1PX = "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v02aAA="


def unique_bytes(base64_data):
    # unique trailing bytes per call: frappe dedupes Files by content hash, which
    # would otherwise share one file_url across unrelated test fixtures
    return base64.b64decode(base64_data.split(",", 1)[-1]) + uuid.uuid4().bytes


def make_thumbnail_data():
    """A distinct webp data URI, in the only format save_presentation_thumbnail accepts."""
    return "data:image/webp;base64," + base64.b64encode(unique_bytes(WEBP_1PX)).decode()


def make_presentation(title):
    return frappe.get_doc(
        {
            "doctype": "Presentation",
            "title": title,
            "slides": [{"elements": "[]"}],
        }
    ).insert()


def make_private_image(presentation_name, content=None, file_name="private-image.png"):
    if content is None:
        content = unique_bytes(PNG_1PX)

    return frappe.get_doc(
        {
            "doctype": "File",
            "file_name": file_name,
            "content": content,
            "is_private": 1,
            "attached_to_doctype": "Presentation",
            "attached_to_name": presentation_name,
        }
    ).insert()


def make_public(presentation_name):
    from suite.drive.overrides.file import File as DriveFile

    file = DriveFile.get_for_doc("Presentation", presentation_name)
    frappe.get_doc({"doctype": "Drive Permission", "entity": file, "user": "", "read": 1}).insert(
        ignore_permissions=True
    )


def make_private(presentation_name):
    from suite.drive.overrides.file import File as DriveFile

    file = DriveFile.get_for_doc("Presentation", presentation_name)
    frappe.db.delete("Drive Permission", {"entity": file, "user": ""})
