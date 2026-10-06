"""The checks every pushed update passes before it is stored, so a bad row never reaches the log."""

from dataclasses import dataclass

from suite.suite_core.collab import updates

MAX_BYTES = 4 * 2**20
# ContentJSON, ContentBinary and ContentDoc: no collab adapter writes them
REFUSED_KINDS = {2, 3, 9}
SKIP = 10


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
