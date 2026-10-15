"""The update log's lifecycle and hash chain: the app's switch, and creating, finding and purging a log."""

import hashlib
import secrets
import struct

import frappe
from frappe.utils import now_datetime

from suite.suite_core.content.tables import table

PURGE_BATCH = 500


class Refusal(Exception):
    """A collab answer other than success, sent as `{"collab": reason, ...}`."""

    def __init__(self, status: int, collab: str, /, **extra):
        super().__init__(collab)
        self.status = status
        self.body = {"collab": collab, **extra}


def mode(adapter: str) -> str:
    """The app's switch: "on", or "off" when it has no row."""
    filters = {
        "parent": "Suite Collab Settings",
        "parentfield": "apps",
        "adapter": adapter,
    }
    return frappe.db.get_value("Suite Collab App", filters, "mode") or "off"


def set_mode(adapter: str, new_mode: str) -> None:
    settings = frappe.get_single("Suite Collab Settings")
    row = next((row for row in settings.apps if row.adapter == adapter), None)
    if row is None:
        row = settings.append("apps", {"adapter": adapter})
    row.mode = new_mode
    settings.save(ignore_permissions=True)


def enabled(adapter: str) -> bool:
    return mode(adapter) == "on"


class ChainBroken(Exception):
    reason = "chain_break"


def require_enabled(adapter: str) -> None:
    if not enabled(adapter):
        raise Refusal(409, "disabled")


def chain_seed(lineage: str) -> bytes:
    return hashlib.sha256(lineage.encode()).digest()


def chain_next(previous: bytes, rev: int, payload_sha: bytes) -> bytes:
    return hashlib.sha256(previous + struct.pack(">Q", rev) + payload_sha).digest()


def find(adapter: str, node: str) -> frappe._dict | None:
    """`node`'s log, or None when it has none or its log is purged."""
    doc_table = table(adapter, "doc")
    rows = frappe.db.sql(
        f"""SELECT `id`, `lineage`, `head_rev`, `head_chain`, `q_epoch`, `verdict`, `judged`, `schema_steps`,
        `suspect_held`, `state_bytes`, `tail_bound`, `trimmed_rev` FROM `{doc_table}` WHERE `node` = %s AND `mode` != 'purged'""",
        node,
        as_dict=True,
    )
    return rows[0] if rows else None


def create(adapter: str, node: str) -> str:
    """Start an empty log for `node` in the caller's transaction; answers its id."""
    doc_id = frappe.generate_hash(length=20)
    lineage = secrets.token_hex(16)
    frappe.db.sql(
        f"""INSERT INTO `{table(adapter, "doc")}` (`id`, `node`, `lineage`, `head_rev`, `head_chain`, `start_clocks`, `created`)
        VALUES (%s, %s, %s, 0, UNHEX(%s), '{{}}', %s)""",
        (doc_id, node, lineage, chain_seed(lineage).hex(), now_datetime()),
    )
    return doc_id


def mark_purged(adapter: str, node: str) -> str | None:
    """Mark `node`'s log purged in the caller's transaction, for `delete_purged` to remove; answers its id."""
    doc = find(adapter, node)
    if not doc:
        return None

    frappe.db.sql(f"UPDATE `{table(adapter, 'doc')}` SET `mode` = 'purged' WHERE `id` = %s", doc.id)
    return doc.id


def delete_purged(adapter: str, doc_id: str) -> None:
    """Delete a purged log's rows in batches, each committed, then its control row. Safe to run again."""
    doc_table = table(adapter, "doc")
    purged = frappe.db.sql(f"SELECT 1 FROM `{doc_table}` WHERE `id` = %s AND `mode` = 'purged'", doc_id)
    if not purged:
        return

    for kind in ("update", "checkpoint", "session", "stage", "recovery", "projection", "copy"):
        while True:
            frappe.db.sql(
                f"DELETE FROM `{table(adapter, kind)}` WHERE `doc_id` = %s LIMIT %s", (doc_id, PURGE_BATCH)
            )
            deleted = frappe.db.sql("SELECT ROW_COUNT()")[0][0]
            frappe.db.commit()  # nosemgrep: frappe-manual-commit
            if deleted < PURGE_BATCH:
                break

    frappe.db.sql(f"DELETE FROM `{doc_table}` WHERE `id` = %s AND `mode` = 'purged'", doc_id)
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
