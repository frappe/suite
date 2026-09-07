"""MKCOL, DELETE, and MOVE.

Each verb is one call into the shared node workflows, with §12.1's role at the
place that table names it. Nothing here re-checks a collision, a depth, or a
quota: those invariants belong to the workflow and are enforced under its own
row lock.

DELETE maps to Drive's trash, which is recoverable from the web UI. The
resource leaves the DAV namespace either way, and RFC 4918 asks for nothing
more.

MOVE overwrites by trashing the target first, so the destination title is free
and the workflow's collision refusal never fires on a name the client is
entitled to take. No DAV MOVE crosses roots (§12): the namespace is one
Personal Root, and the check below says so rather than relying on that.
"""

import frappe
from werkzeug.wrappers import Response

from suite.drive._core import nodes as node_core
from suite.drive._core.access import require
from suite.drive._core.errors import DriveConflict
from suite.drive._core.roles import EDIT, READ, UPLOAD
from suite.drive.webdav import locks, pathmap
from suite.drive.webdav.conditional import evaluate_preconditions
from suite.drive.webdav.context import DavContext
from suite.drive.webdav.errors import (
    BadRequest,
    Conflict,
    Forbidden,
    MethodNotAllowed,
    NotFoundError,
    PreconditionFailed,
    UnsupportedMediaType,
)
from suite.drive.webdav.settings import allow_header_without


def handle_mkcol(ctx: DavContext) -> Response:
    if ctx.body.read_all(64 * 1024).strip():
        # RFC 4918 §9.3: unknown MKCOL bodies may be refused
        raise UnsupportedMediaType("MKCOL request bodies are not supported.")

    resolved = pathmap.resolve(ctx.segments, ctx.user)
    if resolved.is_mount:
        raise MethodNotAllowed(
            "A resource already exists at this URL.",
            headers={"Allow": allow_header_without("MKCOL")},
        )
    if resolved.exists:
        # READ before the 405. `pathmap` resolves without asking permission, so
        # without this a node the caller cannot see would announce itself here
        # while a free name answers 201. Unreadable is 404 (§12.1).
        require(resolved.node, READ, ctx.principals)
        raise MethodNotAllowed(
            "A resource already exists at this URL.",
            headers={"Allow": allow_header_without("MKCOL")},
        )
    if resolved.missing_intermediate:
        raise Conflict("Intermediate collections do not exist.")

    parent, name = resolved.parent, ctx.segments[-1]
    # UPLOAD on the parent, §12.1's role for MKCOL. Below READ this raises
    # DriveNotFound, so an invisible parent answers 404 rather than telling a
    # stranger that a folder they cannot see is there.
    require(parent, UPLOAD, ctx.principals)
    pathmap.validate_dav_name(name, parent)
    locks.enforce(ctx, membership_parent=parent.name)

    node_core.create_folder(ctx.principals, parent.name, name)
    pathmap.reset_memo()
    return Response(status=201)


def handle_delete(ctx: DavContext) -> Response:
    resolved = pathmap.resolve(ctx.segments, ctx.user)
    if resolved.is_mount:
        raise Forbidden("Cannot delete the WebDAV namespace root.")
    if not resolved.exists:
        raise NotFoundError("Resource not found.")

    row = resolved.node
    require(row, EDIT, ctx.principals)
    # RFC 4918 §9.6.1: a DELETE on a collection carries Depth infinity and
    # nothing else. Unlike MOVE the rule is written for collections only, so a
    # `Depth: 0` on an ordinary file stays legal.
    if resolved.is_collection and ctx.depth is not None and ctx.depth != "infinity":
        raise BadRequest("DELETE on a collection accepts Depth infinity only.")
    evaluate_preconditions(ctx.request, row)
    locks.enforce(
        ctx,
        entity=row.name,
        membership_parent=row.parent,
        check_descendants=resolved.is_collection,
    )

    # trash, not destruction: recoverable from the Drive web UI
    node_core.update(ctx.principals, row.name, state="Trashed")
    locks.drop_locks_under(row.name)
    pathmap.reset_memo()
    return Response(status=204)


def handle_move(ctx: DavContext) -> Response:
    # RFC 4918 §9.9.3: a MOVE carries Depth infinity and nothing else. A client
    # sending `Depth: 0` on a collection means "move the collection alone",
    # which this verb cannot do, so answering it with a whole-subtree move
    # would silently do something other than what was asked.
    if ctx.depth is not None and ctx.depth != "infinity":
        raise BadRequest("MOVE accepts Depth infinity only.")

    source = pathmap.resolve(ctx.segments, ctx.user)
    if source.is_mount:
        raise Forbidden("Cannot move the WebDAV namespace root.")
    if not source.exists:
        raise NotFoundError("Resource not found.")

    row = source.node
    require(row, EDIT, ctx.principals)

    destination, dest_parent, dest_name = resolve_destination(ctx, source)
    evaluate_preconditions(ctx.request, row)
    require(dest_parent, UPLOAD, ctx.principals)
    pathmap.validate_dav_name(dest_name, dest_parent)

    locks.enforce(
        ctx,
        entity=row.name,
        membership_parent=row.parent,
        check_descendants=source.is_collection,
    )
    locks.enforce(ctx, membership_parent=dest_parent.name)

    overwrote = _clear_destination(ctx, destination, source)
    _relocate(ctx, row, dest_parent, dest_name)

    # RFC 4918 §7.5: locks do not move with the resource
    locks.drop_locks_under(row.name)
    pathmap.reset_memo()
    return Response(status=204 if overwrote else 201)


def _relocate(ctx: DavContext, row: frappe._dict, dest_parent: frappe._dict, dest_name: str) -> None:
    """Move, rename, or both, as separate writes the workflow accepts.

    `update` refuses a combined move and rename, so a MOVE that changes both
    is two calls, and either order can collide on a title the other order
    would not: move first needs the source's own title free at the
    destination, rename first needs the destination's title free where the
    node still sits. Neither is more right, so the first order is tried and a
    collision falls back to the other. The savepoint is what makes the retry
    honest: without it a fallback could leave a node renamed where it stands.
    """
    moving = dest_parent.name != row.parent
    renaming = dest_name != row.title
    if not moving and not renaming:
        return
    if not moving:
        node_core.update(ctx.principals, row.name, title=dest_name)
        return
    if not renaming:
        node_core.update(ctx.principals, row.name, parent=dest_parent.name)
        return

    savepoint = f"dav_move_{frappe.generate_hash(length=10)}"
    frappe.db.savepoint(savepoint)
    try:
        try:
            node_core.update(ctx.principals, row.name, parent=dest_parent.name)
            node_core.update(ctx.principals, row.name, title=dest_name)
        except DriveConflict:
            frappe.db.rollback(save_point=savepoint)
            node_core.update(ctx.principals, row.name, title=dest_name)
            node_core.update(ctx.principals, row.name, parent=dest_parent.name)
    except Exception:
        # the fallback's own first leg has to be discarded too. Placing a
        # collection inside itself is refused in both orders, and without this
        # the rename-first order would leave the source renamed where it
        # stands - half of a request the client is told failed.
        frappe.db.rollback(save_point=savepoint)
        raise
    else:
        frappe.db.release_savepoint(savepoint)


def _clear_destination(ctx: DavContext, destination: pathmap.ResolvedPath, source) -> bool:
    """Trash whatever the destination URL names, so the exact title is free."""
    target = destination.node
    if target is None or target.name == source.node.name:
        return False
    # §12.1: the read gate runs first. `require` raises DriveNotFound below
    # READ, so a destination the caller cannot see answers 404 rather than
    # being confirmed by the 412 or the 423 below.
    require(target, READ, ctx.principals)
    if not ctx.overwrite:
        raise PreconditionFailed("Destination exists and Overwrite is F.")
    # EDIT on an overwritten target, the same role DELETE needs
    require(target, EDIT, ctx.principals)
    locks.enforce(ctx, entity=target.name, check_descendants=destination.is_collection)
    node_core.update(ctx.principals, target.name, state="Trashed")
    locks.drop_locks_under(target.name)
    pathmap.reset_memo()
    return True


def resolve_destination(ctx: DavContext, source: pathmap.ResolvedPath):
    """Parse and resolve Destination; return (resolved, parent row, leaf name).

    Shared with COPY, which reads the header the same way (RFC 4918 §9.9).
    """
    segments, _ = pathmap.parse_destination(ctx.request)
    if not segments:
        raise Forbidden("Cannot write to the WebDAV namespace root.")

    destination = pathmap.resolve(segments, ctx.user)
    if destination.missing_intermediate:
        raise Conflict("Destination's parent collection does not exist.")

    parent = destination.parent
    if parent is None:
        # the destination resolved to the mount itself, which `segments`
        # already ruled out, so there is no parentless case left
        raise Conflict("Destination's parent collection does not exist.")

    if destination.node is not None and destination.node.name == source.node.name:
        if segments[-1] == source.node.title:
            raise Forbidden("Source and destination are the same resource.")
        # a case-only rename: the case-insensitive fallback resolved the
        # source itself, and the client still means to change its title

    # §12: no DAV move or copy crosses roots. One mount makes this unreachable
    # from a URL, and it is checked rather than assumed - a second mount, or a
    # Destination the walk resolved elsewhere, must not reach a cross-root
    # rewrite through this door.
    if node_core.root_id(source.node) != node_core.root_id(parent):
        raise Forbidden("A WebDAV move or copy cannot cross Drive roots.")

    # A destination inside the source subtree is refused by the workflow
    # itself, as a cycle, and DriveConflict is already this verb's 409.
    return destination, parent, segments[-1]
