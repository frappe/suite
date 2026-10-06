"""The checks every pushed update passes before it is stored, so a bad row never reaches the log."""

from collections.abc import Iterable
from dataclasses import dataclass

import frappe

from suite.suite_core.collab import updates
from suite.suite_core.collab.tables import table

MAX_BYTES = 4 * 2**20
# ContentJSON, ContentBinary and ContentDoc: no collab adapter writes them
REFUSED_KINDS = {2, 3, 9}
SKIP = 10


class Unclosed(Exception):
    """A readable row the log can't take: `clock_gap` or `missing_dep`, with the clock it needed."""

    def __init__(self, reason: str, **extra):
        super().__init__(reason)
        self.reason = reason
        self.extra = extra


@dataclass
class Row:
    update: updates.Update
    # The writer's clocks the row adds, `[clock_from, clock_to)`; equal for a delete-only row
    clock_from: int
    clock_to: int


def check(payload: bytes, cid: int) -> Row:
    """The row `cid` pushed, or `ValueError` when it is malformed: too large, unreadable, written by
    another client, holding a gap, or holding content no collab adapter writes."""
    if len(payload) > MAX_BYTES:
        raise ValueError("update too large")
    update = updates.parse(payload)
    for struct in update.structs:
        if struct.client != cid:
            raise ValueError("written by another client")
        if struct.kind == SKIP:
            raise ValueError("a gap in the writer's clocks")
        if struct.kind in REFUSED_KINDS:
            raise ValueError(f"refused content {struct.kind}")
    if not update.structs:
        return Row(update, 0, 0)
    first, last = update.structs[0], update.structs[-1]
    return Row(update, first.clock, last.clock + last.length)


def next_clocks(payloads: Iterable[bytes]) -> dict[int, int]:
    """Each writer's next clock once `payloads` are stored: every clock below it is in them."""
    clocks = {}
    for payload in payloads:
        for struct in updates.parse(payload).structs:
            clocks[struct.client] = max(clocks.get(struct.client, 0), struct.clock + struct.length)
    return clocks


def close(adapter: str, doc_id: str, row: Row, cid: int, start: dict[int, int]) -> None:
    """Refuse a row that does not continue its writer's clocks, or that needs a struct neither
    committed nor in the row. Run under the document's lock, which every clock change takes."""
    committed = committed_clocks(adapter, doc_id, referenced_clients(row, cid), start)
    known = dict(committed)
    if row.update.structs:
        if row.clock_from != committed[cid]:
            raise Unclosed("clock_gap", clock=committed[cid])
        known[cid] = row.clock_to
    for struct in row.update.structs:
        for ref in struct.refs():
            if ref[1] >= known[ref[0]]:
                raise Unclosed("missing_dep", client=ref[0], clock=ref[1])
    for client, ranges in row.update.deletes.items():
        for clock, length in ranges:
            if clock + length > known[client]:
                raise Unclosed("missing_dep", client=client, clock=max(clock, known[client]))


def committed_clocks(adapter: str, doc_id: str, clients: set[int], start: dict[int, int]) -> dict[int, int]:
    """The next clock of each of `clients` in the log: from its session, or from the start a copy began with."""
    clocks = {client: start.get(client, 0) for client in clients}
    for client, clock in frappe.db.sql(
        f"""SELECT `client_id`, `next_clock` FROM `{table(adapter, "session")}`
        WHERE `doc_id` = %s AND `client_id` IN %s""",
        (doc_id, tuple(clients)),
    ):
        clocks[int(client)] = max(clocks[int(client)], int(clock or 0))
    return clocks


def referenced_clients(row: Row, cid: int) -> set[int]:
    clients = {cid, *row.update.deletes}
    for struct in row.update.structs:
        clients.update(client for client, _clock in struct.refs())
    return clients
