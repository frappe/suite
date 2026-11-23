"""Draw's content adapter for Drive (§10.1).

Drive owns identity and lifecycle. Draw copies and versions only the scene.
The adoption patch binds existing drawings before registry validation. Their
legacy title column remains frozen while the node owns the current title.
"""

import io
import json
from contextvars import ContextVar
from typing import IO

import frappe
from frappe import _

from suite import drive

DOCTYPE = "Drawing"
VERSION_SCHEMA = "drawing/1"
MAX_CONTENT_BYTES = 64 * 1024 * 1024
MAX_VERSION_BYTES = MAX_CONTENT_BYTES + 1024

# Generic document requests cannot acquire the authority of a Drive callback.
_operation: ContextVar[tuple[str, str] | None] = ContextVar("draw_drive_operation", default=None)


def create_empty(node: str) -> str:
    """Create one empty scene after Drive has created its node."""
    return _insert(node, {"rectangles": [], "lines": []})


def duplicate(source_docname: str, node: str) -> str:
    """Copy the body without copying its identity, grants, or history."""
    source = frappe.get_doc(DOCTYPE, source_docname)
    return _insert(node, source.content)


def version_bytes(docname: str) -> tuple[io.BytesIO, str]:
    """Return a bounded scene envelope for Drive's immutable version store."""
    document = frappe.get_doc(DOCTYPE, docname)
    document.validate()
    content = json.loads(document.content) if isinstance(document.content, str) else document.content
    raw = json.dumps(
        {"schema": VERSION_SCHEMA, "content": content},
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    if len(raw) > MAX_VERSION_BYTES:
        frappe.throw(_("The drawing version is too large."))
    return io.BytesIO(raw), "application/json"


def restore_version(docname: str, stream: IO[bytes]) -> None:
    """Validate the entire version before saving any part of its scene."""
    raw = stream.read(MAX_VERSION_BYTES + 1)
    if len(raw) > MAX_VERSION_BYTES:
        frappe.throw(_("The drawing version is too large."))
    try:
        envelope = json.loads(raw)
    except ValueError, UnicodeError:
        frappe.throw(_("The drawing version is not valid JSON."))
    if not isinstance(envelope, dict) or envelope.get("schema") != VERSION_SCHEMA:
        frappe.throw(_("The drawing version has an unsupported format."))
    document = frappe.get_doc(DOCTYPE, docname)
    document.content = envelope.get("content")
    document.save(ignore_permissions=True)


def on_purge(docname: str) -> None:
    """Remove the body without retaining a copy in Deleted Document."""
    token = _operation.set(("purge", docname))
    try:
        frappe.delete_doc(
            DOCTYPE,
            docname,
            force=1,
            ignore_permissions=True,
            ignore_missing=True,
            delete_permanently=True,
        )
    finally:
        _operation.reset(token)


def _insert(node: str, content: object) -> str:
    token = _operation.set(("create", node))
    try:
        document = frappe.get_doc({"doctype": DOCTYPE, "node": node, "content": content})
        document.insert(ignore_permissions=True)
        return document.name
    finally:
        _operation.reset(token)


SPEC = drive.ContentTypeSpec(
    doctype=DOCTYPE,
    mime="frappe/drawing",
    node_field="node",
    create_empty=create_empty,
    duplicate=duplicate,
    version_bytes=version_bytes,
    restore_version=restore_version,
    on_purge=on_purge,
    legacy_fields=("title",),
)
