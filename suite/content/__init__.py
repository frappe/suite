"""Product-neutral content layer, above Drive.

Each app's collaborative documents are append-only logs of Yjs updates in
tables named for the app. This package holds that plumbing; an app plugs in
with a `EditorSpec` through the `suite_content_editors` hook and wraps its
Drive declaration with `with_content`. `suite.content.http` serves the routes
and checks access through Drive. The scheduler and the queue run
`suite.content.jobs`.
"""

from suite.content.copies import readable_copy
from suite.content.editors import Conversion, EditorSpec, HtmlCopy, MediaReferences
from suite.content.ingest import EditorSchema
from suite.content.live import rooms
from suite.content.log import (
    ChainBroken,
    Refusal,
    enabled,
    find,
    require_enabled,
)
from suite.content.logged import (
    NotReady,
    copy,
    ensure_tables,
    html,
    media_ids,
    purge,
    record_prefix,
    remap,
    start,
    threads_changed,
    version,
    with_content,
)
from suite.content.pushes import push, put_piece
from suite.content.restores import header_fields as restore_fields
from suite.content.sessions import claim_session, issue_session
from suite.content.snapshot import Snapshot, read, rows_after, with_tombstones
from suite.content.steps import (
    begin_restore,
    cancel_restore,
    open_document,
    pull_rows,
    push_rows,
    report_suspect,
    stage_piece,
    start_session,
    submit_render,
)
from suite.content.wire import (
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
    "Conversion",
    "EditorSchema",
    "EditorSpec",
    "HtmlCopy",
    "MediaReferences",
    "NotReady",
    "Refusal",
    "begin_restore",
    "cancel_restore",
    "claim_session",
    "copy",
    "enabled",
    "encode_frame",
    "ensure_tables",
    "find",
    "html",
    "issue_session",
    "limits",
    "media_ids",
    "open_document",
    "open_header",
    "parse_piece",
    "parse_push",
    "pull_rows",
    "purge",
    "push",
    "push_rows",
    "put_piece",
    "read",
    "readable_copy",
    "record_prefix",
    "remap",
    "report_suspect",
    "require_enabled",
    "restore_fields",
    "rooms",
    "rows_after",
    "stage_piece",
    "start",
    "start_session",
    "submit_render",
    "threads_changed",
    "version",
    "with_content",
    "with_tombstones",
]
