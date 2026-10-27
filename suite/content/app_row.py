"""The app's row: every read and write the layer makes of the row that holds a document's checked body and
readable copy. A lock on it is taken before the log's control row, never after."""

import base64
from collections.abc import Mapping
from datetime import datetime

import frappe

from suite import drive
from suite.content.editors import EditorSpec, ReadableCopy, spec_of
from suite.content.log import node_of
from suite.content.tables import table


def node_field(spec: EditorSpec) -> str:
    """Return the column of the app's doctype that names the node."""
    return drive.node_field(spec.doctype)


def body_row(app: str, node: str, *, lock: bool = False) -> frappe._dict | None:
    """Load the app's row for `node`, with its body decoded, or None when it has none."""
    spec = spec_of(app)
    node_column = node_field(spec)
    lock_clause = " FOR UPDATE" if lock else ""
    found = frappe.db.sql(
        f"""SELECT `name`, `{spec.body_field}` AS `body`, `modified` FROM `tab{spec.doctype}`
        WHERE `{node_column}` = %s ORDER BY `name` LIMIT 1{lock_clause}""",
        node,
        as_dict=True,
    )
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
    if edited_at is None:
        frappe.db.sql(
            f"UPDATE `tab{spec.doctype}` SET `{spec.body_field}` = %s WHERE `name` = %s", (body, docname)
        )
        return

    frappe.db.sql(
        f"""UPDATE `tab{spec.doctype}` SET `{spec.body_field}` = %s, `modified` = GREATEST(`modified`, %s)
        WHERE `name` = %s""",
        (body, edited_at, docname),
    )


def locked_app_row(app: str, doc_id: str, html_copy: ReadableCopy) -> frappe._dict | None:
    """Lock an unpurged log's app row, then its control row, its copy as `written`; lock before plain reads (REPEATABLE READ)."""
    spec = spec_of(app)
    doc_table = table(app, "doc")
    node_column = node_field(spec)
    found = frappe.db.sql(
        f"""SELECT `name` FROM `tab{spec.doctype}` WHERE `{node_column}` = %s
        ORDER BY `name` LIMIT 1 FOR UPDATE""",
        node_of(app, doc_id),
        as_dict=True,
    )
    unpurged = frappe.db.sql(
        f"SELECT 1 FROM `{doc_table}` WHERE `id` = %s AND `mode` != 'purged' FOR UPDATE", doc_id
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
    doc_table = table(app, "doc")
    projection_table = table(app, "projection")
    node_column = node_field(spec)
    found = frappe.db.sql(
        f"""SELECT `app`.`name`, `doc`.`head_rev`, `projection`.`projected_rev`,
        `projection`.`projection_hash`
        FROM `{doc_table}` `doc`
        JOIN `{projection_table}` `projection` ON `projection`.`doc_id` = `doc`.`id`
        JOIN `tab{spec.doctype}` `app` ON `app`.`{node_column}` = `doc`.`node`
        WHERE `doc`.`id` = %s AND `doc`.`mode` != 'purged' ORDER BY `app`.`name` LIMIT 1""",
        doc_id,
        as_dict=True,
    )
    if not found:
        return None

    copy = found[0]
    copy.written = html_copy.read(spec.doctype, copy.name)
    return copy


def forget_cached(app: str, docname: str) -> None:
    """Drop the app row's cached document."""
    frappe.clear_document_cache(spec_of(app).doctype, docname)
