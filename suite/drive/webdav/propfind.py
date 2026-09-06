"""PROPFIND: Depth 0/1 property listings as 207 multistatus.

Depth infinity is refused with the RFC 4918 §9.1 propfind-finite-depth
precondition (Apache's default too) - an unbounded walk over the tree with
permission fanout is a DoS vector, and no target client uses it.

Depth 1 spends the engine's folder page (§5.3) and nothing per child: three
queries for the window and the two grant sets, then one dead-property fetch,
one lock fetch, and one blob read for the page's validators. The count does
not move with the number of children.
"""

from dataclasses import dataclass

import frappe
from lxml import etree
from werkzeug.wrappers import Response

from suite.drive._core import quota as quota_core
from suite.drive._core.access import chain_ids, require
from suite.drive._core.nodes import MAX_PAGE_SIZE
from suite.drive._core.nodes import children as node_children
from suite.drive._core.roles import READ
from suite.drive.webdav import pathmap
from suite.drive.webdav.context import DavContext
from suite.drive.webdav.errors import BadRequest, Forbidden, NotFoundError
from suite.drive.webdav.properties import checksums_for, live_properties
from suite.drive.webdav.xmlutil import XML_BODY_CAP, MultistatusBuilder, dav, parse_xml

# RFC 4331 §2: quota properties SHOULD NOT be returned on allprop
QUOTA_PROPS = frozenset({dav("quota-used-bytes"), dav("quota-available-bytes")})


@dataclass
class Resource:
    row: frappe._dict
    segments: list[str]
    is_collection: bool
    display_name: str
    ancestors: list[str]  # for lockdiscovery inheritance


def handle(ctx: DavContext) -> Response:
    depth = ctx.depth if ctx.depth is not None else "infinity"
    if depth == "infinity":
        raise Forbidden(
            "PROPFIND with Depth: infinity is not supported.",
            condition="propfind-finite-depth",
        )

    mode, requested = _parse_body(ctx)
    resources = _collect_resources(ctx, depth)
    # quota lives on collections only, so a probe at a file pays nothing
    wants_quota = bool(QUOTA_PROPS & set(requested)) and any(resource.is_collection for resource in resources)
    quota = _mount_quota(resources[0].row) if wants_quota else None

    from suite.drive.webdav import deadprops, locks

    rows = [resource.row for resource in resources]
    # the page's validators cost one read, and a client that did not ask for
    # `getetag` should not pay it (§12.5). `propname` needs it to say which
    # rows define the property at all.
    wants_etag = mode in ("allprop", "propname") or dav("getetag") in requested
    checksums = checksums_for(rows) if wants_etag else {}
    dead = deadprops.get_dead_props([row.name for row in rows])
    lock_map = locks.discovery_map({r.row.name: r.ancestors for r in resources})

    builder = MultistatusBuilder()
    for resource in resources:
        _render(
            builder,
            resource,
            mode,
            requested,
            quota,
            dead.get(resource.row.name, {}),
            lock_map.get(resource.row.name, []),
            checksums.get(resource.row.name),
            ctx.user,
        )
    return builder.build()


def _parse_body(ctx: DavContext) -> tuple[str, list[str]]:
    root = parse_xml(ctx.body.read_all(XML_BODY_CAP))
    if root is None:
        return "allprop", []
    if root.tag != dav("propfind"):
        raise BadRequest("Expected a DAV:propfind request body.")

    if root.find(dav("propname")) is not None:
        return "propname", []
    prop = root.find(dav("prop"))
    if prop is not None:
        return "prop", [child.tag for child in prop if isinstance(child.tag, str)]
    if root.find(dav("allprop")) is not None:
        include = root.find(dav("include"))
        extra = [child.tag for child in include if isinstance(child.tag, str)] if include is not None else []
        return "allprop", extra
    raise BadRequest("Empty DAV:propfind request body.")


def _collect_resources(ctx: DavContext, depth: str) -> list[Resource]:
    resolved = pathmap.resolve(ctx.segments, ctx.user)
    if not resolved.exists:
        # a hidden document, a node in somebody else's root, and a name that
        # was never there are one answer over DAV (§12.1, §12.2)
        raise NotFoundError("Resource not found.")

    principals = ctx.principals
    row = resolved.node

    if depth == "1" and resolved.is_collection:
        row, children = _read_page(principals, row.name)
    else:
        # `require` is the point check, and it raises DriveNotFound below READ,
        # which the dispatcher's mapping turns into 404 rather than 403
        require(row, READ, principals)
        children = []

    ancestors = chain_ids(row)[:-1]
    resources = [Resource(row, list(ctx.segments), _is_collection(row), row.title, ancestors)]
    child_ancestors = [*ancestors, row.name]
    for child in _one_row_per_name(children):
        resources.append(
            Resource(
                child,
                [*ctx.segments, child.title],
                _is_collection(child),
                child.title,
                child_ancestors,
            )
        )
    return resources


def _one_row_per_name(children: list[frappe._dict]) -> list[frappe._dict]:
    """Publish each title once, keeping the row a path lookup would reach.

    `Drive Node` indexes `(parent, state, title)` but does not make it unique,
    so two Active siblings can carry the same title. `href_for` quotes the
    title, so those two share one URL: listing both puts two sizes and two
    ETags at one href, while every GET of it answers from the one row
    `pathmap._child` picks, the oldest. The shadowed row has no URL of its own
    and is not published. Titles that differ only by case keep separate hrefs
    and are both published, because `_child` resolves each of them exactly.
    """
    oldest: dict[str, frappe._dict] = {}
    for child in children:
        current = oldest.get(child.title)
        if current is None or child.creation < current.creation:
            oldest[child.title] = child
    published = {id(row) for row in oldest.values()}
    return [child for child in children if id(child) in published]


def _read_page(principals, parent: str) -> tuple[frappe._dict, list[frappe._dict]]:
    """The listable children of one collection, already filtered to READ.

    §5.3's window is a page, and PROPFIND has no cursor to hand a client, so a
    folder wider than one window is read to the end rather than truncated. Each
    window is three queries; a folder inside one window - which is every
    ordinary folder - is exactly the three the spec budgets.
    """
    rows: list[frappe._dict] = []
    parent_row = None
    cursor = None
    while True:
        page = node_children(principals, parent, cursor=cursor, limit=MAX_PAGE_SIZE)
        parent_row = page["parent"]
        rows.extend(row for row in page["rows"] if pathmap.visible(row))
        cursor = page["next_cursor"]
        if cursor is None:
            return parent_row, rows


def _is_collection(row: frappe._dict) -> bool:
    return row.kind in ("root", "folder")


def _mount_quota(row: frappe._dict) -> tuple[int, int]:
    """§7.9: both quota properties read the Personal Root, the only DAV mount.

    The mount is the caller's own root, so the accounting root is on the row
    already and no second lookup is needed to find it.
    """
    usage = quota_core.get_storage_usage(row.name if row.kind == "root" else row.root)
    return int(usage.used_bytes or 0), int(usage.effective_quota or 0)


def _render(
    builder: MultistatusBuilder,
    resource: Resource,
    mode: str,
    requested: list[str],
    quota: tuple[int, int] | None,
    dead_props: dict[str, etree._Element],
    row_locks: list,
    checksum: str | None,
    viewer: str,
) -> None:
    from suite.drive.webdav import locks

    available = live_properties(
        resource.row,
        is_collection=resource.is_collection,
        display_name=resource.display_name,
        quota=quota if resource.is_collection else None,
        checksum=checksum,
    )
    available[dav("supportedlock")] = locks.supportedlock_xml()
    available[dav("lockdiscovery")] = locks.lockdiscovery_xml(row_locks, viewer)
    response = builder.add_response(pathmap.href_for(resource.segments, resource.is_collection))

    if mode == "propname":
        names = [tag for tag, value in available.items() if value is not None]
        names += list(dead_props)
        response.propstat(200, [etree.Element(tag) for tag in names])
        return

    if mode == "allprop":
        found = [value for tag, value in available.items() if value is not None and tag not in QUOTA_PROPS]
        found += [
            available[tag] for tag in requested if available.get(tag) is not None and tag in QUOTA_PROPS
        ]
        found += list(dead_props.values())
        response.propstat(200, found)
        return

    found, missing = [], []
    for tag in requested:
        value = available.get(tag)
        if value is None:
            value = dead_props.get(tag)
        if value is not None:
            found.append(value)
        else:
            missing.append(etree.Element(tag))
    response.propstat(200, found)
    response.propstat(404, missing)
    if not found and not missing:
        # RFC 4918 §14.24: a response is an href plus propstat or status, and
        # an empty <D:prop/> body leaves no propstat to write
        response.status(200)
