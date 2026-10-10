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
    doc_table = table("writer", "doc")
    if not table_exists(doc_table):
        return

    for column in (
        "`body_rev` bigint unsigned NOT NULL DEFAULT 0",
        "`body_chain` binary(32) NULL",
        "`body_sha` binary(32) NULL",
    ):
        frappe.db.sql_ddl(f"ALTER TABLE `{doc_table}` ADD COLUMN IF NOT EXISTS {column}")

    counts: dict[str, int] = {}
    doc_ids = frappe.db.sql(f"SELECT `id` FROM `{doc_table}` ORDER BY `id`")
    for (doc_id,) in doc_ids:
        outcome = move_body(doc_id)
        counts[outcome] = counts.get(outcome, 0) + 1
    frappe.db.commit()  # nosemgrep: frappe-manual-commit

    for column in OLD_COLUMNS:
        frappe.db.sql_ddl(f"ALTER TABLE `{doc_table}` DROP COLUMN IF EXISTS `{column}`")
    print(f"Writer bodies: {counts}")


def move_body(doc_id: str) -> str:
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    log_rows = frappe.db.sql(
        f"""SELECT `node`, `lineage`, `mode`, `body_rev` FROM `{table("writer", "doc")}`
        WHERE `id` = %s FOR UPDATE""",
        doc_id,
        as_dict=True,
    )
    log_row = log_rows[0]
    if log_row.mode == "purged":
        frappe.db.rollback()
        return "purged"

    rows = frappe.db.sql(
        "SELECT `name`, `owner`, `content` FROM `tabWriter Document` WHERE `node` = %s FOR UPDATE",
        log_row.node,
        as_dict=True,
    )
    if not rows:
        frappe.db.rollback()
        return "no_row"

    row = rows[0]
    newest_checkpoint = frappe.db.sql(
        f"""SELECT `through_rev`, `chain`, `sha256`, `gz` FROM `{table("writer", "checkpoint")}`
        WHERE `doc_id` = %s AND `integrated` = 1 AND `through_rev` > %s ORDER BY `through_rev` DESC LIMIT 1""",
        (doc_id, log_row.body_rev),
    )
    outcome = "moved"
    body_unset = not int(log_row.body_rev)
    row_has_text = row.content not in (None, "", EMPTY_BODY)
    if newest_checkpoint:
        through_rev, chain, sha256, gz_state = newest_checkpoint[0]
        state = gzip.decompress(bytes(gz_state))
        matches_sha = hashlib.sha256(state).digest() == bytes(sha256)
        if not matches_sha:
            # Kept for inspection, but no longer claimed as checked, so no open starts from it
            frappe.db.sql(
                f"""UPDATE `{table("writer", "checkpoint")}` SET `integrated` = 0
                WHERE `doc_id` = %s AND `through_rev` = %s""",
                (doc_id, through_rev),
            )
            frappe.db.commit()  # nosemgrep: frappe-manual-commit
            print(
                f"Writer body not moved, its checkpoint does not match its sha and is marked unchecked: {log_row.node}"
            )
            return "bad_checkpoint"

        body = base64.b64encode(state).decode("ascii")
        keep_recovery_copy(doc_id, log_row, row, body)
        edit_rows = frappe.db.sql(
            f"SELECT `created` FROM `{table('writer', 'update')}` WHERE `doc_id` = %s AND `rev` = %s",
            (doc_id, through_rev),
        )
        edited_at = edit_rows[0][0] if edit_rows else None
        frappe.db.sql(
            """UPDATE `tabWriter Document` SET `content` = %s,
            `modified` = GREATEST(`modified`, COALESCE(%s, `modified`)) WHERE `name` = %s""",
            (body, edited_at, row.name),
        )
        frappe.db.sql(
            f"""UPDATE `{table("writer", "doc")}` SET `body_rev` = %s, `body_chain` = UNHEX(%s), `body_sha` = UNHEX(%s)
            WHERE `id` = %s""",
            (int(through_rev), bytes(chain).hex(), bytes(sha256).hex(), doc_id),
        )
    elif body_unset and row_has_text:
        keep_recovery_copy(doc_id, log_row, row, EMPTY_BODY)
        frappe.db.sql(
            "UPDATE `tabWriter Document` SET `content` = %s WHERE `name` = %s", (EMPTY_BODY, row.name)
        )
        outcome = "emptied"
    else:
        outcome = "kept"
    frappe.db.commit()  # nosemgrep: frappe-manual-commit

    moved_through = int(newest_checkpoint[0][0]) if newest_checkpoint else int(log_row.body_rev)
    frappe.db.sql(
        f"""DELETE FROM `{table("writer", "checkpoint")}`
        WHERE `doc_id` = %s AND `integrated` = 1 AND `through_rev` <= %s""",
        (doc_id, moved_through),
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    return outcome


def keep_recovery_copy(doc_id: str, log_row: frappe._dict, row: frappe._dict, body: str) -> None:
    """A recovery copy of the row's text for the document's owner, when the move would replace it."""
    if row.content in (None, "", EMPTY_BODY, body):
        return

    payload = row.content.encode()
    try:
        owner = document_owner(log_row.node) or row.owner
        payload_sha = hashlib.sha256(payload).hexdigest()
        frappe.db.sql(
            f"""INSERT INTO `{table("writer", "recovery")}`
            (`id`, `doc_id`, `node`, `owner`, `reason`, `lineage`, `sha256`, `nbytes`, `payload`, `created`)
            VALUES (%s, %s, %s, %s, 'row_replaced', %s, UNHEX(%s), %s, UNHEX(%s), %s)""",
            (
                frappe.generate_hash(length=20),
                doc_id,
                log_row.node,
                owner,
                log_row.lineage,
                payload_sha,
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

    print(f"Writer row text kept as a recovery copy before the move: {log_row.node}")


def table_exists(name: str) -> bool:
    matches = frappe.db.sql(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = %s",
        name,
    )
    return bool(matches)
