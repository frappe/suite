"""PUT: create a file node, or replace one in place.

Unlike Drive's browser upload this never auto-renames. An existing target is
overwritten at the same node, which is what the Office and Finder save flows
(LOCK, PUT, UNLOCK) require.

The body spools once, straight into `frappe.storage.blob.put_blob`, which is
§12.3's whole storage machinery: it writes through the active driver, dedupes
on the content checksum, and arms its own rollback so a failed transaction
leaves no bytes behind. There is no staging file, no generation key, no
compensation, and no drift repair to run afterwards; the node write and the
blob reference commit or roll back together.

Quota is preflighted from `Content-Length`, and the same number bounds the
spool when the header is absent (§7.3), so a client can never spool far past
what the root could ever hold. The admission `UPDATE` itself runs inside
`create_file` / `update`, at commit.

`X-OC-Mtime` is honoured so rclone's nextcloud vendor round-trips modification
times (§8.11).
"""

from datetime import UTC, datetime

import frappe
from werkzeug.wrappers import Response

from suite.drive._core import nodes as node_core
from suite.drive._core import quota as quota_core
from suite.drive._core.access import require
from suite.drive._core.roles import EDIT, UPLOAD
from suite.drive.webdav import pathmap
from suite.drive.webdav.conditional import evaluate_preconditions
from suite.drive.webdav.context import DavContext
from suite.drive.webdav.errors import (
    BadRequest,
    Conflict,
    InsufficientStorage,
    MethodNotAllowed,
    NotFoundError,
)
from suite.drive.webdav.properties import to_site_naive

# 9999-12-31 UTC - the largest epoch datetime.fromtimestamp can represent
MAX_MTIME = 253402300799


def handle(ctx: DavContext) -> Response:
    resolved = pathmap.resolve(ctx.segments, ctx.user)

    if resolved.is_mount:
        raise MethodNotAllowed("Cannot PUT to a collection.")
    if resolved.missing_intermediate:
        raise Conflict("Intermediate collections do not exist.")
    if ctx.request.headers.get("Content-Range"):
        raise BadRequest("Partial PUT is not supported.")

    row = resolved.node

    # The role check runs before the body is read, for two reasons. An
    # unauthorized or over-quota client must not be able to make the server
    # spool a large body before it is refused. And `require` raises
    # DriveNotFound below READ, so an unreadable target answers 404 rather
    # than confirming itself through the 405, 412 or 423 below (§12.1).
    # `create_file` and `update` run the same check again under their own row
    # lock; this one only decides whether to read the request at all.
    if row is None:
        if ctx.had_trailing_slash:
            raise Conflict("Cannot PUT to a collection URL.")
        parent = resolved.parent
        require(parent, UPLOAD, ctx.principals)
        pathmap.validate_dav_name(ctx.segments[-1], parent)
        accounting_root = node_core.root_id(parent)
    else:
        if resolved.is_collection:
            raise MethodNotAllowed("Cannot PUT to a collection.")
        require(row, EDIT, ctx.principals)
        accounting_root = row.root

    evaluate_preconditions(ctx.request, row)

    from suite.drive.webdav import locks

    if row is not None:
        locks.enforce(ctx, entity=row.name)
    else:
        locks.enforce(ctx, membership_parent=resolved.parent.name)

    ceiling = _free_bytes(accounting_root)
    length = ctx.request.content_length
    if ceiling is not None and length is not None and length > ceiling:
        # §7.3's preflight: a declared overshoot is refused before a byte lands
        raise InsufficientStorage("Upload exceeds available storage.")

    title = row.title if row is not None else ctx.segments[-1]
    blob = _spool(ctx, title, ceiling)
    content_modified = _client_mtime(ctx)

    if row is None:
        node_core.create_file(
            ctx.principals,
            resolved.parent.name,
            title,
            blob=blob.name,
            size=blob.file_size,
            mime=blob.mime_type,
            content_modified=content_modified,
        )
        status = 201
    else:
        node_core.update(
            ctx.principals,
            row.name,
            blob=blob.name,
            size=blob.file_size,
            mime=blob.mime_type,
            content_modified=content_modified,
        )
        status = 204

    pathmap.reset_memo()
    return _response(ctx, status, blob.checksum)


def _free_bytes(root: str) -> int | None:
    """The bytes this root can still take, or None when it is unlimited.

    One number does both jobs §7.3 gives it: the `Content-Length` preflight and
    the spool bound when no length was declared. `effective_quota` 0 is
    unlimited (RFC 4331 §4 has the same rule for the property), and a root
    already over its quota gets 0 rather than a negative ceiling.
    """
    usage = quota_core.get_storage_usage(root)
    limit = int(usage.effective_quota or 0)
    if not limit:
        return None
    return max(limit - int(usage.used_bytes or 0), 0)


class _BoundedBody:
    """The request body as a read()able stream, stopped at the spool ceiling.

    `put_blob` copies through `stream.read(n)` into its own spooled tempfile,
    so the bound has to live here: by the time the blob exists the bytes are
    already stored. Refusing mid-copy raises out of `put_blob`, whose rollback
    hook removes whatever it had written.
    """

    def __init__(self, ctx: DavContext, ceiling: int | None):
        self._chunks = ctx.body.stream()
        self._buffer = b""
        self._written = 0
        self._ceiling = ceiling

    def read(self, size: int = -1) -> bytes:
        while size < 0 or len(self._buffer) < size:
            chunk = next(self._chunks, b"")
            if not chunk:
                break
            self._written += len(chunk)
            if self._ceiling is not None and self._written > self._ceiling:
                raise InsufficientStorage("Upload exceeds available storage.")
            self._buffer += chunk
        if size < 0:
            data, self._buffer = self._buffer, b""
            return data
        data, self._buffer = self._buffer[:size], self._buffer[size:]
        return data


def _spool(ctx: DavContext, title: str, ceiling: int | None):
    """Store the body once, privately, and answer with its `File Blob` row.

    The blob decides its own size and MIME: `put_blob` sniffs the content and
    takes no caller override, and `_core.nodes` re-reads the row and refuses a
    node whose declared pair disagrees with it. A client's `Content-Type` is
    therefore not consulted at all - the bytes are the only witness.
    """
    from frappe.storage.blob import put_blob

    return put_blob(_BoundedBody(ctx, ceiling), is_private=True, filename=title)


def _client_mtime(ctx: DavContext) -> datetime | None:
    """`X-OC-Mtime` as the naive site-local time the column stores (§8.11).

    The header is a UTC epoch in seconds. A zoneless `fromtimestamp` would read
    it in the OS zone and skew every round-trip (rclone re-syncs) whenever the
    two zones differ, and `_core`'s numeric form is epoch milliseconds, so
    neither the raw value nor a bare float can be handed on.
    """
    header = ctx.request.headers.get("X-OC-Mtime")
    if not header:
        return None
    stamp = header.strip()
    # isdigit() alone let a huge value through and overflowed fromtimestamp
    if not stamp.isdigit() or int(stamp) > MAX_MTIME:
        return None
    return to_site_naive(datetime.fromtimestamp(int(stamp), tz=UTC))


def _response(ctx: DavContext, status: int, checksum: str) -> Response:
    """The stored bytes' own strong validator, the one `getetag` publishes.

    The legacy shape truncated the checksum to 32 characters behind a
    `sha256-` prefix, so an `If-Match` built from a PUT response could never
    match what PROPFIND or GET publish for the same bytes (§12.4).
    """
    headers = {"ETag": f'"{checksum}"'}
    if ctx.request.headers.get("X-OC-Mtime"):
        headers["X-OC-Mtime"] = "accepted"
    return Response(status=status, headers=headers)
