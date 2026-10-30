"""Reading a log: the base and every row after it from one snapshot, chain checked.

The base is the app row's checked body, or a fallback newer than it unless the
read is `integrated`. A read's `rows` leave out quarantined rows, and
`quarantined` lists their revs. Rows are gap-free and commit-ordered, so a break
means the store changed under the read or was rewound; the read is tried once
more before it gives up. A Drive callback may not commit, so it passes
`own_snapshot=False` and reads in Drive's transaction.
"""

import contextlib
import gzip
import hashlib
import json
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from typing import cast

import frappe
from frappe.query_builder import Order, Table
from frappe.query_builder.functions import Coalesce, Count, Length, Max, Sum
from frappe.query_builder.terms import SubQuery

from suite.content.app_row import body_row
from suite.content.db import load_system_variable
from suite.content.log import ChainBroken, chain_next, chain_seed
from suite.content.tables import table


@dataclass(frozen=True)
class Snapshot:
    """A log read: the base, every row after it through the head, and the revs quarantined."""

    lineage: str
    head_rev: int
    head_chain: bytes
    schema: int
    base: int
    checkpoint: bytes | None
    rows: list[tuple[int, bytes]]
    quarantined: list[int]
    q_epoch: int

    def payloads(self) -> list[bytes]:
        """Answer the rows' payloads in rev order."""
        return [payload for _rev, payload in self.rows]


def start_clocks(doc: frappe._dict) -> dict[int, int]:
    """Answer each writer's next clock once the log's start is stored."""
    clocks = json.loads(doc.start_clocks or "{}")
    return {int(client): clock for client, clock in clocks.items()}


def rows_after(app: str, doc_id: str, since_rev: int) -> list[tuple[int, bytes]]:
    """Load the committed rows after `since_rev` in rev order, a quarantined one empty, in one statement."""
    update = Table(table(app, "update"))
    stored_rows = (
        frappe.qb.from_(update)
        .select(update.rev, update.payload)
        .where(update.doc_id == doc_id)
        .where(update.rev > since_rev)
        .orderby(update.rev)
        .run()
    )
    return [(int(rev), bytes(payload)) for rev, payload in stored_rows]


def with_tombstones(log_read: Snapshot) -> list[tuple[int, bytes]]:
    """Answer a read's rows with each quarantined rev as an empty row, which no real row is, in rev order."""
    tombstones = [(rev, b"") for rev in log_read.quarantined]
    return sorted([*log_read.rows, *tombstones])


def isolation_level() -> str | None:
    """Load the session's isolation level under its current name or the one older servers use."""
    for name in ("transaction_isolation", "tx_isolation"):
        level = load_system_variable(name)
        if level is not None:
            return cast(str, level)

    return None


@contextlib.contextmanager
def repeatable_read() -> Iterator[None]:
    """Run the reads in one REPEATABLE READ snapshot. The level applies from the next transaction."""
    previous_level = isolation_level()
    # Raw SQL: qb can't set a session variable
    frappe.db.sql("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ")
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    try:
        yield
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
    finally:
        if previous_level and previous_level != "REPEATABLE-READ":
            previous_clause = previous_level.replace("-", " ")
            # Raw SQL: qb can't set a session variable
            frappe.db.sql(f"SET SESSION TRANSACTION ISOLATION LEVEL {previous_clause}")


def fallback_rev(app: str, doc_id: str) -> int:
    """Load the rev the document's fallback runs through, 0 when it has none."""
    checkpoint = Table(table(app, "checkpoint"))
    found = (
        frappe.qb.from_(checkpoint)
        .select(Coalesce(Max(checkpoint.through_rev), 0))
        .where(checkpoint.doc_id == doc_id)
        .run()
    )
    return int(found[0][0])


@dataclass(frozen=True)
class TailSums:
    """Subqueries for the rows, bytes and bound of a document's tail."""

    rows: SubQuery
    nbytes: SubQuery
    bound: SubQuery


def tail_sums(app: str, doc_id: str, base: int) -> TailSums:
    """Answer subqueries for the rows, bytes and bound of the document's tail after `base`."""
    update = Table(table(app, "update"))
    tail = frappe.qb.from_(update).where(update.doc_id == doc_id).where(update.rev > base)
    payload_bytes = Length(update.payload)
    return TailSums(
        rows=SubQuery(tail.select(Count("*"))),
        nbytes=SubQuery(tail.select(Coalesce(Sum(payload_bytes), 0))),
        bound=SubQuery(tail.select(Coalesce(Sum(Coalesce(update.bound, payload_bytes)), 0))),
    )


@dataclass(frozen=True)
class Base:
    """Where a read starts: the state through `rev` and the chain it ends on."""

    rev: int
    checkpoint: bytes | None
    chain: bytes
    is_intact: bool


def pick_base(app: str, doc_id: str, doc: frappe._dict, body: bytes, integrated: bool) -> Base:
    """Pick the app row's body, or a fallback newer than it unless `integrated`."""
    rev = int(doc.body_rev)
    checkpoint = None
    chain = chain_seed(doc.lineage)
    is_intact = True
    if rev:
        checkpoint = body
        chain = bytes(doc.body_chain or b"")
        body_sha = doc.body_sha
        is_intact = body_sha is not None and hashlib.sha256(checkpoint).digest() == bytes(body_sha)

    fallback_rows = None
    if not integrated:
        fallback_rows = newest_fallback(app, doc_id, rev)

    if fallback_rows:
        through, compressed_state, stored_chain, stored_sha = fallback_rows[0]
        state = gzip.decompress(bytes(compressed_state))
        # A fallback that fails its sha is passed over; every edit after the body is still there
        if hashlib.sha256(state).digest() == bytes(stored_sha):
            return Base(int(through), state, bytes(stored_chain), True)

    return Base(rev, checkpoint, chain, is_intact)


def newest_fallback(app: str, doc_id: str, rev: int) -> Sequence:
    """Load the newest fallback that runs past `rev`, empty when none does."""
    checkpoint = Table(table(app, "checkpoint"))
    return (
        frappe.qb.from_(checkpoint)
        .select(checkpoint.through_rev, checkpoint.gz, checkpoint.chain, checkpoint.sha256)
        .where(checkpoint.doc_id == doc_id)
        .where(checkpoint.through_rev > rev)
        .orderby(checkpoint.through_rev, order=Order.desc)
        .limit(1)
        .run()
    )


@dataclass(frozen=True)
class ChainWalk:
    """The rows and the quarantined revs a read found, and the chain extended over both."""

    rows: list[tuple[int, bytes]]
    quarantined: list[int]
    chain: bytes


def walk_chain(stored: Sequence, chain: bytes) -> ChainWalk:
    """Split the stored rows from the quarantined revs and extend the chain over both."""
    rows: list[tuple[int, bytes]] = []
    quarantined: list[int] = []
    for stored_rev, stored_payload, sha, row_state in stored:
        rev = int(stored_rev)
        payload = bytes(stored_payload)
        if row_state == "quarantined":
            quarantined.append(rev)
            chain = chain_next(chain, rev, bytes(sha))
        else:
            rows.append((rev, payload))
            chain = chain_next(chain, rev, hashlib.sha256(payload).digest())

    return ChainWalk(rows, quarantined, chain)


def load_control_row(app: str, doc_id: str) -> frappe._dict | None:
    """Load the fields a read needs from the document's control row, None when it is purged."""
    doc = Table(table(app, "doc"))
    control_rows = (
        frappe.qb.from_(doc)
        .select(
            doc.node,
            doc.lineage,
            doc.head_rev,
            doc.head_chain,
            doc.body_rev,
            doc.body_chain,
            doc.body_sha,
            doc.schema_steps,
            doc.q_epoch,
        )
        .where(doc.id == doc_id)
        .where(doc.mode != "purged")
        .run(as_dict=True)
    )
    if not control_rows:
        return None

    return control_rows[0]


def load_rows_after_base(app: str, doc_id: str, base_rev: int) -> Sequence:
    """Load every row after `base_rev` with its sha and state, in rev order."""
    update = Table(table(app, "update"))
    return (
        frappe.qb.from_(update)
        .select(update.rev, update.payload, update.sha256, update.state)
        .where(update.doc_id == doc_id)
        .where(update.rev > base_rev)
        .orderby(update.rev)
        .run()
    )


def require_unbroken(doc: frappe._dict, base: Base, stored: Sequence, walk: ChainWalk) -> None:
    """Raise `ChainBroken` unless the rows continue the base, gap-free, to the head and its chain."""
    revs = [int(row[0]) for row in stored]
    is_gap_free = revs == list(range(base.rev + 1, int(doc.head_rev) + 1))
    is_chain_matched = walk.chain == bytes(doc.head_chain)
    if not (base.is_intact and is_gap_free and is_chain_matched):
        raise ChainBroken


def snapshot_scope(own_snapshot: bool) -> contextlib.AbstractContextManager[None]:
    """Answer the scope a read runs in: its own REPEATABLE READ snapshot, or the caller's transaction."""
    if own_snapshot:
        return repeatable_read()

    return contextlib.nullcontext()


def read_once(app: str, doc_id: str, integrated: bool, own_snapshot: bool) -> Snapshot | None:
    """Read the log once; raise `ChainBroken` when the rows don't continue the base to the head."""
    with snapshot_scope(own_snapshot):
        doc = load_control_row(app, doc_id)
        if doc is None:
            return None

        app_row = body_row(app, doc.node)
        if app_row is None:
            return None

        base = pick_base(app, doc_id, doc, app_row.body, integrated)
        stored = load_rows_after_base(app, doc_id, base.rev)

    walk = walk_chain(stored, base.chain)
    require_unbroken(doc, base, stored, walk)
    steps = json.loads(doc.schema_steps)
    return Snapshot(
        lineage=doc.lineage,
        head_rev=int(doc.head_rev),
        head_chain=walk.chain,
        schema=steps[-1][1],
        base=base.rev,
        checkpoint=base.checkpoint,
        rows=walk.rows,
        quarantined=walk.quarantined,
        q_epoch=int(doc.q_epoch),
    )


def read(app: str, doc_id: str, *, integrated: bool = False, own_snapshot: bool = True) -> Snapshot | None:
    """Read the base and every row after it to the head; None when the log is purged or lacks an app row."""
    try:
        return read_once(app, doc_id, integrated, own_snapshot)
    except ChainBroken:
        return read_once(app, doc_id, integrated, own_snapshot)
