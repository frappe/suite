"""Point access resolution for Drive nodes."""

import dataclasses
import secrets
import string
import time
from collections.abc import Callable, Mapping
from datetime import datetime
from enum import Enum
from typing import Literal
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
    rollback_savepoint,
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

# §5.8's `EXPLAIN_SQL` over the ancestors only, with each row's node title:
# the share dialog's "From <folder>" parts (issue 44, D19).
INHERITED_SQL = """
SELECT g.name, g.node, g.principal, g.role, g.expires_on, g.password_hash, g.sent_to,
       n.title AS source_title
FROM `tabDrive Grant` g
JOIN `tabDrive Node` n ON n.name = g.node
WHERE g.node IN %(chain)s
  AND (g.expires_on IS NULL OR g.expires_on > %(now)s)
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
# The share-link entry route (§6.2). A website route, outside the Drive area,
# so the URL a grant returns stays valid whichever route table
# `suite_flip_files` mounts under `/drive`.
LINK_ROUTE = "/l/"
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


class Keep(Enum):
    """A grant field the caller did not send: the stored value stays."""

    KEEP = "keep"


KEEP = Keep.KEEP


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


def describe(node: Mapping, principals: Principals) -> dict:
    """Answer §11.3's `access` expansion from the resolution `require` runs.

    Same rows, same nearest-wins accumulator, same deciding-link rule, so an
    adapter never re-implements policy to show a caller why they got in. It
    reports; it never refuses. A caller below READ is not this function's
    problem: `require` has already raised by the time an expansion is built.
    """
    if principals.is_admin:
        return _admin_description()
    if not principals.all():
        return _empty_description()

    _role, rows, depth, ticket_results = _point_state(node, principals)
    return _describe_rows(rows, depth, principals, ticket_results)


def describe_page(
    chain: list[str],
    child_rows: Mapping[str, list],
    chain_rows: list,
    principals: Principals,
) -> dict[str, dict]:
    """Describe a page of children from the rows the folder page already read.

    §5.3 buys the whole page in three queries and `effective_roles` spends them
    on the role alone. The deciding row is in the same result set, so an
    `?expand=access` list costs no query that a plain list did not already run.
    """
    if principals.is_admin:
        return {child_id: _admin_description() for child_id in child_rows}
    if not principals.all():
        return {child_id: _empty_description() for child_id in child_rows}

    ticket_results = {}
    depth = {node_id: index for index, node_id in enumerate(chain)}
    child_depth = len(chain)
    return {
        child_id: _describe_rows(
            [*chain_rows, *rows],
            {**depth, child_id: child_depth},
            principals,
            ticket_results,
        )
        for child_id, rows in child_rows.items()
    }


def _describe_rows(
    rows: list, depth: Mapping[str, int], principals: Principals, ticket_results: dict
) -> dict:
    unlocked = [row for row in rows if _grant_is_unlocked(row, principals, ticket_results)]
    acc = Acc()
    for row in unlocked:
        acc.offer(row.principal, row.role, depth[row.node], principals)
    role = acc.answer()

    # Own before open, then deepest. When pass 1 ties pass 2, §5.1 makes pass 1
    # the answer, and `_authorizing_link` reports no link for exactly that tie.
    # Sorting on depth alone would name a link as the source of a role the
    # caller already held, contradicting `via_link` in the same payload.
    winners = sorted(
        (row for row in unlocked if _is_winner(row, acc, depth, principals)),
        key=lambda row: (row.principal not in principals.own, -depth[row.node], row.principal),
    )
    winner = winners[0] if winners else None
    return {
        "role": role,
        "via_link": _authorizing_link(rows, depth, principals, role, ticket_results) if role else None,
        "source_node": winner.node if winner else None,
        "source_principal": winner.principal if winner else None,
    }


def _admin_description() -> dict:
    return {"role": MANAGE, "via_link": None, "source_node": None, "source_principal": None}


def _empty_description() -> dict:
    return {"role": NONE, "via_link": None, "source_node": None, "source_principal": None}


def chain_roles(node: Mapping, principals: Principals) -> dict[str, int]:
    """Resolve the caller's role at every id on one node's chain, root first.

    One grant query over the whole chain, then the same nearest-wins pass per
    prefix. A breadcrumb trail needs to know where a caller's sight begins, and
    the chain is capped at depth 40 (§3.1), so the repeated pass is bounded.
    """
    chain = chain_ids(node)
    if principals.is_admin:
        return dict.fromkeys(chain, MANAGE)
    if not principals.all():
        return dict.fromkeys(chain, NONE)

    depth = {node_id: index for index, node_id in enumerate(chain)}
    rows = frappe.db.sql(
        POINT_SQL,
        {"chain": chain, "principals": principals.all(), "now": now()},
        as_dict=True,
    )
    ticket_results = {}
    return {
        node_id: _resolve_rows(
            [row for row in rows if depth[row.node] <= index],
            depth,
            principals,
            ticket_results=ticket_results,
        )
        for index, node_id in enumerate(chain)
    }


def explain(node: Mapping, principals: Principals, *, subject: Principals | None = None) -> dict:
    """Return current grant candidates and mark the rows deciding the answer.

    §5.8 needs MANAGE at the node, like the share dialog it feeds. That is a
    condition on the *caller*: `subject` names whoever is being explained, and
    a stranger is the ordinary case, so their own role decides nothing about
    who may ask. `require` supplies the refusal, which means a caller below
    READ gets 404 rather than a 403 confirming the node exists (§5.2).

    Expired rows are absent, because `EXPLAIN_SQL` filters them: §6.4 keeps an
    expired grant on disk and makes it inert, and an inert row is not a
    candidate for anything. Rows the subject does not hold are present, marked
    `held: false`, because "why can this person not reach it" is the other half
    of the question the dialog asks.
    """
    require(node, MANAGE, principals)
    subject = subject or principals
    if subject.is_admin:
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
        if row.principal in subject.all() and _grant_is_unlocked(row, subject, ticket_results):
            acc.offer(row.principal, row.role, depth[row.node], subject)

    answer = acc.answer()
    out = []
    for row in sorted(rows, key=lambda candidate: (-depth[candidate.node], candidate.principal)):
        held = row.principal in subject.all()
        out.append(
            {
                "node": row.node,
                "depth": depth[row.node],
                "principal": row.principal,
                "role": row.role,
                "expires_on": row.expires_on,
                "pass": 1 if row.principal in subject.own else 2,
                "held": held,
                "winner": held
                and _grant_is_unlocked(row, subject, ticket_results)
                and _is_winner(row, acc, depth, subject),
            }
        )
    return {"role": answer, "source": "grant" if answer else "none", "rows": out}


def grants_for(
    node_id: str,
    principals: Principals,
    *,
    inherited: bool = False,
    resolve_subject: Callable[[], Principals] | None = None,
) -> dict:
    """Answer one node's share dialog: its local grants, and one explanation.

    `grants` holds local rows only, because §5.10 keeps removal and denial
    apart: a list that merged in an ancestor's rows would promise an unshare
    it did not perform. `inherited` asks for those rows separately, each with
    the ancestor it sits on, nearest ancestor first. It is one read over the
    chain, `EXPLAIN_SQL` without the node itself, so only live rows appear. A
    deny on the node itself is local and stays in `grants`.

    Expired rows are listed. §6.4 retains them and makes them inert, and a
    dialog that hid one would offer to create a duplicate of a row that is
    still there. Their `expires_on` is the whole difference between an expired
    row and a live one. `password_hash` never leaves this function; the listed
    row says `has_password` instead.

    The subject arrives as a *callable*, not as a value, and that is the point.
    §11.2 requires MANAGE on the target before another principal is evaluated,
    so whoever `?principal=` named is resolved here, after the gate. Resolving
    them at the call site would answer "that names no user" to a caller with no
    right to ask anything about this node at all.

    `owner` names the user whose Personal root holds the node, with their full
    name, or is None in the Shared root. Their access comes from the root's
    anchor grant, and `grant` refuses to deny them, so the dialog lists them
    first as Owner with no actions.
    """
    node = _node_or_not_found(node_id)
    require(node, MANAGE, principals)
    rows = frappe.get_all(
        "Drive Grant",
        filters={"node": node.name},
        fields=["name", "node", "principal", "role", "expires_on", "password_hash", "sent_to"],
        order_by="principal asc",
    )
    owner = _personal_root_owner(node)
    answer = {
        "grants": [_grant_result(row) for row in rows],
        "owner": _user_entry(owner) if owner else None,
    }
    if inherited:
        answer["inherited"] = _inherited_grants(node, principals)
    if resolve_subject is not None:
        answer["explain"] = explain(node, principals, subject=resolve_subject())
    return answer


def _inherited_grants(node: Mapping, principals: Principals) -> list[dict]:
    """Answer the ancestors' live grants, with link secrets kept to their managers.

    A link row's principal is its token, and its `url` and `sent_to` name the
    secret and the outsider it went to. MANAGE here does not imply MANAGE on
    the ancestor, and an unprotected ancestor link reaches that ancestor's
    whole subtree, siblings included. So a link row on an ancestor the caller
    does not manage is `redacted`: it says a link exists, with its role,
    expiry, and whether it has a password, and nothing that would open it.
    """
    ancestors = chain_ids(node)[:-1]
    if not ancestors:
        return []
    depth = {node_id: index for index, node_id in enumerate(ancestors)}
    rows = frappe.db.sql(INHERITED_SQL, {"chain": ancestors, "now": now()}, as_dict=True)
    rows.sort(key=lambda row: (-depth[row.node], row.principal))
    roles = chain_roles(node, principals)
    answer = []
    for row in rows:
        redacted = row.principal.startswith("$LINK:") and roles[row.node] < MANAGE
        answer.append(
            {
                "grant": _redacted_link(row) if redacted else _grant_result(row),
                "redacted": redacted,
                "source_node": row.node,
                "source_title": row.source_title,
            }
        )
    return answer


def _redacted_link(row: Mapping) -> dict:
    """Describe a link row without its token, URL, grant id, or address."""
    return {
        "node": row["node"],
        "principal": "$LINK",
        "role": row["role"],
        "expires_on": row["expires_on"],
        "has_password": bool(row["password_hash"]),
    }


def resolve_link(token: str) -> dict:
    """Answer which node one share-link token addresses (§6.2).

    The website route `/l/<token>` has to name a node before the SPA can
    ask for anything, so this resolves the grant and stops there. It does not
    check a role and it does not ask for a password: a password link's holder
    needs the node id in order to be told, by the ordinary node route, that it
    is locked (§4.8). Everything the token then authorizes is decided by
    `require` on each request, from the token presented in `X-Drive-Links`.

    Refuses an unknown or malformed token with `DriveNotFound`, and a token
    whose every capability row is past `expires_on` with `DriveLinkExpired`, so
    an expired link stays distinguishable from one that never existed (§6.4).
    """
    if not isinstance(token, str) or not _valid_link_token(token):
        raise DriveNotFound(_("Drive link was not found"))
    principal = f"$LINK:{token}"
    rows = frappe.get_all(
        "Drive Grant",
        filters={"principal": principal},
        fields=["name", "node", "role", "expires_on", "password_hash"],
        order_by="name asc",
    )
    if not rows:
        raise DriveNotFound(_("Drive link was not found"))
    capabilities = [row for row in rows if row.role > NONE]
    current = [
        row for row in capabilities if not row.expires_on or get_datetime(row.expires_on) > now_datetime()
    ]
    if not current:
        if capabilities:
            raise DriveLinkExpired(_("This Drive link has expired"))
        raise DriveNotFound(_("Drive link was not found"))
    row = current[0]
    return {
        "token": token,
        "principal": principal,
        "node": row.node,
        "role": row.role,
        "expires_on": row.expires_on,
        "has_password": bool(row.password_hash),
    }


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
    password: str | None | Keep = KEEP,
    send_to: str | None = None,
    notify: bool = False,
) -> dict:
    """Create or update one local grant after the ordered refusal checks.

    `role` and `expires_on` are replaced on every write; `expires_on=None`
    clears the expiry. `password` is patched: `KEEP` leaves the stored hash,
    `None` clears it, and a string sets it (§5.9 step 3).

    `send_to` mails a new link to one address and stores the address on the
    row. `notify` mails a user principal. Both mails are queued after commit
    and never fail the grant (§9.5).
    """
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
    if isinstance(password, str) and principal_kind != "link":
        raise DriveForbidden(_("Only a Drive share link can have a password"))
    if role == NONE and _is_personal_root_owner(node, principal):
        raise DriveForbidden(_("A Personal Drive root owner cannot be denied"))
    _refuse_owner_loss(node, principal, role=role, expires_on=expires_on)
    if principal.startswith("$LINK:"):
        _refuse_borrowed_link_token(node, principal, role)

    normalized_expiry = _future_expiry(expires_on)
    if send_to is not None:
        if principal != "$LINK":
            frappe.throw(_("Only a new Drive share link can be sent to an address"), frappe.ValidationError)
        if not _single_address(send_to):
            frappe.throw(_("A Drive share link is sent to exactly one address"), frappe.ValidationError)
    if notify and principal_kind != "user":
        frappe.throw(_("Only a Drive grant to a user can notify by email"), frappe.ValidationError)
    stored_principal = _mint_link_principal() if principal == "$LINK" else principal

    savepoint = f"drive_grant_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        existing = frappe.db.get_value(
            "Drive Grant",
            {"node": node_id, "principal": stored_principal},
            ["name", "role", "expires_on", "password_hash", "sent_to"],
            as_dict=True,
            for_update=True,
        )
        # A trashed node is read-only (§4.2, §8.8), so it gains no new access.
        # A write that only takes access away stays open, as revoke does.
        if node.state != "Active" and not _only_takes_access_away(
            existing, principal, role, normalized_expiry, password, notify
        ):
            raise DriveForbidden(_("A trashed Drive node cannot gain access"))
        changes = {"role": role, "expires_on": normalized_expiry}
        if password is not KEEP:
            changes["password_hash"] = passlibctx.hash(password) if password is not None else None
        if existing:
            frappe.db.set_value("Drive Grant", existing.name, changes)
            grant_name = existing.name
            action = "share_edit"
            old_role = existing.role
            password_hash = changes.get("password_hash", existing.password_hash)
            sent_to = existing.sent_to
        else:
            row = frappe.get_doc(
                {
                    "doctype": "Drive Grant",
                    "node": node_id,
                    "principal": stored_principal,
                    "sent_to": send_to,
                    **changes,
                }
            ).insert(ignore_permissions=True)
            grant_name = row.name
            action = "share_add"
            old_role = None
            password_hash = row.password_hash
            sent_to = send_to
        _write_activity(
            node_id,
            action,
            principals,
            {
                "principal": stored_principal,
                "old_role": old_role,
                "new_role": role,
                "expires_on": _json_datetime(normalized_expiry),
                "has_password": bool(password_hash),
            },
        )
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    written = _grant_result(
        frappe._dict(
            name=grant_name,
            node=node_id,
            principal=stored_principal,
            role=role,
            expires_on=normalized_expiry,
            password_hash=password_hash,
            sent_to=sent_to,
        )
    )
    if send_to is not None or notify:
        from suite.drive._core.activity import queue_share_email
        from suite.drive._core.nodes import node_url

        # A link share mails the link; a user share mails the node's address.
        recipient, path = (send_to, written["url"]) if send_to is not None else (principal, node_url(node_id))
        queue_share_email(node_id, recipient, role, path, principals.user)
    return written


def _only_takes_access_away(
    existing: Mapping | None,
    principal: str,
    role: int,
    expires_on: datetime | None,
    password: str | None | Keep,
    notify: bool,
) -> bool:
    """Whether a grant write on a trashed node only removes or lowers access.

    A deny always does. Any other write must lower an existing row's role and
    change nothing that would widen it: no new link, no password change, no
    later expiry, and no share email.
    """
    if principal == "$LINK" or notify:
        return False
    if role == NONE:
        return True
    if not existing or role >= existing["role"] or password is not KEEP:
        return False
    if existing["expires_on"] is None:
        return True
    return expires_on is not None and expires_on <= existing["expires_on"]


def revoke(node_id: str, principal: str, principals: Principals) -> None:
    """Delete only the named local grant; inherited rows remain untouched."""
    node = _node_or_not_found(node_id)
    _require_manage(node, principals)
    _refuse_owner_loss(node, principal)
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
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)


def revoke_below(node_id: str, principal: str, principals: Principals) -> int:
    """Delete a principal's grant at the origin and throughout its subtree."""
    node = _node_or_not_found(node_id)
    _require_manage(node, principals)
    _refuse_owner_loss(node, principal)
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
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
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
            ["name", "node", "principal", "role", "expires_on", "password_hash", "sent_to"],
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
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    return _grant_result(frappe._dict(locked, principal=new_principal))


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
    elif not capabilities:
        # Deny rows only. §6.1 lets a link principal name a deny on a child,
        # and a row that confers nothing is not a link: §5.11 answers a token
        # that names no grant with `DriveNotFound`, and so does `resolve_link`.
        raise DriveNotFound(_("Drive link was not found"))
    elif not current:
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
    if outcome.kind == "locked":
        # 429, never the wrong-password 401: the fifth failure is a lockout
        # too, and `retry_after` tells the HTTP boundary how long it has left.
        lockout = frappe.RateLimitExceededError()
        lockout.retry_after = outcome.retry_after
        frappe.throw(_("Too many failed Drive link unlock attempts; try again later"), lockout)
    if outcome.kind == "busy":
        frappe.throw(_("Drive link unlock is busy; try again"), frappe.ValidationError)
    if outcome.kind == "failed":
        raise DriveLocked(_("The Drive link password is incorrect"))
    expires = int(time.time()) + TICKET_TTL
    return {
        "ticket": make_ticket(token, row.password_hash, expires),
        "expires": expires,
    }


@dataclasses.dataclass(frozen=True)
class UnlockOutcome:
    """What one password attempt decided, under the per-token lock."""

    kind: Literal["success", "failed", "locked", "busy"]
    # Whole seconds left in the lockout, for `locked` only.
    retry_after: int = 0


def _locked_out(cache, raw_cache_key: bytes) -> UnlockOutcome:
    """Answer a lockout with the seconds left in the bucket that refused.

    Called under the per-token lock. Once the lock is released, the lockout
    can expire and another failure can open a fresh counter in its key, so a
    later read would describe that counter instead. The bucket can also
    expire between the refusal and this read, and redis then answers -2. The
    caller was refused all the same, so it waits one second.
    """
    return UnlockOutcome("locked", max(int(cache.ttl(raw_cache_key)), 1))


def _unlock_bucket_locked(cache, raw_cache_key: bytes) -> bool:
    value = cache.get(raw_cache_key)
    return value == b"locked" or value == "locked"


def _verify_link_password(
    cache,
    raw_cache_key: bytes,
    raw_lock_key: bytes,
    password: str,
    password_hash: str,
) -> UnlockOutcome:
    """Serialize check, passlib verification, and bucket mutation per token."""
    lock = cache.lock(raw_lock_key, timeout=30)
    if not lock.acquire(blocking=True, blocking_timeout=10):
        return UnlockOutcome("busy")
    try:
        if _unlock_bucket_locked(cache, raw_cache_key):
            return _locked_out(cache, raw_cache_key)
        if passlibctx.verify(password, password_hash):
            cache.delete(raw_cache_key)
            return UnlockOutcome("success")
        failures = _record_unlock_failure(cache, raw_cache_key)
        # -1 is a bucket that was already locked; the limit is the failure
        # that just locked it. Both answer as a lockout (§6.3).
        if failures < 0 or failures >= UNLOCK_FAILURE_LIMIT:
            return _locked_out(cache, raw_cache_key)
        return UnlockOutcome("failed")
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
        ["name", "root", "path", "kind", "state"],
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


def _refuse_borrowed_link_token(node: Mapping, principal: str, role: int) -> None:
    """Keep a share-link token the server's to mint and one node's to address.

    §5.9 step 1 and §11.2 both say the server mints the 22-char token, so a
    caller writing `$LINK:<token>` is naming a link that already exists, never
    creating one. Two rules follow, and without them a `PUT` on any node the
    caller manages reaches a link they do not own.

    1. The token must already name a row. Otherwise a caller could publish
       `$LINK:aaaaaaaaaaaaaaaaaaaaaa` and call the guessable result a secret.
    2. At most one row per token may carry a capability. §6.1 gives a token one
       row that grants and, below it, ordinary deny rows; §5.11's `unlock_link`
       and §6.2's `resolve_link` both read a token as one grant. A second
       capability row elsewhere makes a password link answer "ambiguous" for
       everyone holding it, and makes `/l/<token>` resolve to whichever
       node sorts first.

    A deny (role NONE) stays legal on any node, because that is exactly §6.1's
    "a deny naming a link principal on a child is an ordinary grant row", and a
    row that confers nothing is invisible to both readers above.
    """
    rows = frappe.get_all(
        "Drive Grant",
        filters={"principal": principal},
        fields=["node", "role"],
    )
    if not rows:
        frappe.throw(
            _("A Drive share link is created with the principal $LINK, and its token is minted"),
            frappe.ValidationError,
        )
    if role > NONE and any(row.node != node.get("name") and row.role > NONE for row in rows):
        raise DriveForbidden(_("That Drive share link already addresses another node"))


def _personal_root_owner(node: Mapping) -> str | None:
    """Answer the user whose Personal root holds `node`, or None in the Shared root."""
    root_id = node.get("name") if node.get("kind") == "root" else node.get("root")
    root = frappe.db.get_value("Drive Root", root_id, ["kind", "user"], as_dict=True)
    return root.user if root and root.kind == "Personal" else None


def _refuse_owner_loss(
    node: Mapping, principal: str, *, role: int | None = None, expires_on: datetime | str | None = None
) -> None:
    """Refuse a write to a Personal root's anchor grant, which gives its owner MANAGE.

    Removing that row, lowering it, or giving it an expiry would lock the
    owner out of their own files. Rows below the root are ordinary grants.
    `role=None` is a removal, and on the root `revoke_below` removes the
    anchor too.
    """
    if node.get("kind") != "root" or not _is_personal_root_owner(node, principal):
        return
    if role is None or role < MANAGE or expires_on is not None:
        raise DriveForbidden(_("The owner of a Personal Drive root keeps Manage on their own files"))


def _user_entry(user: str) -> dict:
    return {"user": user, "full_name": frappe.db.get_value("User", user, "full_name") or user}


def _is_personal_root_owner(node: Mapping, principal: str) -> bool:
    owner = _personal_root_owner(node)
    return owner is not None and owner == principal


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
    targets = tuple(
        target
        for key in ("principal", "old_principal", "new_principal")
        if isinstance((target := detail.get(key)), str) and target
    )
    from suite.drive._core.changes import emit_for_principals

    emit_for_principals(targets)
    target = detail.get("principal")
    if isinstance(target, str) and target and not target.startswith("$"):
        notify_users(activity, (target,))


def _single_address(value) -> bool:
    """Answer whether `value` is one bare email address and nothing else.

    `validate_email_address` accepts a list split on commas and newlines, and
    a `Name <address>` form. One link is minted for one outsider (unified
    frontend spec §7.8), so only the bare address itself passes.
    """
    if not isinstance(value, str) or any(ch in value for ch in ',;<>"') or value.split() != [value]:
        return False
    return validate_email_address(value) == value


def _json_datetime(value) -> str | None:
    return str(value) if value else None


def _grant_result(row: Mapping) -> dict:
    """Publish one stored grant row; `password_hash` never leaves `_core`."""
    principal = row["principal"]
    result = {
        "name": row["name"],
        "node": row["node"],
        "principal": principal,
        "role": row["role"],
        "expires_on": row["expires_on"],
        # Truthiness, not `is not None`: the authorization path reads the
        # column the same way, so an empty string cannot mean "locked" here
        # and "open" there.
        "has_password": bool(row["password_hash"]),
        "sent_to": row.get("sent_to"),
    }
    if principal.startswith("$LINK:"):
        result["url"] = LINK_ROUTE + principal.removeprefix("$LINK:")
    return result
