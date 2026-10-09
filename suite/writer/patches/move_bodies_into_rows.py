"""Move each Writer log's newest checked checkpoint into its `Writer Document.content` and stamp it.

A document with no checked checkpoint keeps an empty row and `body_rev` 0, and opens from all its
edits. Text a row held that the move replaces is kept first as a recovery copy for the document's
owner. Each document commits on its own, so the patch is safe to stop and run again; the old
columns go only once every document is moved.
"""

import base64
import gzip
import hashlib

import frappe
from frappe.utils import now_datetime

from suite.suite_core.content.tables import table
from suite.writer.content import document_owner
from suite.writer.drive import EMPTY_BODY

OLD_COLUMNS = ("checkpoint_rev", "checkpoint_chain", "integrated_rev")


def execute() -> None:
    doc = table("writer", "doc")
    if not exists(doc):
        return
    for column in (
        "`body_rev` bigint unsigned NOT NULL DEFAULT 0",
        "`body_chain` binary(32) NULL",
        "`body_sha` binary(32) NULL",
    ):
        frappe.db.sql_ddl(f"ALTER TABLE `{doc}` ADD COLUMN IF NOT EXISTS {column}")
    counts: dict[str, int] = {}
    for (doc_id,) in frappe.db.sql(f"SELECT `id` FROM `{doc}` ORDER BY `id`"):
        outcome = move(doc_id)
        counts[outcome] = counts.get(outcome, 0) + 1
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    for column in OLD_COLUMNS:
        frappe.db.sql_ddl(f"ALTER TABLE `{doc}` DROP COLUMN IF EXISTS `{column}`")
    print(f"Writer bodies: {counts}")


def move(doc_id: str) -> str:
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    doc = frappe.db.sql(
        f"""SELECT `node`, `lineage`, `mode`, `body_rev` FROM `{table("writer", "doc")}`
        WHERE `id` = %s FOR UPDATE""",
        doc_id,
        as_dict=True,
    )[0]
    if doc.mode == "purged":
        frappe.db.rollback()
        return "purged"
    row = frappe.db.sql(
        "SELECT `name`, `owner`, `content` FROM `tabWriter Document` WHERE `node` = %s FOR UPDATE",
        doc.node,
        as_dict=True,
    )
    if not row:
        frappe.db.rollback()
        return "no_row"
    row = row[0]
    newest = frappe.db.sql(
        f"""SELECT `through_rev`, `chain`, `sha256`, `gz` FROM `{table("writer", "checkpoint")}`
        WHERE `doc_id` = %s AND `integrated` = 1 AND `through_rev` > %s ORDER BY `through_rev` DESC LIMIT 1""",
        (doc_id, doc.body_rev),
    )
    outcome = "moved"
    if newest:
        through, chain, sha, gz = newest[0]
        state = gzip.decompress(bytes(gz))
        if hashlib.sha256(state).digest() != bytes(sha):
            # Kept for inspection, but no longer claimed as checked, so no open starts from it
            frappe.db.sql(
                f"""UPDATE `{table("writer", "checkpoint")}` SET `integrated` = 0
                WHERE `doc_id` = %s AND `through_rev` = %s""",
                (doc_id, through),
            )
            frappe.db.commit()  # nosemgrep: frappe-manual-commit
            print(
                f"Writer body not moved, its checkpoint does not match its sha and is marked unchecked: {doc.node}"
            )
            return "bad_checkpoint"
        body = base64.b64encode(state).decode("ascii")
        keep(doc_id, doc, row, body)
        edited = frappe.db.sql(
            f"SELECT `created` FROM `{table('writer', 'update')}` WHERE `doc_id` = %s AND `rev` = %s",
            (doc_id, through),
        )
        frappe.db.sql(
            """UPDATE `tabWriter Document` SET `content` = %s,
            `modified` = GREATEST(`modified`, COALESCE(%s, `modified`)) WHERE `name` = %s""",
            (body, edited[0][0] if edited else None, row.name),
        )
        frappe.db.sql(
            f"""UPDATE `{table("writer", "doc")}` SET `body_rev` = %s, `body_chain` = UNHEX(%s), `body_sha` = UNHEX(%s)
            WHERE `id` = %s""",
            (int(through), bytes(chain).hex(), bytes(sha).hex(), doc_id),
        )
    elif not int(doc.body_rev) and row.content not in (None, "", EMPTY_BODY):
        keep(doc_id, doc, row, EMPTY_BODY)
        frappe.db.sql(
            "UPDATE `tabWriter Document` SET `content` = %s WHERE `name` = %s", (EMPTY_BODY, row.name)
        )
        outcome = "emptied"
    else:
        outcome = "kept"
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    frappe.db.sql(
        f"""DELETE FROM `{table("writer", "checkpoint")}`
        WHERE `doc_id` = %s AND `integrated` = 1 AND `through_rev` <= %s""",
        (doc_id, int(newest[0][0]) if newest else int(doc.body_rev)),
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    return outcome


def keep(doc_id: str, doc: frappe._dict, row: frappe._dict, body: str) -> None:
    """A recovery copy of the row's text for the document's owner, when the move would replace it."""
    if row.content in (None, "", EMPTY_BODY, body):
        return
    payload = row.content.encode()
    try:
        frappe.db.sql(
            f"""INSERT INTO `{table("writer", "recovery")}`
            (`id`, `doc_id`, `node`, `owner`, `reason`, `lineage`, `sha256`, `nbytes`, `payload`, `created`)
            VALUES (%s, %s, %s, %s, 'row_replaced', %s, UNHEX(%s), %s, UNHEX(%s), %s)""",
            (
                frappe.generate_hash(length=20),
                doc_id,
                doc.node,
                document_owner(doc.node) or row.owner,
                doc.lineage,
                hashlib.sha256(payload).hexdigest(),
                len(payload),
                payload.hex(),
                now_datetime(),
            ),
        )
    except Exception as error:
        # The owner already has a copy of this exact text
        if not frappe.db.is_duplicate_entry(error):
            raise
        return
    print(f"Writer row text kept as a recovery copy before the move: {doc.node}")


def exists(name: str) -> bool:
    return bool(
        frappe.db.sql(
            "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = %s",
            name,
        )
    )
