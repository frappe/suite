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

A System Manager is a narrower story. §4.9's admin is the Administrator or a
Suite Admin, never a role, so no guard over a linked row exempts one: the two
child guards refuse a linked sheet's `Sheet Op Log` and `Sheet Snapshot` rows
for a System Manager exactly as they do for anyone else. A System Manager keeps
every legacy read it has today, because the unlinked side still answers through
`Sheet`. `sheet_query_conditions` still exempts one from the `Sheet` list; that
predicate is ticket 19's and stays until ticket 29 replaces it.

A Suite Admin is denied a linked row here, which §4.9 says should not happen.
That closes at ticket 29, when `suite.drive.framework` answers and
`is_drive_admin` is the one definition. Recorded, not fixed here: granting it
would mean this module reading `Drive Grant`, which is ticket 29's job.

Wiring lives in :mod:`suite.hooks`.
"""

from __future__ import annotations

import frappe

from suite import drive

DOCTYPE = "Sheet"
NODE_FIELD = "node"

_PRIVILEGED_ROLES = frozenset({"Administrator", "System Manager"})

# Frappe stores an unset Link as `''`, not NULL
# (`frappe/model/base_document.py:624-627`), so `node IS NULL` alone reads a
# legacy sheet as one Drive owns and hides it from its own owner. Every
# predicate below asks for both spellings, the way `versioning.tasks` does.
_UNLINKED_SHEET = f"(`tab{DOCTYPE}`.`{NODE_FIELD}` IS NULL OR `tab{DOCTYPE}`.`{NODE_FIELD}` = '')"


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
    """The staged `Sheet` predicate on its own, with no share refusal.

    Always a predicate. The privilege question belongs to the caller: the two
    callers do not answer it the same way, and answering it here is what let a
    `System Manager` list every migrated sheet's child rows.

    Frappe ORs the caller's shared names around whatever this returns, which is
    what keeps a legacy `DocShare` working.
    """
    user = user or frappe.session.user
    return f"{_UNLINKED_SHEET} AND `tab{DOCTYPE}`.`owner` = {frappe.db.escape(user)}"


# ── permission_query_conditions ──────────────────────────────────────────────


def sheet_op_log_query(user: str | None = None) -> str:
    return _scope_to_readable_sheets("Sheet Op Log", "`tabSheet Op Log`", user)


def sheet_snapshot_query(user: str | None = None) -> str:
    return _scope_to_readable_sheets("Sheet Snapshot", "`tabSheet Snapshot`", user)


def _scope_to_readable_sheets(doctype: str, table_prefix: str, user: str | None) -> str:
    """Return a SQL fragment restricting child rows to readable parent sheets.

    Empty string = no restriction, which only the Administrator gets. The
    fragment is AND'd into the WHERE clause by Frappe's permission machinery.

    It reuses the staged `Sheet` predicate, so the list and the row check agree
    on a linked sheet: both refuse it. Left apart, the row check denied every
    non-admin while the list still returned the owner's rows.

    Only `Administrator` skips it. §4.9 grants a bypass to the Administrator
    and a Suite Admin, not to a role, and a `System Manager` holds full CRUD on
    both child doctypes, so the old role bypass listed every migrated sheet's
    snapshot rows. Same removal as `suite.writer.overrides` in 77a877400.
    """
    user = user or frappe.session.user
    if user == "Administrator":
        return ""
    drive.refuse_shared_child_rows(doctype, DOCTYPE, "sheet", NODE_FIELD, user)
    if _is_privileged(user):
        # A System Manager keeps the site-wide legacy child list `Sheet` still
        # answers Yes to (`sheet_has_permission`), bounded to the sheets Drive
        # does not own. Narrowing further would take away a legacy read the row
        # check still grants, which is ticket 19's rule, not ticket 28's.
        return f"{table_prefix}.sheet IN (SELECT name FROM `tab{DOCTYPE}` WHERE {_UNLINKED_SHEET})"
    parent = _sheet_predicate(user)
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
        f"AND `tabDocShare`.`read` = 1 AND {_UNLINKED_SHEET}"
        f")"
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

    Only `Administrator` skips it, for the reason `_scope_to_readable_sheets`
    gives. A `System Manager` still reads an unlinked child: the parent check
    below is what grants it, and that is `Sheet`'s rule to keep.
    """
    user = user or frappe.session.user
    if user == "Administrator":
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
