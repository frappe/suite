"""Coarse, payload-free Drive invalidation after transaction commit."""

from collections.abc import Iterable

import frappe

from suite.drive._core.access import chain_ids

EVENT = "drive:changed"


def emit_for_node(node: str) -> None:
    """Notify the node's owners and current direct or inherited grant holders."""
    row = frappe.db.get_value(
        "Drive Node",
        node,
        ["name", "root", "path", "kind", "owner"],
        as_dict=True,
    )
    if not row:
        return
    ids = set(chain_ids(row))
    if row.kind in ("root", "folder"):
        root = row.name if row.kind == "root" else row.root
        prefix = "%" if row.kind == "root" else f"{row.path or '/'}{row.name}/%"
        descendants = frappe.db.sql(
            """
            SELECT name, owner
            FROM `tabDrive Node`
            WHERE root = %(root)s AND (%(is_root)s OR path LIKE %(prefix)s)
            """,
            {"root": root, "is_root": row.kind == "root", "prefix": prefix},
            as_dict=True,
        )
        ids.update(descendant.name for descendant in descendants)
        owners = {descendant.owner for descendant in descendants if descendant.owner}
    else:
        owners = set()
    if row.owner:
        owners.add(row.owner)
    principals = frappe.get_all(
        "Drive Grant",
        filters={"node": ["in", tuple(ids)]},
        pluck="principal",
    )
    emit_for_principals((*owners, *principals))


def emit_for_principals(principals: Iterable[str]) -> None:
    """Expand user and group principals, then address each user room once."""
    users = set()
    groups = set()
    general = False
    for principal in principals:
        if not isinstance(principal, str) or not principal:
            continue
        if principal == "$GENERAL":
            general = True
        elif principal.startswith("$GROUP:"):
            groups.add(principal.removeprefix("$GROUP:"))
        elif not principal.startswith("$") and principal != "Guest":
            users.add(principal)
    if groups:
        users.update(
            frappe.get_all(
                "User Group Member",
                filters={"parent": ["in", tuple(groups)]},
                pluck="user",
            )
        )
    if general:
        users.update(frappe.get_all("User", filters={"enabled": 1}, pluck="name"))
    users.discard("Guest")
    for user in sorted(users):
        frappe.publish_realtime(EVENT, user=user, after_commit=True)


def emit_for_users(users: Iterable[str]) -> None:
    """Address known personal-record owners without reading the grant graph."""
    emit_for_principals(users)
