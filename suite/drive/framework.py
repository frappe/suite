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

import dataclasses

import frappe
from frappe import _
from frappe.core.doctype.permission_type.permission_type import get_doctype_ptype_map
from frappe.utils import now, validate_email_address

from suite.drive._core import content
from suite.drive._core.access import check
from suite.drive._core.errors import DriveConflict, DriveForbidden, DriveNotFound
from suite.drive._core.principals import Principals, parse_link_header
from suite.drive._core.roles import DEFAULT_PTYPE_ROLE, EDIT, PTYPE_ROLE, READ

ACCESS_NODE_FIELDS = ("name", "kind", "root", "path", "state")

# §1: `Drive Grant` is the only permission table, "source of truth and read
# path". The framework disagrees twice, and both times outside the four hooks
# below, so neither can be answered by returning False:
#
#   row   `perm = false_if_not_shared()` when the hook denied
#         (`frappe/permissions.py:214-216`), so one `DocShare` row re-grants
#         read, write, share, submit, email, and print.
#   list  `where_condition |= table.name.isin(shared_docs)`
#         (`frappe/database/query.py:1739-1742`). With no role read the
#         predicate is not even built and the share alone answers (`:1712-1719`).
#
# So a doctype Drive governs carries no share at all. `refuse_governed_share`
# stops one being written, `validate_content_registry` refuses to activate a
# type that still has rows, and the two read guards refuse outright rather
# than answer False and let the framework widen it.
SHARE_RIGHTS = ("read", "write", "share", "submit", "email", "print")

# A grant on `g` decides a node when it sits on the node itself, on its root,
# or on an ancestor named in its materialized path. `LOCATE` gives the
# ancestor's position in that path, which is monotonic with depth, so the same
# expression answers "does it apply" and "how near is it" with no JSON_TABLE
# and no lateral join (§5.1, §5.7).
NODE_DEPTH = 1_000_000


def handle_http_request() -> None:
    """Run the `/api/suite/drive/` translator on every request on the site.

    Frappe's dotted hook targets terminate in this module (ARCHITECTURE.md),
    so `suite/hooks.py` names this rather than the translator itself. The
    import is function-local because this module is loaded by the permission
    hooks too, and the translator brings in the whole route table; a request
    that is not Drive's leaves after the prefix comparison inside it.
    """
    from suite.drive.http.translator import handle_before_request

    handle_before_request()


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


def principals_for_principal(principal: str) -> Principals:
    """Build the principals one named grant principal reaches with.

    §11.2's `GET /nodes/<id>/grants?principal=<p>` asks what somebody else can
    reach, so the answer needs an identity for them. A `<email>` is a person:
    they carry their groups, `$GENERAL`, and `$PUBLIC` as well, because that is
    what they will actually present. A `$` spelling is not a person and carries
    nothing else of its own, so the answer is what that row confers rather than
    what some particular holder of it might also happen to hold.

    `$PUBLIC` is the exception, and §6.5 is why: every session holds it, Guest
    included. A group, `$GENERAL`, and a link holder all reach a published
    ancestor, so an explanation that withheld `$PUBLIC` would report "no
    access" for people who can in fact read the node.

    The subject never inherits this request's `X-Drive-Links` header, and never
    carries an unlock ticket - including when the named person is the caller,
    which `principals_for` would otherwise treat as the session. One question
    gets one answer whoever asks it. A password link therefore explains as
    locked, the same rule `require` applies on every other surface (§4.8);
    `has_password` on the listed grant row is what names the password itself.

    The five spellings are §4.4's exactly, the same set `grant` accepts. A User
    whose docname is not an address - `Administrator`, `Guest` - can hold no
    grant, so explaining one would answer a question no grant row can pose.
    """
    if not isinstance(principal, str) or not principal.strip():
        frappe.throw(_("A Drive principal is required"), frappe.ValidationError)
    principal = principal.strip()
    if principal == "$PUBLIC":
        return Principals(user=principal, own=(), open=("$PUBLIC",), is_admin=False)
    if principal.startswith("$LINK:"):
        return Principals(user=principal, own=(), open=("$PUBLIC", principal), is_admin=False)
    if principal == "$GENERAL" or principal.startswith("$GROUP:"):
        return Principals(user=principal, own=(principal,), open=("$PUBLIC",), is_admin=False)
    if principal.startswith("$") or validate_email_address(principal) != principal:
        frappe.throw(
            _("Drive principal {0} is not a known spelling").format(principal), frappe.ValidationError
        )
    if not frappe.db.exists("User", principal):
        frappe.throw(_("Drive principal {0} names no user").format(principal), frappe.ValidationError)
    return dataclasses.replace(principals_for(principal), open=("$PUBLIC",), link_tickets=())


def validate_content_registry() -> None:
    """Prove every declared content type against its doctype, at boot.

    Suite composition calls this after a migration, the point where the node
    links the contract needs are known to exist. An invalid declaration stops
    the migration rather than reaching a request, because every document
    workflow reads the same registry.

    A type that still carries `DocShare` rows is refused here too. The read
    guards below already fail closed on one, but they fail closed for the
    person reading, so the migration that would leave them behind is the
    right place to stop.

    So is a row with no node. §5.13 says that state cannot exist, and every
    guard below is written on that promise, so a document Build did not link
    would become a document nobody can read. It is refused here, where the
    migration that produced it can still be seen, rather than one request at
    a time afterwards.
    """
    content.validate_registry()
    for doctype in content.governed_doctypes():
        if frappe.db.exists("DocShare", {"share_doctype": doctype}):
            raise DriveConflict(
                _("Drive cannot govern {0} while it still has shares. Rewrite them as grants first.").format(
                    doctype
                )
            )
    refuse_unlinked_documents()


def refuse_unlinked_documents() -> None:
    """Refuse activation while a governed row still has no node (§5.13).

    This is the ordering rule §14.2 states as "content document node links"
    before the registry answers anything: Build step 10 writes the link on
    every document and adopts the ones that had no `File` row, and a
    satellite takes its rights from the document it points at.
    """
    for doctype, spec in content.registry().items():
        _refuse_unlinked(doctype, spec.node_field)
        for satellite in spec.satellites:
            _refuse_unlinked(satellite.doctype, satellite.link_field)


def _refuse_unlinked(doctype: str, field: str) -> None:
    unlinked = frappe.db.count(doctype, {field: ["is", "not set"]})
    if not unlinked:
        return
    raise DriveConflict(
        _("Drive cannot govern {0}: {1} rows have no {2}. Run the Drive Build migration first.").format(
            doctype, unlinked, field
        )
    )


def refuse_governed_share(doc, method=None) -> None:
    """Refuse a `DocShare` on a doctype Drive governs (§10.2, §10.3).

    Wired on `DocShare.validate`, which `frappe.share.add` and
    `share.set_permission` both reach through `doc.save()`
    (`frappe/share.py:82`, `:141`) even though they save with
    `ignore_permissions`. Deleting a row runs `on_trash` instead, so a legacy
    share can still be cleaned up. A no-op while no content type is
    registered.
    """
    if not content.governs(doc.share_doctype):
        return
    raise DriveForbidden(
        _("Drive decides who reads {0}. Share it in Drive instead.").format(doc.share_doctype)
    )


def doc_has_permission(doc, ptype="read", user=None, debug=False) -> bool:
    """Answer one content document row check through its node (§10.3).

    The ptype maps to a role with the §4.3 table, the node comes from the
    registered `node_field`, and one point check answers. There is no
    "document without a node" fallback: under §5.13 that state cannot exist,
    so it is an error.

    `create` is the one ptype the row cannot answer, so it goes to the parent
    (§4.3).
    """
    spec = content.spec_for(doc.doctype)
    node = _document_node_of(doc, spec)
    role = _role_for_ptype(ptype)
    allowed = _parent_allows(node, role, user) if ptype == "create" else _node_allows(node, role, user)
    if allowed:
        return True
    refuse_shared_row(doc.doctype, doc.get("name"), ptype, user)
    return False


def doc_query_conditions(user: str | None = None, doctype: str | None = None) -> str:
    """Filter a content doctype list to its readable nodes (§10.3).

    This replaces the owner-or-direct-share SQL Drive shipped before, which
    could not see a folder-inherited grant.
    """
    if not doctype:
        return ""
    spec = content.spec_for(doctype)
    _refuse_shared_list(doctype, user)
    return _list_predicate(f"`tab{doctype}`.`{spec.node_field}`", user)


def satellite_has_permission(doc, ptype="read", user=None, debug=False) -> bool:
    """Answer one satellite row check through its document's node (§10.3).

    Read to see, Edit to change. A satellite holds no rights of its own.

    §4.3's `create` rule is already satisfied here: a satellite's parent is the
    content document it links to, and that link, not the row being inserted, is
    what answers. Edit on the document is the right price for adding one.
    """
    spec, satellite = content.satellite_for(doc.doctype)
    docname = doc.get(satellite.link_field)
    if not docname:
        raise DriveConflict(_("A Drive satellite requires its content document"))
    node = frappe.db.get_value(spec.doctype, docname, spec.node_field)
    if not node:
        raise DriveConflict(_("A Drive content document requires its node"))
    role = READ if ptype in (None, "read", "select") else EDIT
    if _node_allows(node, role, user):
        return True
    refuse_shared_row(doc.doctype, doc.get("name"), ptype, user)
    return False


def satellite_query_conditions(user: str | None = None, doctype: str | None = None) -> str:
    """Filter a satellite list to the documents whose nodes the caller reads."""
    if not doctype:
        return ""
    spec, satellite = content.satellite_for(doctype)
    _refuse_shared_list(doctype, user)
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


def refuse_shared_row(doctype: str, docname, ptype: str | None, user: str | None) -> None:
    """Refuse outright when a `DocShare` would grant the row Drive refused.

    Public because a staged app guard needs it too. A `has_permission` hook
    that answers False for a row Drive owns has not denied it: Frappe reads
    that as "no role permission" and then asks `false_if_not_shared`
    (`frappe/permissions.py:214-216`), which a `DocShare` answers. Between
    Build and activation the app's own hook is the only one running, so it has
    to raise the same way this module does.

    Called only after Drive said no, so the reader pays for it only on a
    denial. `frappe.share.get_shared` is asked exactly as
    `false_if_not_shared` asks it (`frappe/permissions.py:194-204`), so what
    this finds is what the framework would have granted, `everyone` rows
    included. Answering False here would hand that answer straight back.
    """
    from frappe.share import get_shared

    # No row, no share. A `create` denial always lands here with no name,
    # because `Document.insert` checks before `set_new_name`, so this arm is
    # the whole answer for it.
    if not docname:
        return
    right = _shared_right(doctype, ptype)
    if right is None:
        return
    if not get_shared(doctype, user, rights=[right], filters=[["share_name", "=", str(docname)]], limit=1):
        return
    raise DriveForbidden(_("Drive decides who reads {0}. A share cannot grant it.").format(doctype))


def refuse_shared_linked_rows(doctype: str, node_field: str, user: str | None) -> None:
    """Refuse a staged app's list when a `DocShare` would reopen a linked row.

    The window between Build and activation is the one where an app's own
    `permission_query_conditions` still answers for a doctype whose rows Drive
    already owns. `frappe.db.query` ORs the shared names around whatever that
    hook returns (`frappe/database/query.py:1737-1741`), so no predicate the app
    writes can keep a shared linked row out of the answer. Refusing is the same
    answer `_refuse_shared_list` gives after activation.

    Scoped to a row that carries a node, because a legacy row is still the app's
    to share. Before Build no row carries one, so a site with Desk assignments
    lists exactly what it always listed.

    `Administrator` is skipped, for the reason `_refuse_shared_list` skips an
    admin: the predicate disappears for them, so refusing would only lock out
    the person who has to remove the row.
    """
    from frappe.share import get_shared

    user = user or frappe.session.user
    if user == "Administrator":
        return
    shared = get_shared(doctype, user)
    if not shared:
        return
    if frappe.db.get_value(doctype, {"name": ("in", shared), node_field: ("is", "set")}, "name"):
        raise DriveForbidden(_("Drive decides who reads {0}. A share cannot grant it.").format(doctype))


def refuse_shared_child_rows(
    doctype: str,
    parent_doctype: str,
    parent_field: str,
    node_field: str,
    user: str | None,
) -> None:
    """Refuse a staged app's history list when a share reaches a linked parent.

    `refuse_shared_linked_rows` scopes on a node column the shared row carries
    itself. A history row carries none: its authority is the node on its parent
    document. Build links documents that already carry history rows and keeps
    those rows until Cleanup, so a `DocShare` on one of them is a way around
    `Drive Grant` for exactly the window `refuse_shared_linked_rows` covers for
    the parent.

    Both reads ask `("is", "set")`, not `IS NOT NULL`: a Link written as the
    empty string is unset, and treating one as linked would take a legacy
    history list down for a row Drive does not own.

    `Administrator` is skipped, for the reason `refuse_shared_linked_rows`
    skips one.
    """
    from frappe.share import get_shared

    user = user or frappe.session.user
    if user == "Administrator":
        return
    shared = get_shared(doctype, user)
    if not shared:
        return
    parents = [
        parent
        for parent in frappe.get_all(doctype, filters={"name": ("in", shared)}, pluck=parent_field)
        if parent
    ]
    if not parents:
        return
    if frappe.db.get_value(parent_doctype, {"name": ("in", parents), node_field: ("is", "set")}, "name"):
        raise DriveForbidden(_("Drive decides who reads {0}. A share cannot grant it.").format(doctype))


def _refuse_shared_list(doctype: str, user: str | None) -> None:
    """Refuse a list the framework would widen with `DocShare` rows.

    `get_permission_conditions` ORs the shared names around whatever this
    module returns (`frappe/database/query.py:1739-1742`), and drops the
    predicate altogether when the doctype carries no role read (`:1712-1719`).
    Neither can be answered from inside the hook, so a governed doctype that
    still has one readable share refuses the whole list instead of returning a
    predicate the engine will widen. `refuse_governed_share` and
    `validate_content_registry` are what keep this unreachable.

    An admin is skipped. The predicate disappears for them, so the engine adds
    no condition and has nothing to OR a share around; refusing would only
    lock out the person who has to remove the row.
    """
    from frappe.share import get_shared

    if is_drive_admin(user or frappe.session.user):
        return
    if get_shared(doctype, user, limit=1):
        raise DriveForbidden(_("Drive decides who reads {0}. A share cannot grant it.").format(doctype))


def _shared_right(doctype: str, ptype: str | None) -> str | None:
    """Return the `DocShare` column the framework reads for one ptype.

    Mirrors `false_if_not_shared` (`frappe/permissions.py:185-192`): `email`
    and `print` are answered by a `read` share, a custom `Permission Type`
    names its own column, and any other ptype cannot be shared. `select` is
    not shareable either; the framework retries it as `read`
    (`frappe/permissions.py:218-229`) and the guard answers on that pass.
    """
    ptype = ptype or "read"
    if ptype in ("email", "print"):
        return "read"
    if ptype in SHARE_RIGHTS:
        return ptype
    return ptype if ptype in get_doctype_ptype_map().get(doctype, []) else None


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
    #
    # The §4.3 table is the only place a ptype becomes a role, `create`
    # included. Which node that role is asked of is `doc_has_permission`'s
    # decision, not this table's.
    return PTYPE_ROLE.get(ptype or "read", DEFAULT_PTYPE_ROLE)


def _parent_allows(node: str, role: int, user: str | None) -> bool:
    """Answer `create` against the destination folder, never the new row (§4.3).

    `Document.insert` runs `check_permission("create")` before `before_insert`
    and before `set_new_name` (`frappe/model/document.py:730`, `:733`, `:734`),
    so the row being asked about has no name and no rights of its own. What it
    does carry is the node Drive already created for it, and UPLOAD on that
    node's parent is the same check `nodes.create_document` made before the
    factory ran.

    This is the shape the framework and Drive already use for a row that takes
    its rights from a link: core's `File` answers write, create, and delete
    against `attached_to_name` (`frappe/core/doctype/file/file.py:897`), core's
    tree check resolves create through the parent field
    (`frappe/permissions.py:396`), and Drive's own legacy adapter answered
    create against the folder (`suite/drive/api/permissions.py:308`).

    Fail closed on anything else. A node that is gone, or one with no parent,
    is a root or a broken tree, and neither can hold a content document. A
    permission hook may only deny, so denying is the whole answer here, and
    `create` is not a `DocShare` right, so nothing re-grants it (§10.3 note on
    `false_if_not_shared`).
    """
    row = frappe.db.get_value("Drive Node", node, ("name", "parent"), as_dict=True)
    if not row or not row.parent:
        return False
    return _node_allows(row.parent, role, user)


def _document_node_of(doc, spec) -> str:
    node = doc.get(spec.node_field)
    if not node:
        raise DriveConflict(_("A Drive content document requires its node"))
    return node


def _node_allows(node: str, role: int, user: str | None) -> bool:
    """Run one point check against the node's stored ancestry.

    A read does not filter the node state. A trashed document is still
    readable through Drive's trash and restore workflows; the list predicate
    is the one that hides it.

    Anything above a read does. §8.8: a trashed document node opens read-only,
    and this is the arm that closes the generic ORM path. `frappe.client.save`
    and `frappe.client.set_value` reach a content row through `doc.save()`,
    which asks this hook and nothing else; the three whitelisted body writers
    are already refused by `DriveContent.drive_check`. Denying here is safe
    for Drive's own workflows because they check with `access.require`, not
    through the framework, and a hook may only deny.
    """
    row = frappe.db.get_value("Drive Node", node, ACCESS_NODE_FIELDS, as_dict=True)
    if not row:
        raise DriveNotFound(_("Drive node {0} was not found").format(node))
    if role > READ and row.state != "Active":
        return False
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
