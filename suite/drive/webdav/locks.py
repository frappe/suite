"""WebDAV write-lock model (RFC 4918 §6-7) and the single enforcement guard.

State lives in the Drive DAV Lock DocType — gunicorn recycles workers and a
Redis flush must not drop a live Office lock mid-edit. Expiry is lazy (purged
before every read) plus an hourly sweep. A lock is satisfied only when its
token is submitted in the If header AND the session user is the lock's owner:
a leaked token grants nothing.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

import frappe
from lxml import etree

from suite.drive._core.access import chain_ids, effective_role
from suite.drive._core.nodes import child_path
from suite.drive._core.roles import READ
from suite.drive.webdav import pathmap
from suite.drive.webdav.context import DavContext, validate_segments
from suite.drive.webdav.errors import BadRequest, Locked, PreconditionFailed
from suite.drive.webdav.ifheader import EMPTY_IF, BadIfHeader, IfHeader, parse_if_header
from suite.drive.webdav.properties import compute_etag
from suite.drive.webdav.xmlutil import dav, dav_element, parse_fragment

DEFAULT_LOCK_TIMEOUT = 600
MAX_LOCK_TIMEOUT = 3600
MAX_ACTIVE_LOCKS_PER_USER = 1000

_FIELDS = ["token", "entity", "scope", "depth", "owner_user", "owner_xml", "expires_at", "lock_root"]


@dataclass
class LockInfo:
    token: str
    entity: str
    scope: str  # "Exclusive" | "Shared"
    depth: str  # "0" | "infinity"
    owner_user: str
    owner_xml: str | None
    expires_at: datetime
    lock_root: str

    @property
    def exclusive(self) -> bool:
        return self.scope == "Exclusive"

    @property
    def remaining(self) -> int:
        return max(0, int((self.expires_at - frappe.utils.now_datetime()).total_seconds()))


# --- enforcement (what every mutating handler calls) ---


def enforce(
    ctx: DavContext,
    entity: str | None = None,
    membership_parent: str | None = None,
    check_descendants: bool = False,
) -> None:
    """412 if the If header's conditions fail, then 423 unless every covering
    lock is satisfied by a submitted token from its owner."""
    submitted = parsed_if(ctx)
    if submitted is not EMPTY_IF:
        _conditional_gate(ctx, submitted)

    covering = _coverage(entity, membership_parent, check_descendants)
    if not covering:
        return

    tokens = submitted.all_tokens()

    def satisfied(lock: LockInfo) -> bool:
        return lock.token in tokens and lock.owner_user == ctx.user

    exclusive_blockers = [lock for lock in covering if lock.exclusive and not satisfied(lock)]
    if exclusive_blockers:
        raise Locked("The resource is locked.", lock_root=exclusive_blockers[0].lock_root)

    shared = [lock for lock in covering if not lock.exclusive]
    if shared and not any(satisfied(lock) for lock in shared):
        raise Locked("The resource is locked.", lock_root=shared[0].lock_root)


def parsed_if(ctx: DavContext) -> IfHeader:
    if "ifheader" not in ctx.extras:
        try:
            ctx.extras["ifheader"] = parse_if_header(ctx.request.headers.get("If"))
        except BadIfHeader as e:
            raise BadRequest(str(e)) from e
    return ctx.extras["ifheader"]


def _conditional_gate(ctx: DavContext, submitted: IfHeader) -> None:
    def readable(resolved: pathmap.ResolvedPath) -> str | None:
        # a resource the user cannot read evaluates exactly like an absent one:
        # the observable 412 would otherwise disclose its existence, ETag and
        # lock state to anyone who can name its URL in a tagged If list
        row = resolved.node
        if row is None or effective_role(row, ctx.principals) < READ:
            return None
        return row.name

    def resolve_href(href: str | None) -> str | None:
        if href is None:
            return readable(pathmap.resolve(ctx.segments, ctx.user))
        from urllib.parse import unquote, urlsplit

        path = urlsplit(href).path
        if path != pathmap.DAV_PREFIX and not path.startswith(pathmap.DAV_PREFIX + "/"):
            return None
        try:
            segments = validate_segments(
                [
                    unquote(segment, errors="strict")
                    for segment in path[len(pathmap.DAV_PREFIX) :].split("/")
                    if segment
                ]
            )
        except (BadRequest, UnicodeDecodeError):
            # an href the URL namespace itself would refuse is simply unmapped
            return None
        return readable(pathmap.resolve(segments, ctx.user))

    def get_etag(entity: str) -> str | None:
        row = pathmap.fetch(entity)
        return compute_etag(row) if row is not None else None

    def get_active_tokens(entity: str) -> frozenset[str]:
        return frozenset(lock.token for lock in covering_locks(entity))

    if not submitted.evaluate(resolve_href, get_etag, get_active_tokens):
        raise PreconditionFailed("If header condition failed.")


def _coverage(entity: str | None, membership_parent: str | None, check_descendants: bool) -> list[LockInfo]:
    covering: dict[str, LockInfo] = {}

    def add_chain(target: str) -> None:
        row = pathmap.fetch(target)
        if row is None:
            return
        # §3.1 materialises the ancestry on the row, so the chain costs nothing
        # beyond the row itself - the legacy adapter walked it with a CTE.
        ancestors = set(chain_ids(row)) - {target}
        for lock in _fetch_locks({target, *ancestors}):
            if lock.entity == target or (lock.entity in ancestors and lock.depth == "infinity"):
                covering[lock.token] = lock

    if entity:
        add_chain(entity)
    if membership_parent:
        # RFC 4918 §7.4: even a depth-0 lock on a collection protects its member list
        add_chain(membership_parent)
    if entity and check_descendants:
        for lock in _fetch_locks_by_token(_locks_over_subtree(entity)):
            covering[lock.token] = lock
    return list(covering.values())


def covering_locks(entity: str) -> list[LockInfo]:
    return _coverage(entity, None, False)


def discovery_map(ancestors_by_entity: dict[str, list[str]]) -> dict[str, list[LockInfo]]:
    """Lockdiscovery for a whole PROPFIND listing from one indexed lock fetch."""
    candidates: set[str] = set()
    for entity, ancestors in ancestors_by_entity.items():
        candidates.add(entity)
        candidates.update(ancestors)
    locks = _fetch_locks(candidates)
    if not locks:
        return {}

    by_entity: dict[str, list[LockInfo]] = {}
    for lock in locks:
        by_entity.setdefault(lock.entity, []).append(lock)

    result: dict[str, list[LockInfo]] = {}
    for entity, ancestors in ancestors_by_entity.items():
        matched = list(by_entity.get(entity, []))
        for ancestor in ancestors:
            matched += [lock for lock in by_entity.get(ancestor, []) if lock.depth == "infinity"]
        if matched:
            result[entity] = matched
    return result


def _locks_over_subtree(subtree_root: str) -> list[str]:
    """Tokens of active locks anywhere under `subtree_root`, itself included.

    `Drive Node` materialises its ancestry, so the whole subtree is one indexed
    range on `node_subtree (root, path)` instead of the recursive walk the
    adjacency list needed.
    """
    row = pathmap.fetch(subtree_root)
    if row is None:
        return []
    rows = frappe.db.sql(
        """SELECT DISTINCT l.name
        FROM `tabDrive DAV Lock` l
        JOIN `tabDrive Node` n ON n.name = l.entity
        WHERE l.expires_at > NOW()
          AND (n.name = %(node)s OR (n.root = %(root)s AND n.path LIKE %(prefix)s))""",
        values={
            "node": subtree_root,
            "root": row.name if row.kind == "root" else row.root,
            "prefix": child_path(row) + "%",
        },
    )
    return [entry[0] for entry in rows]


# --- lifecycle ---


def create_lock(
    entity: str,
    *,
    scope: str,
    depth: str,
    owner_user: str,
    owner_xml: str | None,
    requested_timeout: int,
    lock_root: str,
) -> LockInfo:
    token = f"urn:uuid:{uuid.uuid4()}"
    frappe.get_doc(
        {
            "doctype": "Drive DAV Lock",
            "token": token,
            "entity": entity,
            "scope": scope,
            "depth": depth,
            "owner_user": owner_user,
            "owner_xml": owner_xml,
            "timeout_seconds": requested_timeout,
            "expires_at": frappe.utils.now_datetime() + timedelta(seconds=requested_timeout),
            "lock_root": lock_root,
        }
    ).insert(ignore_permissions=True)
    return _get(token)


def refresh_lock(token: str, *, requested_timeout: int) -> LockInfo:
    frappe.db.set_value(
        "Drive DAV Lock",
        token,
        {
            "timeout_seconds": requested_timeout,
            "expires_at": frappe.utils.now_datetime() + timedelta(seconds=requested_timeout),
        },
        update_modified=False,
    )
    return _get(token)


def delete_lock(token: str) -> None:
    frappe.db.delete("Drive DAV Lock", {"name": token})


def user_active_lock_count(user: str) -> int:
    """How many unexpired locks this user holds — the per-user creation cap."""
    return frappe.db.count(
        "Drive DAV Lock",
        {"owner_user": user, "expires_at": [">", frappe.utils.now_datetime()]},
    )


def drop_locks_under(entity: str) -> None:
    """DELETE/MOVE cleanup: locks do not survive unmapping or travel (RFC §7.5)."""
    tokens = _locks_over_subtree(entity)
    frappe.db.delete("Drive DAV Lock", {"entity": entity})
    if tokens:
        frappe.db.delete("Drive DAV Lock", {"name": ["in", tokens]})


def find_lock(token: str) -> LockInfo | None:
    purge_expired_locks(lazy=True)
    row = frappe.db.get_value("Drive DAV Lock", token, _FIELDS, as_dict=True)
    return LockInfo(**row) if row else None


def find_conflicts(entity: str, *, scope: str, depth: str, is_collection: bool) -> list[LockInfo]:
    """LOCK conflict matrix: exclusive conflicts with everything, shared only
    with exclusive. A depth-infinity request on a collection also conflicts
    with any lock inside the subtree."""
    covering = list(covering_locks(entity))
    if is_collection and depth == "infinity":
        known = {lock.token for lock in covering}
        subtree = set(_locks_over_subtree(entity))
        covering += _fetch_locks_by_token(list(subtree - known))

    if scope == "Exclusive":
        return covering
    return [lock for lock in covering if lock.exclusive]


def purge_expired_locks(lazy: bool = False) -> None:
    """Hourly scheduler target; also run lazily before every read."""
    threshold = frappe.utils.now_datetime() if lazy else frappe.utils.now_datetime() - timedelta(seconds=60)
    frappe.db.sql("DELETE FROM `tabDrive DAV Lock` WHERE expires_at <= %(cutoff)s", {"cutoff": threshold})


def parse_timeout_header(value: str | None) -> int:
    """First supported entry of the Timeout header, clamped; Office's habitual
    Second-3600 is granted verbatim."""
    if not value:
        return DEFAULT_LOCK_TIMEOUT
    for part in value.split(","):
        part = part.strip()
        if part.lower() == "infinite":
            return MAX_LOCK_TIMEOUT
        if part.lower().startswith("second-"):
            digits = part[len("second-") :]
            if digits.isdigit():
                return max(1, min(int(digits), MAX_LOCK_TIMEOUT))
    return DEFAULT_LOCK_TIMEOUT


# --- XML payloads (shared with PROPFIND) ---


def supportedlock_xml() -> etree._Element:
    supported = dav_element("supportedlock")
    for scope in ("exclusive", "shared"):
        entry = etree.SubElement(supported, dav("lockentry"))
        lockscope = etree.SubElement(entry, dav("lockscope"))
        etree.SubElement(lockscope, dav(scope))
        locktype = etree.SubElement(entry, dav("locktype"))
        etree.SubElement(locktype, dav("write"))
    return supported


def lockdiscovery_xml(locks: list[LockInfo], viewer: str | None = None) -> etree._Element:
    """Render activelocks. When `viewer` is given (a PROPFIND listing), a lock the
    viewer does not own is emitted without its token or owner identity — the
    token is inert to a non-owner anyway (enforce/UNLOCK require ownership), and
    the owner element would leak who is editing which file."""
    discovery = dav_element("lockdiscovery")
    for lock in locks:
        owned = viewer is None or lock.owner_user == viewer
        active = etree.SubElement(discovery, dav("activelock"))
        locktype = etree.SubElement(active, dav("locktype"))
        etree.SubElement(locktype, dav("write"))
        lockscope = etree.SubElement(active, dav("lockscope"))
        etree.SubElement(lockscope, dav(lock.scope.lower()))
        etree.SubElement(active, dav("depth")).text = lock.depth
        if owned and lock.owner_xml and (owner := parse_fragment(lock.owner_xml)) is not None:
            active.append(owner)
        etree.SubElement(active, dav("timeout")).text = f"Second-{lock.remaining}"
        if owned:
            token = etree.SubElement(active, dav("locktoken"))
            etree.SubElement(token, dav("href")).text = lock.token
        root = etree.SubElement(active, dav("lockroot"))
        etree.SubElement(root, dav("href")).text = lock.lock_root
    return discovery


# --- internals ---


def _fetch_locks(entity_names: set[str]) -> list[LockInfo]:
    """Active locks anchored to any of these entities — one indexed query, so
    enforcement never loads the whole table (only the target's chain matters)."""
    if not entity_names:
        return []
    rows = frappe.get_all(
        "Drive DAV Lock",
        filters={
            "entity": ["in", list(entity_names)],
            "expires_at": [">", frappe.utils.now_datetime()],
        },
        fields=_FIELDS,
    )
    return [LockInfo(**row) for row in rows]


def _fetch_locks_by_token(tokens: list[str]) -> list[LockInfo]:
    """Active locks by token — for the subtree-descendant conflict/coverage set."""
    if not tokens:
        return []
    rows = frappe.get_all(
        "Drive DAV Lock",
        filters={
            "name": ["in", tokens],
            "expires_at": [">", frappe.utils.now_datetime()],
        },
        fields=_FIELDS,
    )
    return [LockInfo(**row) for row in rows]


def _get(token: str) -> LockInfo:
    return LockInfo(**frappe.db.get_value("Drive DAV Lock", token, _FIELDS, as_dict=True))
