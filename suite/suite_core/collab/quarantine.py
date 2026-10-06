"""Take rows out of a document's log without breaking its rev order or its hash chain.

A quarantined row keeps its rev, sha and chain and loses its payload, which its
owner keeps as a recovery row. Every row that can't apply without it goes too:
its writer's later rows, and other writers' rows built on what it wrote. Its
writer's session is closed, and `q_epoch` rises so a tab that may have applied
it rebuilds.
"""

import gzip
import hashlib
from dataclasses import dataclass

import frappe
import pycrdt
from frappe.utils import now_datetime

from suite.suite_core.collab import compaction, updates
from suite.suite_core.collab.log import start_clocks
from suite.suite_core.collab.tables import table


@dataclass
class TailRow:
    rev: int
    client: int
    # None when the payload can't be read
    update: updates.Update | None


def quarantine(adapter: str, doc_id: str, revs: set[int], reason: str) -> list[int]:
    """Quarantine `revs` and every row that depends on them; answers every rev quarantined.

    Only rows after the checkpoint can be taken out: content already in it is not a row any more.
    """
    # The lock must be the first statement of a fresh transaction
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    locked = frappe.db.sql(
        f"""SELECT `node`, `lineage`, `checkpoint_rev`, `start_clocks`, `mode` FROM `{table(adapter, "doc")}`
        WHERE `id` = %s FOR UPDATE""",
        doc_id,
        as_dict=True,
    )
    try:
        if not locked or locked[0].mode == "purged":
            frappe.db.rollback()
            return []
        doc = locked[0]
        if min(revs) <= int(doc.checkpoint_rev):
            raise ValueError("a row in the checkpoint can't be quarantined")
        rows = frappe.db.sql(
            f"""SELECT `u`.`rev`, `u`.`client_id`, `u`.`payload`, `s`.`principal`
            FROM `{table(adapter, "update")}` `u` LEFT JOIN `{table(adapter, "session")}` `s`
            ON `s`.`doc_id` = `u`.`doc_id` AND `s`.`sid` = `u`.`sid`
            WHERE `u`.`doc_id` = %s AND `u`.`rev` > %s AND `u`.`state` = 'ok' ORDER BY `u`.`rev`""",
            (doc_id, doc.checkpoint_rev),
            as_dict=True,
        )
        tail = [TailRow(int(row.rev), int(row.client_id), readable(bytes(row.payload))) for row in rows]
        picked, cut = dependents(tail, revs, floor(adapter, doc_id, doc))
        if not picked:
            frappe.db.rollback()
            return []
        now = now_datetime()
        for row in rows:
            if int(row.rev) not in picked:
                continue
            if not row.principal:
                raise RuntimeError(f"rev {row.rev} has no session, so its recovery copy would have no owner")
            payload = bytes(row.payload)
            try:
                frappe.db.sql(
                    f"""INSERT INTO `{table(adapter, "recovery")}`
                    (`id`, `doc_id`, `node`, `owner`, `reason`, `lineage`, `sha256`, `nbytes`, `payload`, `context_rev`, `created`)
                    VALUES (%s, %s, %s, %s, %s, %s, UNHEX(%s), %s, UNHEX(%s), %s, %s)""",
                    (
                        frappe.generate_hash(length=20),
                        doc_id,
                        doc.node,
                        row.principal,
                        reason,
                        doc.lineage,
                        hashlib.sha256(payload).hexdigest(),
                        len(payload),
                        payload.hex(),
                        int(row.rev),
                        now,
                    ),
                )
            except Exception as error:
                # The owner already has a copy of these exact bytes
                if not frappe.db.is_duplicate_entry(error):
                    raise
        frappe.db.sql(
            f"""UPDATE `{table(adapter, "update")}` SET `state` = 'quarantined', `payload` = ''
            WHERE `doc_id` = %s AND `rev` IN %s""",
            (doc_id, tuple(picked)),
        )
        for client, clock in cut.items():
            # Other writers' rows that need a clock at or past `clock` are refused from now on
            frappe.db.sql(
                f"""UPDATE `{table(adapter, "session")}` SET `closed` = 1, `next_clock` = %s
                WHERE `doc_id` = %s AND `client_id` = %s""",
                (clock, doc_id, client),
            )
        frappe.db.sql(
            f"""UPDATE `{table(adapter, "doc")}` SET `q_epoch` = `q_epoch` + 1,
            `tail_bytes` = (SELECT COALESCE(SUM(LENGTH(`payload`)), 0) FROM `{table(adapter, "update")}`
                WHERE `doc_id` = %(doc)s AND `rev` > %(base)s)
            WHERE `id` = %(doc)s""",
            {"doc": doc_id, "base": doc.checkpoint_rev},
        )
        frappe.log_error(
            title=f"Collab rows quarantined: {reason}",
            message=f"{adapter} document {doc_id}: revs {sorted(picked)} quarantined, {len(cut)} sessions closed",
            reference_doctype="Suite Collab Settings",
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
    except BaseException:
        frappe.db.rollback()
        raise
    return sorted(picked)


def readable(payload: bytes) -> updates.Update | None:
    try:
        return updates.parse(payload)
    except ValueError:
        return None


def floor(adapter: str, doc_id: str, doc: dict) -> dict[int, int]:
    """Each writer's next clock in the checkpoint and the start, which no quarantine can take back."""
    clocks = start_clocks(doc)
    if int(doc.checkpoint_rev):
        gz = frappe.db.sql(
            f"SELECT `gz` FROM `{table(adapter, 'checkpoint')}` WHERE `doc_id` = %s AND `through_rev` = %s",
            (doc_id, doc.checkpoint_rev),
        )[0][0]
        for client, clock in compaction.state_vector(pycrdt.get_state(gzip.decompress(bytes(gz)))).items():
            clocks[client] = max(clocks.get(client, 0), clock)
    return clocks


def dependents(tail: list[TailRow], revs: set[int], floor: dict[int, int]) -> tuple[set[int], dict[int, int]]:
    """The revs of `tail` to quarantine with `revs`, and for each writer losing a row, the clock its kept
    content ends at.

    A writer's clocks are contiguous, so its rows after a quarantined one go too. A row of another
    writer whose struct sits next to or inside content past that clock, or that deletes content past
    it, goes, with its own later rows, until nothing changes.
    """
    picked = {row.rev for row in tail if row.rev in revs}
    while True:
        first = {}
        for row in tail:
            if row.rev in picked:
                first.setdefault(row.client, row.rev)
        picked |= {row.rev for row in tail if row.client in first and row.rev > first[row.client]}
        cut = {client: floor.get(client, 0) for client in first}
        for row in tail:
            if row.client in cut and row.rev not in picked and row.update and row.update.structs:
                last = row.update.structs[-1]
                cut[row.client] = max(cut[row.client], last.clock + last.length)
        grown = {row.rev for row in tail if row.rev not in picked and row.update and reaches(row.update, cut)}
        if not grown:
            return picked, cut
        picked |= grown


def reaches(update: updates.Update, cut: dict[int, int]) -> bool:
    """Whether `update` needs or deletes a writer's content at or past its clock in `cut`."""
    return any(
        client in cut and clock >= cut[client] for struct in update.structs for client, clock in struct.refs()
    ) or any(
        client in cut and clock + length > cut[client]
        for client, ranges in update.deletes.items()
        for clock, length in ranges
    )
