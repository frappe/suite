"""GET/HEAD: stream a node's bytes with Range and conditional support.

The node is authorized first, then the bytes leave through the framework's
public stream-read (§12.3, §13.5): `send_file(conditional=True)` for a local
blob, and a 206 built from the driver's ranged read for a remote one. Range,
`If-None-Match`, 304, and 416 are all handled there, against the same strong
ETag PROPFIND publishes; `If-Range` is decided one layer down, where the
blob's checksum is already in hand. `drive_webdav_s3_redirect` survives inside
it as the opt-in 302 to a signed native URL, off by default because the
Windows mini-redirector mishandles auth across a cross-host redirect.

`Last-Modified` is set here rather than taken from the framework: it has to be
the node's `content_modified`, the same time `getlastmodified` publishes.

Collections have no bytes, so a browser landing on one is sent to the Drive UI.
"""

import unicodedata
from urllib.parse import quote

from werkzeug.utils import redirect
from werkzeug.wrappers import Response

from suite.drive._core import nodes as node_core
from suite.drive._core.access import require
from suite.drive._core.content import download_filename
from suite.drive._core.roles import READ
from suite.drive.webdav import pathmap
from suite.drive.webdav.context import DavContext
from suite.drive.webdav.errors import NotFoundError
from suite.drive.webdav.properties import content_time, rfc1123


def handle(ctx: DavContext) -> Response:
    resolved = pathmap.resolve(ctx.segments, ctx.user)
    if not resolved.exists:
        raise NotFoundError("Resource not found.")

    row = resolved.node
    # one point check, §2.3's whole budget for the byte path; below READ it
    # raises DriveNotFound, so an unreadable node is 404 and never 403
    require(row, READ, ctx.principals)

    if resolved.is_collection:
        return _collection_response(ctx, "/drive" if resolved.is_mount else f"/drive/d/{row.name}")

    response = node_core.stream_content(row, environ=ctx.request.environ)
    if response.status_code in (200, 206):
        # RFC 7232 §4.1: a 304 carries no representation metadata, and a cache
        # copies whatever it does carry onto the stored response
        _neutralize_active_content(response.headers, download_filename(row.title))
    # the byte path and `getlastmodified` must name one time (§8.11, §12.4).
    # werkzeug derives its own from the blob file's mtime, which is when those
    # bytes were first stored - shared by every node that dedupes onto them.
    response.headers["Last-Modified"] = rfc1123(content_time(row))
    response.headers["Cache-Control"] = "private, no-cache"
    if "Accept-Ranges" not in response.headers:
        # werkzeug advertises ranges only on an actual 206
        response.headers["Accept-Ranges"] = "bytes"
    return response


def _collection_response(ctx: DavContext, spa_url: str) -> Response:
    if ctx.request.method == "HEAD":
        return Response(status=200)
    # a browser landing on a collection URL gets the real UI
    return redirect(spa_url, code=302)


def _neutralize_active_content(headers, filename: str) -> None:
    """File bytes are untrusted user content served from the app origin, and
    neither frappe nor werkzeug adds these: without them an uploaded HTML/SVG
    file opened in a browser runs its scripts with the viewer's session.
    Attachment covers UAs that ignore CSP, matching the signed-URL path;
    DAV clients name files from the URL and ignore all three headers."""
    headers["X-Content-Type-Options"] = "nosniff"
    headers["Content-Security-Policy"] = "sandbox"
    headers.set("Content-Disposition", "attachment", **_disposition_names(filename))


def _disposition_names(filename: str) -> dict[str, str]:
    """Name a download the way RFC 6266 and RFC 8187 do, for any title (§12.4).

    A WSGI header value is latin-1 (RFC 9110 §5.5). `Headers.set` quotes a
    filename but does not encode one, so a title carrying `€`, Cyrillic or
    Chinese produced a header no server can put on the wire: the dev server
    raised `UnicodeEncodeError` inside `send_header`, after the status line, and
    the client got no response at all and timed out. Non-ASCII therefore travels
    in `filename*`, with an ASCII-folded `filename` for clients that read only
    that one. Control characters are dropped, so a title holding a newline
    cannot split the response either.

    `http/routes.py:_disposition_names` is the same function for the same
    reason. It is repeated rather than imported: HTTP and WebDAV are sibling
    adapters and neither may depend on the other (ARCHITECTURE.md, "Ownership
    and placement"). Both mirror what `werkzeug.send_file` does, so a DAV byte
    path and an export name a file identically.
    """
    cleaned = "".join(character for character in filename if character.isprintable()) or "download"
    try:
        cleaned.encode("ascii")
    except UnicodeEncodeError:
        simple = unicodedata.normalize("NFKD", cleaned).encode("ascii", "ignore").decode("ascii")
        return {
            "filename": simple or "download",
            "filename*": f"UTF-8''{quote(cleaned, safe='!#$&+-.^_`|~')}",
        }
    return {"filename": cleaned}
