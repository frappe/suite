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
from frappe.utils import now_datetime

from suite import drive
from suite.content import compaction, ingest, live, updates
from suite.content.app_row import body_row
from suite.content.snapshot import fallback_rev, start_clocks
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
    doc_table = table(app, "doc")
    locked = frappe.db.sql(
        f"""SELECT `node`, `lineage`, `body_rev`, `start_clocks`, `mode`, `q_epoch` FROM `{doc_table}`
        WHERE `id` = %s FOR UPDATE""",
        doc_id,
        as_dict=True,
    )
    if not locked or locked[0].mode == "purged":
        return None

    return locked[0]


def tail_rows(app: str, doc_id: str, body_rev: int) -> list[frappe._dict]:
    """Load the stored rows after `body_rev`, each with its session's user."""
    update_table = table(app, "update")
    session_table = table(app, "session")
    return frappe.db.sql(
        f"""SELECT `u`.`rev`, `u`.`client_id`, `u`.`payload`, `s`.`user`
        FROM `{update_table}` `u` LEFT JOIN `{session_table}` `s`
        ON `s`.`doc_id` = `u`.`doc_id` AND `s`.`sid` = `u`.`sid`
        WHERE `u`.`doc_id` = %s AND `u`.`rev` > %s AND `u`.`state` = 'ok' ORDER BY `u`.`rev`""",
        (doc_id, body_rev),
        as_dict=True,
    )


def insert_recovery_copy(app: str, recovery_values: tuple) -> None:
    """Insert one recovery copy, unless its owner already keeps these exact bytes."""
    recovery_table = table(app, "recovery")
    try:
        frappe.db.sql(
            f"""INSERT INTO `{recovery_table}`
            (`id`, `doc_id`, `node`, `owner`, `reason`, `lineage`, `sha256`, `nbytes`, `payload`, `context_rev`, `created`)
            VALUES (%s, %s, %s, %s, %s, %s, UNHEX(%s), %s, UNHEX(%s), %s, %s)""",
            recovery_values,
        )
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
        recovery_values = (
            frappe.generate_hash(length=20),
            doc_id,
            control_row.node,
            row.user or document_owner,
            reason,
            control_row.lineage,
            hashlib.sha256(payload).hexdigest(),
            len(payload),
            payload.hex(),
            int(row.rev),
            now,
        )
        insert_recovery_copy(app, recovery_values)


def take_out_rows(app: str, doc_id: str, picked: set[int], cut_clocks: dict[int, int]) -> None:
    """Empty the picked rows, drop any fallback holding them and close the sessions past the cut."""
    update_table = table(app, "update")
    checkpoint_table = table(app, "checkpoint")
    session_table = table(app, "session")
    frappe.db.sql(
        f"""UPDATE `{update_table}` SET `state` = 'quarantined', `payload` = '', `bound` = 0
        WHERE `doc_id` = %s AND `rev` IN %s""",
        (doc_id, tuple(picked)),
    )
    frappe.db.sql(
        f"DELETE FROM `{checkpoint_table}` WHERE `doc_id` = %s AND `through_rev` >= %s",
        (doc_id, min(picked)),
    )
    for client, clock in cut_clocks.items():
        # Other writers' rows that need a clock at or past `clock` are refused from now on
        frappe.db.sql(
            f"""UPDATE `{session_table}` SET `closed` = 1, `next_clock` = %s
            WHERE `doc_id` = %s AND `client_id` = %s""",
            (clock, doc_id, client),
        )


def recount_tail(app: str, doc_id: str, body_rev: int) -> None:
    """Bump the quarantine epoch and recount the tail after the base."""
    base_rev = max(body_rev, fallback_rev(app, doc_id))
    tail_params = {
        "doc": doc_id,
        "base": base_rev,
    }
    doc_table = table(app, "doc")
    update_table = table(app, "update")
    frappe.db.sql(
        f"""UPDATE `{doc_table}` SET `q_epoch` = `q_epoch` + 1,
        `tail_bytes` = (SELECT COALESCE(SUM(LENGTH(`payload`)), 0) FROM `{update_table}`
            WHERE `doc_id` = %(doc)s AND `rev` > %(base)s),
        `tail_bound` = (SELECT COALESCE(SUM(COALESCE(`bound`, LENGTH(`payload`))), 0) FROM `{update_table}`
            WHERE `doc_id` = %(doc)s AND `rev` > %(base)s)
        WHERE `id` = %(doc)s""",
        tail_params,
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
