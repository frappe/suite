"""Point access resolution for Drive nodes."""

import dataclasses
import secrets
import string
import time
from collections.abc import Mapping
from datetime import datetime
from uuid import uuid4

import frappe
from frappe import _
from frappe.utils import get_datetime, now, now_datetime, validate_email_address
from frappe.utils.password import passlibctx

from suite.drive._core.errors import (
    DriveForbidden,
    DriveLinkExpired,
    DriveLocked,
    DriveNotFound,
)
from suite.drive._core.principals import TICKET_TTL, Principals, make_ticket, ticket_ok
from suite.drive._core.roles import EDIT, MANAGE, NONE, READ, ROLES

POINT_SQL = """
SELECT node, principal, role, password_hash
FROM `tabDrive Grant`
WHERE node IN %(chain)s
  AND principal IN %(principals)s
  AND (expires_on IS NULL OR expires_on > %(now)s)
"""

EXPLAIN_SQL = """
SELECT node, principal, role, expires_on, password_hash
FROM `tabDrive Grant`
WHERE node IN %(chain)s
  AND (expires_on IS NULL OR expires_on > %(now)s)
"""

EXPIRED_LINK_SQL = """
SELECT node, principal, role, expires_on, password_hash
FROM `tabDrive Grant`
WHERE node IN %(chain)s
  AND principal IN %(principals)s
  AND expires_on IS NOT NULL
  AND expires_on <= %(now)s
"""

BASE62 = string.ascii_letters + string.digits
UNLOCK_FAILURE_LIMIT = 5
UNLOCK_WINDOW_SECONDS = 15 * 60
_UNLOCK_FAILURE_SCRIPT = """
local current = redis.call('GET', KEYS[1])
if current == 'locked' then
    return -1
end
local count = tonumber(current) or 0
count = count + 1
if count >= tonumber(ARGV[1]) then
    redis.call('SET', KEYS[1], 'locked', 'EX', ARGV[2])
    return count
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 1 then
    ttl = tonumber(ARGV[2])
end
redis.call('SET', KEYS[1], tostring(count), 'EX', ttl)
return count
"""


def chain_ids(node: Mapping) -> list[str]:
    """Return a root-first chain without querying the database."""
    if node.get("kind") == "root":
        return [node.get("name")]

    ids = [node.get("root")]
    if node.get("path"):
        ids.extend(node.get("path").strip("/").split("/"))
    ids.append(node.get("name"))
    return ids


def own_tier(principal: str, user: str) -> int:
    """Order own principals: the user, then groups, then the site principal."""
    if principal == user:
        return 0
    if principal.startswith("$GROUP:"):
        return 1
    return 2


@dataclasses.dataclass
class Acc:
    """Nearest-wins state for one node."""

    own: int | None = None
    own_depth: int = -1
    own_tier: int = 9
    open: int | None = None
    open_depth: int = -1

    def copy(self) -> Acc:
        return dataclasses.replace(self)

    def offer(self, principal: str, role: int, depth: int, principals: Principals) -> None:
        if principal in principals.own:
            tier = own_tier(principal, principals.user)
            if depth > self.own_depth:
                self.own, self.own_depth, self.own_tier = role, depth, tier
            elif depth == self.own_depth and tier < self.own_tier:
                self.own, self.own_tier = role, tier
            elif depth == self.own_depth and tier == self.own_tier:
                if self.own == 0 or role == 0:
                    self.own = 0
                else:
                    self.own = max(self.own, role)
        elif principal in principals.open:
            if depth > self.open_depth:
                self.open, self.open_depth = role, depth
            elif depth == self.open_depth and role > (self.open or 0):
                self.open = role

    def answer(self) -> int:
        if self.own == 0:
            return 0
        return max(self.own or 0, self.open or 0)


def effective_role(node: Mapping, principals: Principals) -> int:
    """Resolve one node from its materialized ancestry and current grant rows."""
    if principals.is_admin:
        return MANAGE
    if not principals.all():
        return 0

    return _point_state(node, principals)[0]


def effective_roles(
    chain: list[str],
    child_rows: Mapping[str, list],
    chain_rows: list,
    principals: Principals,
) -> dict[str, int]:
    """Resolve a page of children from the two grant result sets."""
    if principals.is_admin:
        return dict.fromkeys(child_rows, MANAGE)

    ticket_results = {}
    depth = {node_id: index for index, node_id in enumerate(chain)}
    child_depth = len(chain)
    roles = {}
    for child_id, rows in child_rows.items():
        roles[child_id] = _resolve_rows(
            [*chain_rows, *rows],
            {**depth, child_id: child_depth},
            principals,
            ticket_results=ticket_results,
        )
    return roles


def _point_state(node: Mapping, principals: Principals):
    """Load current rows once and validate each protected link proof once."""

    chain = chain_ids(node)
    depth = {node_id: index for index, node_id in enumerate(chain)}
    rows = frappe.db.sql(
        POINT_SQL,
        {"chain": chain, "principals": principals.all(), "now": now()},
        as_dict=True,
    )
    ticket_results = {}
    role = _resolve_rows(rows, depth, principals, ticket_results=ticket_results)
    return role, rows, depth, ticket_results


def _resolve_rows(
    rows,
    depth: Mapping[str, int],
    principals: Principals,
    *,
    unlock=False,
    ticket_results=None,
) -> int:
    ticket_results = ticket_results if ticket_results is not None else {}
    acc = Acc()
    for row in rows:
        if not unlock and not _grant_is_unlocked(row, principals, ticket_results):
            continue
        acc.offer(row.principal, row.role, depth[row.node], principals)
    return acc.answer()


def _grant_is_unlocked(row: Mapping, principals: Principals, ticket_results=None) -> bool:
    password_hash = row.get("password_hash")
    if not password_hash or not row.principal.startswith("$LINK:"):
        return True
    proof = principals.ticket_for(row.principal)
    if not proof:
        return False
    exp, mac = proof
    ticket_results = ticket_results if ticket_results is not None else {}
    key = (row.principal, password_hash, exp, mac)
    if key not in ticket_results:
        ticket_results[key] = ticket_ok(row.principal.removeprefix("$LINK:"), password_hash, exp, mac)
    return ticket_results[key]


def locked_link_in_play(node: Mapping, principals: Principals, need: int) -> bool:
    """Return whether unlocking a current password link would satisfy this check."""
    links = tuple(principal for principal in principals.open if principal.startswith("$LINK:"))
    if not links:
        return False
    _role, rows, depth, ticket_results = _point_state(node, principals)
    return _locked_link_in_rows(rows, depth, principals, need, ticket_results)


def _locked_link_in_rows(rows, depth, principals, need, ticket_results) -> bool:
    links = tuple(principal for principal in principals.open if principal.startswith("$LINK:"))
    if not links:
        return False
    locked = any(
        row.principal in links
        and row.get("password_hash")
        and not _grant_is_unlocked(row, principals, ticket_results)
        for row in rows
    )
    return locked and _resolve_rows(rows, depth, principals, unlock=True) >= need


def expired_link_in_play(node: Mapping, principals: Principals, need: int) -> bool:
    """Return whether a presented expired link would otherwise satisfy this check."""
    links = tuple(principal for principal in principals.open if principal.startswith("$LINK:"))
    if not links:
        return False
    _role, current_rows, depth, ticket_results = _point_state(node, principals)
    return _expired_link_in_rows(node, principals, need, current_rows, depth, ticket_results)


def _expired_link_in_rows(node, principals, need, current_rows, depth, ticket_results) -> bool:
    links = tuple(principal for principal in principals.open if principal.startswith("$LINK:"))
    if not links:
        return False
    chain = chain_ids(node)
    expired_rows = frappe.db.sql(
        EXPIRED_LINK_SQL,
        {"chain": chain, "principals": links, "now": now()},
        as_dict=True,
    )
    hypothetical_expired = [frappe._dict(row, password_hash=None) for row in expired_rows]
    return (
        bool(expired_rows)
        and _resolve_rows(
            [*current_rows, *hypothetical_expired],
            depth,
            principals,
            ticket_results=ticket_results,
        )
        >= need
    )


def check(node: Mapping, need: int, principals: Principals) -> bool:
    return effective_role(node, principals) >= need


def require(node: Mapping, need: int, principals: Principals) -> str | None:
    """Require a role and return the link principal that supplied it, if any.

    A caller's own grant wins attribution when it is independently sufficient.
    This lets write workflows bind a Guest/link-authorized operation to the
    exact capability that made it possible without issuing another grant query.
    """
    if principals.is_admin:
        return None
    if not principals.all():
        role, rows, depth, ticket_results = 0, [], {}, {}
    else:
        role, rows, depth, ticket_results = _point_state(node, principals)
    if role >= need:
        return _authorizing_link(rows, depth, principals, need, ticket_results)
    if _expired_link_in_rows(node, principals, need, rows, depth, ticket_results):
        raise DriveLinkExpired(_("This Drive link has expired"))
    if _locked_link_in_rows(rows, depth, principals, need, ticket_results):
        raise DriveLocked(_("This Drive link requires a password"))
    if role < READ:
        raise DriveNotFound(_("Drive node {0} was not found").format(node.get("name")))
    raise DriveForbidden(_("You do not have the required access to Drive node {0}").format(node.get("name")))


def _authorizing_link(
    rows: list,
    depth: Mapping[str, int],
    principals: Principals,
    need: int,
    ticket_results: dict,
) -> str | None:
    """Return a deterministic deciding link when own principals are insufficient."""
    acc = Acc()
    for row in rows:
        if _grant_is_unlocked(row, principals, ticket_results):
            acc.offer(row.principal, row.role, depth[row.node], principals)

    own_role = acc.own or NONE
    open_role = acc.open or NONE
    if open_role < need or own_role >= open_role:
        return None

    candidates = sorted(
        row.principal
        for row in rows
        if row.principal.startswith("$LINK:")
        and row.principal in principals.open
        and row.role == acc.open
        and depth[row.node] == acc.open_depth
        and _grant_is_unlocked(row, principals, ticket_results)
    )
    return candidates[0] if candidates else None


def require_link(
    node: Mapping,
    need: int,
    principals: Principals,
    link: str,
) -> None:
    """Require current access through one exact presented link capability."""
    require(node, need, principals)
    if link not in principals.open or not link.startswith("$LINK:"):
        raise DriveForbidden(_("The required Drive link was not presented"))
    tickets = tuple(ticket for ticket in principals.link_tickets if ticket[0] == link)
    link_only = Principals(
        user=principals.user,
        own=(),
        open=(link,),
        is_admin=False,
        link_tickets=tickets,
    )
    if require(node, need, link_only) != link:
        raise DriveForbidden(_("The required Drive link is no longer authorized"))


def require_from_rows(
    node: Mapping,
    need: int,
    principals: Principals,
    rows: list,
) -> None:
    """Apply require semantics to already-loaded current rows.

    Successful listing checks stay inside their fixed query budget. A denied
    check may issue the expired-link probe needed to distinguish its error.
    """
    if principals.is_admin:
        return
    depth = {node_id: index for index, node_id in enumerate(chain_ids(node))}
    ticket_results = {}
    role = _resolve_rows(rows, depth, principals, ticket_results=ticket_results)
    if role >= need:
        return
    if _expired_link_in_rows(node, principals, need, rows, depth, ticket_results):
        raise DriveLinkExpired(_("This Drive link has expired"))
    if _locked_link_in_rows(rows, depth, principals, need, ticket_results):
        raise DriveLocked(_("This Drive link requires a password"))
    if role < READ:
        raise DriveNotFound(_("Drive node {0} was not found").format(node.get("name")))
    raise DriveForbidden(_("You do not have the required access to Drive node {0}").format(node.get("name")))


def add_creator_grant(
    node: Mapping,
    parent: Mapping,
    principals: Principals,
    *,
    via_link: str | None = None,
) -> bool:
    """Give a signed-in non-link creator EDIT when the parent gives less than EDIT."""
    if principals.user == "Guest" or via_link or effective_role(parent, principals) >= EDIT:
        return False

    frappe.get_doc(
        {
            "doctype": "Drive Grant",
            "node": node.get("name"),
            "principal": principals.user,
            "role": EDIT,
        }
    ).insert(ignore_permissions=True)
    return True


def explain(node: Mapping, principals: Principals) -> dict:
    """Return current grant candidates and mark the rows deciding the answer."""
    if principals.is_admin:
        return {"role": MANAGE, "source": "site admin", "rows": []}

    chain = chain_ids(node)
    depth = {node_id: index for index, node_id in enumerate(chain)}
    rows = frappe.db.sql(
        EXPLAIN_SQL,
        {"chain": chain, "now": now()},
        as_dict=True,
    )
    acc = Acc()
    ticket_results = {}
    for row in rows:
        if row.principal in principals.all() and _grant_is_unlocked(row, principals, ticket_results):
            acc.offer(row.principal, row.role, depth[row.node], principals)

    answer = acc.answer()
    if answer < MANAGE:
        raise DriveForbidden(
            _("You do not have the required access to Drive node {0}").format(node.get("name"))
        )
    out = []
    for row in sorted(rows, key=lambda candidate: (-depth[candidate.node], candidate.principal)):
        held = row.principal in principals.all()
        out.append(
            {
                "node": row.node,
                "depth": depth[row.node],
                "principal": row.principal,
                "role": row.role,
                "expires_on": row.expires_on,
                "pass": 1 if row.principal in principals.own else 2,
                "held": held,
                "winner": held
                and _grant_is_unlocked(row, principals, ticket_results)
                and _is_winner(row, acc, depth, principals),
            }
        )
    return {"role": answer, "source": "grant" if answer else "none", "rows": out}


def _is_winner(row, acc: Acc, depth: Mapping[str, int], principals: Principals) -> bool:
    if row.principal in principals.own:
        tier = own_tier(row.principal, principals.user)
        return (
            acc.answer() == (acc.own or 0)
            and depth[row.node] == acc.own_depth
            and tier == acc.own_tier
            and row.role == acc.own
        )
    if row.principal in principals.open:
        return (
            acc.own != NONE
            and acc.answer() == (acc.open or 0)
            and depth[row.node] == acc.open_depth
            and row.role == acc.open
        )
    return False


def grant(
    node_id: str,
    principal: str,
    role: int,
    principals: Principals,
    *,
    expires_on: datetime | str | None = None,
    password: str | None = None,
) -> dict:
    """Create or replace one local grant after the ordered refusal checks."""
    node = _node_or_not_found(node_id)
    _require_manage(node, principals)
    if type(role) is not int or role not in ROLES:
        frappe.throw(_("Drive grant role is invalid"), frappe.ValidationError)

    principal_kind = _principal_kind(principal)
    if not principal_kind:
        frappe.throw(_("Drive grant principal is invalid"), frappe.ValidationError)
    _validate_principal_target(principal, principal_kind)

    if principal == "$PUBLIC" and role > READ:
        raise DriveForbidden(_("Public Drive access cannot exceed Read"))
    if principal == "$PUBLIC" and node.kind == "root":
        raise DriveForbidden(_("A Drive root cannot be public"))
    if principal_kind == "link" and node.kind == "root":
        raise DriveForbidden(_("A Drive root cannot have a share link"))
    if principal_kind == "link" and role > EDIT:
        raise DriveForbidden(_("A Drive share link cannot exceed Edit"))
    if password is not None and principal_kind != "link":
        raise DriveForbidden(_("Only a Drive share link can have a password"))
    if role == NONE and _is_personal_root_owner(node, principal):
        raise DriveForbidden(_("A Personal Drive root owner cannot be denied"))

    normalized_expiry = _future_expiry(expires_on)
    stored_principal = _mint_link_principal() if principal == "$LINK" else principal
    password_hash = passlibctx.hash(password) if password is not None else None

    savepoint = f"drive_grant_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        existing = frappe.db.get_value(
            "Drive Grant",
            {"node": node_id, "principal": stored_principal},
            ["name", "role"],
            as_dict=True,
            for_update=True,
        )
        if existing:
            frappe.db.set_value(
                "Drive Grant",
                existing.name,
                {
                    "role": role,
                    "expires_on": normalized_expiry,
                    "password_hash": password_hash,
                },
            )
            grant_name = existing.name
            action = "share_edit"
            old_role = existing.role
        else:
            row = frappe.get_doc(
                {
                    "doctype": "Drive Grant",
                    "node": node_id,
                    "principal": stored_principal,
                    "role": role,
                    "expires_on": normalized_expiry,
                    "password_hash": password_hash,
                }
            ).insert(ignore_permissions=True)
            grant_name = row.name
            action = "share_add"
            old_role = None
        _write_activity(
            node_id,
            action,
            principals,
            {
                "principal": stored_principal,
                "old_role": old_role,
                "new_role": role,
                "expires_on": _json_datetime(normalized_expiry),
                "has_password": password_hash is not None,
            },
        )
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    return _grant_result(
        grant_name,
        node_id,
        stored_principal,
        role,
        normalized_expiry,
        password_hash,
    )


def revoke(node_id: str, principal: str, principals: Principals) -> None:
    """Delete only the named local grant; inherited rows remain untouched."""
    node = _node_or_not_found(node_id)
    _require_manage(node, principals)
    savepoint = f"drive_revoke_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        existing = frappe.db.get_value(
            "Drive Grant",
            {"node": node_id, "principal": principal},
            ["name", "role"],
            as_dict=True,
            for_update=True,
        )
        if not existing:
            frappe.db.release_savepoint(savepoint)
            return
        frappe.db.delete("Drive Grant", {"name": existing.name})
        _write_activity(
            node_id,
            "share_remove",
            principals,
            {"principal": principal, "old_role": existing.role, "new_role": None},
        )
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    else:
        frappe.db.release_savepoint(savepoint)


def revoke_below(node_id: str, principal: str, principals: Principals) -> int:
    """Delete a principal's grant at the origin and throughout its subtree."""
    node = _node_or_not_found(node_id)
    _require_manage(node, principals)
    is_root = node.kind == "root"
    root = node.name if is_root else node.root
    prefix = "" if is_root else f"{node.path or '/'}{node.name}/%"

    savepoint = f"drive_revoke_below_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        frappe.db.sql(
            """
            DELETE g FROM `tabDrive Grant` g
            JOIN `tabDrive Node` n ON n.name = g.node
            WHERE g.principal = %(principal)s
              AND (
                n.name = %(node)s
                OR (n.root = %(root)s AND (%(is_root)s OR n.path LIKE %(prefix)s))
              )
            """,
            {
                "principal": principal,
                "node": node.name,
                "root": root,
                "is_root": is_root,
                "prefix": prefix,
            },
        )
        deleted = frappe.db._cursor.rowcount
        _write_activity(
            node.name,
            "share_remove",
            principals,
            {"principal": principal, "scope": "below", "rows": deleted},
        )
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return deleted


def rotate_link(grant_id: str, principals: Principals) -> dict:
    """Rotate a link principal in place, preserving all link settings."""
    existing = frappe.db.get_value(
        "Drive Grant",
        grant_id,
        ["name", "node", "principal", "role", "expires_on", "password_hash"],
        as_dict=True,
    )
    if not existing:
        raise DriveNotFound(_("Drive grant {0} was not found").format(grant_id))
    node = _node_or_not_found(existing.node)
    _require_manage(node, principals)
    if not existing.principal.startswith("$LINK:"):
        frappe.throw(_("Only a Drive share link can be rotated"), frappe.ValidationError)

    new_principal = _mint_link_principal()
    savepoint = f"drive_rotate_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        locked = frappe.db.get_value(
            "Drive Grant",
            grant_id,
            ["name", "node", "principal", "role", "expires_on", "password_hash"],
            as_dict=True,
            for_update=True,
        )
        if not locked:
            raise DriveNotFound(_("Drive grant {0} was not found").format(grant_id))
        if not locked.principal.startswith("$LINK:"):
            frappe.throw(_("Only a Drive share link can be rotated"), frappe.ValidationError)
        frappe.db.set_value("Drive Grant", grant_id, "principal", new_principal)
        _write_activity(
            locked.node,
            "share_edit",
            principals,
            {
                "old_principal": locked.principal,
                "new_principal": new_principal,
                "new_role": locked.role,
                "expires_on": _json_datetime(locked.expires_on),
                "has_password": bool(locked.password_hash),
            },
        )
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    return _grant_result(
        locked.name,
        locked.node,
        new_principal,
        locked.role,
        locked.expires_on,
        locked.password_hash,
    )


def unlock_link(token: str, password: str) -> dict:
    """Verify one link password and return a stateless, 30-day proof."""
    if not _valid_link_token(token):
        raise DriveNotFound(_("Drive link was not found"))
    rows = frappe.get_all(
        "Drive Grant",
        filters={"principal": f"$LINK:{token}"},
        fields=["name", "role", "expires_on", "password_hash"],
        order_by="name asc",
    )
    if not rows:
        raise DriveNotFound(_("Drive link was not found"))

    capabilities = [row for row in rows if row.role > NONE]
    current = [
        row for row in capabilities if not row.expires_on or get_datetime(row.expires_on) > now_datetime()
    ]
    protected = [row for row in current if row.password_hash]
    if len(protected) > 1:
        raise DriveForbidden(_("This Drive link has ambiguous password grants"))
    if protected:
        row = protected[0]
    elif not current and capabilities:
        raise DriveLinkExpired(_("This Drive link has expired"))
    else:
        raise DriveForbidden(_("This Drive link does not require a password"))

    cache_key = f"drive:link_unlock:{token}"
    cache = frappe.cache()
    raw_cache_key = cache.make_key(cache_key)
    raw_lock_key = cache.make_key(f"drive:link_unlock:lock:{token}")
    outcome = _verify_link_password(
        cache,
        raw_cache_key,
        raw_lock_key,
        password,
        row.password_hash,
    )
    if outcome == "locked":
        frappe.throw(
            _("Too many failed Drive link unlock attempts; try again later"),
            frappe.RateLimitExceededError,
        )
    if outcome == "busy":
        frappe.throw(_("Drive link unlock is busy; try again"), frappe.ValidationError)
    if outcome == "failed":
        raise DriveLocked(_("The Drive link password is incorrect"))
    expires = int(time.time()) + TICKET_TTL
    return {
        "ticket": make_ticket(token, row.password_hash, expires),
        "expires": expires,
    }


def _unlock_bucket_locked(cache, raw_cache_key: bytes) -> bool:
    value = cache.get(raw_cache_key)
    return value == b"locked" or value == "locked"


def _verify_link_password(
    cache,
    raw_cache_key: bytes,
    raw_lock_key: bytes,
    password: str,
    password_hash: str,
) -> str:
    """Serialize check, passlib verification, and bucket mutation per token."""
    lock = cache.lock(raw_lock_key, timeout=30)
    if not lock.acquire(blocking=True, blocking_timeout=10):
        return "busy"
    try:
        if _unlock_bucket_locked(cache, raw_cache_key):
            return "locked"
        if passlibctx.verify(password, password_hash):
            cache.delete(raw_cache_key)
            return "success"
        return "locked" if _record_unlock_failure(cache, raw_cache_key) < 0 else "failed"
    finally:
        lock.release()


def _record_unlock_failure(cache, raw_cache_key: bytes) -> int:
    """Atomically count one failure and turn the fifth into a lockout bucket."""
    return int(
        cache.eval(
            _UNLOCK_FAILURE_SCRIPT,
            1,
            raw_cache_key,
            UNLOCK_FAILURE_LIMIT,
            UNLOCK_WINDOW_SECONDS,
        )
    )


def _node_or_not_found(node_id: str) -> frappe._dict:
    node = frappe.db.get_value(
        "Drive Node",
        node_id,
        ["name", "root", "path", "kind"],
        as_dict=True,
    )
    if not node:
        raise DriveNotFound(_("Drive node {0} was not found").format(node_id))
    return node


def _require_manage(node: Mapping, principals: Principals) -> None:
    if effective_role(node, principals) < MANAGE:
        raise DriveForbidden(
            _("You do not have the required access to Drive node {0}").format(node.get("name"))
        )


def _principal_kind(principal: str) -> str | None:
    if not isinstance(principal, str) or not principal or len(principal) > 200:
        return None
    if principal in ("$GENERAL", "$PUBLIC"):
        return "open" if principal == "$PUBLIC" else "general"
    if principal == "$LINK":
        return "link"
    if principal.startswith("$LINK:"):
        return "link" if _valid_link_token(principal.removeprefix("$LINK:")) else None
    if principal.startswith("$GROUP:"):
        return "group" if principal.removeprefix("$GROUP:") else None
    if principal.startswith("$"):
        return None
    return "user" if validate_email_address(principal) == principal else None


def _validate_principal_target(principal: str, principal_kind: str) -> None:
    if principal_kind == "user" and not frappe.db.exists("User", principal):
        frappe.throw(_("Drive grant user does not exist"), frappe.ValidationError)
    if principal_kind == "group" and not frappe.db.exists("User Group", principal.removeprefix("$GROUP:")):
        frappe.throw(_("Drive grant user group does not exist"), frappe.ValidationError)


def _is_personal_root_owner(node: Mapping, principal: str) -> bool:
    root_id = node.get("name") if node.get("kind") == "root" else node.get("root")
    root = frappe.db.get_value("Drive Root", root_id, ["kind", "user"], as_dict=True)
    return bool(root and root.kind == "Personal" and root.user == principal)


def _future_expiry(expires_on: datetime | str | None) -> datetime | None:
    if expires_on is None:
        return None
    try:
        expiry = get_datetime(expires_on)
        if expiry is None:
            raise ValueError
        is_past = expiry < now_datetime()
    except (TypeError, ValueError, OverflowError):
        frappe.throw(_("Drive grant expiry is invalid"), frappe.ValidationError)
    if is_past:
        frappe.throw(_("Drive grant expiry cannot be in the past"), frappe.ValidationError)
    return expiry


def _valid_link_token(token: str) -> bool:
    return len(token) == 22 and token.isascii() and token.isalnum()


def _mint_link_principal() -> str:
    while True:
        token = "".join(secrets.choice(BASE62) for _ in range(22))
        principal = f"$LINK:{token}"
        if not frappe.db.exists("Drive Grant", {"principal": principal}):
            return principal


def _write_activity(
    node: str,
    action: str,
    principals: Principals,
    detail: dict,
) -> None:
    from suite.drive._core.activity import notify_users, record

    activity = record(principals, node, action, detail=detail)
    target = detail.get("principal")
    if isinstance(target, str) and target and not target.startswith("$"):
        notify_users(activity, (target,))


def _json_datetime(value) -> str | None:
    return str(value) if value else None


def _grant_result(
    name: str,
    node: str,
    principal: str,
    role: int,
    expires_on,
    password_hash: str | None,
) -> dict:
    result = {
        "name": name,
        "node": node,
        "principal": principal,
        "role": role,
        "expires_on": expires_on,
        "has_password": password_hash is not None,
    }
    if principal.startswith("$LINK:"):
        result["url"] = f"/drive/l/{principal.removeprefix('$LINK:')}"
    return result
