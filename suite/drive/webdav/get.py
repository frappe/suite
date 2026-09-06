"""GET/HEAD: stream a node's bytes with Range and conditional support.

The node is authorized first, then the bytes leave through the framework's
public stream-read (§12.3, §13.5): `send_file(conditional=True)` for a local
blob, and a 206 built from the driver's ranged read for a remote one. Range,
`If-None-Match`, 304, and 416 are all handled there, against the same strong
ETag PROPFIND publishes. `drive_webdav_s3_redirect` survives inside it as the
opt-in 302 to a signed native URL, off by default because the Windows
mini-redirector mishandles auth across a cross-host redirect.

Collections have no bytes, so a browser landing on one is sent to the Drive UI.
"""

from werkzeug.utils import redirect
from werkzeug.wrappers import Response

from suite.drive._core import nodes as node_core
from suite.drive._core.access import require
from suite.drive._core.content import download_filename
from suite.drive._core.roles import READ
from suite.drive.webdav import pathmap
from suite.drive.webdav.context import DavContext
from suite.drive.webdav.errors import NotFoundError


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
    _neutralize_active_content(response.headers, download_filename(row.title))
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
    headers.set("Content-Disposition", "attachment", filename=filename)
