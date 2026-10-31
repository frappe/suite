"""Take rows out of a document's log without breaking its rev order or its hash chain.

A quarantined row keeps its rev, sha and chain and loses its payload, which its
owner keeps as a recovery row. Every row that can't apply without it goes too:
its writer's later rows, and other writers' rows built on what it wrote. Its
writer's session is closed, and `q_epoch` rises so a tab that may have applied
it rebuilds.
"""

import hashlib
from dataclasses import dataclass

import frappe
import pycrdt
from frappe.query_builder import Table
from frappe.utils import now_datetime

from suite import drive
from suite.content import compaction, ingest, live, updates
from suite.content.app_row import body_row
from suite.content.db import Unhex, insert_into
from suite.content.snapshot import fallback_rev, start_clocks, tail_sums
from suite.content.tables import table


@dataclass
class TailRow:
    rev: int
    client: int
    # None when the payload can't be read
    update: updates.Update | None


def locked_control_row(app: str, doc_id: str) -> frappe._dict | None:
    """Lock and load the control row, or None when the log is gone."""
    # The lock must be the first statement of a fresh transaction
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    doc = Table(table(app, "doc"))
    locked = (
        frappe.qb.from_(doc)
        .select(doc.node, doc.lineage, doc.body_rev, doc.start_clocks, doc.mode, doc.q_epoch)
        .where(doc.id == doc_id)
        .for_update()
        .run(as_dict=True)
    )
    if not locked or locked[0].mode == "purged":
        return None

    return locked[0]


def tail_rows(app: str, doc_id: str, body_rev: int) -> list[frappe._dict]:
    """Load the stored rows after `body_rev`, each with its session's user."""
    update = Table(table(app, "update"))
    session = Table(table(app, "session"))
    return (
        frappe.qb.from_(update)
        .left_join(session)
        .on((session.doc_id == update.doc_id) & (session.sid == update.sid))
        .select(update.rev, update.client_id, update.payload, session.user)
        .where(update.doc_id == doc_id)
        .where(update.rev > body_rev)
        .where(update.state == "ok")
        .orderby(update.rev)
        .run(as_dict=True)
    )


def insert_recovery_copy(app: str, recovery_row: dict) -> None:
    """Insert one recovery copy, unless its owner already keeps these exact bytes."""
    try:
        insert_into(table(app, "recovery"), recovery_row).run()
    except Exception as error:
        # The owner already has a copy of these exact bytes
        if not frappe.db.is_duplicate_entry(error):
            raise


def keep_recovery_copies(
    app: str,
    doc_id: str,
    control_row: frappe._dict,
    picked_rows: list[frappe._dict],
    document_owner: str | None,
    reason: str,
) -> None:
    """Keep each picked row's bytes for the writer who sent it, or for the owner when its session is gone."""
    now = now_datetime()
    for row in picked_rows:
        payload = bytes(row.payload)
        recovery_row = {
            "id": frappe.generate_hash(length=20),
            "doc_id": doc_id,
            "node": control_row.node,
            "owner": row.user or document_owner,
            "reason": reason,
            "lineage": control_row.lineage,
            "sha256": Unhex(hashlib.sha256(payload).hexdigest()),
            "nbytes": len(payload),
            "payload": Unhex(payload.hex()),
            "context_rev": int(row.rev),
            "created": now,
        }
        insert_recovery_copy(app, recovery_row)


def take_out_rows(app: str, doc_id: str, picked: set[int], cut_clocks: dict[int, int]) -> None:
    """Empty the picked rows, drop any fallback holding them and close the sessions past the cut."""
    update = Table(table(app, "update"))
    checkpoint = Table(table(app, "checkpoint"))
    (
        frappe.qb.update(update)
        .set(update.state, "quarantined")
        .set(update.payload, "")
        .set(update.bound, 0)
        .where(update.doc_id == doc_id)
        .where(update.rev.isin(list(picked)))
        .run()
    )
    (
        frappe.qb.from_(checkpoint)
        .delete()
        .where(checkpoint.doc_id == doc_id)
        .where(checkpoint.through_rev >= min(picked))
        .run()
    )
    close_sessions_past(app, doc_id, cut_clocks)


def close_sessions_past(app: str, doc_id: str, cut_clocks: dict[int, int]) -> None:
    """Close each client's sessions at its cut clock."""
    session = Table(table(app, "session"))
    for client, clock in cut_clocks.items():
        # Other writers' rows that need a clock at or past `clock` are refused from now on
        (
            frappe.qb.update(session)
            .set(session.closed, 1)
            .set(session.next_clock, clock)
            .where(session.doc_id == doc_id)
            .where(session.client_id == client)
            .run()
        )


def recount_tail(app: str, doc_id: str, body_rev: int) -> None:
    """Bump the quarantine epoch and recount the tail after the base."""
    base_rev = max(body_rev, fallback_rev(app, doc_id))
    tail = tail_sums(app, doc_id, base_rev)
    doc = Table(table(app, "doc"))
    (
        frappe.qb.update(doc)
        .set(doc.q_epoch, doc.q_epoch + 1)
        .set(doc.tail_bytes, tail.nbytes)
        .set(doc.tail_bound, tail.bound)
        .where(doc.id == doc_id)
        .run()
    )


def record_quarantine(
    app: str,
    doc_id: str,
    reason: str,
    *,
    picked: set[int],
    closed_count: int,
    sessionless_revs: list[int],
    document_owner: str | None,
) -> None:
    """Log the quarantine for admins, and the recovery copies kept for the document's owner."""
    picked_revs = sorted(picked)
    frappe.log_error(
        title=f"Collab rows quarantined: {reason}",
        message=f"{app} document {doc_id}: revs {picked_revs} quarantined, {closed_count} sessions closed",
        reference_doctype="Suite Collab Settings",
    )
    if sessionless_revs:
        frappe.log_error(
            title="Collab recovery copies kept for the document owner",
            message=f"{app} document {doc_id}: revs {sessionless_revs} had no session, so {document_owner} keeps their copies",
            reference_doctype="Suite Collab Settings",
        )


def sessionless_owner(node: str, sessionless_revs: list[int]) -> str | None:
    """Answer the owner of `node`, who answers for rows saved without a session; None when there are none."""
    if not sessionless_revs:
        return None

    return drive.node_owner(node)


def take_out_dependents(
    app: str, doc_id: str, control_row: frappe._dict, revs: set[int], reason: str
) -> set[int]:
    """Take `revs` and their dependents out of the locked log with recovery copies; return the revs taken."""
    body_rev = int(control_row.body_rev)
    if min(revs) <= body_rev:
        raise ValueError("a row in the body can't be quarantined")

    rows = tail_rows(app, doc_id, body_rev)
    tail = [TailRow(int(row.rev), int(row.client_id), parse_or_none(bytes(row.payload))) for row in rows]
    kept_clocks = floor_clocks(app, control_row)
    picked, cut_clocks = dependents(tail, revs, kept_clocks)
    if not picked:
        return picked

    picked_rows = [row for row in rows if int(row.rev) in picked]
    sessionless_revs = [int(row.rev) for row in picked_rows if not row.user]
    document_owner = sessionless_owner(control_row.node, sessionless_revs)
    keep_recovery_copies(app, doc_id, control_row, picked_rows, document_owner, reason)
    take_out_rows(app, doc_id, picked, cut_clocks)
    recount_tail(app, doc_id, body_rev)
    record_quarantine(
        app,
        doc_id,
        reason,
        picked=picked,
        closed_count=len(cut_clocks),
        sessionless_revs=sessionless_revs,
        document_owner=document_owner,
    )
    return picked


def quarantine(app: str, doc_id: str, revs: set[int], reason: str) -> list[int]:
    """Quarantine `revs`, all after the body, and every row that depends on them; return every rev taken."""
    control_row = locked_control_row(app, doc_id)
    try:
        if control_row is None:
            frappe.db.rollback()
            return []

        picked = take_out_dependents(app, doc_id, control_row, revs, reason)
        if not picked:
            frappe.db.rollback()
            return []

        frappe.db.commit()  # nosemgrep: frappe-manual-commit
    except BaseException:
        frappe.db.rollback()
        raise

    q_epoch = int(control_row.q_epoch) + 1
    live.publish_control(app, doc_id, control_row.lineage, kind="quarantine", q_epoch=q_epoch)
    return sorted(picked)


def first_client(update: updates.Update) -> int:
    """Answer the client of the first struct in `update`, 0 when it has none."""
    if update.structs:
        return update.structs[0].client

    return 0


def first_unfit(checkpoint: bytes | None, rows: list[bytes], roots: set[str]) -> tuple[int, str] | None:
    """Find the first of `rows` a compaction or the push gate refuses, and why; -1 for the checkpoint."""
    parts: list[bytes] = []
    if checkpoint:
        parts = [checkpoint]

    unfit_part = compaction.first_unfit_part(parts + rows)
    if unfit_part and unfit_part[0] < len(parts):
        return -1, unfit_part[1]

    known_clocks = ingest.next_clocks(parts)
    for index, payload in enumerate(rows):
        if unfit_part and unfit_part[0] == len(parts) + index:
            return index, unfit_part[1]

        update = updates.parse(payload)
        client_id = first_client(update)

        unknown_root = any(struct.root is not None and struct.root not in roots for struct in update.structs)
        if unknown_root:
            return index, "unknown_root"

        try:
            row = ingest.admit_update(update, client_id)
            ingest.check_follows(row, client_id, known_clocks)
        except ValueError:
            return index, "refused_row"
        except ingest.Unclosed as error:
            return index, error.reason

        if update.structs:
            known_clocks[client_id] = row.clock_to

    return None


def parse_or_none(payload: bytes) -> updates.Update | None:
    """Parse `payload`, or None when it can't be read."""
    try:
        return updates.parse(payload)
    except ValueError:
        return None


def floor_clocks(app: str, doc: frappe._dict) -> dict[int, int]:
    """Each writer's next clock in the body and the start, which no quarantine can take back."""
    clocks = start_clocks(doc)
    if not int(doc.body_rev):
        return clocks

    row = body_row(app, doc.node)
    if row is None:
        return clocks

    body_state = pycrdt.get_state(row.body)
    for client, clock in compaction.state_vector(body_state).items():
        clocks[client] = max(clocks.get(client, 0), clock)

    return clocks


def first_picked_revs(tail: list[TailRow], quarantined_revs: set[int]) -> dict[int, int]:
    """Map each writer losing a row to its first quarantined rev."""
    first_picked_rev: dict[int, int] = {}
    for row in tail:
        if row.rev in quarantined_revs:
            first_picked_rev.setdefault(row.client, row.rev)

    return first_picked_rev


def later_revs(tail: list[TailRow], first_picked_rev: dict[int, int]) -> set[int]:
    """Return the revs of each writer's rows after its first quarantined one, as its clocks are contiguous."""
    revs: set[int] = set()
    for row in tail:
        if row.client in first_picked_rev and row.rev > first_picked_rev[row.client]:
            revs.add(row.rev)

    return revs


def cut_clocks_for(
    tail: list[TailRow],
    quarantined_revs: set[int],
    first_picked_rev: dict[int, int],
    floor_clock_by_writer: dict[int, int],
) -> dict[int, int]:
    """Return the clock each writer losing a row keeps content to: its floor, or its last kept row's end."""
    cut = {client: floor_clock_by_writer.get(client, 0) for client in first_picked_rev}
    for row in tail:
        kept = row.rev not in quarantined_revs
        if row.client in cut and kept and row.update and row.update.structs:
            last_struct = row.update.structs[-1]
            cut[row.client] = max(cut[row.client], last_struct.clock + last_struct.length)

    return cut


def new_dependent_revs(tail: list[TailRow], quarantined_revs: set[int], cut: dict[int, int]) -> set[int]:
    """Return the revs of kept rows that need or delete content past `cut`."""
    revs: set[int] = set()
    for row in tail:
        if row.rev not in quarantined_revs and row.update and reaches_cut(row.update, cut):
            revs.add(row.rev)

    return revs


def dependents(
    tail: list[TailRow], revs: set[int], floor_clock_by_writer: dict[int, int]
) -> tuple[set[int], dict[int, int]]:
    """Find the revs of `tail` that go with `revs`, and the clock each losing writer is cut at."""
    quarantined_revs = {row.rev for row in tail if row.rev in revs}
    while True:
        first_picked_rev = first_picked_revs(tail, quarantined_revs)
        quarantined_revs |= later_revs(tail, first_picked_rev)
        cut = cut_clocks_for(tail, quarantined_revs, first_picked_rev, floor_clock_by_writer)
        new_dependents = new_dependent_revs(tail, quarantined_revs, cut)
        if not new_dependents:
            return quarantined_revs, cut

        quarantined_revs |= new_dependents


def reaches_cut(update: updates.Update, cut: dict[int, int]) -> bool:
    """Whether `update` needs or deletes a writer's content at or past its clock in `cut`."""
    for struct in update.structs:
        if any(client in cut and clock >= cut[client] for client, clock in struct.refs()):
            return True

    for client, ranges in update.deletes.items():
        if client in cut and any(clock + length > cut[client] for clock, length in ranges):
            return True

    return False
