"""Staged permission guards for `Sheet` and its child doctypes.

`Sheet Op Log` and `Sheet Snapshot` carry the full content of every workbook
edit (and, in the snapshot's case, the entire workbook payload). Their
DocType row-perms grant `role: "All", read: 1` so the in-app history views
work for shared collaborators — but without these hooks the stock
`frappe.client.get_list` / `frappe.client.get` endpoints would let any
authenticated user enumerate every sheet on the site.

`Sheet` itself is here from ticket 19. §10.4 needs an open baseline role
DocPerm on a content doctype, because a Frappe permission hook can only deny
(`frappe/permissions.py:244-246`), so the `All` row lost its `if_owner`. These
guards put that rule back where it can also read the node column: a legacy row
keeps the owner-or-DocShare behaviour it has always had, and a linked row is
refused.

## The two sides

Adoption is staged (§10.3, README execution rules). `Sheet` carries a `node`
Link from ticket 19, but `drive_content_types` stays empty and these hooks stay
here until ticket 29 has Build's links. So every guard reads the node column and
answers on one of two sides:

  node set    Drive-native. `Drive Grant` is the only authority (§1), and this
              module cannot read it: the entries that can live in
              `suite.drive.framework` and arrive with the registry. Refused
              here, never answered from `DocShare`.
  no node     A legacy row Build has not linked. Unchanged owner-or-shared
              behaviour until §14.6 copies it and Cleanup removes it.

Refusing a linked row is not the same as answering `False` for it. Frappe widens
both hooks with `DocShare` rows the app never sees: the row check falls through
to `false_if_not_shared` (`frappe/permissions.py:214-216`) and the list ORs the
shared names around the predicate (`frappe/database/query.py:1739-1742`).
Neither can be answered from inside the hook, so both guards call Drive to
refuse, exactly as `suite.drive.framework` refuses after activation.

The Administrator bypasses every guard below: `frappe.has_permission` answers
for them before any controller hook runs (`frappe/permissions.py:109-111`).

A System Manager is a narrower story, and the two sides do not agree. The child
guards and both list predicates exempt one, so a System Manager still reads and
lists a linked sheet's `Sheet Op Log` and `Sheet Snapshot` rows — today's
behaviour, unchanged, and the reason it is left alone. `sheet_has_permission`
does not exempt one, because the refusal has to come before any answer this
module could give. Neither matches §4.9, whose admin is the Administrator or a
Suite Admin, and a Suite Admin is therefore denied a linked `Sheet` row here.
Both close at ticket 29, when `suite.drive.framework` answers and
`is_drive_admin` is the one definition. Recorded, not fixed here: fixing it
would mean this module reading `Drive Grant`, which is ticket 29's job.

Wiring lives in :mod:`suite.hooks`.
"""

from __future__ import annotations

import frappe
from frappe import _

from suite import drive

DOCTYPE = "Sheet"
NODE_FIELD = "node"

_PRIVILEGED_ROLES = frozenset({"Administrator", "System Manager"})

# The two child doctypes these guards answer for, and their tables. A lookup,
# never interpolation, so no caller can put a name into the SQL below.
_CHILD_TABLES = {
    "Sheet Op Log": "`tabSheet Op Log`",
    "Sheet Snapshot": "`tabSheet Snapshot`",
}


# ── Sheet ────────────────────────────────────────────────────────────────────


def sheet_has_permission(doc, ptype: str = "read", user: str | None = None, debug: bool = False) -> bool:
    """Answer one `Sheet` row check while adoption is staged."""
    user = user or frappe.session.user
    if _stored_node(doc):
        drive.refuse_shared_row(DOCTYPE, doc.get("name"), ptype, user)
        return False
    if _is_privileged(user):
        return True
    # The `if_owner` rule the `All` DocPerm carried until ticket 19, back where
    # it can also see the node column. A non-owner is denied, not refused, so
    # Frappe still asks `false_if_not_shared` and a legacy `DocShare` grants
    # exactly the right it names.
    return (doc.get("owner") or "") == user


def sheet_query_conditions(user: str | None = None, doctype: str | None = None) -> str:
    """`permission_query_conditions` for `Sheet`, staged the same way."""
    user = user or frappe.session.user
    # Privilege first, the order `_scope_to_readable_sheets` uses. The predicate
    # disappears for a privileged caller, so there is nothing for the engine to
    # OR a share around and nothing to refuse; refusing anyway would lock the
    # operator out of the very list that finds the offending `DocShare`.
    if _is_privileged(user):
        return ""
    # A shared linked sheet cannot be excluded by any predicate this hook
    # returns: `frappe.db.query` ORs the shared names around it. Drive refuses
    # instead. Scoped to a sheet that carries a node, so a legacy site lists
    # what it always listed.
    drive.refuse_shared_linked_rows(DOCTYPE, NODE_FIELD, user)
    return _sheet_predicate(user)


def _stored_node(doc) -> str | None:
    """The node the database holds for this row, never the one the caller sent.

    `frappe.client.save` builds the whole `Document` from client JSON and runs
    the write check against it, so a caller who presents a linked row with
    `node` cleared would otherwise take the legacy owner-or-`DocShare` branch.
    The stored column is the only value Drive owns. An unsaved row has none, so
    the supplied value is all there is and `require_node` polices it.
    """
    if doc is None:
        return None
    name = doc.get("name")
    if not name or doc.get("__islocal"):
        return doc.get(NODE_FIELD) or None
    return frappe.db.get_value(DOCTYPE, name, NODE_FIELD) or None


def _sheet_predicate(user: str | None) -> str:
    """The staged `Sheet` predicate, with no share refusal.

    Empty string = no restriction (privileged users). Frappe ORs the caller's
    shared names around whatever this returns, which is what keeps a legacy
    `DocShare` working.
    """
    user = user or frappe.session.user
    if _is_privileged(user):
        return ""
    return f"`tab{DOCTYPE}`.`{NODE_FIELD}` IS NULL AND `tab{DOCTYPE}`.`owner` = {frappe.db.escape(user)}"


# ── permission_query_conditions ──────────────────────────────────────────────


def sheet_op_log_query(user: str | None = None) -> str:
    return _scope_to_readable_sheets("Sheet Op Log", "`tabSheet Op Log`", user)


def sheet_snapshot_query(user: str | None = None) -> str:
    return _scope_to_readable_sheets("Sheet Snapshot", "`tabSheet Snapshot`", user)


def _scope_to_readable_sheets(doctype: str, table_prefix: str, user: str | None) -> str:
    """Return a SQL fragment restricting child rows to readable parent sheets.

    Empty string = no restriction (privileged users). The fragment is AND'd
    into the WHERE clause by Frappe's permission machinery.

    It reuses the staged `Sheet` predicate, so the list and the row check agree
    on a linked sheet: both refuse it. Left apart, the row check denied every
    non-admin while the list still returned the owner's rows.
    """
    user = user or frappe.session.user
    if _is_privileged(user):
        return ""
    _refuse_shared_linked_children(doctype, user)
    parent = _sheet_predicate(user)
    if not parent:
        return ""
    user_lit = frappe.db.escape(user)
    # Readable sheet = owned by caller OR shared with caller via DocShare, and
    # not owned by Drive. The DocShare arm is spelled out here because Frappe
    # ORs the shared names of the doctype being listed, which is the child, not
    # the parent.
    return (
        f"{table_prefix}.sheet IN ("
        f"SELECT name FROM `tab{DOCTYPE}` WHERE {parent} "
        f"UNION "
        f"SELECT `tabDocShare`.share_name FROM `tabDocShare` "
        f"JOIN `tab{DOCTYPE}` ON `tab{DOCTYPE}`.name = `tabDocShare`.share_name "
        f"WHERE `tabDocShare`.share_doctype = '{DOCTYPE}' AND `tabDocShare`.user = {user_lit} "
        f"AND `tabDocShare`.`read` = 1 AND `tab{DOCTYPE}`.`{NODE_FIELD}` IS NULL"
        f")"
    )


def _refuse_shared_linked_children(doctype: str, user: str) -> None:
    """Refuse a child list a `DocShare` on the child rows would reopen.

    `drive.refuse_shared_linked_rows` cannot answer here: neither child doctype
    carries a node column, so the link is one hop away through `sheet`. The
    refusal is the same one, and after activation the `Sheet Op Log` satellite
    declaration is what makes it Drive's own.

    `Administrator` is skipped, for the reason Drive skips one: the predicate
    disappears for them, so refusing would only lock out the person who has to
    remove the row.
    """
    from frappe.share import get_shared

    if user == "Administrator":
        return
    shared = get_shared(doctype, user)
    if not shared:
        return
    # Bounded by the caller's own shared rows, and it joins rather than reading
    # the linked sheet names first: after Build that list is every sheet on the
    # site.
    child_table = _CHILD_TABLES[doctype]
    linked = frappe.db.sql(
        f"""SELECT child.name FROM {child_table} child
            JOIN `tab{DOCTYPE}` parent ON parent.name = child.sheet
            WHERE child.name IN %(shared)s AND parent.`{NODE_FIELD}` IS NOT NULL
            LIMIT 1""",
        {"shared": tuple(shared)},
    )
    if linked:
        frappe.throw(
            _("Drive decides who reads {0}. A share cannot grant it.").format(doctype),
            frappe.PermissionError,
        )


# ── has_permission ───────────────────────────────────────────────────────────


def sheet_op_log_has_permission(doc, ptype: str = "read", user: str | None = None) -> bool:
    return _child_has_permission(doc, ptype, user)


def sheet_snapshot_has_permission(doc, ptype: str = "read", user: str | None = None) -> bool:
    return _child_has_permission(doc, ptype, user)


def _child_has_permission(doc, ptype: str, user: str | None) -> bool:
    """Per-doc gate: a child row is readable iff its parent Sheet is readable.

    Mutations on a child are gated on *write* on the parent — these doctypes
    are append-only logs that nobody should be hand-editing via the Desk or
    the client API anyway (internal writers use `ignore_permissions=True`).

    A child of a linked sheet is refused rather than denied: `sheet_has_permission`
    refuses the parent's own share, and a `DocShare` on the child row would
    otherwise reopen it through `false_if_not_shared`.
    """
    user = user or frappe.session.user
    if _is_privileged(user):
        return True
    sheet_name = _extract_sheet(doc)
    if not sheet_name:
        # The one arm with no parent to ask about. Refuse rather than deny: a
        # `False` here is re-granted by `false_if_not_shared`, and an orphan
        # child row is exactly the thing no share should reopen.
        drive.refuse_shared_row(_extract_doctype(doc), _extract_name(doc), ptype, user)
        return False
    if frappe.db.get_value(DOCTYPE, sheet_name, NODE_FIELD):
        drive.refuse_shared_row(_extract_doctype(doc), _extract_name(doc), ptype, user)
        return False
    parent_ptype = "read" if ptype in _READ_PTYPES else "write"
    return bool(frappe.has_permission(DOCTYPE, doc=sheet_name, ptype=parent_ptype, user=user))


_READ_PTYPES = frozenset({"read", "report", "export", "email", "print", "select"})


def _extract_sheet(doc) -> str | None:
    """Pull the parent sheet name from either a Document or a plain dict."""
    if doc is None:
        return None
    if isinstance(doc, dict):
        return doc.get("sheet")
    return getattr(doc, "sheet", None)


def _extract_doctype(doc) -> str:
    if isinstance(doc, dict):
        return doc.get("doctype") or ""
    return getattr(doc, "doctype", "") or ""


def _extract_name(doc) -> str | None:
    if isinstance(doc, dict):
        return doc.get("name")
    return getattr(doc, "name", None)


def _is_privileged(user: str) -> bool:
    if user == "Administrator":
        return True
    return bool(_PRIVILEGED_ROLES.intersection(frappe.get_roles(user)))
