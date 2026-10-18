"""Take rows out of a document's log without breaking its rev order or its hash chain.

A quarantined row keeps its rev, sha and chain and loses its payload, which its
owner keeps as a recovery row. Every row that can't apply without it goes too:
its writer's later rows, and other writers' rows built on what it wrote. Its
writer's session is closed, and `q_epoch` rises so a tab that may have applied
it rebuilds.
"""

import hashlib
from collections.abc import Callable
from dataclasses import dataclass

import frappe
import pycrdt
from frappe.utils import now_datetime

from suite.suite_core.content import compaction, ingest, live, updates
from suite.suite_core.content.snapshot import body_row, fallback_rev, start_clocks
from suite.suite_core.content.tables import table


@dataclass
class TailRow:
    rev: int
    client: int
    # None when the payload can't be read
    update: updates.Update | None


def locked_control_row(adapter: str, doc_id: str) -> frappe._dict | None:
    """The control row under its lock, or None when the log is gone."""
    # The lock must be the first statement of a fresh transaction
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    locked = frappe.db.sql(
        f"""SELECT `node`, `lineage`, `body_rev`, `start_clocks`, `mode`, `q_epoch` FROM `{table(adapter, "doc")}`
        WHERE `id` = %s FOR UPDATE""",
        doc_id,
        as_dict=True,
    )
    if not locked or locked[0].mode == "purged":
        return None

    return locked[0]


def tail_rows(adapter: str, doc_id: str, body_rev: int) -> list[frappe._dict]:
    return frappe.db.sql(
        f"""SELECT `u`.`rev`, `u`.`client_id`, `u`.`payload`, `s`.`principal`
        FROM `{table(adapter, "update")}` `u` LEFT JOIN `{table(adapter, "session")}` `s`
        ON `s`.`doc_id` = `u`.`doc_id` AND `s`.`sid` = `u`.`sid`
        WHERE `u`.`doc_id` = %s AND `u`.`rev` > %s AND `u`.`state` = 'ok' ORDER BY `u`.`rev`""",
        (doc_id, body_rev),
        as_dict=True,
    )


def keep_recovery_copies(
    adapter: str,
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
            row.principal or document_owner,
            reason,
            control_row.lineage,
            hashlib.sha256(payload).hexdigest(),
            len(payload),
            payload.hex(),
            int(row.rev),
            now,
        )
        try:
            frappe.db.sql(
                f"""INSERT INTO `{table(adapter, "recovery")}`
                (`id`, `doc_id`, `node`, `owner`, `reason`, `lineage`, `sha256`, `nbytes`, `payload`, `context_rev`, `created`)
                VALUES (%s, %s, %s, %s, %s, %s, UNHEX(%s), %s, UNHEX(%s), %s, %s)""",
                recovery_values,
            )
        except Exception as error:
            # The owner already has a copy of these exact bytes
            if not frappe.db.is_duplicate_entry(error):
                raise


def take_out_rows(adapter: str, doc_id: str, picked: set[int], cut_clocks: dict[int, int]) -> None:
    """Empty the picked rows, drop any fallback holding them and close the sessions past the cut."""
    frappe.db.sql(
        f"""UPDATE `{table(adapter, "update")}` SET `state` = 'quarantined', `payload` = '', `bound` = 0
        WHERE `doc_id` = %s AND `rev` IN %s""",
        (doc_id, tuple(picked)),
    )
    frappe.db.sql(
        f"DELETE FROM `{table(adapter, 'checkpoint')}` WHERE `doc_id` = %s AND `through_rev` >= %s",
        (doc_id, min(picked)),
    )
    for client, clock in cut_clocks.items():
        # Other writers' rows that need a clock at or past `clock` are refused from now on
        frappe.db.sql(
            f"""UPDATE `{table(adapter, "session")}` SET `closed` = 1, `next_clock` = %s
            WHERE `doc_id` = %s AND `client_id` = %s""",
            (clock, doc_id, client),
        )


def recount_tail(adapter: str, doc_id: str, body_rev: int) -> None:
    """Bump the quarantine epoch and recount the tail after the base."""
    base_rev = max(body_rev, fallback_rev(adapter, doc_id))
    tail_params = {
        "doc": doc_id,
        "base": base_rev,
    }
    frappe.db.sql(
        f"""UPDATE `{table(adapter, "doc")}` SET `q_epoch` = `q_epoch` + 1,
        `tail_bytes` = (SELECT COALESCE(SUM(LENGTH(`payload`)), 0) FROM `{table(adapter, "update")}`
            WHERE `doc_id` = %(doc)s AND `rev` > %(base)s),
        `tail_bound` = (SELECT COALESCE(SUM(COALESCE(`bound`, LENGTH(`payload`))), 0) FROM `{table(adapter, "update")}`
            WHERE `doc_id` = %(doc)s AND `rev` > %(base)s)
        WHERE `id` = %(doc)s""",
        tail_params,
    )


def quarantine(
    adapter: str, doc_id: str, revs: set[int], reason: str, owner_of: Callable[[str], str | None]
) -> list[int]:
    """Quarantine `revs` and every row that depends on them; answers every rev quarantined.

    Only rows after the body can be taken out: content already in it is not a row any more. A fallback
    holding a quarantined row goes with it.
    A row whose session is gone has its recovery copy kept for `owner_of(node)`, the document's owner.
    """
    control_row = locked_control_row(adapter, doc_id)
    try:
        if control_row is None:
            frappe.db.rollback()
            return []

        body_rev = int(control_row.body_rev)
        if min(revs) <= body_rev:
            raise ValueError("a row in the body can't be quarantined")

        rows = tail_rows(adapter, doc_id, body_rev)
        tail = [TailRow(int(row.rev), int(row.client_id), parse_or_none(bytes(row.payload))) for row in rows]
        kept_clocks = floor_clocks(adapter, control_row)
        picked, cut_clocks = dependents(tail, revs, kept_clocks)
        if not picked:
            frappe.db.rollback()
            return []

        picked_rows = [row for row in rows if int(row.rev) in picked]
        sessionless_revs = [int(row.rev) for row in picked_rows if not row.principal]
        document_owner = owner_of(control_row.node) if sessionless_revs else None
        if sessionless_revs and not document_owner:
            raise RuntimeError(f"revs {sessionless_revs} have no session and the document no owner")

        keep_recovery_copies(adapter, doc_id, control_row, picked_rows, document_owner, reason)
        take_out_rows(adapter, doc_id, picked, cut_clocks)
        recount_tail(adapter, doc_id, body_rev)
        frappe.log_error(
            title=f"Collab rows quarantined: {reason}",
            message=f"{adapter} document {doc_id}: revs {sorted(picked)} quarantined, {len(cut_clocks)} sessions closed",
            reference_doctype="Suite Collab Settings",
        )
        if sessionless_revs:
            frappe.log_error(
                title="Collab recovery copies kept for the document owner",
                message=f"{adapter} document {doc_id}: revs {sessionless_revs} had no session, so {document_owner} keeps their copies",
                reference_doctype="Suite Collab Settings",
            )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
    except BaseException:
        frappe.db.rollback()
        raise

    q_epoch = int(control_row.q_epoch) + 1
    live.publish_control(adapter, doc_id, control_row.lineage, kind="quarantine", q_epoch=q_epoch)
    return sorted(picked)


def first_unfit(checkpoint: bytes | None, rows: list[bytes], roots: set[str]) -> tuple[int, str] | None:
    """The index of the first of `rows` a compaction must not take, with the reason; -1 for the checkpoint.

    On top of what the compaction refuses, a row the push gate would refuse today: rows stored
    before a gate are never checked again on the write path.
    """
    parts = [checkpoint] if checkpoint else []
    unfit_part = compaction.first_unfit_part(parts + rows)
    if unfit_part and unfit_part[0] < len(parts):
        return -1, unfit_part[1]

    known_clocks = ingest.next_clocks(parts)
    for index, payload in enumerate(rows):
        if unfit_part and unfit_part[0] == len(parts) + index:
            return index, unfit_part[1]

        update = updates.parse(payload)
        client_id = update.structs[0].client if update.structs else 0
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
    try:
        return updates.parse(payload)
    except ValueError:
        return None


def floor_clocks(adapter: str, doc: frappe._dict) -> dict[int, int]:
    """Each writer's next clock in the body and the start, which no quarantine can take back."""
    clocks = start_clocks(doc)
    row = body_row(adapter, doc.node) if int(doc.body_rev) else None
    if row is not None:
        body_state = pycrdt.get_state(row.body)
        for client, clock in compaction.state_vector(body_state).items():
            clocks[client] = max(clocks.get(client, 0), clock)

    return clocks


def dependents(
    tail: list[TailRow], revs: set[int], floor_clock_by_writer: dict[int, int]
) -> tuple[set[int], dict[int, int]]:
    """The revs of `tail` to quarantine with `revs`, and for each writer losing a row, the clock its kept
    content ends at.

    A writer's clocks are contiguous, so its rows after a quarantined one go too. A row of another
    writer whose struct sits next to or inside content past that clock, or that deletes content past
    it, goes, with its own later rows, until nothing changes. So a writer that re-sends whole delete
    sets loses its own rows and their dependents too, each with its recovery copy.
    """
    quarantined_revs = {row.rev for row in tail if row.rev in revs}
    while True:
        first_picked_rev: dict[int, int] = {}
        for row in tail:
            if row.rev in quarantined_revs:
                first_picked_rev.setdefault(row.client, row.rev)
        quarantined_revs |= {
            row.rev
            for row in tail
            if row.client in first_picked_rev and row.rev > first_picked_rev[row.client]
        }
        cut = {client: floor_clock_by_writer.get(client, 0) for client in first_picked_rev}
        for row in tail:
            kept = row.rev not in quarantined_revs
            if row.client in cut and kept and row.update and row.update.structs:
                last_struct = row.update.structs[-1]
                cut[row.client] = max(cut[row.client], last_struct.clock + last_struct.length)
        new_dependents = {
            row.rev
            for row in tail
            if row.rev not in quarantined_revs and row.update and reaches_cut(row.update, cut)
        }
        if not new_dependents:
            return quarantined_revs, cut

        quarantined_revs |= new_dependents


def reaches_cut(update: updates.Update, cut: dict[int, int]) -> bool:
    """Whether `update` needs or deletes a writer's content at or past its clock in `cut`."""
    needs_cut_content = any(
        client in cut and clock >= cut[client] for struct in update.structs for client, clock in struct.refs()
    )
    deletes_cut_content = any(
        client in cut and clock + length > cut[client]
        for client, ranges in update.deletes.items()
        for clock, length in ranges
    )
    return needs_cut_content or deletes_cut_content
