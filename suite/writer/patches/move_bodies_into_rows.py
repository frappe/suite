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

from suite import drive
from suite.content.tables import table
from suite.writer.drive import EMPTY_BODY

OLD_COLUMNS = ("checkpoint_rev", "checkpoint_chain", "integrated_rev")
DOC_TABLE = table("writer", "doc")
CHECKPOINT_TABLE = table("writer", "checkpoint")
UPDATE_TABLE = table("writer", "update")
RECOVERY_TABLE = table("writer", "recovery")


def insert_recovery_copy(doc_id: str, log_row: frappe._dict, owner: str, payload: bytes) -> None:
    """Insert a recovery copy of `payload` for `owner`."""
    payload_sha = hashlib.sha256(payload).hexdigest()
    frappe.db.sql(
        f"""INSERT INTO `{RECOVERY_TABLE}`
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


def keep_recovery_copy(doc_id: str, log_row: frappe._dict, row: frappe._dict, body: str) -> None:
    """Keep the row's text as a recovery copy for the document's owner, when the move would replace it."""
    if row.content in {None, "", EMPTY_BODY, body}:
        return

    payload = row.content.encode()
    try:
        owner = drive.node_owner(log_row.node)
    except drive.DriveNotFound:
        owner = row.owner

    try:
        insert_recovery_copy(doc_id, log_row, owner, payload)
    except Exception as error:
        # The owner already has a copy of this exact text
        if not frappe.db.is_duplicate_entry(error):
            raise

        return

    print(f"Writer row text kept as a recovery copy before the move: {log_row.node}")


def mark_checkpoint_unchecked(doc_id: str, node: str, through_rev: int) -> str:
    """Mark a checkpoint that fails its sha unchecked, and answer the outcome."""
    # Kept for inspection, but no longer claimed as checked, so no open starts from it
    frappe.db.sql(
        f"""UPDATE `{CHECKPOINT_TABLE}` SET `integrated` = 0
        WHERE `doc_id` = %s AND `through_rev` = %s""",
        (doc_id, through_rev),
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    print(f"Writer body not moved, its checkpoint does not match its sha and is marked unchecked: {node}")
    return "bad_checkpoint"


def move_checkpoint(doc_id: str, log_row: frappe._dict, row: frappe._dict, checkpoint: tuple) -> str:
    """Write a checked checkpoint into the row and the log, and answer the outcome."""
    through_rev, chain, sha256, gz_state = checkpoint
    state = gzip.decompress(bytes(gz_state))
    matches_sha = hashlib.sha256(state).digest() == bytes(sha256)
    if not matches_sha:
        return mark_checkpoint_unchecked(doc_id, log_row.node, through_rev)

    body = base64.b64encode(state).decode("ascii")
    keep_recovery_copy(doc_id, log_row, row, body)
    edit_rows = frappe.db.sql(
        f"SELECT `created` FROM `{UPDATE_TABLE}` WHERE `doc_id` = %s AND `rev` = %s",
        (doc_id, through_rev),
    )
    edited_at = None
    if edit_rows:
        edited_at = edit_rows[0][0]

    frappe.db.sql(
        """UPDATE `tabWriter Document` SET `content` = %s,
        `modified` = GREATEST(`modified`, COALESCE(%s, `modified`)) WHERE `name` = %s""",
        (body, edited_at, row.name),
    )
    frappe.db.sql(
        f"""UPDATE `{DOC_TABLE}` SET `body_rev` = %s, `body_chain` = UNHEX(%s), `body_sha` = UNHEX(%s)
        WHERE `id` = %s""",
        (int(through_rev), bytes(chain).hex(), bytes(sha256).hex(), doc_id),
    )
    return "moved"


def empty_row(doc_id: str, log_row: frappe._dict, row: frappe._dict) -> str:
    """Empty a row with text and no moved body, keeping its text first, and answer the outcome."""
    body_unset = not int(log_row.body_rev)
    row_has_text = row.content not in {None, "", EMPTY_BODY}
    if not (body_unset and row_has_text):
        return "kept"

    keep_recovery_copy(doc_id, log_row, row, EMPTY_BODY)
    frappe.db.sql("UPDATE `tabWriter Document` SET `content` = %s WHERE `name` = %s", (EMPTY_BODY, row.name))
    return "emptied"


def load_log_row(doc_id: str) -> frappe._dict:
    """Load and lock the document's log row."""
    log_rows = frappe.db.sql(
        f"""SELECT `node`, `lineage`, `mode`, `body_rev` FROM `{DOC_TABLE}`
        WHERE `id` = %s FOR UPDATE""",
        doc_id,
        as_dict=True,
    )
    return log_rows[0]


def load_document_row(node: str) -> frappe._dict | None:
    """Load and lock the Writer Document row of `node`."""
    rows = frappe.db.sql(
        """SELECT `name`, `owner`, `content` FROM `tabWriter Document`
        WHERE `node` = %s ORDER BY `name` LIMIT 1 FOR UPDATE""",
        node,
        as_dict=True,
    )
    if not rows:
        return None

    return rows[0]


def load_newest_checkpoint(doc_id: str, body_rev: int) -> tuple | None:
    """Load the newest checked checkpoint past `body_rev`."""
    checkpoints = frappe.db.sql(
        f"""SELECT `through_rev`, `chain`, `sha256`, `gz` FROM `{CHECKPOINT_TABLE}`
        WHERE `doc_id` = %s AND `integrated` = 1 AND `through_rev` > %s ORDER BY `through_rev` DESC LIMIT 1""",
        (doc_id, body_rev),
    )
    if not checkpoints:
        return None

    [checkpoint] = checkpoints
    return checkpoint


def drop_moved_checkpoints(doc_id: str, moved_through: int) -> None:
    """Delete the checked checkpoints the row's body now covers."""
    frappe.db.sql(
        f"""DELETE FROM `{CHECKPOINT_TABLE}`
        WHERE `doc_id` = %s AND `integrated` = 1 AND `through_rev` <= %s""",
        (doc_id, moved_through),
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def move_body(doc_id: str) -> str:
    """Move one document's newest checked checkpoint into its row, and answer the outcome."""
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    log_row = load_log_row(doc_id)
    if log_row.mode == "purged":
        frappe.db.rollback()
        return "purged"

    row = load_document_row(log_row.node)
    if row is None:
        frappe.db.rollback()
        return "no_row"

    checkpoint = load_newest_checkpoint(doc_id, log_row.body_rev)
    if checkpoint is None:
        outcome = empty_row(doc_id, log_row, row)
    else:
        outcome = move_checkpoint(doc_id, log_row, row, checkpoint)

    if outcome == "bad_checkpoint":
        return outcome

    frappe.db.commit()  # nosemgrep: frappe-manual-commit

    moved_through = int(log_row.body_rev)
    if checkpoint is not None:
        moved_through = int(checkpoint[0])

    drop_moved_checkpoints(doc_id, moved_through)
    return outcome


def execute() -> None:
    """Move every Writer log's newest checked checkpoint into its row, then drop the old columns."""
    if DOC_TABLE not in frappe.db.get_tables(cached=False):
        return

    for column in (
        "`body_rev` bigint unsigned NOT NULL DEFAULT 0",
        "`body_chain` binary(32) NULL",
        "`body_sha` binary(32) NULL",
    ):
        frappe.db.sql_ddl(f"ALTER TABLE `{DOC_TABLE}` ADD COLUMN IF NOT EXISTS {column}")

    counts: dict[str, int] = {}
    doc_ids = frappe.db.sql(f"SELECT `id` FROM `{DOC_TABLE}` ORDER BY `id`")
    for (doc_id,) in doc_ids:
        outcome = move_body(doc_id)
        counts[outcome] = counts.get(outcome, 0) + 1

    frappe.db.commit()  # nosemgrep: frappe-manual-commit

    for column in OLD_COLUMNS:
        frappe.db.sql_ddl(f"ALTER TABLE `{DOC_TABLE}` DROP COLUMN IF EXISTS `{column}`")

    print(f"Writer bodies: {counts}")
