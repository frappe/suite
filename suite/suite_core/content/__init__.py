"""Product-neutral content layer.

Each app's collaborative documents are append-only logs of Yjs updates in
tables named for the app. This package holds that plumbing; an app plugs in
with a `ContentAdapterSpec` through the `suite_content_adapters` hook, and
`suite.composition.content` serves the routes and checks access through Drive,
because `suite_core` never imports Drive or a product.
"""

from suite.suite_core.content.backfill import backfill_clocks
from suite.suite_core.content.checkpoints import replace_start
from suite.suite_core.content.ingest import EditorSchema
from suite.suite_core.content.live import rooms
from suite.suite_core.content.log import (
    PROTOCOL_VERSION,
    ChainBroken,
    Refusal,
    claim_session,
    create,
    delete_purged,
    enabled,
    encode_frame,
    find,
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
    "PROTOCOL_VERSION",
    "ChainBroken",
    "EditorSchema",
    "Refusal",
    "backfill_clocks",
    "claim_session",
    "create",
    "delete_purged",
    "enabled",
    "encode_frame",
    "ensure_tables",
    "find",
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
