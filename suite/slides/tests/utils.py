# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import base64
import uuid

import frappe

PNG_1PX = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def make_presentation(title):
    return frappe.get_doc(
        {
            "doctype": "Presentation",
            "title": title,
            "slides": [{"elements": "[]"}],
        }
    ).insert()


def unique_image_content():
    return base64.b64decode(PNG_1PX.split(",", 1)[1]) + uuid.uuid4().bytes


def make_private_image(presentation_name, content=None):
    # unique content per call: frappe dedupes Files by content hash, which
    # would otherwise share one file_url across unrelated test fixtures
    if content is None:
        content = unique_image_content()

    return frappe.get_doc(
        {
            "doctype": "File",
            "file_name": "private-image.png",
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
