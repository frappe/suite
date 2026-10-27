"""The app's row: every read and write the layer makes of the row that holds a document's checked body and
readable copy. A lock on it is taken before the log's control row, never after."""

import base64
from collections.abc import Mapping
from datetime import datetime

import frappe
from frappe.query_builder import Table

from suite import drive
from suite.content.db import Greatest
from suite.content.editors import EditorSpec, ReadableCopy, spec_of
from suite.content.log import node_of
from suite.content.tables import table


def node_field(spec: EditorSpec) -> str:
    """Return the column of the app's doctype that names the node."""
    return drive.node_field(spec.doctype)


def body_row(app: str, node: str, *, lock: bool = False) -> frappe._dict | None:
    """Load the app's row for `node`, with its body decoded, or None when it has none."""
    spec = spec_of(app)
    app_table = frappe.qb.DocType(spec.doctype)
    query = (
        frappe.qb.from_(app_table)
        .select(app_table.name, app_table[spec.body_field].as_("body"), app_table.modified)
        .where(app_table[node_field(spec)] == node)
        .orderby(app_table.name)
        .limit(1)
    )
    if lock:
        query = query.for_update()

    found = query.run(as_dict=True)
    if not found:
        return None

    row = found[0]
    try:
        row.body = base64.b64decode(row.body or "", validate=True)
    except ValueError:
        # Answered as a body no stamp matches
        row.body = b""

    return row


def write_body(app: str, docname: str, state: bytes, *, edited_at: datetime | None = None) -> None:
    """Write `state` as the row's body; `edited_at` moves its `modified` forward to then, never back."""
    spec = spec_of(app)
    body = base64.b64encode(state).decode("ascii")
    app_table = frappe.qb.DocType(spec.doctype)
    update = (
        frappe.qb.update(app_table).set(app_table[spec.body_field], body).where(app_table.name == docname)
    )
    if edited_at is None:
        update.run()
        return

    update.set(app_table.modified, Greatest(app_table.modified, edited_at)).run()


def locked_app_row(app: str, doc_id: str, html_copy: ReadableCopy) -> frappe._dict | None:
    """Lock an unpurged log's app row, then its control row, its copy as `written`; lock before plain reads (REPEATABLE READ)."""
    spec = spec_of(app)
    app_table = frappe.qb.DocType(spec.doctype)
    doc = Table(table(app, "doc"))
    found = (
        frappe.qb.from_(app_table)
        .select(app_table.name)
        .where(app_table[node_field(spec)] == node_of(app, doc_id))
        .orderby(app_table.name)
        .limit(1)
        .for_update()
        .run(as_dict=True)
    )
    unpurged = (
        frappe.qb.from_(doc).select(1).where(doc.id == doc_id).where(doc.mode != "purged").for_update().run()
    )
    if not found or not unpurged:
        return None

    app_row = found[0]
    app_row.written = html_copy.read(spec.doctype, app_row.name)
    return app_row


def write_copy(app: str, docname: str, changed: Mapping[str, str | None], html_copy: ReadableCopy) -> None:
    """Write the copy's `changed` rows."""
    html_copy.write(spec_of(app).doctype, docname, changed)


def copy_row(app: str, doc_id: str, html_copy: ReadableCopy) -> frappe._dict | None:
    """Load the copy's rows as `written`, with the head and the projection row, of a log that isn't purged."""
    spec = spec_of(app)
    doc = Table(table(app, "doc")).as_("doc")
    projection = Table(table(app, "projection")).as_("projection")
    app_table = frappe.qb.DocType(spec.doctype).as_("app")
    found = (
        frappe.qb.from_(doc)
        .join(projection)
        .on(projection.doc_id == doc.id)
        .join(app_table)
        .on(app_table[node_field(spec)] == doc.node)
        .select(app_table.name, doc.head_rev, projection.projected_rev, projection.projection_hash)
        .where(doc.id == doc_id)
        .where(doc.mode != "purged")
        .orderby(app_table.name)
        .limit(1)
        .run(as_dict=True)
    )
    if not found:
        return None

    copy = found[0]
    copy.written = html_copy.read(spec.doctype, copy.name)
    return copy


def forget_cached(app: str, docname: str) -> None:
    """Drop the app row's cached document."""
    frappe.clear_document_cache(spec_of(app).doctype, docname)
