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


@dataclass(frozen=True)
class EditorSchema:
    """What a collab adapter's editor writes: its current schema, for each node, mark, attribute or
    map key a row may name the schema that introduced it, the content kinds and shared types it makes,
    and the names it gives elements and format items."""

    version: int
    features: dict[str, int]
    content_refs: frozenset[int]
    shared_types: frozenset[int]
    nodes: frozenset[str]
    marks: frozenset[str]

    def allows(self, names: Iterable[str], stamp: int) -> bool:
        """Whether a row stamped `stamp` may hold every one of `names`: each declared at or below it."""
        return all(self.features.get(name, stamp + 1) <= stamp for name in names)

    def could_write(self, update: updates.Update) -> bool:
        """Whether the editor could have written `update`: every struct is content the editor makes,
        with each name in its role."""
        return all(
            struct.kind in self.content_refs
            and (struct.type is None or struct.type in self.shared_types)
            and (struct.node is None or struct.node in self.nodes)
            and (struct.format_key is None or struct.format_key in self.marks)
            for struct in update.structs
        )


@dataclass
class Row:
    update: updates.Update
    # The writer's clocks the row adds, `[clock_from, clock_to)`; equal for a delete-only row
    clock_from: int
    clock_to: int


def check(payload: bytes, cid: int) -> Row:
    """The row `cid` pushed, or `ValueError` when it is malformed: too large, unreadable, or refused by `admit`."""
    if len(payload) > MAX_BYTES:
        raise ValueError("update too large")
    return admit(updates.parse(payload), cid)


def admit(update: updates.Update, cid: int) -> Row:
    """The row `update` makes for `cid`, or `ValueError` when it is empty, written by another client,
    holds a gap, or holds content no collab adapter writes."""
    if not update.structs and not any(update.deletes.values()):
        raise ValueError("an empty row")
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
    follows(row, cid, committed_clocks(adapter, doc_id, referenced_clients(row, cid), start))


def follows(row: Row, cid: int, committed: dict[int, int]) -> None:
    """Refuse `row` unless it continues `cid`'s clocks and needs only clocks below `committed` or earlier in the row."""
    known = dict(committed)
    if row.update.structs and row.clock_from != known.get(cid, 0):
        raise Unclosed("clock_gap", clock=known.get(cid, 0))
    for struct in row.update.structs:
        # A struct can only follow what is committed or earlier in the row, never itself or a later struct
        for ref in struct.refs():
            if ref[1] >= known.get(ref[0], 0):
                raise Unclosed("missing_dep", client=ref[0], clock=ref[1])
        known[cid] = struct.clock + struct.length
    for client, ranges in row.update.deletes.items():
        for clock, length in ranges:
            if clock + length > known.get(client, 0):
                raise Unclosed("missing_dep", client=client, clock=max(clock, known.get(client, 0)))


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
