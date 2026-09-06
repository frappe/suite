"""One whitelisted handler per row of §11.2's node, upload, and root tables.

A handler does four things and nothing else: it declares its verb and whether a
guest may reach it, it builds the caller's principals once from the session and
this request's `X-Drive-Links` header, it calls one private Drive workflow, and
it shapes what came back. Every refusal, every role check, and every byte
charge belongs to the workflow.

`@frappe.whitelist(methods=[...])` is the second gate, not the first. The
translator will only route a verb its table names, so this decorator is what
refuses the same call made straight at the v2 method URL.

`allow_guest=True` means "a caller with no session may be *heard* here",
because a share link is presented by a Guest (§6.2). It never means the call is
allowed: `access.require` decides that from the principals, and answers a
caller below READ with 404 rather than 403 so an unreadable node stays
invisible (§5.2).

Two things a client may not say. It may not name bytes: no route takes a blob
id, a blob key, a preview id, or a size that reaches accounting, because
§8.4 makes the upload session the only proof that the caller produced the bytes
being charged. And it may not name a target twice: the translator writes the
path segments into `form_dict` after the body was parsed, so the id in the URL
is the id that acts.
"""

import base64
import binascii
import functools
from uuid import uuid4

import frappe
from frappe import _
from werkzeug.wrappers import Response

from suite.drive import framework
from suite.drive._core import content, previews, roots
from suite.drive._core import nodes as node_core
from suite.drive._core import upload as upload_core
from suite.drive._core.access import describe
from suite.drive._core.errors import DriveConflict, DriveError, DriveLocked, DriveNotFound
from suite.drive.http import shapes


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
            _refuse(type(refusal), str(refusal))
        except frappe.ValidationError as invalid:
            _refuse(DriveError, str(invalid))

    return answered


def _refuse(kind: type, message: str) -> None:
    if kind is DriveLocked:
        # `process_response` puts an OAuth Bearer challenge on any 401 when
        # resource metadata is enabled, and merges `response_headers` after it.
        # A password link is opened at POST /links/<token>/unlock, not by
        # logging in, so name that instead of inviting a browser login prompt.
        frappe.local.response_headers["WWW-Authenticate"] = 'DriveLink realm="drive"'
    frappe.throw(message, kind)


def _principals():
    return framework.principals_for_request()


# --------------------------------------------------------------------------
# Nodes
# --------------------------------------------------------------------------


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def node_create(
    parent: str | None = None,
    title: str | None = None,
    kind: str | None = None,
    url: str | None = None,
    content_doctype: str | None = None,
    from_node: str | None = None,
    is_template: str | bool | None = None,
) -> dict:
    """Create one folder, link, or content document below `parent` (§8.3)."""
    principals = _principals()
    created = node_core.create(
        principals,
        shapes.required_text(parent, "parent"),
        shapes.required_text(title, "title"),
        kind=shapes.required_text(kind, "kind"),
        url=shapes.text(url, "url"),
        content_doctype=shapes.text(content_doctype, "content_doctype"),
        from_node=shapes.text(from_node, "from_node"),
        is_template=shapes.flag(is_template, "is_template", False),
    )
    return shapes.node_shape(node_core.stored(created))


@frappe.whitelist(allow_guest=True, methods=["GET"])
@_route
def node_get(node: str | None = None, expand: str | None = None) -> dict:
    """Answer one readable node, with the expansions the caller asked for."""
    principals = _principals()
    asked = shapes.expansions(expand)
    row = node_core.get(principals, shapes.required_text(node, "node"))
    answer = shapes.node_shape(row)
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
    node: str | None = None,
    title: str | None = None,
    parent: str | None = None,
    state: str | None = None,
    content_modified: str | int | float | None = None,
) -> dict:
    """Rename, move, trash, or restore one node (§8.2).

    A restore whose original parent chain is gone carries both `parent` and
    `state: "Active"`: the destination is the user's choice, and `_restore`
    answers `DriveConflict` when it is missing rather than picking one.
    """
    principals = _principals()
    return shapes.node_shape(
        node_core.update(
            principals,
            shapes.required_text(node, "node"),
            title=shapes.text(title, "title"),
            parent=shapes.text(parent, "parent"),
            state=shapes.text(state, "state"),
            content_modified=content_modified,
        )
    )


@frappe.whitelist(methods=["DELETE"])
@_route
def node_purge(node: str | None = None) -> dict:
    """Permanently remove one subtree. MANAGE only, so never a link holder."""
    purged = node_core.purge(_principals(), shapes.required_text(node, "node"))
    return {"purged": purged}


@frappe.whitelist(allow_guest=True, methods=["GET"])
@_route
def node_children(
    node: str | None = None,
    limit: str | int | None = None,
    cursor: str | None = None,
    order_by: str | None = None,
    ascending: str | bool | None = None,
    mime_prefix: str | None = None,
    expand: str | None = None,
) -> dict:
    """Page one folder's readable children in §11.4's opaque-cursor envelope."""
    principals = _principals()
    asked = shapes.expansions(expand)
    parent = shapes.required_text(node, "node")
    result = node_core.children(
        principals,
        parent,
        cursor=shapes.text(cursor, "cursor"),
        limit=shapes.whole(limit, "limit", node_core.DEFAULT_PAGE_SIZE),
        order_by=shapes.text(order_by, "order_by") or "title",
        ascending=shapes.flag(ascending, "ascending", True),
        mime_prefix=shapes.text(mime_prefix, "mime_prefix"),
        with_access="access" in asked,
    )
    rows = [shapes.node_shape(row) for row in result["rows"]]
    if "access" in asked:
        for answer, row in zip(rows, result["rows"], strict=True):
            answer["access"] = row.access
    if "preview" in asked:
        minted = previews.preview_expansions([row["name"] for row in rows])
        for answer in rows:
            answer["preview"] = minted.get(answer["name"])
    if "breadcrumbs" in asked:
        # Every row in the page shares one parent, so the trail is the listed
        # folder's own trail with the folder itself appended.
        listed = node_core.get(principals, parent)
        trail = [*node_core.breadcrumbs(listed, principals), {"name": listed.name, "title": listed.title}]
        for answer in rows:
            answer["breadcrumbs"] = trail
    return shapes.page(result, rows)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def node_copy(node: str | None = None, parent: str | None = None, title: str | None = None) -> dict:
    """Copy one readable tree into `parent`, sharing blobs but no authority."""
    principals = _principals()
    copied = node_core.copy(
        principals,
        shapes.required_text(node, "node"),
        shapes.required_text(parent, "parent"),
        title=shapes.text(title, "title"),
    )
    return shapes.node_shape(node_core.stored(copied))


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def node_batch(nodes: list | None = None, patch: dict | None = None) -> dict:
    """Apply one patch to many nodes, isolating each failure (§11.5).

    Partial success is a result, not an error, so the response is 200. Each
    node runs inside its own savepoint: a refusal rolls back that node's rows
    and its activity row and leaves every other node's write standing, which is
    what makes "one activity row per node that moved" true.

    A refusal is reported. Anything else is a defect, and is left to abort the
    request rather than be flattened into a per-node message.
    """
    principals = _principals()
    asked = shapes.identifiers(nodes, "nodes")
    mutation = shapes.patch(patch, "patch")
    ok: list[str] = []
    failed: list[dict] = []
    for node in asked:
        savepoint = f"drive_http_batch_{uuid4().hex[:12]}"
        frappe.db.savepoint(savepoint)
        try:
            node_core.update(
                principals,
                node,
                title=shapes.text(mutation.get("title"), "title"),
                parent=shapes.text(mutation.get("parent"), "parent"),
                state=shapes.text(mutation.get("state"), "state"),
                content_modified=mutation.get("content_modified"),
            )
        except frappe.ValidationError as refusal:
            frappe.db.rollback(save_point=savepoint)
            kind = type(refusal) if isinstance(refusal, DriveError) else DriveError
            failed.append({"node": node, "type": kind.__name__, "message": str(refusal)})
        else:
            frappe.db.release_savepoint(savepoint)
            ok.append(node)
    return {"ok": ok, "failed": failed}


@frappe.whitelist(allow_guest=True, methods=["PUT"])
@_route
def node_put_content(
    node: str | None = None,
    upload_id: str | None = None,
    checksum: str | None = None,
    content_modified: str | int | float | None = None,
) -> dict:
    """Replace one file's bytes from the caller's own finished upload session."""
    principals = _principals()
    replaced = upload_core.finish_upload(
        principals,
        shapes.required_text(upload_id, "upload_id"),
        checksum=shapes.text(checksum, "checksum"),
        content_modified=content_modified,
        replaces=shapes.required_text(node, "node"),
    )
    return shapes.node_shape(node_core.stored(replaced))


@frappe.whitelist(allow_guest=True, methods=["GET"])
@_route
def node_get_content(node: str | None = None, format: str | None = None) -> Response:
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
        minted = node_core.content_url(principals, wanted)
        answer = Response(status=302)
        answer.headers["Location"] = minted["url"]
        answer.headers["Cache-Control"] = "private, no-store"
        return answer

    if row.kind == "document":
        stream, mime, filename = content.export_document(principals, wanted, shapes.text(format, "format"))
        answer = Response(stream, mimetype=mime)
        answer.headers.set("Content-Disposition", "attachment", filename=filename)
        answer.headers["Cache-Control"] = "private, no-store"
        return answer

    raise DriveConflict(_("This Drive node has no content to send"))


@frappe.whitelist(allow_guest=True, methods=["GET"])
@_route
def node_media(node: str | None = None) -> dict:
    """List one readable document's media with signed 15-minute URLs (§6.8)."""
    return {"media": content.list_media(_principals(), shapes.required_text(node, "node"))}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def node_preview(node: str | None = None, image: str | None = None, mime: str | None = None) -> dict:
    """Replace one document's preview with an image its app rendered (§9.2)."""
    principals = _principals()
    wanted = shapes.required_text(node, "node")
    try:
        pixels = base64.b64decode(shapes.required_text(image, "image"), validate=True)
    except (binascii.Error, ValueError):
        frappe.throw(_("Drive argument image is invalid"), frappe.ValidationError)
    previews.push_preview(principals, wanted, pixels, shapes.required_text(mime, "mime"))
    return {"preview": previews.preview_expansions([wanted]).get(wanted)}


# --------------------------------------------------------------------------
# Uploads
# --------------------------------------------------------------------------


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def upload_create(
    parent: str | None = None,
    filename: str | None = None,
    size: str | int | None = None,
    mime: str | None = None,
) -> dict:
    """Open one private blob session, refusing on the declared size (§11.2).

    The refusal is `DriveOverQuota`, never a permission error: a caller who may
    upload here and has no room is told which of the two is missing.
    """
    return upload_core.create_upload(
        _principals(),
        shapes.required_text(parent, "parent"),
        shapes.required_text(filename, "filename"),
        shapes.whole(size, "size", 0),
        mime=shapes.text(mime, "mime"),
    )


@frappe.whitelist(allow_guest=True, methods=["PUT"])
@_route
def upload_chunk(upload_id: str | None = None, offset: str | int | None = None) -> dict:
    """Write one bounded chunk of a bound session at `?offset=`."""
    return upload_core.upload_chunk(
        _principals(),
        shapes.required_text(upload_id, "upload_id"),
        shapes.whole(offset, "offset", 0),
        _chunk_bytes(),
    )


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def upload_finish(
    upload_id: str | None = None,
    parent: str | None = None,
    title: str | None = None,
    checksum: str | None = None,
    content_modified: str | int | float | None = None,
    replaces: str | None = None,
) -> dict:
    """Turn one finished session into a new file, or into a replacement head."""
    principals = _principals()
    node = upload_core.finish_upload(
        principals,
        shapes.required_text(upload_id, "upload_id"),
        parent=shapes.text(parent, "parent"),
        title=shapes.text(title, "title"),
        checksum=shapes.text(checksum, "checksum"),
        content_modified=content_modified,
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
def root_usage(root: str | None = None) -> dict:
    """Report one root's counters to its own user, its managers, or an admin."""
    return dict(roots.usage_for(shapes.required_text(root, "root"), _principals()))


@frappe.whitelist(methods=["PATCH"])
@_route
def root_patch(
    root: str | None = None,
    quota_bytes: str | int | None = None,
    state: str | None = None,
) -> dict:
    """Apply exactly one Suite Admin change to one root's metadata."""
    wanted = shapes.required_text(root, "root")
    quota = None if quota_bytes is None else shapes.whole(quota_bytes, "quota_bytes", 0)
    return dict(
        roots.update_root(
            wanted,
            _principals(),
            quota_bytes=quota,
            state=shapes.text(state, "state"),
        )
    )


@frappe.whitelist(methods=["DELETE"])
@_route
def root_purge(root: str | None = None) -> dict:
    """Purge one Archived root pair and everything below it. Suite Admin only."""
    return dict(roots.purge_root(shapes.required_text(root, "root"), _principals()))


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
