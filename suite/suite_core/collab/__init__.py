"""Product-neutral collaboration library.

A product (Writer first) keeps each collaborative document as an append-only
log of Yjs updates in its own tables. This package holds the mechanism and no
state: the product supplies its table prefix and checks access through Drive
itself, because `suite_core` never imports Drive or a product.
"""

from suite.suite_core.collab.log import (
    PROTO,
    Refusal,
    create,
    enabled,
    find,
    frame,
    issue_session,
    open_header,
    parse_push,
    push,
    require_enabled,
    rows_after,
)
from suite.suite_core.collab.tables import ensure_tables

__all__ = [
    "PROTO",
    "Refusal",
    "create",
    "enabled",
    "ensure_tables",
    "find",
    "frame",
    "issue_session",
    "open_header",
    "parse_push",
    "push",
    "require_enabled",
    "rows_after",
]
