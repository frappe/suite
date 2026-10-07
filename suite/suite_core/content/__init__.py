"""Product-neutral collaboration library.

A product (Writer first) keeps each collaborative document as an append-only
log of Yjs updates in its own tables. This package holds the mechanism and no
state: the product supplies its table prefix and checks access through Drive
itself, because `suite_core` never imports Drive or a product.
"""

from suite.suite_core.content.backfill import backfill_clocks
from suite.suite_core.content.checkpoints import replace_start
from suite.suite_core.content.ingest import EditorSchema
from suite.suite_core.content.live import rooms
from suite.suite_core.content.log import (
    PROTO,
    ChainBroken,
    Refusal,
    claim_session,
    create,
    delete_purged,
    enabled,
    find,
    frame,
    issue_session,
    limits,
    mark_purged,
    open_header,
    parse_piece,
    parse_push,
    push,
    put_piece,
    read,
    require_enabled,
    rows_after,
    with_tombstones,
)
from suite.suite_core.content.tables import ensure_tables

__all__ = [
    "PROTO",
    "ChainBroken",
    "EditorSchema",
    "Refusal",
    "backfill_clocks",
    "claim_session",
    "create",
    "delete_purged",
    "enabled",
    "ensure_tables",
    "find",
    "frame",
    "issue_session",
    "limits",
    "mark_purged",
    "open_header",
    "parse_piece",
    "parse_push",
    "push",
    "put_piece",
    "read",
    "replace_start",
    "require_enabled",
    "rooms",
    "rows_after",
    "with_tombstones",
]
