"""Read a scene or save it under its current Drive grant and revision."""

import json

import frappe
from frappe import _

from suite import drive
from suite.draw import DrawingBody, DrawingConflict, DrawingNotFound
from suite.draw.drive import _operation


def read(node: str) -> DrawingBody:
    document = frappe.get_doc("Drawing", _drawing_name(node))
    document.drive_check(drive.READ)
    return _body(document)


def save(node: str, content: str, base_modified: str) -> DrawingBody:
    name = _drawing_name(node)
    drive.lock_content_for_edit(node)
    document = frappe.get_doc("Drawing", name, for_update=True)
    if not isinstance(base_modified, str) or str(document.modified) != base_modified:
        raise DrawingConflict(_("This drawing changed elsewhere. Your draft has been kept."))
    if not isinstance(content, str):
        raise frappe.ValidationError(_("Drawing content must be a JSON string."))
    document.content = content
    with _operation.set(("save", name)):
        document.save()
    document.drive_take_version()
    return _body(document)


def _drawing_name(node: str) -> str:
    if frappe.session.user == "Guest":
        raise frappe.PermissionError(_("Sign in to open drawings."))
    name = frappe.db.get_value("Drawing", {"node": node}, "name")
    if not name:
        raise DrawingNotFound(_("The drawing could not be found."))
    return name


def _body(document) -> DrawingBody:
    content = document.content
    if not isinstance(content, str):
        content = json.dumps(content, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return {
        "name": document.name,
        "node": document.node,
        "content": content,
        "modified": str(document.modified),
    }
