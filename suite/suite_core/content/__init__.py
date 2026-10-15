"""Product-neutral content layer.

Each app's collaborative documents are append-only logs of Yjs updates in
tables named for the app. This package holds that plumbing; an app plugs in
with a `ContentAdapterSpec` through the `suite_content_adapters` hook, and
`suite.composition.content` serves the routes and checks access through Drive,
because `suite_core` never imports Drive or a product.
"""

from suite.suite_core.content.backfill import backfill_clocks
from suite.suite_core.content.checkpoints import replace_start
from suite.suite_core.content.copies import readable_copy
from suite.suite_core.content.copies import submit as submit_render
from suite.suite_core.content.copies import wanted as copy_wanted
from suite.suite_core.content.ingest import EditorSchema
from suite.suite_core.content.live import rooms
from suite.suite_core.content.log import (
    ChainBroken,
    Refusal,
    create,
    delete_purged,
    enabled,
    find,
    mark_purged,
    mode,
    require_enabled,
    set_mode,
)
from suite.suite_core.content.pushes import push, put_piece
from suite.suite_core.content.restores import begin as begin_restore
from suite.suite_core.content.restores import cancel as cancel_restore
from suite.suite_core.content.restores import header_fields as restore_fields
from suite.suite_core.content.restores import milestone_taken
from suite.suite_core.content.sessions import claim_session, issue_session
from suite.suite_core.content.snapshot import Snapshot, read, rows_after, with_tombstones
from suite.suite_core.content.tables import ensure_tables
from suite.suite_core.content.wire import (
    PROTOCOL_VERSION,
    encode_frame,
    limits,
    open_header,
    parse_piece,
    parse_push,
)

__all__ = [
    "PROTOCOL_VERSION",
    "ChainBroken",
    "EditorSchema",
    "Refusal",
    "backfill_clocks",
    "begin_restore",
    "cancel_restore",
    "claim_session",
    "copy_wanted",
    "create",
    "delete_purged",
    "enabled",
    "encode_frame",
    "ensure_tables",
    "find",
    "issue_session",
    "limits",
    "mark_purged",
    "milestone_taken",
    "mode",
    "open_header",
    "parse_piece",
    "parse_push",
    "push",
    "put_piece",
    "read",
    "readable_copy",
    "replace_start",
    "require_enabled",
    "restore_fields",
    "rooms",
    "rows_after",
    "set_mode",
    "submit_render",
    "with_tombstones",
]
