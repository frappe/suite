"""Trimming: delete the edit rows the app row's checked body holds, once they are past the evidence window.

The base is the body at `body_rev`, never a fallback. A row stays while it is
under a day old and among the newest `max(4 MiB, 2 * state)` bytes the body
covers, so a tab resending a push still finds it. Before anything is deleted,
pycrdt must find that the body holds every row, and so must the product's Node
checker where the host has Node; otherwise the rows stay and admins are alerted.
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
from frappe.query_builder import Case, Order, Table
from frappe.query_builder.functions import Coalesce, Length, Max, Min
from frappe.utils import now_datetime
from pypika.analytics import Preceding
from pypika.analytics import Sum as WindowSum

from suite.content import admission, checker, compaction, db
from suite.content.app_row import body_row
from suite.content.snapshot import repeatable_read
from suite.content.tables import table

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


def cursor_key(app: str) -> str:
    """Name the cache key that holds where an app's last run stopped."""
    return f"suite:collab:trim-cursor:{app}"


def run(app: str, part_map: Mapping[str, type], bundle: Path) -> None:
    """Trim every document that has rows to trim, from the cursor on, until the time budget runs out."""
    deadline = time.monotonic() + BUDGET_S
    cursor = frappe.cache.get_value(cursor_key(app)) or ""
    doc = Table(table(app, "doc"))
    candidates = (
        frappe.qb.from_(doc)
        .select(doc.id)
        .where(doc.id > cursor)
        .where(doc.mode != "purged")
        .where(doc.suspect.isnull())
        .where(doc.body_rev > doc.trimmed_rev + 1)
        .orderby(doc.id)
        .run()
    )
    for (doc_id,) in candidates:
        if time.monotonic() > deadline or not trim(app, doc_id, part_map, bundle, deadline):
            return

        frappe.cache.set_value(cursor_key(app), doc_id)

    frappe.cache.delete_value(cursor_key(app))


def trim(
    app: str, doc_id: str, part_map: Mapping[str, type], bundle: Path, deadline: float = math.inf
) -> bool:
    """Delete the document's rows past the window, a chunk at a time; answer False if `deadline` passed first."""
    bound = trim_bound(app, doc_id, now_datetime())
    while bound is not None:
        chunk = next_chunk(app, doc_id, bound)
        if chunk is None or not passes_check(app, doc_id, chunk, part_map, bundle):
            return True

        if not delete(app, doc_id, chunk):
            return True

        if time.monotonic() > deadline:
            return False

    return True


def passes_check(app: str, doc_id: str, chunk: Chunk, part_map: Mapping[str, type], bundle: Path) -> bool:
    """Check the chunk under a compaction place; alert and answer False on a mismatch, False too if none is free."""
    place = admission.take_place(app, doc_id)
    if place is None:
        return False

    try:
        check(chunk, part_map, bundle)
    except Mismatch as mismatch:
        first_kept = chunk.after + 1
        db.alert(
            f"Collab trimming: {mismatch.reason}",
            f"Kept rows {first_kept} to {chunk.through}\n{app} document {doc_id}",
        )
        return False
    finally:
        admission.free_place(place)

    return True


def trim_bound(app: str, doc_id: str, now: datetime) -> tuple[int, int] | None:
    """Answer the document's `body_rev` and the last rev it covers past the window, or None."""
    with repeatable_read():
        doc = control_row(app, doc_id)
        if doc is None:
            return None

        start = window_start(app, doc, now)

    body_rev = int(doc.body_rev)
    # The row at `body_rev` stays, so the body's chain can be checked against it
    return body_rev, min(start - 1, body_rev - 1)


def window_start(app: str, doc: frappe._dict, now: datetime) -> int:
    """Answer the lowest rev in the evidence window: under a day old, among the newest `max(4 MiB, 2 * state)` bytes."""
    window_bytes = max(WINDOW_BYTES, 2 * int(doc.state_bytes))
    cutoff = now - WINDOW_AGE
    update = Table(table(app, "update"))
    # Bytes of the rows newer than each row, newest first
    newer = WindowSum(Length(update.payload)).over().orderby(update.rev, order=Order.desc)
    covered = (
        frappe.qb.from_(update)
        .select(update.rev, update.created, Coalesce(newer.rows(Preceding(), Preceding(1)), 0).as_("newer"))
        .where(update.doc_id == doc.id)
        .where(update.rev > int(doc.trimmed_rev))
        .where(update.rev <= int(doc.body_rev))
        .as_("covered")
    )
    past_window = (covered.newer >= window_bytes) | (covered.created < cutoff)
    found = (
        frappe.qb.from_(covered)
        .select(Coalesce(Max(Case().when(past_window, covered.rev)) + 1, Min(covered.rev), 0))
        .run()
    )
    return int(found[0][0])


def next_chunk(app: str, doc_id: str, bound: tuple[int, int]) -> Chunk | None:
    """Read the next rows to trim from one snapshot, or None when none is left or the body moved on."""
    body_rev, last = bound
    with repeatable_read():
        doc = control_row(app, doc_id)
        if doc is None or int(doc.body_rev) != body_rev:
            return None

        after = int(doc.trimmed_rev)
        through = chunk_end(app, doc_id, after, last)
        app_row = body_row(app, doc.node)
        if through <= after or app_row is None:
            return None

        return Chunk(
            after=after,
            through=through,
            body=app_row.body,
            body_sha=bytes(doc.body_sha or b""),
            body_chain=bytes(doc.body_chain or b""),
            stamp_chain=row_chain(app, doc_id, body_rev),
            rows=ok_payloads(app, doc_id, after, through),
        )


def chunk_end(app: str, doc_id: str, after: int, last: int) -> int:
    """Answer the last rev of the chunk after `after`, at most `last`, or `after` when it is empty."""
    update = Table(table(app, "update"))
    rows = (
        frappe.qb.from_(update)
        .select(update.rev, Length(update.payload))
        .where(update.doc_id == doc_id)
        .where(update.rev > after)
        .where(update.rev <= last)
        .orderby(update.rev)
        .limit(CHUNK_ROWS)
        .run()
    )
    end = after
    nbytes = 0
    for rev, row_bytes in rows:
        if end > after and nbytes + int(row_bytes) > CHUNK_BYTES:
            break

        end = int(rev)
        nbytes += int(row_bytes)

    return end


def ok_payloads(app: str, doc_id: str, after: int, through: int) -> list[bytes]:
    """Read the payloads of the rows after `after` through `through` that are not quarantined."""
    update = Table(table(app, "update"))
    rows = (
        frappe.qb.from_(update)
        .select(update.payload)
        .where(update.doc_id == doc_id)
        .where(update.rev > after)
        .where(update.rev <= through)
        .where(update.state == "ok")
        .orderby(update.rev)
        .run()
    )
    return [bytes(payload) for (payload,) in rows]


def row_chain(app: str, doc_id: str, rev: int) -> bytes | None:
    """Read the chain stamped on the row at `rev`, or None when that row is gone."""
    update = Table(table(app, "update"))
    found = (
        frappe.qb.from_(update)
        .select(update.chain)
        .where(update.doc_id == doc_id)
        .where(update.rev == rev)
        .run()
    )
    if not found:
        return None

    return bytes(found[0][0])


def control_row(app: str, doc_id: str) -> frappe._dict | None:
    """Read the control row of a document trimming may touch: neither purged nor suspect."""
    doc = Table(table(app, "doc"))
    found = (
        frappe.qb.from_(doc)
        .select(
            doc.id, doc.node, doc.body_rev, doc.body_chain, doc.body_sha, doc.state_bytes, doc.trimmed_rev
        )
        .where(doc.id == doc_id)
        .where(doc.mode != "purged")
        .where(doc.suspect.isnull())
        .run(as_dict=True)
    )
    if not found:
        return None

    return found[0]


def check(chunk: Chunk, part_map: Mapping[str, type], bundle: Path) -> None:
    """Raise `Mismatch` unless the body is the one stamped and both pycrdt and Node find it holds every row."""
    if hashlib.sha256(chunk.body).digest() != chunk.body_sha:
        raise Mismatch("body_sha")

    if chunk.stamp_chain != chunk.body_chain:
        raise Mismatch("chain")

    if not chunk.rows:
        return

    try:
        rebuilt = compaction.compact(chunk.body, chunk.rows, part_map)
    except compaction.CompactionFailed as failed:
        raise Mismatch(failed.reason) from failed

    if not rebuilt.integrated or not compaction.same_content(rebuilt.state, chunk.body, part_map):
        raise Mismatch("not_held")

    try:
        held = checker.covers(bundle, chunk.body, chunk.rows)
    except checker.CheckerFailed as failed:
        raise Mismatch("checker_failed") from failed

    if held is False:
        raise Mismatch("checker_not_held")


def delete(app: str, doc_id: str, chunk: Chunk) -> bool:
    """Delete the chunk's 'ok' rows under the control row's lock, if its body and trim point are unchanged."""
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    if not still_as_checked(app, doc_id, chunk):
        frappe.db.rollback()
        return False

    doc = Table(table(app, "doc"))
    update = Table(table(app, "update"))
    (
        frappe.qb.from_(update)
        .delete()
        .where(update.doc_id == doc_id)
        .where(update.rev > chunk.after)
        .where(update.rev <= chunk.through)
        .where(update.state == "ok")
        .run()
    )
    frappe.qb.update(doc).set(doc.trimmed_rev, chunk.through).where(doc.id == doc_id).run()
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    return True


def still_as_checked(app: str, doc_id: str, chunk: Chunk) -> bool:
    """Lock the control row and answer whether its body and trim point are the ones the chunk was checked on."""
    doc = Table(table(app, "doc"))
    locked = (
        frappe.qb.from_(doc)
        .select(doc.body_sha, doc.trimmed_rev)
        .where(doc.id == doc_id)
        .where(doc.mode != "purged")
        .where(doc.suspect.isnull())
        .for_update()
        .run(as_dict=True)
    )
    if not locked:
        return False

    return bytes(locked[0].body_sha or b"") == chunk.body_sha and int(locked[0].trimmed_rev) == chunk.after
