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
what the root could ever hold. The site's `drive_webdav_max_upload_size` caps
the body on top of that, and answers 413 rather than 507 because it is a server
limit and not an exhausted quota. The admission `UPDATE` itself runs inside
`create_file` / `update`, at commit.

`X-OC-Mtime` is honoured so rclone's nextcloud vendor round-trips modification
times (§8.11).
"""

from datetime import UTC, datetime
from typing import NamedTuple

import frappe
from frappe.utils import cint
from werkzeug.wrappers import Response

from suite.drive._core import nodes as node_core
from suite.drive._core import quota as quota_core
from suite.drive._core.access import require
from suite.drive._core.roles import EDIT, READ
from suite.drive.webdav import pathmap
from suite.drive.webdav.conditional import evaluate_preconditions
from suite.drive.webdav.context import DavContext
from suite.drive.webdav.errors import (
    BadRequest,
    Conflict,
    InsufficientStorage,
    MethodNotAllowed,
    PayloadTooLarge,
)
from suite.drive.webdav.properties import to_site_naive
from suite.drive.webdav.settings import allow_header_without

# 9999-12-31 UTC - the largest epoch datetime.fromtimestamp can represent
MAX_MTIME = 253402300799

_COLLECTION_REFUSAL = "Cannot PUT to a collection."


def handle(ctx: DavContext) -> Response:
    resolved = pathmap.resolve(ctx.segments, ctx.user)

    if resolved.is_mount:
        raise MethodNotAllowed(_COLLECTION_REFUSAL, headers={"Allow": allow_header_without("PUT")})
    if resolved.missing_intermediate:
        raise Conflict(pathmap.MISSING_PARENT)
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
        # 409, not 404, when the parent is below READ: an unreadable parent and
        # an absent one answer alike (§12.1, RFC 4918 §9.7.1). It also runs
        # before `segments[-1]`, which is empty on `/dav` itself.
        pathmap.require_create_parent(parent, ctx.principals)
        pathmap.validate_dav_name(ctx.segments[-1], parent)
        accounting_root = node_core.root_id(parent)
    else:
        # READ before the 405. `pathmap` resolves without asking permission, so
        # a folder the caller cannot see would otherwise announce itself
        # through "cannot PUT to a collection" while a name that was never
        # there answers 201. Unreadable is 404 (§12.1), collection or not.
        require(row, READ, ctx.principals)
        if resolved.is_collection:
            raise MethodNotAllowed(_COLLECTION_REFUSAL, headers={"Allow": allow_header_without("PUT")})
        require(row, EDIT, ctx.principals)
        accounting_root = row.root

    evaluate_preconditions(ctx.request, row)

    from suite.drive.webdav import locks

    if row is not None:
        locks.enforce(ctx, entity=row.name)
    else:
        locks.enforce(ctx, membership_parent=resolved.parent.name)

    ceilings = _ceilings(accounting_root)
    length = ctx.request.content_length
    if length is not None:
        # §7.3's preflight: a declared overshoot is refused before a byte lands
        ceilings.check(length)

    # `_spool` stores the request body through `put_blob`, so the blob below
    # is one this request produced. A DAV client never names a blob id - there
    # is no place in the protocol for one - so neither write is the §11.2 door
    # `nodes.create` guards with `_client_named_blob`.
    title = row.title if row is not None else ctx.segments[-1]
    blob = _spool(ctx, title, ceilings)
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
    return _response(status, blob.checksum, content_modified)


class _Ceilings(NamedTuple):
    """The two bounds on a PUT body, kept apart because they answer differently.

    `quota` is the bytes the root can still take, or None when it is unlimited.
    `hard` is `drive_webdav_max_upload_size`, the site's own absolute body cap,
    or None when the site sets none.

    They are not one number. An exhausted quota is 507 and tells a client to
    free space; a server body limit is 413 (RFC 7231 §6.5.11) and tells it this
    one file is too big. rclone abandons a whole sync on 507 and skips a single
    file on 413, so collapsing the pair would stop a backup because one file
    was oversized.
    """

    quota: int | None
    hard: int | None

    def check(self, size: int) -> None:
        """Refuse `size` bytes with whichever bound it broke, hard cap first."""
        if self.hard is not None and size > self.hard:
            raise PayloadTooLarge("Upload exceeds this site's maximum WebDAV upload size.")
        if self.quota is not None and size > self.quota:
            raise InsufficientStorage("Upload exceeds available storage.")

    @property
    def bounded(self) -> bool:
        return self.quota is not None or self.hard is not None


def _ceilings(root: str) -> _Ceilings:
    """Both bounds §7.3 gives a PUT: the preflight and the spool stop.

    `effective_quota` 0 is unlimited (RFC 4331 §4 has the same rule for the
    property), and a root already over its quota gets 0 rather than a negative
    ceiling. The hard cap is what bounds a chunked PUT into an unlimited root,
    the one case the quota number cannot bound at all.

    `cint` rather than `int`: a site that wrote "5GB" into the key would
    otherwise raise `ValueError` out of every single PUT, which the mapper
    answers 500. A cap nobody can parse is the same as no cap.
    """
    usage = quota_core.get_storage_usage(root)
    limit = int(usage.effective_quota or 0)
    quota = max(limit - int(usage.used_bytes or 0), 0) if limit else None

    hard = cint(frappe.conf.get("drive_webdav_max_upload_size"))
    return _Ceilings(quota=quota, hard=hard or None)


class _BoundedBody:
    """The request body as a read()able stream, stopped at the spool ceilings.

    `put_blob` copies through `stream.read(n)` into its own spooled tempfile,
    so the bound has to live here: by the time the blob exists the bytes are
    already stored. Refusing mid-copy raises out of `put_blob`, whose rollback
    hook removes whatever it had written.
    """

    def __init__(self, ctx: DavContext, ceilings: _Ceilings):
        self._chunks = ctx.body.stream()
        self._buffer = b""
        self._written = 0
        self._ceilings = ceilings

    def read(self, size: int = -1) -> bytes:
        while size < 0 or len(self._buffer) < size:
            chunk = next(self._chunks, b"")
            if not chunk:
                break
            self._written += len(chunk)
            if self._ceilings.bounded:
                self._ceilings.check(self._written)
            self._buffer += chunk
        if size < 0:
            data, self._buffer = self._buffer, b""
            return data
        data, self._buffer = self._buffer[:size], self._buffer[size:]
        return data


def _spool(ctx: DavContext, title: str, ceilings: _Ceilings):
    """Store the body once, privately, and answer with its `File Blob` row.

    The blob decides its own size and MIME: `put_blob` sniffs the content and
    takes no caller override, and `_core.nodes` re-reads the row and refuses a
    node whose declared pair disagrees with it. A client's `Content-Type` is
    therefore not consulted at all - the bytes are the only witness.
    """
    from frappe.storage.blob import put_blob

    return put_blob(_BoundedBody(ctx, ceilings), is_private=True, filename=title)


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


def _response(status: int, checksum: str, content_modified: datetime | None) -> Response:
    """The stored bytes' own strong validator, the one `getetag` publishes.

    The legacy shape truncated the checksum to 32 characters behind a
    `sha256-` prefix, so an `If-Match` built from a PUT response could never
    match what PROPFIND or GET publish for the same bytes (§12.4).

    `X-OC-Mtime: accepted` is claimed only when a time was really stamped. The
    header is how the nextcloud vendor learns whether to re-sync, so echoing it
    for a value we dropped would leave the client believing a time it can never
    read back.
    """
    headers = {"ETag": f'"{checksum}"'}
    if content_modified is not None:
        headers["X-OC-Mtime"] = "accepted"
    return Response(status=status, headers=headers)
