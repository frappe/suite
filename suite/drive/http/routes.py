"""One whitelisted handler per row of §11.2's route tables.

A handler does four things and nothing else: it declares its verb and whether a
guest may reach it, it builds the caller's principals once from the session and
this request's `X-Drive-Links` header, it calls one private Drive workflow, and
it shapes what came back. Every refusal, every role check, and every byte
charge belongs to the workflow. The settings and WebDAV routes address no node,
so they build no principals: they read and write the session user's settings.

`@frappe.whitelist(methods=[...])` is the second gate, not the first. The
translator will only route a verb its table names, so this decorator is what
refuses the same call made straight at the v2 method URL.

`allow_guest=True` means "a caller with no session may be *heard* here",
because a share link is presented by a Guest (§6.2). It never means the call is
allowed: `access.require` decides that from the principals, and answers a
caller below READ with 404 rather than 403 so an unreadable node stays
invisible (§5.2).

`xss_safe=True` rides beside it wherever a guest sends text that has to arrive
as it was typed. Without it `is_whitelisted` runs `sanitize_html` over every
string in `form_dict`, but only for a Guest: the same comment stored verbatim
for a signed-in user comes back truncated at its first `<` for a link holder, a
§9.3 anchor stops round-tripping, and a link password containing a bracket can
never unlock while every attempt still spends one of §6.3's five tries. That
rewrite is not the escape a client owes its own renderer, and Drive answers
JSON, so the text is stored as sent and escaped where it is drawn.

Two things a client may not say. It may not name bytes that reach accounting:
`POST /nodes` takes §11.2's declared `blob`, `size`, and `mime`, and they are
claims `create_file` checks against the stored blob row before it writes or
charges anything - every other route reaches bytes only through an upload
session, which §8.4 makes the proof that the caller produced them. This route
has no session to show, so `nodes.create` also makes it prove READ on a node or
version that already holds the blob: Drive prints blob ids in its own §6.8
signed URLs, and a fifteen-minute read must not become a permanent node. And it
may not name a target twice: the translator writes the path segments into
`form_dict` after the body was parsed, so the id in the URL is the id that
acts.
"""

import base64
import binascii
import functools
import unicodedata
from datetime import datetime
from urllib.parse import quote
from uuid import uuid4

import frappe
from frappe import _
from werkzeug.wrappers import Response

from suite.drive import framework
from suite.drive._core import access, archive, comments, content, previews, roots, versions
from suite.drive._core import activity as activity_core
from suite.drive._core import nodes as node_core
from suite.drive._core import upload as upload_core
from suite.drive._core.access import describe
from suite.drive._core.errors import (
    DriveConflict,
    DriveError,
    DriveLocked,
    DriveNotFound,
    rollback_savepoint,
)
from suite.drive.http import shapes
from suite.drive.webdav import settings as webdav_settings

# Every handler argument is annotated with this one permissive alias, and none
# of them means it. `require_type_annotated_api_methods` is on for this app, so
# a missing annotation is a hard error and a narrow one is worse than useless:
# pydantic refuses a mismatch with `FrappeTypeError` from outside the handler
# body, where the §11.6 mapping cannot reach it, and answers 417 with no
# message. The alias admits anything a JSON body or a query string can carry,
# and `shapes` does the real checking inside the body, where a refusal is a
# `ValidationError` the boundary maps to 400.
Given = str | int | float | bool | list | dict | None


def _route(handler):
    """Give every Drive refusal the v2 body §11.6 specifies.

    `report_error` names the exception class, and copies a message only when
    `msgprint` stamped one onto it - which `frappe.throw` does and a bare
    `raise` does not. Drive's workflows raise, which is right for a Python
    caller and leaves an HTTP client a body with a type and no message, so the
    boundary throws the same class again to fill it in.

    A plain `frappe.ValidationError` is a malformed argument. The framework
    scores it 417; §11.6 has one code for a bad request, and it is `DriveError`
    at 400.
    """

    @functools.wraps(handler)
    def answered(*args, **kwargs):
        try:
            return handler(*args, **kwargs)
        except DriveError as refusal:
            _refuse(type(refusal), str(refusal), free_title=getattr(refusal, "free_title", None))
        except frappe.RateLimitExceededError as limited:
            # 429, and already carrying its message: §6.3 locks a link out for
            # fifteen minutes after five wrong passwords, and the caller has to
            # be able to tell that apart from a wrong password. The clause
            # below would flatten it to 400 with every other bad argument.
            # `Retry-After` carries the seconds left, so the unlock screen can
            # count down to the next attempt.
            if retry_after := getattr(limited, "retry_after", None):
                frappe.local.response_headers["Retry-After"] = str(retry_after)
            raise
        except frappe.DoesNotExistError as missing:
            # A row a workflow reached for is gone. The framework already
            # scores this 404; §11.6 spells that `DriveNotFound`.
            _refuse(DriveNotFound, str(missing))
        except frappe.ValidationError as invalid:
            _refuse(DriveError, str(invalid))

    return answered


def _refuse(kind: type, message: str, **fields) -> None:
    """Throw `kind` so the envelope carries its message and any extra `fields`.

    `report_error` merges the `msgprint` entry stamped with the exception's id
    into the envelope, so an extra field (§11.6's `free_title`) is written onto
    that entry. A field whose value is None is left out.
    """
    if kind is DriveLocked:
        # `process_response` puts an OAuth Bearer challenge on any 401 when
        # resource metadata is enabled, and merges `response_headers` after it.
        # A password link is opened at POST /links/<token>/unlock, not by
        # logging in, so name that instead of inviting a browser login prompt.
        frappe.local.response_headers["WWW-Authenticate"] = 'DriveLink realm="drive"'
    extra = {name: value for name, value in fields.items() if value is not None}
    try:
        frappe.throw(message, kind)
    except kind as thrown:
        if extra:
            stamp = getattr(thrown, "__frappe_exc_id", None)
            for entry in frappe.local.message_log:
                if stamp and entry.get("__frappe_exc_id") == stamp:
                    entry.update(extra)
        raise


def _principals():
    return framework.principals_for_request()


def _mark_favourites(principals, answers: list[shapes.NodeShape]) -> None:
    """Set the caller's own `favourite` flag on each answered node.

    One `Drive Favourite` read for the whole page. A Guest keeps no
    favourites, so every node answers `false` for them.
    """
    marks = activity_core.personal_marks(principals, [answer["name"] for answer in answers])
    for answer in answers:
        answer["favourite"] = bool((marks.get(answer["name"]) or {}).get("favourite"))


# --------------------------------------------------------------------------
# Nodes
# --------------------------------------------------------------------------


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def node_create(
    parent_node: Given = None,
    title: Given = None,
    kind: Given = None,
    blob: Given = None,
    size: Given = None,
    mime: Given = None,
    content_modified: Given = None,
    url: Given = None,
    content_doctype: Given = None,
    from_node: Given = None,
    is_template: Given = None,
) -> shapes.NodeShape:
    """Create one node of any kind a client may create below `parent_node` (§8.3).

    `blob`, `size`, and `mime` are §11.2's declared body, and they are claims
    the workflow checks, not values it stores. `create_file` re-reads the blob
    row, refuses unless the declared size and mime match it, writes the node
    from the stored values, and charges the root the stored size. The blob id
    itself is checked too: this is the one create with no upload session
    behind it, so `nodes.create` makes the caller prove READ on a node or
    version that already holds those bytes.
    """
    principals = _principals()
    created = node_core.create(
        principals,
        shapes.required_text(parent_node, "parent_node"),
        shapes.required_text(title, "title"),
        kind=shapes.required_text(kind, "kind"),
        blob=shapes.text(blob, "blob"),
        size=None if size is None else shapes.whole(size, "size", 0),
        mime=shapes.text(mime, "mime"),
        content_modified=shapes.moment(content_modified, "content_modified"),
        url=shapes.text(url, "url"),
        content_doctype=shapes.text(content_doctype, "content_doctype"),
        from_node=shapes.text(from_node, "from_node"),
        is_template=shapes.flag(is_template, "is_template", False),
    )
    return shapes.node_shape(node_core.stored(created))


@frappe.whitelist(allow_guest=True, methods=["GET"])
@_route
def node_get(node: Given = None, expand: Given = None) -> shapes.NodeShape:
    """Answer one readable node, with the expansions the caller asked for."""
    principals = _principals()
    asked = shapes.expansions(expand)
    row = node_core.get(principals, shapes.required_text(node, "node"))
    answer = shapes.node_shape(row)
    _mark_favourites(principals, [answer])
    if "access" in asked:
        answer["access"] = describe(row, principals)
    if "breadcrumbs" in asked:
        answer["breadcrumbs"] = node_core.breadcrumbs(row, principals)
    if "preview" in asked:
        answer["preview"] = previews.preview_expansions([row.name]).get(row.name)
    return answer


@frappe.whitelist(allow_guest=True, methods=["PATCH"])
@_route
def node_patch(
    node: Given = None,
    title: Given = None,
    parent_node: Given = None,
    state: Given = None,
    content_modified: Given = None,
    expect_parent_node: Given = None,
) -> shapes.NodeShape:
    """Rename, move, trash, restore, or stamp one node (§8.2).

    §11.2 gives this route five whole bodies and no more: `{title}`,
    `{parent_node}`, `{state}`, `{parent_node, state: "Active"}`, and
    `{content_modified}`. `update` takes exactly one of them, and two at once
    is a `ValidationError`. A move may add `expect_parent_node`, the folder
    the caller last saw the node in; the workflow answers `DriveMoved` (409)
    when it has moved on, and writes nothing.

    Bytes are not among them. A file head is replaced through
    `PUT /nodes/<id>/content`, which names an upload session the caller
    finished, so this route never takes a blob id.

    A restore whose original parent chain is gone carries both `parent_node` and
    `state: "Active"`: the destination is the user's choice, and `_restore`
    answers `DriveConflict` when it is missing rather than picking one.
    """
    principals = _principals()
    return shapes.node_shape(
        node_core.update(
            principals,
            shapes.required_text(node, "node"),
            title=shapes.text(title, "title"),
            parent_node=shapes.text(parent_node, "parent_node"),
            state=shapes.text(state, "state"),
            content_modified=shapes.moment(content_modified, "content_modified"),
            expect_parent_node=shapes.text(expect_parent_node, "expect_parent_node"),
        )
    )


@frappe.whitelist(methods=["DELETE"])
@_route
def node_purge(node: Given = None) -> shapes.Count:
    """Permanently remove one trash root's subtree (§8.8).

    MANAGE only, so never a link holder. Any node that is not a trash root is
    `DriveConflict`: an Active node goes to the trash first.
    """
    return {"count": node_core.purge(_principals(), shapes.required_text(node, "node"))}


@frappe.whitelist(allow_guest=True, methods=["GET"])
@_route
def node_children(
    node: Given = None,
    limit: Given = None,
    cursor: Given = None,
    order_by: Given = None,
    ascending: Given = None,
    type: Given = None,
    expand: Given = None,
) -> shapes.Page[shapes.NodeShape]:
    """Page one folder's readable children in §11.4's opaque-cursor envelope."""
    principals = _principals()
    asked = shapes.expansions(expand)
    parent = shapes.required_text(node, "node")
    result = node_core.children(
        principals,
        parent,
        cursor=shapes.text(cursor, "cursor") or None,
        limit=shapes.whole(limit, "limit", node_core.DEFAULT_PAGE_SIZE),
        order_by=shapes.text(order_by, "order_by") or "title",
        ascending=shapes.flag(ascending, "ascending", True),
        listing_types=shapes.listing_types(type),
        with_access="access" in asked,
    )
    rows = [shapes.node_shape(row) for row in result["rows"]]
    _mark_favourites(principals, rows)
    if "access" in asked:
        for answer, row in zip(rows, result["rows"], strict=True):
            answer["access"] = row.access
    if "preview" in asked:
        minted = previews.preview_expansions([row["name"] for row in rows])
        for answer in rows:
            answer["preview"] = minted.get(answer["name"])
    if "breadcrumbs" in asked and rows:
        # Every row in the page shares one parent, so the trail is the listed
        # folder's own trail with the folder itself appended. `children`
        # already read and authorized that folder: reading it again would let
        # a grant revoked mid-request 404 a page the plain listing answered.
        listed = result["container"]
        trail = [*node_core.breadcrumbs(listed, principals), {"name": listed.name, "title": listed.title}]
        for answer in rows:
            answer["breadcrumbs"] = list(trail)
    return shapes.page(result, rows)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def node_copy(node: Given = None, parent_node: Given = None, title: Given = None) -> shapes.NodeShape:
    """Copy one readable tree into `parent_node`, sharing blobs but no authority."""
    principals = _principals()
    copied = node_core.copy(
        principals,
        shapes.required_text(node, "node"),
        shapes.required_text(parent_node, "parent_node"),
        title=shapes.text(title, "title"),
    )
    return shapes.node_shape(node_core.stored(copied))


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def node_archive_start(node: Given = None) -> shapes.ArchiveStatus:
    """Build one bounded folder archive synchronously."""
    return archive.start(_principals(), shapes.required_text(node, "node"))


@frappe.whitelist(allow_guest=True, methods=["GET"])
@_route
def node_archive_status(node: Given = None) -> shapes.ArchiveStatus:
    """Report this caller's current folder archive build."""
    return archive.status(_principals(), shapes.required_text(node, "node"))


@frappe.whitelist(allow_guest=True, methods=["GET"])
@_route
def node_archive_download(node: Given = None) -> Response:
    """Stream a ready folder archive through the active storage driver."""
    from frappe.storage.serve import stream_blob

    blob, filename = archive.download(_principals(), shapes.required_text(node, "node"))
    return stream_blob(
        blob,
        filename,
        as_attachment=True,
        environ=frappe.local.request.environ,
    )


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def node_batch(nodes: Given = None, patch: Given = None) -> shapes.BatchResult:
    """Apply one patch to many nodes, isolating each failure (§11.5).

    Partial success is a result, not an error, so the response is 200. Each
    node runs inside its own savepoint: a refusal rolls back that node's rows
    and its activity row and leaves every other node's write standing, which is
    what makes "one activity row per node that moved" true.

    A refusal is reported. Anything else is a defect, and is left to abort the
    request rather than be flattened into a per-node message. A deadlock is one
    of those: `QueryDeadlockError` is not a `ValidationError`, so it leaves this
    loop with the whole batch, which is the truth after InnoDB rolled the
    victim's transaction back. The rollback goes through the shared helper so
    that a savepoint InnoDB has already discarded cannot replace the error the
    caller has to read.
    """
    principals = _principals()
    asked = shapes.identifiers(nodes, "nodes")
    mutation = shapes.patch(patch, "patch")
    return _each(
        asked,
        lambda node: node_core.update(
            principals,
            node,
            title=shapes.text(mutation.get("title"), "title"),
            parent_node=shapes.text(mutation.get("parent_node"), "parent_node"),
            state=shapes.text(mutation.get("state"), "state"),
            content_modified=shapes.moment(mutation.get("content_modified"), "content_modified"),
            expect_parent_node=shapes.text(mutation.get("expect_parent_node"), "expect_parent_node"),
        ),
    )


@frappe.whitelist(methods=["POST"])
@_route
def node_batch_purge(nodes: Given = None) -> shapes.BatchResult:
    """Purge many subtrees, isolating each failure (§11.5).

    Each node is `DELETE /nodes/<id>`: MANAGE on the node, in its own
    savepoint, with one activity row. MANAGE is never reached through a link,
    so a Guest is not heard.

    Shallowest first: a selected folder is purged before a selected node below
    it. That purge removes the descendant too, so the descendant is reported
    purged, not missing.
    """
    principals = _principals()
    asked = shapes.identifiers(nodes, "nodes")
    ancestors = node_core.stored_ancestors(asked)
    purged: set[str] = set()

    def purge(node: str) -> None:
        if purged.isdisjoint(ancestors.get(node, ())):
            node_core.purge(principals, node)
        purged.add(node)

    return _each(tuple(sorted(asked, key=lambda node: len(ancestors.get(node, ())))), purge)


def _each(asked: tuple[str, ...], act) -> shapes.BatchResult:
    """Run `act` once per node in its own savepoint, and report §11.5's shape."""
    ok: list[str] = []
    failed: list[shapes.BatchFailure] = []
    for node in asked:
        savepoint = f"drive_http_batch_{uuid4().hex[:12]}"
        frappe.db.savepoint(savepoint)
        try:
            act(node)
        except frappe.ValidationError as refusal:
            rollback_savepoint(savepoint, refusal)
            kind = type(refusal) if isinstance(refusal, DriveError) else DriveError
            failed.append({"node": node, "type": kind.__name__, "message": str(refusal)})
        else:
            frappe.db.release_savepoint(savepoint)
            ok.append(node)
    return {"ok": ok, "failed": failed}


@frappe.whitelist(allow_guest=True, methods=["PUT"])
@_route
def node_put_content(
    node: Given = None,
    upload_id: Given = None,
    checksum: Given = None,
    content_modified: Given = None,
) -> dict:
    """Replace one file's bytes from the caller's own finished upload session."""
    principals = _principals()
    replaced = upload_core.finish_upload(
        principals,
        shapes.required_text(upload_id, "upload_id"),
        checksum=shapes.text(checksum, "checksum"),
        content_modified=shapes.moment(content_modified, "content_modified"),
        replaces=shapes.required_text(node, "node"),
    )
    return shapes.node_shape(node_core.stored(replaced))


@frappe.whitelist(allow_guest=True, methods=["GET"])
@_route
def node_get_content(node: Given = None, format: Given = None) -> Response:
    """Send one readable node's bytes: a signed redirect, or a streamed export.

    A file redirects to a short-lived signed `/f/` URL, which the framework
    serves against the signature alone - so the READ check has to happen here,
    before the URL exists. A content document has no stored bytes: only its app
    can produce them, and it does so through the guarded stream §10.1 declares.
    """
    principals = _principals()
    wanted = shapes.required_text(node, "node")
    row = node_core.get(principals, wanted)

    if row.kind == "file":
        # §2.3 budgets this path at one point check. `get` spent it, so the URL
        # is minted from that row rather than reading and checking again.
        minted = node_core.signed_content_url(row)
        answer = Response(status=302)
        answer.headers["Location"] = minted["url"]
        answer.headers["Cache-Control"] = "private, no-store"
        return answer

    if row.kind == "document":
        stream, mime, filename = content.export_document(principals, wanted, shapes.text(format, "format"))
        answer = Response(stream, mimetype=mime)
        answer.headers.set("Content-Disposition", "attachment", **_disposition_names(filename))
        answer.headers["Cache-Control"] = "private, no-store"
        return answer

    raise DriveConflict(_("This Drive node has no content to send"))


def _disposition_names(filename: str) -> dict:
    """Name a download the way RFC 5987 does, for any title a node may carry.

    A WSGI header is latin-1. `Headers.set` quotes a filename but does not
    encode one, so a title in Cyrillic or Chinese kills the response after the
    status line, and a title holding a newline raises `ValueError` past the
    boundary that maps refusals. Control characters are dropped and non-ASCII
    is carried in `filename*`, which is what `werkzeug.send_file` does.
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


@frappe.whitelist(allow_guest=True, methods=["GET"])
@_route
def node_media(node: Given = None) -> dict:
    """List one readable document's media with signed 15-minute URLs (§6.8)."""
    return {"media": content.list_media(_principals(), shapes.required_text(node, "node"))}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def node_preview(node: Given = None, image: Given = None, mime: Given = None) -> dict:
    """Replace one document's preview with an image its app rendered (§9.2)."""
    principals = _principals()
    wanted = shapes.required_text(node, "node")
    try:
        pixels = base64.b64decode(shapes.required_text(image, "image"), validate=True)
    except binascii.Error, ValueError:
        frappe.throw(_("Drive argument image is invalid"), frappe.ValidationError)
    previews.push_preview(principals, wanted, pixels, shapes.required_text(mime, "mime"))
    return {"preview": previews.preview_expansions([wanted]).get(wanted)}


# --------------------------------------------------------------------------
# Uploads
# --------------------------------------------------------------------------


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def upload_create(
    parent_node: Given = None,
    filename: Given = None,
    size: Given = None,
    mime: Given = None,
    replaces: Given = None,
) -> dict:
    """Open one private blob session, refusing on the declared size (§11.2).

    A file above the site's per-file limit is `DriveFileTooLarge`. A root
    without room is `DriveOverQuota`, never a permission error: a caller who
    may upload here and has no room is told which of the two is missing. A taken
    `filename` is `DriveConflict` with `free_title`, unless the taken title is
    the file named by `replaces`.
    """
    return upload_core.create_upload(
        _principals(),
        shapes.required_text(parent_node, "parent_node"),
        shapes.required_text(filename, "filename"),
        shapes.whole(size, "size", 0),
        mime=shapes.text(mime, "mime"),
        replaces=shapes.text(replaces, "replaces"),
    )


@frappe.whitelist(allow_guest=True, methods=["PUT"])
@_route
def upload_chunk(upload_id: Given = None, offset: Given = None) -> dict:
    """Write one bounded chunk of a bound session at `?offset=`.

    The session is authorized before the body is read. Python evaluates every
    argument first, so an unknown or unauthorized session would otherwise cost
    a whole 16 MiB chunk of memory to refuse.
    """
    principals = _principals()
    wanted = shapes.required_text(upload_id, "upload_id")
    where = shapes.whole(offset, "offset", 0)
    binding = upload_core.authorize_chunk(principals, wanted)
    return upload_core.upload_chunk(principals, wanted, where, _chunk_bytes(), binding=binding)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def upload_finish(
    upload_id: Given = None,
    parent_node: Given = None,
    title: Given = None,
    checksum: Given = None,
    content_modified: Given = None,
    replaces: Given = None,
) -> dict:
    """Turn one finished session into a new file, or into a replacement head."""
    principals = _principals()
    node = upload_core.finish_upload(
        principals,
        shapes.required_text(upload_id, "upload_id"),
        parent_node=shapes.text(parent_node, "parent_node"),
        title=shapes.text(title, "title"),
        checksum=shapes.text(checksum, "checksum"),
        content_modified=shapes.moment(content_modified, "content_modified"),
        replaces=shapes.text(replaces, "replaces"),
    )
    return shapes.node_shape(node_core.stored(node))


def _chunk_bytes() -> bytes:
    """Read one chunk body without buffering more than Drive allows.

    On the streaming path `make_form_dict` never ran and `max_content_length`
    is cleared, so `request.stream` is untouched and unbounded: read one byte
    past the limit and let `upload_chunk` refuse. Off that path - a PUT made
    straight at the v2 method URL - the framework already read and capped the
    body, and werkzeug kept it.
    """
    request = frappe.local.request
    cached = request.__dict__.get("_cached_data")
    if cached is not None:
        return cached
    return request.stream.read(upload_core.MAX_CHUNK_BYTES + 1)


# --------------------------------------------------------------------------
# Roots
# --------------------------------------------------------------------------


@frappe.whitelist(methods=["GET"])
@_route
def roots_discover() -> shapes.RootLocations:
    """Return the signed-in caller's active Files locations."""
    return roots.discover(_principals())


@frappe.whitelist(methods=["GET"])
@_route
def root_usage(root: Given = None, expand: Given = None) -> shapes.RootUsage:
    """Report one root's counters to its own user, its managers, or an admin.

    `?expand=breakdown` adds bytes by type and the largest nodes.
    """
    breakdown = "breakdown" in shapes.expansions(expand, allowed=shapes.USAGE_EXPANSIONS)
    return dict(roots.usage_for(shapes.required_text(root, "root"), _principals(), breakdown=breakdown))


@frappe.whitelist(methods=["PATCH"])
@_route
def root_patch(
    root: Given = None,
    quota_bytes: Given = None,
    state: Given = None,
) -> shapes.RootShape:
    """Apply exactly one Suite Admin change to one root's metadata."""
    wanted = shapes.required_text(root, "root")
    quota = None if quota_bytes is None else shapes.whole(quota_bytes, "quota_bytes", 0)
    return shapes.root_shape(
        roots.update_root(
            wanted,
            _principals(),
            quota_bytes=quota,
            state=shapes.text(state, "state"),
        )
    )


@frappe.whitelist(methods=["POST"])
@_route
def root_empty_trash(root: Given = None) -> shapes.Count:
    """Purge every trashed tree in one root. MANAGE on the root node (§8.8)."""
    return {"count": node_core.empty_trash(_principals(), shapes.required_text(root, "root"))}


@frappe.whitelist(methods=["DELETE"])
@_route
def root_purge(root: Given = None) -> shapes.Count:
    """Purge one Archived root pair and everything below it. Suite Admin only."""
    return {"count": roots.purge_root(shapes.required_text(root, "root"), _principals()).purged}


# --------------------------------------------------------------------------
# Grants, links, publishing
# --------------------------------------------------------------------------


@frappe.whitelist(methods=["GET"])
@_route
def node_grants(node: Given = None, principal: Given = None, inherited: Given = None) -> shapes.GrantsShape:
    """Answer one node's local grants, and optionally one explanation (§11.2).

    `?inherited=1` adds every live grant on an ancestor, each with the node it
    sits on and that node's title, nearest ancestor first. The share dialog
    shows them under "From <folder>" (issue 44, D19).

    `owner` is the person whose Personal root holds the node, or null in the
    Shared root. The dialog lists them first, as Owner, with nothing to
    change. Every user the answer names is published as a person, from one
    lookup for the whole answer.

    `?principal=` is the accepted spelling of §5.8's `explain`. MANAGE on the
    target is what the caller needs, and it is checked before the named
    principal is even resolved: whether that person can reach the node is the
    question being asked, never a condition on the right to ask it.

    No session, no answer. A link caps at EDIT (§5.9) and `$PUBLIC` at READ, so
    no principal a Guest can present ever reaches MANAGE, and hearing the call
    would only let an anonymous caller probe for node ids.

    The named principal is handed over unresolved, as a callable the workflow
    invokes after its MANAGE check. Resolving it here would run
    `principals_for_principal` first, and its "that names no user" refusal
    would answer a caller who has no right to ask anything about this node.
    """
    principals = _principals()
    named = shapes.text(principal, "principal")
    answer = access.grants_for(
        shapes.required_text(node, "node"),
        principals,
        inherited=shapes.flag(inherited, "inherited", False),
        resolve_subject=(lambda: framework.principals_for_principal(named)) if named else None,
    )
    return shapes.grants_shape(answer)


@frappe.whitelist(methods=["PUT"])
@_route
def node_put_grant(
    node: Given = None,
    principal: Given = None,
    role: Given = None,
    expires_on: Given = None,
    password: Given = None,
    send_to: Given = None,
    notify: Given = None,
) -> shapes.GrantShape:
    """Write one grant, including an explicit deny and a new share link (§5.9).

    `role` is required and is never defaulted. Every one of §5.9's twelve
    refusals belongs to the workflow, including the five §11.2 restates, so
    this route pre-checks none of them: a pre-check here would answer before
    the MANAGE gate and tell a caller without it which rule they broke.

    `role: 0` is the explicit deny, and it is the only way to write one.
    Publishing is this route with principal `$PUBLIC` and `role: 10`. There is
    no separate publish verb (§6.5).

    `role` and `expires_on` are replaced: an omitted or null `expires_on`
    clears the expiry. `password` is patched (§5.9 step 3): omitted keeps the
    stored hash, null clears it, and a string sets it, so changing a link's
    expiry never drops its password.

    `send_to` on `$LINK` mails the new link to one address and stores it on
    the row. `notify: true` on a user principal mails that user. `notify` is
    never stored. Both mails leave the request path (§9.5).

    An existing link is addressed by its grant id (`PATCH /grants/<id>`),
    never by `$LINK:<token>` here: the token is the credential, and a path is
    what proxies log and browsers keep.
    """
    role, expires_on, password = _grant_write(role, expires_on, password)
    written = access.grant(
        shapes.required_text(node, "node"),
        _path_principal(principal),
        role,
        _principals(),
        expires_on=expires_on,
        password=password,
        send_to=shapes.text(send_to, "send_to"),
        notify=shapes.flag(notify, "notify", False),
    )
    return shapes.grant_shape(written)


@frappe.whitelist(methods=["PATCH"])
@_route
def grant_patch(
    grant: Given = None,
    role: Given = None,
    expires_on: Given = None,
    password: Given = None,
) -> shapes.GrantShape:
    """Rewrite one grant by its id: the same write as `PUT`, on a row already there.

    This is how a share link's role, expiry, or password changes. The row's
    node and principal are read from the row, so the token never leaves the
    body of a listing. Every refusal of §5.9 applies as it does on `PUT`.
    """
    role, expires_on, password = _grant_write(role, expires_on, password)
    written = access.update_grant(
        shapes.required_text(grant, "grant"),
        _principals(),
        role=role,
        expires_on=expires_on,
        password=password,
    )
    return shapes.grant_shape(written)


def _grant_write(role: Given, expires_on: Given, password: Given) -> tuple[int, datetime | None, str | None]:
    """Read the three fields a grant write shares between `PUT` and `PATCH`."""
    # An absent role and a blank one are the same refusal. `shapes.whole` reads
    # `""` as its default, and the default a role would take is 0, which is the
    # explicit deny of §5.10. A dropped form field must never become a denial.
    if role is None or role == "":
        frappe.throw(_("Drive argument role is required"), frappe.ValidationError)
    # Frappe passes `None` for an omitted key and for an explicit JSON `null`
    # alike. Only the parsed body tells them apart, and they mean opposite
    # things here: keep the password, or clear it.
    if password is None and "password" not in frappe.form_dict:
        password = access.KEEP
    return (
        shapes.whole(role, "role", 0),
        shapes.moment(expires_on, "expires_on"),
        # A blank password is a cleared one. `""` reaching the workflow would
        # be hashed and stored, and §6.3's unlock would then guard the link
        # behind a secret nobody typed; on a principal that is not a link it
        # would trip refusal 10 and answer 403 for an empty form field.
        password if password is access.KEEP else shapes.text(password, "password") or None,
    )


def _path_principal(principal: Given) -> str:
    """A principal named in a path: any of §4.4's spellings but a link token."""
    named = shapes.required_text(principal, "principal")
    if named.startswith("$LINK:"):
        frappe.throw(
            _("A Drive share link is addressed by its grant id, not its token"), frappe.ValidationError
        )
    return named


@frappe.whitelist(methods=["DELETE"])
@_route
def node_delete_grant(node: Given = None, principal: Given = None, below: Given = None) -> shapes.Count:
    """Remove this principal's local grant, or every grant below it (§5.10).

    Removal is never a denial. This writes no row of its own: access inherited
    from an ancestor survives it, and `GET /nodes/<id>/grants?principal=` is
    what shows the caller what is left. Denying takes `PUT` with `role: 0`.

    `?below=1` is `revoke_below`, the eviction the creator grant makes
    necessary (§4.5): a creator grant sits under the folder being revoked at,
    and nearest-wins would keep it alive. The count is the rows removed, the
    row here included.
    """
    principals = _principals()
    wanted = shapes.required_text(node, "node")
    named = _path_principal(principal)
    if shapes.flag(below, "below", False):
        return {"count": access.revoke_below(wanted, named, principals)}
    return {"count": access.revoke(wanted, named, principals)}


@frappe.whitelist(methods=["DELETE"])
@_route
def grant_delete(grant: Given = None) -> shapes.Count:
    """Remove one grant by its id. How a share link is removed (§5.10)."""
    return {"count": access.revoke_grant(shapes.required_text(grant, "grant"), _principals())}


@frappe.whitelist(methods=["POST"])
@_route
def grant_rotate(grant: Given = None) -> shapes.GrantShape:
    """Mint a new token for one share link, keeping everything else (§5.11).

    The address is the `Drive Grant` id, not the old token: rotation is a
    management act on a row, and naming the token in the URL would put the
    secret being replaced into the access log.
    """
    return shapes.grant_shape(access.rotate_link(shapes.required_text(grant, "grant"), _principals()))


@frappe.whitelist(allow_guest=True, xss_safe=True, methods=["POST"])
@_route
def link_unlock(token: Given = None, password: Given = None) -> shapes.UnlockTicket:
    """Trade one link password for the stateless 30-day ticket of §4.8.

    The token travels in the body with the password, never in the path: both
    are secrets, and a path is logged where a body is not.

    No role is needed and no row is written: the password is the whole proof,
    and the ticket is an HMAC over the token, the stored hash, and an expiry,
    so a password change or a rotation kills every ticket at once.

    Guest-reachable, because unlocking is what a caller does before they have
    any access at all. A wrong password answers 401. The fifth failure in
    fifteen minutes locks the token out, and it and every attempt during the
    lockout answer 429 with `Retry-After`, which the boundary keeps distinct
    from a wrong password (§6.3).
    """
    return access.unlock_link(
        shapes.required_text(token, "token"),
        shapes.required_text(password, "password"),
    )


# --------------------------------------------------------------------------
# Views
# --------------------------------------------------------------------------


@frappe.whitelist(methods=["GET"])
@_route
def view_list(
    view: Given = None,
    limit: Given = None,
    cursor: Given = None,
    root: Given = None,
    content_doctype: Given = None,
    term: Given = None,
    type: Given = None,
    expand: Given = None,
) -> shapes.Page[shapes.NodeShape | shapes.ArchivedRootShape]:
    """Page one of §11.2's seven frozen discovery views.

    Session only. Five of the seven are answered from the caller's own
    principals and the other two are their private lists, so a Guest has
    nothing to be shown here and a shared `Guest` recents list would be one
    list for every anonymous visitor on the site.

    Access and preview expansions are built once for the whole page. Search,
    shared, and favourites also accept breadcrumbs, whose ancestor titles are
    fetched as one union: a folder opened from those lists shows its trail at
    once. Recents hides folders and trash shows the trash root's own trail, so
    neither takes them.

    `archived-roots` answers root metadata, not nodes (§5.5), so its rows are
    passed through as they are.
    """
    principals = _principals()
    name = shapes.required_text(view, "view")
    asked = shapes.expansions(expand)
    supported = {"preview", "access"}
    if name in ("search", "shared", "favourites"):
        supported.add("breadcrumbs")
    if name == "archived-roots":
        supported = set()
    unsupported = sorted(asked - supported)
    if unsupported:
        frappe.throw(
            _("A Drive view cannot expand {0}").format(", ".join(unsupported)),
            frappe.ValidationError,
        )
    result = node_core.views(
        principals,
        name,
        cursor=shapes.text(cursor, "cursor") or None,
        limit=shapes.whole(limit, "limit", node_core.DEFAULT_PAGE_SIZE),
        with_access="access" in asked,
        with_breadcrumbs="breadcrumbs" in asked,
        **_view_filters(name, root, content_doctype, term, type),
    )
    if name == "archived-roots":
        return shapes.page(result, [dict(row) for row in result["rows"]])
    rows = shapes.node_shapes(result["rows"])
    _mark_favourites(principals, rows)
    for answer, row in zip(rows, result["rows"], strict=True):
        if "access" in asked:
            answer["access"] = row.access
        if "breadcrumbs" in asked:
            answer["breadcrumbs"] = row.breadcrumbs
        if name == "recents":
            answer["opened_at"] = shapes.stamp(row.opened_at)
    if "preview" in asked:
        minted = previews.preview_expansions([row["name"] for row in rows])
        for answer in rows:
            answer["preview"] = minted.get(answer["name"])
    return shapes.page(result, rows)


def _view_filters(name: str, root: Given, content_doctype: Given, term: Given, listing_types: Given) -> dict:
    """Pass each view only the filters §11.2 declares for it.

    Forwarding every argument to every view would let `?term=` reach `trash`
    and be silently ignored, which reads to a client as a filter that did not
    work rather than an argument that does not exist.

    Every node view but `templates` takes `?type=`. Templates are documents
    only, and filter by `content_doctype`; `archived-roots` lists roots, not
    nodes. Both refuse `?type=` rather than ignore it.
    """
    if name in ("templates", "archived-roots") and shapes.text(listing_types, "type"):
        frappe.throw(_("The {0} view does not filter by type").format(name), frappe.ValidationError)
    if name == "templates":
        return {"content_doctype": shapes.text(content_doctype, "content_doctype")}
    if name == "archived-roots":
        return {}
    filters = {"listing_types": shapes.listing_types(listing_types)}
    if name == "trash":
        filters["root"] = shapes.required_text(root, "root")
    if name == "search":
        filters["term"] = shapes.required_text(term, "term")
    return filters


@frappe.whitelist(methods=["DELETE"])
@_route
def view_clear_recents(nodes: Given = None) -> shapes.Count:
    """Clear the caller's own recents, and never their favourites (§9.5)."""
    named = None if nodes is None else shapes.name_list(nodes, "nodes")
    return {"count": activity_core.clear_recents(_principals(), named)}


# --------------------------------------------------------------------------
# Versions
# --------------------------------------------------------------------------


@frappe.whitelist(allow_guest=True, methods=["GET"])
@_route
def node_versions(node: Given = None, limit: Given = None, cursor: Given = None) -> dict:
    """Page one readable node's version history, newest sequence first."""
    result = versions.list_versions(
        _principals(),
        shapes.required_text(node, "node"),
        cursor=shapes.text(cursor, "cursor") or None,
        limit=shapes.whole(limit, "limit", node_core.DEFAULT_PAGE_SIZE),
    )
    return shapes.page(result, [shapes.version_shape(row) for row in result["rows"]])


@frappe.whitelist(allow_guest=True, xss_safe=True, methods=["POST"])
@_route
def node_version_create(node: Given = None, kind: Given = None, label: Given = None) -> shapes.VersionShape:
    """Store the node's current bytes as a version and answer that version.

    `kind` and `label` are §9.1's own arguments: `auto` is what a save path
    takes, and a person naming or pinning a milestone takes `named` or
    `milestone`. Which kinds exist is the workflow's rule, not this route's.
    """
    principals = _principals()
    wanted = shapes.required_text(node, "node")
    seq = versions.take_version(
        principals,
        wanted,
        kind=shapes.text(kind, "kind") or "auto",
        label=shapes.text(label, "label"),
    )
    return shapes.version_shape(versions.get_version(principals, wanted, seq))


@frappe.whitelist(allow_guest=True, xss_safe=True, methods=["PATCH"])
@_route
def node_version_patch(
    node: Given = None,
    seq: Given = None,
    label: Given = None,
    pinned: Given = None,
) -> shapes.VersionShape:
    """Set either mutable field of an otherwise immutable version (§9.1).

    A field the request does not name is left alone. Defaulting `pinned` to
    false would let a rename clear a retention pin, and §9.1 makes that pin the
    difference between a version the thinner keeps forever and one it deletes.
    An empty `label` is the way to clear a label; an absent one is not.
    """
    changes = {}
    if label is not None:
        changes["label"] = shapes.text(label, "label") or None
    if pinned is not None and pinned != "":
        changes["pinned"] = shapes.flag(pinned, "pinned", False)
    if not changes:
        frappe.throw(_("Drive requires either label or pinned"), frappe.ValidationError)
    return shapes.version_shape(
        versions.label_version(
            _principals(),
            shapes.required_text(node, "node"),
            shapes.sequence(seq, "seq"),
            **changes,
        )
    )


@frappe.whitelist(methods=["DELETE"])
@_route
def node_version_delete(node: Given = None, seq: Given = None) -> shapes.Count:
    """Delete one version and release its bytes. MANAGE, so never a link."""
    versions.delete_version(
        _principals(),
        shapes.required_text(node, "node"),
        shapes.sequence(seq, "seq"),
    )
    # The workflow removes exactly the one row it was named, or raises.
    return {"count": 1}


@frappe.whitelist(allow_guest=True, methods=["GET"])
@_route
def node_version_content(node: Given = None, seq: Given = None) -> Response:
    """Redirect to one version's bytes behind a short-lived signature (§6.8)."""
    minted = versions.version_content_url(
        _principals(),
        shapes.required_text(node, "node"),
        shapes.sequence(seq, "seq"),
    )
    answer = Response(status=302)
    answer.headers["Location"] = minted["url"]
    answer.headers["Cache-Control"] = "private, no-store"
    return answer


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def node_version_restore(node: Given = None, seq: Given = None) -> shapes.VersionShape | None:
    """Restore one version, answering the version taken first (§9.1).

    Restore is never destructive: the workflow captures the current state as a
    version before it writes, and that captured version is what comes back,
    so a client can offer the way back. A zero-byte file head has nothing to
    capture, and the answer is null.
    """
    principals = _principals()
    wanted = shapes.required_text(node, "node")
    captured = versions.restore_version(principals, wanted, shapes.sequence(seq, "seq"))
    if not captured:
        return None
    return shapes.version_shape(versions.get_version(principals, wanted, captured))


# --------------------------------------------------------------------------
# Threads and comments
# --------------------------------------------------------------------------


@frappe.whitelist(allow_guest=True, methods=["GET"])
@_route
def node_threads(node: Given = None, resolved: Given = None) -> dict:
    """List one readable document's comment threads and their comments."""
    return {
        "threads": shapes.thread_shapes(
            comments.threads(
                _principals(),
                shapes.required_text(node, "node"),
                resolved=None
                if resolved is None or resolved == ""
                else shapes.flag(resolved, "resolved", False),
            )
        )
    }


@frappe.whitelist(allow_guest=True, xss_safe=True, methods=["POST"])
@_route
def node_thread_create(
    node: Given = None,
    anchor: Given = None,
    text: Given = None,
    author_name: Given = None,
) -> shapes.ThreadShape:
    """Open one thread and its first comment in one write (§9.3).

    The anchor is opaque here: Drive stores and lists it, and the content app
    resolves it on screen. The author is the server's to set - a guest supplies
    only the display name they typed, never the identity (§6.7). The answer is
    the thread as `GET .../threads` lists it, its first comment inside.
    """
    return shapes.thread_shape(
        comments.create_thread(
            _principals(),
            shapes.required_text(node, "node"),
            shapes.required_text(anchor, "anchor"),
            shapes.required_text(text, "text"),
            author_name=shapes.text(author_name, "author_name"),
        )
    )


@frappe.whitelist(allow_guest=True, methods=["PATCH"])
@_route
def thread_patch(thread: Given = None, resolved: Given = None) -> shapes.ThreadShape:
    """Resolve or reopen one thread. COMMENT, and idempotent (§9.3)."""
    if resolved is None:
        frappe.throw(_("Drive argument resolved is required"), frappe.ValidationError)
    wanted = shapes.flag(resolved, "resolved", False)
    return shapes.thread_shape(
        comments.resolve(_principals(), shapes.required_text(thread, "thread"), wanted)
    )


@frappe.whitelist(allow_guest=True, xss_safe=True, methods=["POST"])
@_route
def thread_comment_create(
    thread: Given = None,
    text: Given = None,
    author_name: Given = None,
) -> shapes.CommentShape:
    """Append one comment to an existing thread. COMMENT on its node."""
    return shapes.comment_shape(
        comments.reply(
            _principals(),
            shapes.required_text(thread, "thread"),
            shapes.required_text(text, "text"),
            author_name=shapes.text(author_name, "author_name"),
        )
    )


@frappe.whitelist(allow_guest=True, xss_safe=True, methods=["PATCH"])
@_route
def comment_patch(comment: Given = None, text: Given = None) -> shapes.CommentShape:
    """Rewrite one comment's body. EDIT on the node, or being its author."""
    return shapes.comment_shape(
        comments.edit_comment(
            _principals(),
            shapes.required_text(comment, "comment"),
            shapes.required_text(text, "text"),
        )
    )


@frappe.whitelist(allow_guest=True, methods=["DELETE"])
@_route
def comment_delete(comment: Given = None) -> shapes.Count:
    """Delete one comment. EDIT on the node, or being its author."""
    comments.delete_comment(_principals(), shapes.required_text(comment, "comment"))
    # The workflow removes exactly the one row it was named, or raises.
    return {"count": 1}


# --------------------------------------------------------------------------
# Activity, visits, favourites
# --------------------------------------------------------------------------


@frappe.whitelist(allow_guest=True, methods=["GET"])
@_route
def node_activity(node: Given = None, limit: Given = None, cursor: Given = None) -> dict:
    """Page one readable node's history, newest first (§9.4)."""
    result = activity_core.history(
        _principals(),
        shapes.required_text(node, "node"),
        cursor=shapes.text(cursor, "cursor") or None,
        limit=shapes.whole(limit, "limit", node_core.DEFAULT_PAGE_SIZE),
    )
    return shapes.page(result, [shapes.activity_shape(row) for row in result["rows"]])


@frappe.whitelist(methods=["POST"])
@_route
def node_visit(node: Given = None) -> shapes.Count:
    """Record that the caller opened this node. One Recent, no Activity."""
    activity_core.visit(_principals(), shapes.required_text(node, "node"))
    return {"count": 1}


@frappe.whitelist(methods=["PUT"])
@_route
def node_put_favourite(node: Given = None) -> shapes.Count:
    """Star one readable node for the caller alone."""
    activity_core.set_favourite(_principals(), shapes.required_text(node, "node"), True)
    return {"count": 1}


@frappe.whitelist(methods=["DELETE"])
@_route
def node_delete_favourite(node: Given = None) -> shapes.Count:
    """Unstar one node for the caller alone.

    Clearing takes no check on the node, deliberately: a star on something the
    caller stopped being able to read would otherwise be a mark they can
    neither see nor remove.
    """
    activity_core.set_favourite(_principals(), shapes.required_text(node, "node"), False)
    return {"count": 1}


# --------------------------------------------------------------------------
# Notifications
# --------------------------------------------------------------------------


@frappe.whitelist(methods=["GET"])
@_route
def notifications_list(
    limit: Given = None, cursor: Given = None, unread: Given = None
) -> shapes.Page[shapes.NotificationShape]:
    """Page the caller's own inbox. A notification points at one activity row."""
    result = activity_core.notifications(
        _principals(),
        only_unread=shapes.flag(unread, "unread", False),
        cursor=shapes.text(cursor, "cursor") or None,
        limit=shapes.whole(limit, "limit", node_core.DEFAULT_PAGE_SIZE),
    )
    return shapes.page(result, [shapes.notification_shape(row) for row in result["rows"]])


@frappe.whitelist(methods=["GET"])
@_route
def notifications_unread_count() -> shapes.UnreadCount:
    """Return the exact unread notification badge count."""
    return {"unread": activity_core.unread_count(_principals())}


@frappe.whitelist(methods=["POST"])
@_route
def notifications_read(notifications: Given = None, all: Given = None) -> shapes.Count:
    """Mark named, or all, of the caller's notifications read (§11.2).

    Caller-scoped on both sides: the workflow reads the caller's own unread
    inbox and marks only ids found in it, so naming somebody else's pointer
    marks nothing and is counted as nothing.
    """
    named = None if notifications is None else shapes.name_list(notifications, "notifications")
    if named is None and not shapes.flag(all, "all", False):
        frappe.throw(
            _("Drive requires either notifications or all"),
            frappe.ValidationError,
        )
    return {"count": activity_core.mark_read(_principals(), named)}


# --------------------------------------------------------------------------
# Settings and WebDAV
# --------------------------------------------------------------------------
#
# None of these touches a node, so none of them builds principals. Each one is
# the caller's own settings row or the site's, read and written through
# `webdav.settings`, which the DAV dispatcher reads too.


@frappe.whitelist(methods=["GET"])
@_route
def settings_get() -> shapes.UserSettings:
    """Answer the caller's own `Drive Settings` row, or its field defaults."""
    return webdav_settings.user_settings(frappe.session.user)


@frappe.whitelist(methods=["PATCH"])
@_route
def settings_patch(webdav_enabled: Given = None) -> shapes.UserSettings:
    """Write the caller's DAV opt-in, the one field this row takes over HTTP.

    The row is created on the first write. `writer_settings` stays with the
    document API, which writes it today (§11.2).
    """
    if webdav_enabled is None:
        frappe.throw(_("Drive argument webdav_enabled is required"), frappe.ValidationError)
    user = frappe.session.user
    webdav_settings.set_user_webdav_enabled(user, shapes.flag(webdav_enabled, "webdav_enabled", False))
    return webdav_settings.user_settings(user)


@frappe.whitelist(methods=["GET"])
@_route
def site_settings_get() -> shapes.SiteSettings | shapes.AdminSiteSettings:
    """Answer the site's Drive settings, with the admin fields for an admin."""
    return webdav_settings.site_settings()


@frappe.whitelist(methods=["PATCH"])
@_route
def site_settings_patch(webdav_enabled: Given = None) -> shapes.AdminSiteSettings:
    """Turn the site's DAV mount on or off. A Drive admin only.

    The other §3.13 fields are set in Desk.
    """
    if webdav_enabled is None:
        frappe.throw(_("Drive argument webdav_enabled is required"), frappe.ValidationError)
    webdav_settings.set_global_webdav_enabled(shapes.flag(webdav_enabled, "webdav_enabled", False))
    return webdav_settings.site_settings()


@frappe.whitelist(methods=["GET"])
@_route
def webdav_get() -> shapes.WebdavHidden | shapes.WebdavOff | shapes.WebdavConnection:
    """Answer what the WebDAV panel shows the caller: `webdav_config` unchanged."""
    return webdav_settings.webdav_access()


# --------------------------------------------------------------------------
# Everything else under the prefix
# --------------------------------------------------------------------------


@frappe.whitelist(allow_guest=True, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
@_route
def unknown() -> None:
    """Answer any unclaimed address under the prefix in the envelope it expects.

    A path no row claims and a verb no row declares for a path both arrive
    here. Both answer 404: a 405 would confirm to a caller that a path exists,
    and werkzeug's own `NotFound` would answer HTML in a namespace that answers
    JSON everywhere else.
    """
    raise DriveNotFound(_("That Drive address does not exist"))
