"""Atomic lifecycle for the one-to-one Drive root pair."""

from uuid import uuid4

import frappe
from frappe import _

from suite.drive._core.errors import DriveConflict, DriveNotFound
from suite.drive._core.roles import MANAGE, UPLOAD

PERSONAL = "Personal"
SHARED = "Shared"
ACTIVE = "Active"
ILLEGAL_ROOT_OPERATIONS = frozenset({"move", "copy", "trash", "restore", "purge", "version"})


def create_root(
    *,
    kind: str,
    title: str,
    user: str | None = None,
    quota_bytes: int = 0,
) -> frappe._dict:
    """Create a root node, its metadata, and its anchor grant as one unit."""
    _validate_create_arguments(kind, user, quota_bytes)
    savepoint = f"drive_root_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        _lock_identity(kind, user)
        if active_root_for(kind=kind, user=user, for_update=True):
            subject = user if kind == PERSONAL else SHARED
            raise DriveConflict(_("An active Drive root already exists for {0}").format(subject))

        owner = user if kind == PERSONAL else "Administrator"
        node = _insert_root_node(title=title, owner=owner)
        root = _insert_root_metadata(
            node=node.name,
            kind=kind,
            user=user,
            quota_bytes=quota_bytes,
        )
        _insert_anchor_grant(node=node.name, kind=kind, user=user)
        validate_root_pair(node.name)
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return frappe._dict(name=root.name, node=node.name, kind=kind, user=user, title=node.title)


def active_root_for(*, kind: str, user: str | None = None, for_update: bool = False) -> str | None:
    filters = {"kind": kind, "state": ACTIVE}
    if kind == PERSONAL:
        filters["user"] = user
    return frappe.db.get_value("Drive Root", filters, "name", for_update=for_update)


def personal_root_for(user: str) -> str | None:
    """Return a user's active Personal root node id."""
    return active_root_for(kind=PERSONAL, user=user)


def validate_root_pair(node_id: str, *, for_update: bool = False) -> frappe._dict:
    """Validate both directions and every root-node invariant."""
    locking = {"for_update": True} if for_update else {}
    node = frappe.db.get_value(
        "Drive Node",
        node_id,
        [
            "name",
            "title",
            "parent",
            "root",
            "path",
            "kind",
            "blob",
            "size",
            "mime",
            "url",
            "content_doctype",
            "content_docname",
            "state",
            "trashed_at",
            "trash_root",
            "is_template",
            "owner",
        ],
        as_dict=True,
        **locking,
    )
    if not node:
        raise DriveNotFound(_("Drive root node {0} was not found").format(node_id))
    if (
        node.kind != "root"
        or any(
            (
                node.parent,
                node.root,
                node.path,
                node.blob,
                node.size,
                node.mime,
                node.url,
                node.content_doctype,
                node.content_docname,
                node.trashed_at,
                node.trash_root,
                node.is_template,
            )
        )
        or node.state != ACTIVE
    ):
        raise frappe.ValidationError(_("Drive root node {0} has an invalid root shape").format(node_id))

    root = frappe.db.get_value(
        "Drive Root",
        {"node": node_id},
        ["name", "node", "kind", "user", "state", "quota_bytes", "used_bytes"],
        as_dict=True,
        **locking,
    )
    if not root or root.name != node_id or root.node != node_id:
        raise frappe.ValidationError(_("Drive root node {0} has no matching metadata").format(node_id))
    if root.kind == PERSONAL:
        if not root.user:
            raise frappe.ValidationError(_("A Personal Drive root must name its user"))
    elif root.kind == SHARED:
        if root.user:
            raise frappe.ValidationError(_("A Shared Drive root cannot name a user"))
    else:
        raise frappe.ValidationError(_("Drive root kind must be Personal or Shared"))
    if root.state not in (ACTIVE, "Archived"):
        raise frappe.ValidationError(_("Drive root state must be Active or Archived"))
    return frappe._dict(node=node, root=root)


def reject_illegal_root_operation(node: dict, operation: str) -> None:
    """Guard ordinary tree operations that never apply to a root node."""
    if node.get("kind") == "root" and operation in ILLEGAL_ROOT_OPERATIONS:
        from suite.drive._core.errors import DriveForbidden

        raise DriveForbidden(_("The {0} operation does not apply to a Drive root").format(operation))


def _validate_create_arguments(kind: str, user: str | None, quota_bytes: int) -> None:
    if kind not in (PERSONAL, SHARED):
        raise frappe.ValidationError(_("Drive root kind must be Personal or Shared"))
    if isinstance(quota_bytes, bool) or not isinstance(quota_bytes, int) or quota_bytes < 0:
        raise frappe.ValidationError(_("Drive root quota must be a nonnegative integer"))
    if kind == PERSONAL:
        if not user or not frappe.db.exists("User", user):
            raise frappe.ValidationError(_("A Personal Drive root must name an existing user"))
    elif user:
        raise frappe.ValidationError(_("A Shared Drive root cannot name a user"))


def _lock_identity(kind: str, user: str | None) -> None:
    """Serialize on a stable row; the following locking read sees the latest root."""
    if kind == PERSONAL:
        frappe.db.get_value("User", user, "name", for_update=True)
    else:
        frappe.db.get_value("DocType", "Drive Root", "name", for_update=True)


def _insert_root_node(*, title: str, owner: str) -> frappe.model.document.Document:
    node = frappe.get_doc(
        {
            "doctype": "Drive Node",
            "title": title,
            "kind": "root",
            "path": "",
            "state": ACTIVE,
            "size": 0,
            "is_template": 0,
            "owner": owner,
        }
    )
    node.flags.drive_root_lifecycle = True
    node.insert(ignore_permissions=True)
    # Document.insert assigns the session user after construction. Root ownership is
    # a domain value, not the identity of whichever request happened to provision it.
    frappe.db.set_value("Drive Node", node.name, "owner", owner, update_modified=False)
    node.owner = owner
    return node


def _insert_root_metadata(
    *, node: str, kind: str, user: str | None, quota_bytes: int
) -> frappe.model.document.Document:
    root = frappe.get_doc(
        {
            "doctype": "Drive Root",
            "node": node,
            "kind": kind,
            "user": user,
            "state": ACTIVE,
            "quota_bytes": quota_bytes,
            "used_bytes": 0,
            "acl_generation": 0,
        }
    )
    root.flags.drive_root_lifecycle = True
    return root.insert(ignore_permissions=True)


def _insert_anchor_grant(*, node: str, kind: str, user: str | None) -> None:
    principal, role = (user, MANAGE) if kind == PERSONAL else ("$GENERAL", UPLOAD)
    frappe.get_doc({"doctype": "Drive Grant", "node": node, "principal": principal, "role": role}).insert(
        ignore_permissions=True
    )
