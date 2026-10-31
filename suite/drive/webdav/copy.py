"""COPY.

One call into §8.9's copy primitive, the same one "new from template" and
"duplicate this deck" use. Blobs are shared, so no byte is copied; grants,
versions and comments are not carried; dead properties are cloned by the
workflow, across the whole subtree it walks. Children the caller cannot read
are skipped rather than refused, exactly as PROPFIND drops them.

Depth 0 on a collection is RFC 4918 §9.8.3's "copy the collection, not its
members", which is a create rather than a copy: an empty folder at the
destination carrying the source's dead properties.
"""

from werkzeug.wrappers import Response

from suite.drive._core import nodes as node_core
from suite.drive._core.access import require
from suite.drive._core.roles import EDIT, READ
from suite.drive.webdav import deadprops, locks, pathmap
from suite.drive.webdav.conditional import evaluate_preconditions
from suite.drive.webdav.context import DavContext
from suite.drive.webdav.errors import (
    BadRequest,
    Conflict,
    Forbidden,
    NotFoundError,
    PreconditionFailed,
)
from suite.drive.webdav.structure import resolve_destination


def handle(ctx: DavContext) -> Response:
    source = pathmap.resolve(ctx.segments, ctx.user)
    if source.is_mount:
        raise Forbidden("Cannot copy the WebDAV namespace root.")
    if not source.exists:
        raise NotFoundError("Resource not found.")

    row = source.node
    require(row, READ, ctx.principals)

    depth = ctx.depth if ctx.depth is not None else "infinity"
    if source.is_collection and depth == "1":
        raise BadRequest("COPY on a collection accepts Depth 0 or infinity only.")

    destination, dest_parent, dest_name = resolve_destination(ctx, source)
    evaluate_preconditions(ctx.request, row)
    pathmap.require_create_parent(dest_parent, ctx.principals)
    pathmap.validate_dav_name(dest_name, dest_parent)
    locks.enforce(ctx, membership_parent=dest_parent.name)

    overwrote = _clear_destination(ctx, destination, source)

    if source.is_collection and depth == "0":
        # a shallow collection copy is a create; §8.9's primitive has no
        # members-excluded form, and inventing one would put a second copy
        # rule beside the one every other caller uses
        created = node_core.create_folder(ctx.principals, dest_parent.name, dest_name)
        deadprops.copy_props(row.name, created)
    else:
        created = node_core.copy(ctx.principals, row.name, dest_parent.name, title=dest_name)
        _refuse_renamed_copy(created, dest_name)

    pathmap.reset_memo()
    return Response(status=204 if overwrote else 201)


def _clear_destination(ctx: DavContext, destination: pathmap.ResolvedPath, source) -> bool:
    """Trash whatever the destination URL names, so the exact title is free.

    Without this the workflow would deduplicate the title (§8.6) and publish
    the copy at ` (2)`, which is not the URL the client asked to create.
    """
    target = destination.node
    if target is None:
        return False
    if target.name == source.node.name:
        raise Forbidden("Source and destination are the same resource.")
    # §12.1: the read gate runs first. `require` raises DriveNotFound below
    # READ, so a destination the caller cannot see answers 404 rather than
    # being confirmed by the 412 or the 423 below.
    require(target, READ, ctx.principals)
    if not ctx.overwrite:
        raise PreconditionFailed("Destination exists and Overwrite is F.")
    # §12.1 gives COPY no role on the destination beyond UPLOAD on its parent,
    # but overwriting is destroying what is there, and DELETE needs EDIT
    require(target, EDIT, ctx.principals)
    locks.enforce(ctx, entity=target.name, check_descendants=destination.is_collection)
    node_core.update(ctx.principals, target.name, state="Trashed")
    locks.drop_locks_under(target.name)
    pathmap.reset_memo()
    return True


def _refuse_renamed_copy(created: str, dest_name: str) -> None:
    """Refuse a copy the workflow had to rename to place.

    §8.6 makes `copy` deduplicate a colliding title instead of refusing, which
    is right for a person clicking Duplicate and wrong for COPY: the client
    named a URL, and a body published at ` (2)` is not that URL. The exact
    title was cleared above for every sibling DAV can see, so what is left is
    a sibling it cannot - a hidden content document, a template, an
    unaddressable title, or a case variant this collation calls the same name.
    The refusal rolls the copy back with the request.
    """
    if node_core.stored(created).title != dest_name:
        raise Conflict("A resource that WebDAV cannot address already holds this name.")
