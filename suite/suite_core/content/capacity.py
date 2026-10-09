"""How much a document may take: the most a row can add to the next compaction, and whether a push still fits (I19).

A row's bytes alone don't bound what it adds: every existing struct it splits
costs more state. So each row counts `nbytes + 32` for every distinct position
it can split, and a push is admitted while the state, the tail's bound and its
own bound stay under the cap.
"""

from datetime import datetime

import frappe

from suite.suite_core.content import ingest, updates
from suite.suite_core.content.scheduling import STATE_MAX

SPLIT_COST = 32
# Deleting content shrinks the next compaction, so a full document still takes deletes up to this far past the cap
DELETE_ROOM = 512 * 2**10
TAIL_ROWS_MAX = 20_000
COMPACTION_MS = 2000
FULL_RETRY_MS = 300_000
EDIT_MAX = 4 * 2**20


def edit_max() -> int:
    """The largest change one push may commit; escaping can double its bytes on the way to the database."""
    packet_rows = frappe.db.sql("SELECT @@max_allowed_packet")
    max_packet = int(packet_rows[0][0])
    return min(EDIT_MAX, (max_packet - 2**20) // 2)


class Full(Exception):
    """The document can't take the push: `compacting` until a compaction makes room, or `doc_full` for good."""

    def __init__(self, reason: str, retry_ms: int):
        super().__init__(reason)
        self.reason = reason
        self.retry_ms = retry_ms


def row_bound(update: updates.Update, nbytes: int) -> int:
    """The most a row of `nbytes` holding `update` can add to the compacted state."""
    own_ends = set()
    for struct in update.structs:
        if struct.kind != ingest.SKIP_KIND:
            own_ends |= {(struct.client, struct.clock), (struct.client, struct.clock + struct.length)}

    splits = update.split_points() - own_ends
    return nbytes + SPLIT_COST * len(splits)


def admit(control_row, update: updates.Update, row_bound: int, now: datetime) -> None:
    """Raise `Full` unless the locked `control_row` has room for a row of `row_bound`.

    A push that only deletes gets `DELETE_ROOM` past the cap. With no tail left
    to compact, nothing can make room, so a push that adds and doesn't fit is full
    for good; one that only deletes is taken, as it can name only structs the state holds.
    """
    state_bytes = int(control_row.state_bytes)
    tail_bound = int(control_row.tail_bound)
    tail_rows = int(control_row.tail_rows)
    adds_content = bool(update.structs)
    if adds_content and state_bytes >= STATE_MAX:
        raise Full("doc_full", FULL_RETRY_MS)

    cap = STATE_MAX if adds_content else STATE_MAX + DELETE_ROOM
    under_cap = state_bytes + tail_bound + row_bound <= cap
    tail_has_room = tail_rows < TAIL_ROWS_MAX
    if under_cap and tail_has_room:
        return

    if not tail_rows:
        if not adds_content:
            return

        raise Full("doc_full", FULL_RETRY_MS)

    wait_ms = 0
    if control_row.next_compaction_at:
        wait_ms = max(0, (control_row.next_compaction_at - now).total_seconds() * 1000)
    compaction_ms = int(control_row.last_compaction_ms or COMPACTION_MS)
    raise Full("compacting", int(wait_ms) + compaction_ms)
