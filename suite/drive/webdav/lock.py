"""LOCK and UNLOCK.

Windows and Office open a new file as LOCK on an unmapped URL, then PUT with
the token, then UNLOCK. RFC 4918 §7.3 replaced lock-null resources with
"create the resource, then lock it", so a LOCK at an unmapped URL creates a
real node with §8.5's empty head: no blob, no bytes, and no charge (§12.3).
An expired unused lock leaves that node exactly as it stands.

Refresh is an empty-body LOCK carrying the token in an If header.
"""

import frappe
from lxml import etree
from werkzeug.wrappers import Response

from suite.drive._core import nodes as node_core
from suite.drive._core.access import chain_ids, effective_role, require
from suite.drive._core.roles import EDIT, READ
from suite.drive.webdav import locks, pathmap
from suite.drive.webdav.context import DavContext
from suite.drive.webdav.errors import (
    BadRequest,
    Conflict,
    Forbidden,
    InsufficientStorage,
    Locked,
    NotFoundError,
    PreconditionFailed,
)
from suite.drive.webdav.xmlutil import (
    XML_BODY_CAP,
    MultistatusBuilder,
    dav,
    dav_element,
    parse_xml,
    xml_response,
)

# DAV:owner is informational (RFC 4918 §14.17); cap it like a dead property so a
# LOCK cannot bloat the lock row or the PROPFIND lockdiscovery reflected to others
MAX_OWNER_XML_BYTES = 64 * 1024


def handle_lock(ctx: DavContext) -> Response:
    resolved = pathmap.resolve(ctx.segments, ctx.user)
    if resolved.is_mount:
        raise Forbidden("Cannot lock the WebDAV namespace root.")

    timeout = locks.parse_timeout_header(ctx.request.headers.get("Timeout"))

    body = parse_xml(ctx.body.read_all(XML_BODY_CAP))
    if body is None:
        # RFC 4918 §9.10.2: "A server MUST ignore the Depth header on a LOCK
        # refresh." A client that puts `Depth: 1` on every request it sends
        # would otherwise lose the lock it is trying to keep.
        return _refresh(ctx, resolved, timeout)

    depth = ctx.depth if ctx.depth is not None else "infinity"
    if depth == "1":
        raise BadRequest("LOCK accepts Depth 0 or infinity only.")
    return _create(ctx, resolved, body, depth, timeout)


def handle_unlock(ctx: DavContext) -> Response:
    resolved = pathmap.resolve(ctx.segments, ctx.user)
    if not resolved.exists or resolved.is_mount:
        raise NotFoundError("Resource not found.")
    # unreadable is indistinguishable from absent - otherwise the 409-vs-404
    # split below is an existence oracle (anti-enumeration, matches other
    # verbs). `require` raises DriveNotFound below READ, which is that answer.
    require(resolved.node, READ, ctx.principals)

    header = ctx.request.headers.get("Lock-Token", "").strip()
    if not header.startswith("<") or not header.endswith(">"):
        raise BadRequest("A Lock-Token header is required.")
    token = header[1:-1]

    lock = locks.find_lock(token)
    if lock is None or not _covers(lock, resolved.node):
        raise Conflict(
            "The token does not identify a lock on this resource.",
            condition="lock-token-matches-request-uri",
        )

    # §12.1: the lock owner, or a Suite Admin
    if lock.owner_user != ctx.user and not ctx.principals.is_admin:
        raise Forbidden("Only the lock owner may unlock this resource.")

    locks.delete_lock(token)
    return Response(status=204)


def _refresh(ctx: DavContext, resolved: pathmap.ResolvedPath, timeout: int) -> Response:
    # an unreadable target answers exactly like an unmapped one (anti-enumeration,
    # as on UNLOCK): the owner-mismatch Forbidden below would otherwise confirm
    # a hidden resource and its lock to anyone holding a leaked token
    if not resolved.exists or effective_role(resolved.node, ctx.principals) < READ:
        raise PreconditionFailed("Nothing to refresh at this URL.")
    # §12.1 gives LOCK on an existing node EDIT, and a refresh is that same
    # LOCK. Gating a refresh on READ alone let a holder whose grant had since
    # been lowered keep the write lock alive for as long as they kept asking,
    # locking the owner out of their own file with a role that cannot write it.
    require(resolved.node, EDIT, ctx.principals)

    submitted = locks.parsed_if(ctx).all_tokens()
    if not submitted:
        raise PreconditionFailed("Refresh requires the lock token in an If header.")

    lock = next(
        (lock for token in submitted if (lock := locks.find_lock(token)) and _covers(lock, resolved.node)),
        None,
    )
    if lock is None:
        raise PreconditionFailed("No submitted token locks this resource.")
    if lock.owner_user != ctx.user:
        raise Forbidden("Only the lock owner may refresh a lock.")

    refreshed = locks.refresh_lock(lock.token, requested_timeout=timeout)
    return _lock_response(refreshed, status=200, with_token_header=False)


def _create(
    ctx: DavContext, resolved: pathmap.ResolvedPath, body: etree._Element, depth: str, timeout: int
) -> Response:
    scope, owner_xml = _parse_lockinfo(body)

    # bound the lock table before anything is created: the unmapped-URL path
    # writes a node, and a user already at the cap must not leave one behind
    # for a lock that is then refused
    if locks.user_active_lock_count(ctx.user) >= locks.MAX_ACTIVE_LOCKS_PER_USER:
        raise InsufficientStorage("Too many active locks; release some before creating more.")

    created = False
    if resolved.exists:
        row = resolved.node
        # §12.1: EDIT on an existing node. Below READ this raises
        # DriveNotFound, so an unreadable target is 404 (anti-enumeration).
        require(row, EDIT, ctx.principals)
        if not resolved.is_collection:
            depth = "0"  # depth is meaningless on a non-collection
    else:
        if ctx.had_trailing_slash:
            raise Conflict("Cannot LOCK an unmapped collection URL.")
        row = _create_empty_resource(ctx, resolved)
        created = True
        depth = "0"

    is_collection = row.kind in ("root", "folder")
    if is_collection and depth == "infinity" and (member := _unlockable_member(ctx, row)) is not None:
        return _hierarchy_refusal(ctx, row, member)

    # RFC 4918 §9.10.5's table refuses an exclusive lock against any lock and a
    # shared one against an exclusive, whoever holds it: "It is illegal for a
    # principal to request the same lock twice." Exempting a lock whose token
    # the caller submitted minted a second token over the same resource, and
    # `locks.enforce` then wanted both: the holder could write with neither
    # until one expired, and UNLOCK of either did not free it.
    conflicts = locks.find_conflicts(row.name, scope=scope, depth=depth, is_collection=is_collection)
    if conflicts:
        raise Locked(
            "The resource is already locked.",
            lock_root=conflicts[0].lock_root,
            condition="no-conflicting-lock",
        )

    lock = locks.create_lock(
        row.name,
        scope=scope,
        depth=depth,
        owner_user=ctx.user,
        owner_xml=owner_xml,
        requested_timeout=timeout,
        lock_root=pathmap.href_for(ctx.segments, is_collection),
    )
    return _lock_response(lock, status=201 if created else 200, with_token_header=True)


def _unlockable_member(ctx: DavContext, collection: frappe._dict) -> frappe._dict | None:
    """The first member of this collection the caller may not lock (§9.10.3).

    RFC 4918 §9.10.3: "If the lock cannot be granted to all resources, the
    server MUST return a Multi-Status response ... Either the entire hierarchy
    is locked or no resources are locked."

    A depth-infinity lock reaches every descendant - `locks._coverage` walks
    the materialised ancestry - so EDIT on the collection alone hands out a
    lock the server then refuses to honour: §5.1's nearest-wins lets a deeper
    grant lower the caller inside their own root, and the PUT that submits the
    token answers 403 on a resource the LOCK said it had taken.

    Only a member carrying a `Drive Grant` row of its own can answer
    differently from the collection. A member with no row of its own takes its
    nearest granted ancestor's answer, and every granted node in the subtree is
    checked here, so the ordinary subtree - no grants below the collection -
    costs one indexed query and resolves nothing.
    """
    granted = frappe.db.sql(
        """SELECT DISTINCT n.name
        FROM `tabDrive Node` n
        JOIN `tabDrive Grant` g ON g.node = n.name
        WHERE n.state = 'Active' AND n.root = %(root)s AND n.path LIKE %(prefix)s""",
        values={
            "root": node_core.root_id(collection),
            "prefix": node_core.child_path(collection) + "%",
        },
    )
    for (name,) in granted:
        member = pathmap.fetch(name)
        if member is not None and effective_role(member, ctx.principals) < EDIT:
            return member
    return None


def _hierarchy_refusal(ctx: DavContext, collection: frappe._dict, member: frappe._dict) -> Response:
    """RFC 4918 §9.10.3's 207: the member that refused, then the Request-URI.

    §9.10.9's example is this shape - 403 on the resource that prevented the
    lock, 424 Failed Dependency on the URL the client asked to lock - and no
    lock is created, because partial success is not an option for LOCK.
    """
    builder = MultistatusBuilder()
    builder.add_response(_member_href(ctx, collection, member)).status(403)
    builder.add_response(pathmap.href_for(ctx.segments, True)).status(424)
    return builder.build()


def _member_href(ctx: DavContext, collection: frappe._dict, member: frappe._dict) -> str:
    """The member's own URL, built from the segments the client named."""
    chain = chain_ids(member)
    below = chain[chain.index(collection.name) + 1 :]
    titles = {
        row.name: row.title
        for row in frappe.get_all("Drive Node", filters={"name": ["in", below]}, fields=["name", "title"])
    }
    return pathmap.href_for(
        [*ctx.segments, *(titles.get(node, node) for node in below)],
        member.kind in ("root", "folder"),
    )


def _parse_lockinfo(body: etree._Element) -> tuple[str, str | None]:
    if body.tag != dav("lockinfo"):
        raise BadRequest("Expected a DAV:lockinfo request body.")

    locktype = body.find(dav("locktype"))
    if locktype is None or locktype.find(dav("write")) is None:
        raise PreconditionFailed("Only write locks are supported.")

    lockscope = body.find(dav("lockscope"))
    if lockscope is None:
        raise BadRequest("Missing DAV:lockscope.")
    if lockscope.find(dav("exclusive")) is not None:
        scope = "Exclusive"
    elif lockscope.find(dav("shared")) is not None:
        scope = "Shared"
    else:
        raise BadRequest("Unknown lock scope.")

    owner = body.find(dav("owner"))
    owner_xml = etree.tostring(owner, encoding="unicode") if owner is not None else None
    if owner_xml and len(owner_xml.encode("utf-8")) > MAX_OWNER_XML_BYTES:
        raise BadRequest("DAV:owner element is too large.")
    return scope, owner_xml


def _create_empty_resource(ctx: DavContext, resolved: pathmap.ResolvedPath) -> frappe._dict:
    """§12.3's lock-null replacement: an empty Active node under UPLOAD.

    RFC 4918 §7.3 dropped lock-null resources in favour of "create the
    resource, then lock it", and Windows and Office open a new file that way.
    The node holds no blob at all, so nothing is stored and nothing is
    charged; if the lock expires with no PUT, the empty node stays [009 §6].
    """
    if resolved.missing_intermediate or resolved.parent is None:
        raise Conflict(pathmap.MISSING_PARENT)
    parent, name = resolved.parent, ctx.segments[-1]
    # §12.1: UPLOAD on the parent for a LOCK at an unmapped URL. Below READ
    # this is 409, the answer an absent parent already gets (RFC 4918 §9.10.6),
    # so a lock request cannot name a folder the caller cannot see.
    pathmap.require_create_parent(parent, ctx.principals)
    pathmap.validate_dav_name(name, parent)
    locks.enforce(ctx, membership_parent=parent.name)

    node = node_core.create_empty_file(ctx.principals, parent.name, name)
    pathmap.reset_memo()
    return pathmap.fetch(node)


def _covers(lock: locks.LockInfo, row: frappe._dict) -> bool:
    """Whether one lock reaches this node - itself, or a depth-infinity
    ancestor. §3.1 materialises the ancestry on the row, so the chain costs
    nothing beyond the row already in hand."""
    if lock.entity == row.name:
        return True
    return lock.depth == "infinity" and lock.entity in chain_ids(row)[:-1]


def _lock_response(lock: locks.LockInfo, status: int, with_token_header: bool) -> Response:
    prop = dav_element("prop", locks.lockdiscovery_xml([lock]))
    response = xml_response(prop, status=status)
    if with_token_header:
        response.headers["Lock-Token"] = f"<{lock.token}>"
    return response
