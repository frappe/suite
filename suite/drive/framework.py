"""Frappe request adapter for Drive identity and permission hooks.

Frappe dotted hook targets terminate here, never in `_core`. The four
permission entry points below keep the framework's own keyword signatures:
`has_permission` hooks are called as
`method(doc=doc, ptype=ptype, user=user, debug=debug)` and
`permission_query_conditions` hooks as `method(user, doctype=doctype)`.

`frappe.call` drops a keyword the signature does not name rather than raising,
so a wrong signature fails silently: a `doc_query_conditions` that lost
`doctype` would return "" and filter nothing. The contract test in
`suite/drive/tests/test_content.py` is what freezes these four signatures
(§10.3).
"""

import frappe
from frappe import _
from frappe.utils import now

from suite.drive._core import content
from suite.drive._core.access import check
from suite.drive._core.errors import DriveConflict, DriveNotFound
from suite.drive._core.principals import Principals, parse_link_header
from suite.drive._core.roles import DEFAULT_PTYPE_ROLE, EDIT, PTYPE_ROLE, READ

ACCESS_NODE_FIELDS = ("name", "kind", "root", "path", "state")

# A grant on `g` decides a node when it sits on the node itself, on its root,
# or on an ancestor named in its materialized path. `LOCATE` gives the
# ancestor's position in that path, which is monotonic with depth, so the same
# expression answers "does it apply" and "how near is it" with no JSON_TABLE
# and no lateral join (§5.1, §5.7).
NODE_DEPTH = 1_000_000


def is_drive_admin(user: str | None = None) -> bool:
    user = user or frappe.session.user
    return user == "Administrator" or "Suite Admin" in frappe.get_roles(user)


def principals_for_request() -> Principals:
    """Build the caller's identity principals once at the framework boundary."""
    return principals_for(frappe.session.user)


def principals_for(user: str | None = None) -> Principals:
    """Build principals for one user, with this request's link credentials.

    Link credentials belong to the request, so they are read only when `user`
    is the session user. A permission hook asked about somebody else answers
    from that person's own principals alone.
    """
    session_user = frappe.session.user
    user = user or session_user
    credentials = _request_credentials() if user == session_user else ()
    links = tuple(credential.principal for credential in credentials)
    tickets = tuple(
        (credential.principal, credential.exp, credential.mac)
        for credential in credentials
        if credential.exp is not None and credential.mac is not None
    )
    if user == "Guest":
        return Principals(
            user=user,
            own=(),
            open=("$PUBLIC", *links),
            is_admin=False,
            link_tickets=tickets,
        )

    groups = frappe.cache().hget("drive_user_groups", user, generator=lambda: _user_groups(user))
    own = (user, *(f"$GROUP:{group}" for group in groups), "$GENERAL")
    return Principals(
        user=user,
        own=own,
        open=("$PUBLIC", *links),
        is_admin=is_drive_admin(user),
        link_tickets=tickets,
    )


def validate_content_registry() -> None:
    """Prove every declared content type against its doctype, at boot.

    Suite composition calls this after a migration, the point where the node
    links the contract needs are known to exist. An invalid declaration stops
    the migration rather than reaching a request, because every document
    workflow reads the same registry.
    """
    content.validate_registry()


def doc_has_permission(doc, ptype="read", user=None, debug=False) -> bool:
    """Answer one content document row check through its node (§10.3).

    The ptype maps to a role with the §4.3 table, the node comes from the
    registered `node_field`, and one point check answers. There is no
    "document without a node" fallback: under §5.13 that state cannot exist,
    so it is an error.
    """
    spec = content.spec_for(doc.doctype)
    return _node_allows(_document_node_of(doc, spec), _role_for_ptype(ptype), user)


def doc_query_conditions(user: str | None = None, doctype: str | None = None) -> str:
    """Filter a content doctype list to its readable nodes (§10.3).

    This replaces the owner-or-direct-share SQL Drive shipped before, which
    could not see a folder-inherited grant.
    """
    if not doctype:
        return ""
    spec = content.spec_for(doctype)
    return _list_predicate(f"`tab{doctype}`.`{spec.node_field}`", user)


def satellite_has_permission(doc, ptype="read", user=None, debug=False) -> bool:
    """Answer one satellite row check through its document's node (§10.3).

    Read to see, Edit to change. A satellite holds no rights of its own.
    """
    spec, satellite = content.satellite_for(doc.doctype)
    docname = doc.get(satellite.link_field)
    if not docname:
        raise DriveConflict(_("A Drive satellite requires its content document"))
    node = frappe.db.get_value(spec.doctype, docname, spec.node_field)
    if not node:
        raise DriveConflict(_("A Drive content document requires its node"))
    role = READ if ptype in (None, "read", "select") else EDIT
    return _node_allows(node, role, user)


def satellite_query_conditions(user: str | None = None, doctype: str | None = None) -> str:
    """Filter a satellite list to the documents whose nodes the caller reads."""
    if not doctype:
        return ""
    spec, satellite = content.satellite_for(doctype)
    predicate = _list_predicate("`drive_content_owner`.`" + spec.node_field + "`", user)
    if predicate in ("", "1=0"):
        return predicate
    # A child table names its parent through `parent` plus `parenttype`. Names
    # are unique per doctype, not across doctypes, so without the second column
    # a row under an unrelated parent whose name matches a readable document
    # would pass the filter.
    owner = ""
    if satellite.link_field == "parent":
        owner = f"`tab{doctype}`.`parenttype` = {frappe.db.escape(spec.doctype)} AND "
    return (
        f"{owner}`tab{doctype}`.`{satellite.link_field}` IN ("
        f"SELECT `drive_content_owner`.`name` FROM `tab{spec.doctype}` `drive_content_owner` "
        f"WHERE {predicate})"
    )


def _request_credentials():
    request = getattr(frappe.local, "request", None)
    header = request.headers.get("X-Drive-Links") if request is not None else None
    return parse_link_header(header)


def _user_groups(user: str) -> tuple[str, ...]:
    return tuple(
        frappe.get_all(
            "User Group Member",
            filters={"parenttype": "User Group", "user": user},
            pluck="parent",
            order_by="parent",
        )
    )


def _role_for_ptype(ptype: str | None) -> int:
    # `get_doc_permissions` asks with no ptype at all (`frappe/permissions.py`
    # calls `has_controller_permissions(doc, None)`), so `None` must mean the
    # cheapest verb. Answering EDIT there hides a readable document from every
    # viewer who holds only READ.
    return PTYPE_ROLE.get(ptype or "read", DEFAULT_PTYPE_ROLE)


def _document_node_of(doc, spec) -> str:
    node = doc.get(spec.node_field)
    if not node:
        raise DriveConflict(_("A Drive content document requires its node"))
    return node


def _node_allows(node: str, role: int, user: str | None) -> bool:
    """Run one point check against the node's stored ancestry.

    The row check does not filter the node state. A trashed document is still
    readable through Drive's trash and restore workflows; the list predicate
    is the one that hides it.
    """
    row = frappe.db.get_value("Drive Node", node, ACCESS_NODE_FIELDS, as_dict=True)
    if not row:
        raise DriveNotFound(_("Drive node {0} was not found").format(node))
    return check(row, role, principals_for(user))


def _list_predicate(node_column: str, user: str | None) -> str:
    """Return the §5 nearest-wins Read predicate for one node column.

    A Suite Admin holds MANAGE everywhere, so the filter disappears. Otherwise
    the answer repeats `Acc`: the deepest own grant decides, a deny there wins
    outright, and an open grant can only add. Two simplifications keep it in
    SQL and both refuse more than the engine, never less: grants at the same
    depth are not ordered by own tier, and a password-protected link grant is
    skipped because a list caller presents no unlock ticket.
    """
    principals = principals_for(user)
    if principals.is_admin:
        return ""
    if not principals.all():
        return "1=0"

    own = _nearest_role("drive_own", principals.own, skip_locked=False)
    other = _nearest_role("drive_open", principals.open, skip_locked=True)
    return (
        "EXISTS (SELECT 1 FROM `tabDrive Node` `drive_node` "
        f"WHERE `drive_node`.`name` = {node_column} "
        "AND `drive_node`.`kind` = 'document' AND `drive_node`.`state` = 'Active' "
        f"AND COALESCE({own}, -1) <> 0 "
        f"AND GREATEST(COALESCE({own}, 0), COALESCE({other}, 0)) >= {READ})"
    )


def _nearest_role(alias: str, principals: tuple[str, ...], *, skip_locked: bool) -> str:
    """Return a scalar subquery giving the role the nearest grants decide."""
    if not principals:
        return "NULL"
    live = _live_grants(alias, principals, skip_locked=skip_locked)
    deepest = _live_grants(f"{alias}_deep", principals, skip_locked=skip_locked)
    return (
        "(SELECT CASE WHEN MIN(`{a}`.`role`) = 0 THEN 0 ELSE MAX(`{a}`.`role`) END "
        "FROM `tabDrive Grant` `{a}` WHERE {live} AND {depth} = "
        "(SELECT MAX({deep_depth}) FROM `tabDrive Grant` `{d}` WHERE {deepest}))"
    ).format(
        a=alias,
        d=f"{alias}_deep",
        live=live,
        deepest=deepest,
        depth=_depth_expr(alias),
        deep_depth=_depth_expr(f"{alias}_deep"),
    )


def _live_grants(alias: str, principals: tuple[str, ...], *, skip_locked: bool) -> str:
    spelled = ", ".join(frappe.db.escape(principal) for principal in principals)
    locked = f" AND `{alias}`.`password_hash` IS NULL" if skip_locked else ""
    return (
        f"{_applies_expr(alias)} AND `{alias}`.`principal` IN ({spelled}) "
        f"AND (`{alias}`.`expires_on` IS NULL OR `{alias}`.`expires_on` > {frappe.db.escape(now())})"
        f"{locked}"
    )


def _applies_expr(alias: str) -> str:
    return (
        f"(`{alias}`.`node` = `drive_node`.`name` OR `{alias}`.`node` = `drive_node`.`root` "
        f"OR (COALESCE(`drive_node`.`path`, '') <> '' "
        f"AND LOCATE(CONCAT('/', `{alias}`.`node`, '/'), `drive_node`.`path`) > 0))"
    )


def _depth_expr(alias: str) -> str:
    return (
        f"(CASE WHEN `{alias}`.`node` = `drive_node`.`name` THEN {NODE_DEPTH} "
        f"WHEN `{alias}`.`node` = `drive_node`.`root` THEN 0 "
        f"ELSE LOCATE(CONCAT('/', `{alias}`.`node`, '/'), `drive_node`.`path`) END)"
    )
