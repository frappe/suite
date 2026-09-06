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

Two things a client may not say. It may not name bytes that reach accounting:
`POST /nodes` takes §11.2's declared `blob`, `size`, and `mime`, and they are
claims `create_file` checks against the stored blob row before it writes or
charges anything - every other route reaches bytes only through an upload
session, which §8.4 makes the proof that the caller produced them. And it may
not name a target twice: the translator writes the path segments into
`form_dict` after the body was parsed, so the id in the URL is the id that
acts.
"""

import base64
import binascii
import functools
import unicodedata
from urllib.parse import quote
from uuid import uuid4

import frappe
from frappe import _
from werkzeug.wrappers import Response

from suite.drive import framework
from suite.drive._core import access, comments, content, previews, roots, versions
from suite.drive._core import activity as activity_core
from suite.drive._core import nodes as node_core
from suite.drive._core import upload as upload_core
from suite.drive._core.access import describe
from suite.drive._core.errors import DriveConflict, DriveError, DriveLocked, DriveNotFound
from suite.drive.http import shapes

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
            _refuse(type(refusal), str(refusal))
        except frappe.RateLimitExceededError:
            # 429, and already carrying its message: §6.3 locks a link out for
            # fifteen minutes after five wrong passwords, and the caller has to
            # be able to tell that apart from a wrong password. The clause
            # below would flatten it to 400 with every other bad argument.
            raise
        except frappe.DoesNotExistError as missing:
            # A row a workflow reached for is gone. The framework already
            # scores this 404; §11.6 spells that `DriveNotFound`.
            _refuse(DriveNotFound, str(missing))
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
    parent: Given = None,
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
) -> dict:
    """Create one node of any kind a client may create below `parent` (§8.3).

    `blob`, `size`, and `mime` are §11.2's declared body, and they are claims
    the workflow checks, not values it stores. `create_file` re-reads the blob
    row, refuses unless the declared size and mime match it, writes the node
    from the stored values, and charges the root the stored size.
    """
    principals = _principals()
    created = node_core.create(
        principals,
        shapes.required_text(parent, "parent"),
        shapes.required_text(title, "title"),
        kind=shapes.required_text(kind, "kind"),
        blob=shapes.text(blob, "blob"),
        size=None if size is None else shapes.whole(size, "size", 0),
        mime=shapes.text(mime, "mime"),
        content_modified=content_modified,
        url=shapes.text(url, "url"),
        content_doctype=shapes.text(content_doctype, "content_doctype"),
        from_node=shapes.text(from_node, "from_node"),
        is_template=shapes.flag(is_template, "is_template", False),
    )
    return shapes.node_shape(node_core.stored(created))


@frappe.whitelist(allow_guest=True, methods=["GET"])
@_route
def node_get(node: Given = None, expand: Given = None) -> dict:
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
    node: Given = None,
    title: Given = None,
    parent: Given = None,
    state: Given = None,
    content_modified: Given = None,
) -> dict:
    """Rename, move, trash, restore, or stamp one node (§8.2).

    §11.2 gives this route five whole bodies and no more: `{title}`,
    `{parent}`, `{state}`, `{parent, state: "Active"}`, and
    `{content_modified}`. `update` takes exactly one of them, and two at once
    is a `ValidationError`.

    Bytes are not among them. A file head is replaced through
    `PUT /nodes/<id>/content`, which names an upload session the caller
    finished, so this route never takes a blob id.

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
def node_purge(node: Given = None) -> dict:
    """Permanently remove one subtree. MANAGE only, so never a link holder."""
    purged = node_core.purge(_principals(), shapes.required_text(node, "node"))
    return {"purged": purged}


@frappe.whitelist(allow_guest=True, methods=["GET"])
@_route
def node_children(
    node: Given = None,
    limit: Given = None,
    cursor: Given = None,
    order_by: Given = None,
    ascending: Given = None,
    mime_prefix: Given = None,
    expand: Given = None,
) -> dict:
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
    if "breadcrumbs" in asked and rows:
        # Every row in the page shares one parent, so the trail is the listed
        # folder's own trail with the folder itself appended. `children`
        # already read and authorized that folder: reading it again would let
        # a grant revoked mid-request 404 a page the plain listing answered.
        listed = result["parent"]
        trail = [*node_core.breadcrumbs(listed, principals), {"name": listed.name, "title": listed.title}]
        for answer in rows:
            answer["breadcrumbs"] = list(trail)
    return shapes.page(result, rows)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def node_copy(node: Given = None, parent: Given = None, title: Given = None) -> dict:
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
def node_batch(nodes: Given = None, patch: Given = None) -> dict:
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
        content_modified=content_modified,
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
    parent: Given = None,
    filename: Given = None,
    size: Given = None,
    mime: Given = None,
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
    parent: Given = None,
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
def root_usage(root: Given = None) -> dict:
    """Report one root's counters to its own user, its managers, or an admin."""
    return dict(roots.usage_for(shapes.required_text(root, "root"), _principals()))


@frappe.whitelist(methods=["PATCH"])
@_route
def root_patch(
    root: Given = None,
    quota_bytes: Given = None,
    state: Given = None,
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
def root_purge(root: Given = None) -> dict:
    """Purge one Archived root pair and everything below it. Suite Admin only."""
    return dict(roots.purge_root(shapes.required_text(root, "root"), _principals()))


# --------------------------------------------------------------------------
# Grants, links, publishing
# --------------------------------------------------------------------------


@frappe.whitelist(methods=["GET"])
@_route
def node_grants(node: Given = None, principal: Given = None) -> dict:
    """Answer one node's local grants, and optionally one explanation (§11.2).

    `?principal=` is the accepted spelling of §5.8's `explain`. MANAGE on the
    target is what the caller needs, and it is checked before the named
    principal is even resolved: whether that person can reach the node is the
    question being asked, never a condition on the right to ask it.

    No session, no answer. A link caps at EDIT (§5.9) and `$PUBLIC` at READ, so
    no principal a Guest can present ever reaches MANAGE, and hearing the call
    would only let an anonymous caller probe for node ids.
    """
    principals = _principals()
    named = shapes.text(principal, "principal")
    subject = framework.principals_for_principal(named) if named else None
    answer = access.grants_for(
        shapes.required_text(node, "node"),
        principals,
        subject=subject,
    )
    shaped = {"grants": [shapes.grant_shape(row) for row in answer["grants"]]}
    if "explain" in answer:
        shaped["explain"] = shapes.explain_shape(answer["explain"])
    return shaped


@frappe.whitelist(methods=["PUT"])
@_route
def node_put_grant(
    node: Given = None,
    principal: Given = None,
    role: Given = None,
    expires_on: Given = None,
    password: Given = None,
) -> dict:
    """Write one grant, including an explicit deny and a new share link (§5.9).

    `role` is required and is never defaulted. Every one of §5.9's twelve
    refusals belongs to the workflow, including the five §11.2 restates, so
    this route pre-checks none of them: a pre-check here would answer before
    the MANAGE gate and tell a caller without it which rule they broke.

    `role: 0` is the explicit deny, and it is the only way to write one.
    Publishing is this route with principal `$PUBLIC` and `role: 10`. There is
    no separate publish verb (§6.5).

    §5.9 step 3 upserts all three columns, so this is a replace and not a
    patch: a link keeps its password and its expiry only while the caller keeps
    sending them.
    """
    if role is None:
        frappe.throw(_("Drive argument role is required"), frappe.ValidationError)
    written = access.grant(
        shapes.required_text(node, "node"),
        shapes.required_text(principal, "principal"),
        shapes.whole(role, "role", 0),
        _principals(),
        expires_on=expires_on,
        password=shapes.text(password, "password"),
    )
    return _grant_answer(written)


@frappe.whitelist(methods=["DELETE"])
@_route
def node_delete_grant(node: Given = None, principal: Given = None, below: Given = None) -> dict:
    """Remove this principal's local grant, or every grant below it (§5.10).

    Removal is never a denial. This writes no row of its own: access inherited
    from an ancestor survives it, and `GET /nodes/<id>/grants?principal=` is
    what shows the caller what is left. Denying takes `PUT` with `role: 0`.

    `?below=1` is `revoke_below`, the eviction the creator grant makes
    necessary (§4.5): a creator grant sits under the folder being revoked at,
    and nearest-wins would keep it alive.
    """
    principals = _principals()
    wanted = shapes.required_text(node, "node")
    named = shapes.required_text(principal, "principal")
    if shapes.flag(below, "below", False):
        return {"result": "revoked", "rows": access.revoke_below(wanted, named, principals)}
    access.revoke(wanted, named, principals)
    return {"result": "revoked"}


@frappe.whitelist(methods=["POST"])
@_route
def grant_rotate(grant: Given = None) -> dict:
    """Mint a new token for one share link, keeping everything else (§5.11).

    The address is the `Drive Grant` id, not the old token: rotation is a
    management act on a row, and naming the token in the URL would put the
    secret being replaced into the access log.
    """
    return _grant_answer(access.rotate_link(shapes.required_text(grant, "grant"), _principals()))


def _grant_answer(written: dict) -> dict:
    """Split §11.2's `{grant, url?}`: the row, and the link URL beside it."""
    answer = {"grant": shapes.grant_shape(written)}
    if written.get("url"):
        answer["url"] = written["url"]
    return answer


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def link_unlock(token: Given = None, password: Given = None) -> dict:
    """Trade one link password for the stateless 30-day ticket of §4.8.

    No role is needed and no row is written: the password is the whole proof,
    and the ticket is an HMAC over the token, the stored hash, and an expiry,
    so a password change or a rotation kills every ticket at once.

    Guest-reachable, because unlocking is what a caller does before they have
    any access at all. Five failures in fifteen minutes lock the token out and
    answer 429, which the boundary keeps distinct from a wrong password (§6.3).
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
    expand: Given = None,
) -> dict:
    """Page one of §11.2's seven frozen discovery views.

    Session only. Five of the seven are answered from the caller's own
    principals and the other two are their private lists, so a Guest has
    nothing to be shown here and a shared `Guest` recents list would be one
    list for every anonymous visitor on the site.

    `expand=preview` is the one expansion a view can answer: the page's ids are
    already permission-filtered, so the URLs cost one query for the whole page
    (§9.2). `access` and `breadcrumbs` are refused rather than faked - the
    first needs the grant rows the view query does not collect, the second
    costs an ancestry read per row.

    `archived-roots` answers root metadata, not nodes (§5.5), so its rows are
    passed through as they are.
    """
    principals = _principals()
    name = shapes.required_text(view, "view")
    asked = shapes.expansions(expand)
    unsupported = sorted(asked - {"preview"})
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
        **_view_filters(name, root, content_doctype, term),
    )
    if name == "archived-roots":
        return shapes.page(result, [dict(row) for row in result["rows"]])
    rows = [shapes.node_shape(row) for row in result["rows"]]
    if "preview" in asked:
        minted = previews.preview_expansions([row["name"] for row in rows])
        for answer in rows:
            answer["preview"] = minted.get(answer["name"])
    return shapes.page(result, rows)


def _view_filters(name: str, root: Given, content_doctype: Given, term: Given) -> dict:
    """Pass each view only the filters §11.2 declares for it.

    Forwarding every argument to every view would let `?term=` reach `trash`
    and be silently ignored, which reads to a client as a filter that did not
    work rather than an argument that does not exist.
    """
    if name == "trash":
        return {"root": shapes.required_text(root, "root")}
    if name == "templates":
        return {"content_doctype": shapes.text(content_doctype, "content_doctype")}
    if name == "search":
        return {"term": shapes.required_text(term, "term")}
    return {}


@frappe.whitelist(methods=["DELETE"])
@_route
def view_clear_recents(nodes: Given = None) -> dict:
    """Clear the caller's own recents, and never their favourites (§9.5)."""
    named = None if nodes is None else shapes.name_list(nodes, "nodes")
    return {"cleared": activity_core.clear_recents(_principals(), named)}


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


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def node_version_create(node: Given = None, kind: Given = None, label: Given = None) -> dict:
    """Store the node's current bytes as a version and answer its sequence.

    `kind` and `label` are §9.1's own arguments: `auto` is what a save path
    takes, and a person naming or pinning a milestone takes `named` or
    `milestone`. Which kinds exist is the workflow's rule, not this route's.
    """
    seq = versions.take_version(
        _principals(),
        shapes.required_text(node, "node"),
        kind=shapes.text(kind, "kind") or "auto",
        label=shapes.text(label, "label"),
    )
    return {"seq": seq}


@frappe.whitelist(allow_guest=True, methods=["PATCH"])
@_route
def node_version_patch(
    node: Given = None,
    seq: Given = None,
    label: Given = None,
    pinned: Given = None,
) -> dict:
    """Set the two mutable fields of an otherwise immutable version (§9.1)."""
    principals = _principals()
    wanted = shapes.sequence(seq, "seq")
    keep = shapes.flag(pinned, "pinned", False)
    named = shapes.text(label, "label")
    versions.label_version(
        principals,
        shapes.required_text(node, "node"),
        wanted,
        label=named,
        pinned=keep,
    )
    return {"label": named, "pinned": int(keep)}


@frappe.whitelist(methods=["DELETE"])
@_route
def node_version_delete(node: Given = None, seq: Given = None) -> dict:
    """Delete one version and release its bytes. MANAGE, so never a link."""
    versions.delete_version(
        _principals(),
        shapes.required_text(node, "node"),
        shapes.sequence(seq, "seq"),
    )
    return {}


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
def node_version_restore(node: Given = None, seq: Given = None) -> dict:
    """Restore one version, answering the sequence taken first (§9.1).

    Restore is never destructive: the workflow captures the current state as a
    version before it writes, and that captured sequence is what comes back.
    """
    return {
        "seq": versions.restore_version(
            _principals(),
            shapes.required_text(node, "node"),
            shapes.sequence(seq, "seq"),
        )
    }


# --------------------------------------------------------------------------
# Threads and comments
# --------------------------------------------------------------------------


@frappe.whitelist(allow_guest=True, methods=["GET"])
@_route
def node_threads(node: Given = None, resolved: Given = None) -> dict:
    """List one readable document's comment threads and their comments."""
    return {
        "threads": [
            shapes.thread_shape(row)
            for row in comments.threads(
                _principals(),
                shapes.required_text(node, "node"),
                resolved=None
                if resolved is None or resolved == ""
                else shapes.flag(resolved, "resolved", False),
            )
        ]
    }


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def node_thread_create(
    node: Given = None,
    anchor: Given = None,
    text: Given = None,
    author_name: Given = None,
) -> dict:
    """Open one thread and its first comment in one write (§9.3).

    The anchor is opaque here: Drive stores and lists it, and the content app
    resolves it on screen. The author is the server's to set - a guest supplies
    only the display name they typed, never the identity (§6.7).
    """
    return comments.create_thread(
        _principals(),
        shapes.required_text(node, "node"),
        shapes.required_text(anchor, "anchor"),
        shapes.required_text(text, "text"),
        author_name=shapes.text(author_name, "author_name"),
    )


@frappe.whitelist(allow_guest=True, methods=["PATCH"])
@_route
def thread_patch(thread: Given = None, resolved: Given = None) -> dict:
    """Resolve or reopen one thread. COMMENT, and idempotent (§9.3)."""
    if resolved is None:
        frappe.throw(_("Drive argument resolved is required"), frappe.ValidationError)
    wanted = shapes.flag(resolved, "resolved", False)
    comments.resolve(_principals(), shapes.required_text(thread, "thread"), wanted)
    return {"resolved": wanted}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@_route
def thread_comment_create(
    thread: Given = None,
    text: Given = None,
    author_name: Given = None,
) -> dict:
    """Append one comment to an existing thread. COMMENT on its node."""
    return {
        "comment": comments.reply(
            _principals(),
            shapes.required_text(thread, "thread"),
            shapes.required_text(text, "text"),
            author_name=shapes.text(author_name, "author_name"),
        )
    }


@frappe.whitelist(allow_guest=True, methods=["PATCH"])
@_route
def comment_patch(comment: Given = None, text: Given = None) -> dict:
    """Rewrite one comment's body. EDIT on the node, or being its author."""
    comments.edit_comment(
        _principals(),
        shapes.required_text(comment, "comment"),
        shapes.required_text(text, "text"),
    )
    return {}


@frappe.whitelist(allow_guest=True, methods=["DELETE"])
@_route
def comment_delete(comment: Given = None) -> dict:
    """Delete one comment. EDIT on the node, or being its author."""
    comments.delete_comment(_principals(), shapes.required_text(comment, "comment"))
    return {}


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
def node_visit(node: Given = None) -> dict:
    """Record that the caller opened this node. One Recent, no Activity."""
    activity_core.visit(_principals(), shapes.required_text(node, "node"))
    return {}


@frappe.whitelist(methods=["PUT"])
@_route
def node_put_favourite(node: Given = None) -> dict:
    """Star one readable node for the caller alone."""
    activity_core.set_favourite(_principals(), shapes.required_text(node, "node"), True)
    return {}


@frappe.whitelist(methods=["DELETE"])
@_route
def node_delete_favourite(node: Given = None) -> dict:
    """Unstar one node for the caller alone.

    Clearing takes no check on the node, deliberately: a star on something the
    caller stopped being able to read would otherwise be a mark they can
    neither see nor remove.
    """
    activity_core.set_favourite(_principals(), shapes.required_text(node, "node"), False)
    return {}


# --------------------------------------------------------------------------
# Notifications
# --------------------------------------------------------------------------


@frappe.whitelist(methods=["GET"])
@_route
def notifications_list(limit: Given = None, cursor: Given = None, unread: Given = None) -> dict:
    """Page the caller's own inbox. A notification points at one activity row."""
    result = activity_core.notifications(
        _principals(),
        only_unread=shapes.flag(unread, "unread", False),
        cursor=shapes.text(cursor, "cursor") or None,
        limit=shapes.whole(limit, "limit", node_core.DEFAULT_PAGE_SIZE),
    )
    return shapes.page(result, [shapes.notification_shape(row) for row in result["rows"]])


@frappe.whitelist(methods=["POST"])
@_route
def notifications_read(notifications: Given = None, all: Given = None) -> dict:
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
    return {"read": activity_core.mark_read(_principals(), named)}


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
