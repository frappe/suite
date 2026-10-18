"""Reading a log: the base and every row after it from one snapshot, chain checked."""

import base64
import contextlib
import gzip
import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass

import frappe

from suite.suite_core.content.adapters import spec_of
from suite.suite_core.content.log import ChainBroken, chain_next, chain_seed
from suite.suite_core.content.tables import table


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
        return [payload for _rev, payload in self.rows]


def start_clocks(doc: frappe._dict) -> dict[int, int]:
    clocks = json.loads(doc.start_clocks or "{}")
    return {int(client): clock for client, clock in clocks.items()}


def rows_after(adapter: str, doc_id: str, since: int) -> list[tuple[int, bytes]]:
    """Committed rows after `since`, in rev order, a quarantined one empty. One statement, so one snapshot."""
    stored_rows = frappe.db.sql(
        f"SELECT `rev`, `payload` FROM `{table(adapter, 'update')}` WHERE `doc_id` = %s AND `rev` > %s ORDER BY `rev`",
        (doc_id, since),
    )
    return [(int(rev), bytes(payload)) for rev, payload in stored_rows]


def with_tombstones(log_read: Snapshot) -> list[tuple[int, bytes]]:
    """A read's rows with each quarantined rev as an empty row, which no real row is, in rev order."""
    tombstones = [(rev, b"") for rev in log_read.quarantined]
    return sorted([*log_read.rows, *tombstones])


def isolation_level() -> str | None:
    for variable in ("@@transaction_isolation", "@@tx_isolation"):
        try:
            return frappe.db.sql(f"SELECT {variable}")[0][0]
        except Exception:
            continue
    return None


@contextlib.contextmanager
def repeatable_read():
    """Run the reads in one REPEATABLE READ snapshot. The level applies from the next transaction."""
    previous_level = isolation_level()
    frappe.db.sql("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ")
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    try:
        yield
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
    finally:
        if previous_level and previous_level != "REPEATABLE-READ":
            frappe.db.sql(f"SET SESSION TRANSACTION ISOLATION LEVEL {previous_level.replace('-', ' ')}")


def body_row(adapter: str, node: str, *, lock: bool = False) -> frappe._dict | None:
    """The app's row for `node`, with its body decoded, or None when it has none."""
    spec = spec_of(adapter)
    found = frappe.db.sql(
        f"""SELECT `name`, `{spec.body_field}` AS `body`, `modified` FROM `tab{spec.content_type}`
        WHERE `{spec.node_field}` = %s ORDER BY `name` LIMIT 1{" FOR UPDATE" if lock else ""}""",
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


def fallback_rev(adapter: str, doc_id: str) -> int:
    """The rev the document's fallback runs through, 0 when it has none."""
    found = frappe.db.sql(
        f"SELECT COALESCE(MAX(`through_rev`), 0) FROM `{table(adapter, 'checkpoint')}` WHERE `doc_id` = %s",
        doc_id,
    )
    return int(found[0][0])


@dataclass(frozen=True)
class Base:
    """Where a read starts: the state through `rev` and the chain it ends on."""

    rev: int
    checkpoint: bytes | None
    chain: bytes
    is_intact: bool


def pick_base(adapter: str, doc_id: str, doc: frappe._dict, body: bytes, integrated: bool) -> Base:
    """The app row's body, or a fallback newer than it unless `integrated`."""
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
        fallback_rows = frappe.db.sql(
            f"""SELECT `through_rev`, `gz`, `chain`, `sha256` FROM `{table(adapter, "checkpoint")}`
            WHERE `doc_id` = %s AND `through_rev` > %s ORDER BY `through_rev` DESC LIMIT 1""",
            (doc_id, rev),
        )

    if fallback_rows:
        through, compressed_state, stored_chain, stored_sha = fallback_rows[0]
        state = gzip.decompress(bytes(compressed_state))
        # A fallback that fails its sha is passed over; every edit after the body is still there
        if hashlib.sha256(state).digest() == bytes(stored_sha):
            return Base(int(through), state, bytes(stored_chain), True)

    return Base(rev, checkpoint, chain, is_intact)


def walk_chain(stored: Sequence, chain: bytes) -> tuple[list[tuple[int, bytes]], list[int], bytes]:
    """The rows and the quarantined revs, and the chain extended over both."""
    rows, quarantined = [], []
    for rev, payload, sha, row_state in stored:
        rev, payload = int(rev), bytes(payload)
        if row_state == "quarantined":
            quarantined.append(rev)
            chain = chain_next(chain, rev, bytes(sha))
        else:
            rows.append((rev, payload))
            chain = chain_next(chain, rev, hashlib.sha256(payload).digest())

    return rows, quarantined, chain


def read_once(adapter: str, doc_id: str, integrated: bool, own_snapshot: bool) -> Snapshot | None:
    """Raises `ChainBroken` when the rows don't continue the base to the head."""
    with repeatable_read() if own_snapshot else contextlib.nullcontext():
        control_rows = frappe.db.sql(
            f"""SELECT `node`, `lineage`, `head_rev`, `head_chain`, `body_rev`, `body_chain`, `body_sha`,
            `schema_steps`, `q_epoch` FROM `{table(adapter, "doc")}` WHERE `id` = %s AND `mode` != 'purged'""",
            doc_id,
            as_dict=True,
        )
        app_row = body_row(adapter, control_rows[0].node) if control_rows else None
        if app_row is None:
            return None

        doc = control_rows[0]
        base = pick_base(adapter, doc_id, doc, app_row.body, integrated)
        stored = frappe.db.sql(
            f"""SELECT `rev`, `payload`, `sha256`, `state` FROM `{table(adapter, "update")}`
            WHERE `doc_id` = %s AND `rev` > %s ORDER BY `rev`""",
            (doc_id, base.rev),
        )

    rows, quarantined, chain = walk_chain(stored, base.chain)
    revs = [int(row[0]) for row in stored]
    is_gap_free = revs == list(range(base.rev + 1, int(doc.head_rev) + 1))
    is_chain_matched = chain == bytes(doc.head_chain)
    if not (base.is_intact and is_gap_free and is_chain_matched):
        raise ChainBroken

    steps = json.loads(doc.schema_steps)
    return Snapshot(
        lineage=doc.lineage,
        head_rev=int(doc.head_rev),
        head_chain=chain,
        schema=steps[-1][1],
        base=base.rev,
        checkpoint=base.checkpoint,
        rows=rows,
        quarantined=quarantined,
        q_epoch=int(doc.q_epoch),
    )


def read(
    adapter: str, doc_id: str, *, integrated: bool = False, own_snapshot: bool = True
) -> Snapshot | None:
    """The base and every row after it through the head, from one snapshot, chain checked.
    The base is the app row's checked body, or a fallback newer than it unless `integrated`.
    `rows` leaves out quarantined rows; `quarantined` lists their revs. None when the log is
    purged or the app has no row for it.

    Rows are gap-free and commit-ordered, so a break means the store changed under
    the read or was rewound; the read is tried once more before it gives up.
    A Drive callback may not commit, so it passes `own_snapshot=False` and reads in Drive's transaction.
    """
    try:
        return read_once(adapter, doc_id, integrated, own_snapshot)
    except ChainBroken:
        return read_once(adapter, doc_id, integrated, own_snapshot)
