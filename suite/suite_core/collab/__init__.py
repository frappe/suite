"""Product-neutral collaboration library.

A product (Writer first) keeps each collaborative document as an append-only
log of Yjs updates in its own tables. This package holds the mechanism and no
state: the product supplies its table prefix and checks access through Drive
itself, because `suite_core` never imports Drive or a product.
"""

from suite.suite_core.collab.checkpoints import replace_start
from suite.suite_core.collab.log import (
    PROTO,
    ChainBroken,
    Refusal,
    backfill_clocks,
    claim_session,
    create,
    delete_purged,
    enabled,
    find,
    frame,
    issue_session,
    mark_purged,
    open_header,
    parse_push,
    push,
    read,
    require_enabled,
    rows_after,
)
from suite.suite_core.collab.tables import ensure_tables

__all__ = [
    "PROTO",
    "ChainBroken",
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
    "mark_purged",
    "open_header",
    "parse_push",
    "push",
    "read",
    "replace_start",
    "require_enabled",
    "rows_after",
]
