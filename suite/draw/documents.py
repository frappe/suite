"""Read a scene or save it under its current Drive grant and revision."""

import json

import frappe
from frappe import _

from suite import drive
from suite.draw import DrawingBody, DrawingConflict, DrawingNotFound


def read(node: str) -> DrawingBody:
    document = _document(node)
    document.drive_check(drive.READ)
    return _body(document)


def save(node: str, content: str, base_modified: str) -> DrawingBody:
    document = _document(node, lock=True)
    document.drive_check(drive.EDIT)
    if not isinstance(base_modified, str) or str(document.modified) != base_modified:
        raise DrawingConflict(_("This drawing changed elsewhere. Your draft has been kept."))
    if not isinstance(content, str):
        raise frappe.ValidationError(_("Drawing content must be a JSON string."))
    document.content = content
    document.save()
    document.drive_take_version()
    return _body(document)


def _document(node: str, *, lock: bool = False):
    if frappe.session.user == "Guest":
        raise frappe.PermissionError(_("Sign in to open drawings."))
    name = frappe.db.get_value("Drawing", {"node": node}, "name", for_update=lock)
    if not name:
        raise DrawingNotFound(_("The drawing could not be found."))
    return frappe.get_doc("Drawing", name, for_update=lock)


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
