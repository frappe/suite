"""Trimming: delete the edit rows the app row's checked body holds, once they are past the evidence window.

The base is the body at `body_rev`, never a fallback. A row stays while it is
under a day old and among the newest `max(4 MiB, 2 * state)` bytes the body
covers, so a tab resending a push still finds it. Before anything is deleted,
pycrdt must find that the body holds every row, and so must the product's Node
kernel where the host has Node; otherwise the rows stay and admins are alerted.
The row at `body_rev` always stays, so the body's chain is checked against it.

The hourly run keeps a cursor, so a run killed or out of time resumes where it
stopped. Each check takes one of the bench's compaction places.
"""

import hashlib
import math
import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import frappe
from frappe.utils import now_datetime

from suite.suite_core.content import admission, compaction, db, kernel
from suite.suite_core.content.snapshot import body_row, repeatable_read
from suite.suite_core.content.tables import table

WINDOW_AGE = timedelta(hours=24)
WINDOW_BYTES = 4 * 2**20
CHUNK_ROWS = 2000
CHUNK_BYTES = 4 * 2**20
BUDGET_S = 20 * 60
TIMEOUT = 1500


class Mismatch(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Chunk:
    """Rows after `after` through `through` that the body holds, with the body and its stamp as read."""

    after: int
    through: int
    body: bytes
    body_sha: bytes
    body_chain: bytes
    stamp_chain: bytes | None
    rows: list[bytes]


def cursor_key(adapter: str) -> str:
    """Name the cache key that holds where an app's last run stopped."""
    return f"suite:collab:trim-cursor:{adapter}"


def run(adapter: str, roots: Mapping[str, type], bundle: Path) -> None:
    """Trim every document that has rows to trim, from the cursor on, until the time budget runs out."""
    deadline = time.monotonic() + BUDGET_S
    cursor = frappe.cache.get_value(cursor_key(adapter)) or ""
    doc_table = table(adapter, "doc")
    candidates = frappe.db.sql(
        f"""SELECT `id` FROM `{doc_table}` WHERE `id` > %s AND `mode` != 'purged'
        AND `suspect` IS NULL AND `body_rev` > `trimmed_rev` + 1 ORDER BY `id`""",
        cursor,
    )
    for (doc_id,) in candidates:
        if time.monotonic() > deadline or not trim(adapter, doc_id, roots, bundle, deadline):
            return

        frappe.cache.set_value(cursor_key(adapter), doc_id)

    frappe.cache.delete_value(cursor_key(adapter))


def trim(
    adapter: str, doc_id: str, roots: Mapping[str, type], bundle: Path, deadline: float = math.inf
) -> bool:
    """Delete the document's rows past the window, a chunk at a time; answer False if `deadline` passed first."""
    bound = trim_bound(adapter, doc_id, now_datetime())
    while bound is not None:
        chunk = next_chunk(adapter, doc_id, bound)
        if chunk is None or not passes_check(adapter, doc_id, chunk, roots, bundle):
            return True

        if not delete(adapter, doc_id, chunk):
            return True

        if time.monotonic() > deadline:
            return False

    return True


def passes_check(adapter: str, doc_id: str, chunk: Chunk, roots: Mapping[str, type], bundle: Path) -> bool:
    """Check the chunk under a compaction place; alert and answer False on a mismatch, False too if none is free."""
    place = admission.take_place(adapter, doc_id)
    if place is None:
        return False

    try:
        check(chunk, roots, bundle)
    except Mismatch as mismatch:
        first_kept = chunk.after + 1
        db.alert(
            f"Collab trimming: {mismatch.reason}",
            f"Kept rows {first_kept} to {chunk.through}\n{adapter} document {doc_id}",
        )
        return False
    finally:
        admission.free_place(place)

    return True


def trim_bound(adapter: str, doc_id: str, now: datetime) -> tuple[int, int] | None:
    """Answer the document's `body_rev` and the last rev it covers past the window, or None."""
    with repeatable_read():
        doc = control_row(adapter, doc_id)
        if doc is None:
            return None

        start = window_start(adapter, doc, now)

    body_rev = int(doc.body_rev)
    # The row at `body_rev` stays, so the body's chain can be checked against it
    return body_rev, min(start - 1, body_rev - 1)


def window_start(adapter: str, doc: frappe._dict, now: datetime) -> int:
    """Answer the lowest rev in the evidence window: under a day old, among the newest `max(4 MiB, 2 * state)` bytes."""
    window_bytes = max(WINDOW_BYTES, 2 * int(doc.state_bytes))
    cutoff = now - WINDOW_AGE
    update_table = table(adapter, "update")
    found = frappe.db.sql(
        f"""SELECT COALESCE(MAX(CASE WHEN `newer` >= %s OR `created` < %s THEN `rev` END) + 1, MIN(`rev`), 0)
        FROM (SELECT `rev`, `created`, COALESCE(SUM(LENGTH(`payload`)) OVER (
            ORDER BY `rev` DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS `newer`
            FROM `{update_table}` WHERE `doc_id` = %s AND `rev` > %s AND `rev` <= %s) AS `covered`""",
        (window_bytes, cutoff, doc.id, int(doc.trimmed_rev), int(doc.body_rev)),
    )
    return int(found[0][0])


def next_chunk(adapter: str, doc_id: str, bound: tuple[int, int]) -> Chunk | None:
    """Read the next rows to trim from one snapshot, or None when none is left or the body moved on."""
    body_rev, last = bound
    with repeatable_read():
        doc = control_row(adapter, doc_id)
        if doc is None or int(doc.body_rev) != body_rev:
            return None

        after = int(doc.trimmed_rev)
        through = chunk_end(adapter, doc_id, after, last)
        app_row = body_row(adapter, doc.node)
        if through <= after or app_row is None:
            return None

        return Chunk(
            after=after,
            through=through,
            body=app_row.body,
            body_sha=bytes(doc.body_sha or b""),
            body_chain=bytes(doc.body_chain or b""),
            stamp_chain=row_chain(adapter, doc_id, body_rev),
            rows=ok_payloads(adapter, doc_id, after, through),
        )


def chunk_end(adapter: str, doc_id: str, after: int, last: int) -> int:
    """Answer the last rev of the chunk after `after`, at most `last`, or `after` when it is empty."""
    update_table = table(adapter, "update")
    rows = frappe.db.sql(
        f"""SELECT `rev`, LENGTH(`payload`) FROM `{update_table}`
        WHERE `doc_id` = %s AND `rev` > %s AND `rev` <= %s ORDER BY `rev` LIMIT %s""",
        (doc_id, after, last, CHUNK_ROWS),
    )
    end = after
    nbytes = 0
    for rev, row_bytes in rows:
        if end > after and nbytes + int(row_bytes) > CHUNK_BYTES:
            break

        end = int(rev)
        nbytes += int(row_bytes)

    return end


def ok_payloads(adapter: str, doc_id: str, after: int, through: int) -> list[bytes]:
    """Read the payloads of the rows after `after` through `through` that are not quarantined."""
    update_table = table(adapter, "update")
    rows = frappe.db.sql(
        f"""SELECT `payload` FROM `{update_table}` WHERE `doc_id` = %s AND `rev` > %s AND `rev` <= %s
        AND `state` = 'ok' ORDER BY `rev`""",
        (doc_id, after, through),
    )
    return [bytes(payload) for (payload,) in rows]


def row_chain(adapter: str, doc_id: str, rev: int) -> bytes | None:
    """Read the chain stamped on the row at `rev`, or None when that row is gone."""
    update_table = table(adapter, "update")
    found = frappe.db.sql(
        f"SELECT `chain` FROM `{update_table}` WHERE `doc_id` = %s AND `rev` = %s", (doc_id, rev)
    )
    if not found:
        return None

    return bytes(found[0][0])


def control_row(adapter: str, doc_id: str) -> frappe._dict | None:
    """Read the control row of a document trimming may touch: neither purged nor suspect."""
    doc_table = table(adapter, "doc")
    found = frappe.db.sql(
        f"""SELECT `id`, `node`, `body_rev`, `body_chain`, `body_sha`, `state_bytes`, `trimmed_rev`
        FROM `{doc_table}` WHERE `id` = %s AND `mode` != 'purged' AND `suspect` IS NULL""",
        doc_id,
        as_dict=True,
    )
    if not found:
        return None

    return found[0]


def check(chunk: Chunk, roots: Mapping[str, type], bundle: Path) -> None:
    """Raise `Mismatch` unless the body is the one stamped and both pycrdt and Node find it holds every row."""
    if hashlib.sha256(chunk.body).digest() != chunk.body_sha:
        raise Mismatch("body_sha")

    if chunk.stamp_chain != chunk.body_chain:
        raise Mismatch("chain")

    if not chunk.rows:
        return

    try:
        rebuilt = compaction.compact(chunk.body, chunk.rows, roots)
    except compaction.CompactionFailed as failed:
        raise Mismatch(failed.reason) from failed

    if not rebuilt.integrated or not compaction.same_content(rebuilt.state, chunk.body, roots):
        raise Mismatch("not_held")

    try:
        held = kernel.covers(bundle, chunk.body, chunk.rows)
    except kernel.KernelFailed as failed:
        raise Mismatch("kernel_failed") from failed

    if held is False:
        raise Mismatch("kernel_not_held")


def delete(adapter: str, doc_id: str, chunk: Chunk) -> bool:
    """Delete the chunk's 'ok' rows under the control row's lock, if its body and trim point are unchanged."""
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    if not still_as_checked(adapter, doc_id, chunk):
        frappe.db.rollback()
        return False

    doc_table = table(adapter, "doc")
    update_table = table(adapter, "update")
    frappe.db.sql(
        f"""DELETE FROM `{update_table}` WHERE `doc_id` = %s AND `rev` > %s AND `rev` <= %s
        AND `state` = 'ok'""",
        (doc_id, chunk.after, chunk.through),
    )
    frappe.db.sql(f"UPDATE `{doc_table}` SET `trimmed_rev` = %s WHERE `id` = %s", (chunk.through, doc_id))
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    return True


def still_as_checked(adapter: str, doc_id: str, chunk: Chunk) -> bool:
    """Lock the control row and answer whether its body and trim point are the ones the chunk was checked on."""
    doc_table = table(adapter, "doc")
    locked = frappe.db.sql(
        f"""SELECT `body_sha`, `trimmed_rev` FROM `{doc_table}`
        WHERE `id` = %s AND `mode` != 'purged' AND `suspect` IS NULL FOR UPDATE""",
        doc_id,
        as_dict=True,
    )
    if not locked:
        return False

    return bytes(locked[0].body_sha or b"") == chunk.body_sha and int(locked[0].trimmed_rev) == chunk.after
