"""LOCK and UNLOCK.

Windows/Office's new-file flow is LOCK (unmapped URL) → PUT with the token →
UNLOCK, and RFC 4918 §7.3 replaced lock-null resources with "create an empty
resource, then lock it" — so LOCK on an unmapped URL creates a real zero-byte
file. Refresh is an empty-body LOCK carrying the token in If.
"""

import hashlib

import frappe
from lxml import etree
from werkzeug.wrappers import Response

from suite.drive.api.files import get_upload_path
from suite.drive.api.permissions import user_has_permission
from suite.drive.api.storage import acquire_owner_storage_lock, validate_quota
from suite.drive.utils import create_drive_file, get_ancestors_of
from suite.drive.webdav import locks, pathmap, perms
from suite.drive.webdav.context import DavContext
from suite.drive.webdav.errors import (
    BadRequest,
    Conflict,
    Forbidden,
    InsufficientStorage,
    Locked,
    NotFoundError,
    PreconditionFailed,
    quota_guard,
)
from suite.drive.webdav.xmlutil import XML_BODY_CAP, dav, dav_element, parse_xml, xml_response

# DAV:owner is informational (RFC 4918 §14.17); cap it like a dead property so a
# LOCK cannot bloat the lock row or the PROPFIND lockdiscovery reflected to others
MAX_OWNER_XML_BYTES = 64 * 1024


def handle_lock(ctx: DavContext) -> Response:
    resolved = pathmap.resolve(ctx.segments, ctx.user)
    if resolved.is_mount or resolved.root == "virtual":
        raise Forbidden("Cannot lock the namespace root.")

    depth = ctx.depth if ctx.depth is not None else "infinity"
    if depth == "1":
        raise BadRequest("LOCK accepts Depth 0 or infinity only.")
    timeout = locks.parse_timeout_header(ctx.request.headers.get("Timeout"))

    body = parse_xml(ctx.body.read_all(XML_BODY_CAP))
    if body is None:
        return _refresh(ctx, resolved, timeout)
    return _create(ctx, resolved, body, depth, timeout)


def handle_unlock(ctx: DavContext) -> Response:
    resolved = pathmap.resolve(ctx.segments, ctx.user)
    if not resolved.exists or resolved.is_mount:
        raise NotFoundError("Resource not found.")
    # unreadable is indistinguishable from absent — otherwise the 409-vs-404
    # split below is an existence oracle (anti-enumeration, matches other verbs)
    if not perms.resolve_entity_access(resolved.entity, ctx.user)["read"]:
        raise NotFoundError("Resource not found.")

    header = ctx.request.headers.get("Lock-Token", "").strip()
    if not header.startswith("<") or not header.endswith(">"):
        raise BadRequest("A Lock-Token header is required.")
    token = header[1:-1]

    lock = locks.find_lock(token)
    if lock is None or not _covers(lock, resolved.entity.name):
        raise Conflict(
            "The token does not identify a lock on this resource.",
            condition="lock-token-matches-request-uri",
        )

    from suite.drive.api.permissions import is_drive_admin

    if lock.owner_user != ctx.user and not is_drive_admin(ctx.user):
        raise Forbidden("Only the lock owner may unlock this resource.")

    locks.delete_lock(token)
    return Response(status=204)


def _refresh(ctx: DavContext, resolved: pathmap.ResolvedPath, timeout: int) -> Response:
    # an unreadable target answers exactly like an unmapped one (anti-enumeration,
    # as on UNLOCK): the owner-mismatch Forbidden below would otherwise confirm
    # a hidden resource and its lock to anyone holding a leaked token
    if not resolved.exists or not perms.resolve_entity_access(resolved.entity, ctx.user)["read"]:
        raise PreconditionFailed("Nothing to refresh at this URL.")

    submitted = locks.parsed_if(ctx).all_tokens()
    if not submitted:
        raise PreconditionFailed("Refresh requires the lock token in an If header.")

    lock = next(
        (
            lock
            for token in submitted
            if (lock := locks.find_lock(token)) and _covers(lock, resolved.entity.name)
        ),
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

    # bound the lock table before materializing anything — the unmapped-URL path
    # writes a real File row + blob, which must not happen once a user is at the
    # cap (checking after would orphan the blob when the DB row rolls back)
    if locks.user_active_lock_count(ctx.user) >= locks.MAX_ACTIVE_LOCKS_PER_USER:
        raise InsufficientStorage("Too many active locks; release some before creating more.")

    created = False
    if resolved.exists:
        row = resolved.entity
        # unreadable is indistinguishable from absent (anti-enumeration)
        if not perms.resolve_entity_access(row, ctx.user)["read"]:
            raise NotFoundError("Resource not found.")
        if not user_has_permission(row.name, "write"):
            raise Forbidden("You cannot lock this resource.")
        if not row.is_folder:
            depth = "0"  # depth is meaningless on a non-collection
    else:
        if ctx.had_trailing_slash:
            raise Conflict("Cannot LOCK an unmapped collection URL.")
        row = _create_empty_resource(ctx, resolved)
        created = True
        depth = "0"

    conflicts = locks.find_conflicts(row.name, scope=scope, depth=depth, is_collection=bool(row.is_folder))
    tokens = locks.parsed_if(ctx).all_tokens()
    conflicts = [lock for lock in conflicts if not (lock.token in tokens and lock.owner_user == ctx.user)]
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
        lock_root=pathmap.href_for(ctx.segments, bool(row.is_folder)),
    )
    return _lock_response(lock, status=201 if created else 200, with_token_header=True)


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
    if resolved.missing_intermediate or resolved.root == "unknown" or resolved.parent is None:
        raise Conflict("Intermediate collections do not exist.")
    parent, name = resolved.parent, ctx.segments[-1]
    # unreadable parent reads as absent, not forbidden (anti-enumeration)
    access = perms.resolve_entity_access(parent, ctx.user)
    if not (access["read"] or access["upload"]):
        raise NotFoundError("Resource not found.")
    if not access["upload"]:
        raise Forbidden("Ask the folder owner for upload access.")
    pathmap.validate_dav_name(name, parent)
    locks.enforce(ctx, membership_parent=parent.name)

    # mirror put._create's storage gate: an over-quota user must not mint new
    # File rows through the lock-null create path either
    acquire_owner_storage_lock(ctx.user)
    with quota_guard():
        validate_quota(incoming_size=0)

    manager = ctx.manager
    scratch = get_upload_path(f"webdav_{frappe.generate_hash(length=12)}_lock")
    scratch.write_bytes(b"")
    try:
        drive_file = create_drive_file(
            name,
            parent.name,
            "Application",
            lambda file: "/" + str(manager.get_disk_path(file)),
            "application/octet-stream",
            0,
        )
        manager.upload_file(scratch, drive_file, create_thumbnail=False)
        if manager.s3_enabled:
            from suite.drive.utils.files import get_s3_key, get_s3_url

            drive_file.file_url = get_s3_url(get_s3_key(drive_file.file_url))
            drive_file.save()
        drive_file.db_set("content_hash", hashlib.sha256(b"").hexdigest(), update_modified=False)
    finally:
        scratch.unlink(missing_ok=True)

    pathmap.reset_memo()
    return pathmap.fetch(drive_file.name)


def _covers(lock: locks.LockInfo, entity: str) -> bool:
    if lock.entity == entity:
        return True
    return lock.depth == "infinity" and lock.entity in get_ancestors_of(entity)


def _lock_response(lock: locks.LockInfo, status: int, with_token_header: bool) -> Response:
    prop = dav_element("prop", locks.lockdiscovery_xml([lock]))
    response = xml_response(prop, status=status)
    if with_token_header:
        response.headers["Lock-Token"] = f"<{lock.token}>"
    return response
