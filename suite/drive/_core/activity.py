"""Drive activity, recents, favourites, and notification workflows."""

from collections.abc import Iterable
from typing import Any

import frappe
from frappe import _
from frappe.utils import now_datetime

from suite.drive._core.errors import DriveError, DriveForbidden, DriveNotFound
from suite.drive._core.principals import Principals
from suite.drive._core.roles import READ

ACTIVITY_ACTIONS = (
    "create",
    "rename",
    "move",
    "edit",
    "comment",
    "trash",
    "restore",
    "delete",
    "share_add",
    "share_edit",
    "share_remove",
)
DEFAULT_RECORD_LIMIT = 60
MAX_RECORD_LIMIT = 200


def record(
    principals: Principals,
    node: str,
    action: str,
    *,
    detail: dict | None = None,
    via_link: str | None = None,
    client: str | None = None,
) -> str:
    """Append one immutable activity row after a workflow has authorized its write."""
    if action not in ACTIVITY_ACTIONS:
        frappe.throw(_("Drive activity action is invalid"), frappe.ValidationError)
    if via_link is not None and not via_link.startswith("$LINK:"):
        frappe.throw(_("Drive activity link attribution is invalid"), frappe.ValidationError)
    if client is not None and len(client) > 255:
        frappe.throw(_("Drive activity client is too long"), frappe.ValidationError)
    if not frappe.db.exists("Drive Node", node):
        raise DriveNotFound(_("Drive node {0} was not found").format(node))

    row = frappe.get_doc(
        {
            "doctype": "Drive Activity",
            "node": node,
            "action": action,
            "actor": principals.user,
            "at": now_datetime(),
            "via_link": via_link,
            "client": client,
            "detail": detail or {},
        }
    ).insert(ignore_permissions=True)
    return row.name


def history(
    principals: Principals,
    node: str,
    *,
    limit: int = DEFAULT_RECORD_LIMIT,
) -> list[dict]:
    """Return a newest-first node history only after checking current Read access."""
    _authorized_node(principals, node)
    rows = frappe.get_all(
        "Drive Activity",
        filters={"node": node},
        fields=["name", "node", "action", "actor", "at", "via_link", "client", "detail"],
        order_by="at desc, creation desc",
        limit=_limit(limit),
    )
    for row in rows:
        row.detail = _json_value(row.detail, {})
    return rows


def visit(principals: Principals, node: str) -> str:
    """Upsert the caller's Recent row without writing Activity."""
    _require_person(principals)
    _authorized_node(principals, node)
    stamp = now_datetime()
    existing = frappe.db.get_value(
        "Drive Recent",
        {"user": principals.user, "node": node},
        "name",
        for_update=True,
    )
    if existing:
        frappe.db.set_value("Drive Recent", existing, "opened_at", stamp, update_modified=False)
        return existing
    return (
        frappe.get_doc(
            {
                "doctype": "Drive Recent",
                "user": principals.user,
                "node": node,
                "opened_at": stamp,
            }
        )
        .insert(ignore_permissions=True)
        .name
    )


def recents(
    principals: Principals,
    *,
    limit: int = DEFAULT_RECORD_LIMIT,
) -> list[dict]:
    """Return only the caller's still-readable recent nodes."""
    _require_person(principals)
    rows = frappe.get_all(
        "Drive Recent",
        filters={"user": principals.user},
        fields=["name", "node", "opened_at"],
        order_by="opened_at desc",
        limit=_limit(limit),
    )
    return _visible_personal_rows(principals, rows)


def clear_recents(principals: Principals, nodes: Iterable[str] | None = None) -> int:
    """Remove the caller's Recent rows, never their Favourite rows."""
    _require_person(principals)
    filters: dict[str, Any] = {"user": principals.user}
    if nodes is not None:
        node_ids = tuple(dict.fromkeys(nodes))
        if not node_ids:
            return 0
        filters["node"] = ["in", node_ids]
    deleted = frappe.db.count("Drive Recent", filters)
    frappe.db.delete("Drive Recent", filters)
    return deleted


def set_favourite(principals: Principals, node: str, value: bool = True) -> bool:
    """Set the caller's private favourite mark after a Read check."""
    _require_person(principals)
    _authorized_node(principals, node)
    if type(value) is not bool:
        frappe.throw(_("Drive favourite value must be a boolean"), frappe.ValidationError)
    existing = frappe.db.get_value(
        "Drive Favourite",
        {"user": principals.user, "node": node},
        "name",
        for_update=True,
    )
    if value and not existing:
        frappe.get_doc({"doctype": "Drive Favourite", "user": principals.user, "node": node}).insert(
            ignore_permissions=True
        )
    elif not value and existing:
        frappe.db.delete("Drive Favourite", {"name": existing, "user": principals.user})
    return value


def favourites(
    principals: Principals,
    *,
    limit: int = DEFAULT_RECORD_LIMIT,
) -> list[dict]:
    """Return only the caller's still-readable favourite nodes."""
    _require_person(principals)
    rows = frappe.get_all(
        "Drive Favourite",
        filters={"user": principals.user},
        fields=["name", "node", "creation"],
        order_by="creation desc",
        limit=_limit(limit),
    )
    return _visible_personal_rows(principals, rows)


def notify_users(activity: str, users: Iterable[str]) -> int:
    """Create one notification pointer for each distinct existing target user."""
    created = 0
    for user in dict.fromkeys(users):
        if not isinstance(user, str) or not user or not frappe.db.exists("User", user):
            continue
        if frappe.db.exists("Drive Notification", {"activity": activity, "to_user": user}):
            continue
        frappe.get_doc(
            {"doctype": "Drive Notification", "activity": activity, "to_user": user, "read": 0}
        ).insert(ignore_permissions=True)
        created += 1
    return created


def notifications(
    principals: Principals,
    *,
    only_unread: bool = False,
    limit: int = DEFAULT_RECORD_LIMIT,
) -> list[dict]:
    """Return the caller's notification pointers with authorized activity data."""
    return _visible_notifications(principals, only_unread=only_unread, limit=_limit(limit))


def _visible_notifications(
    principals: Principals,
    *,
    only_unread: bool,
    limit: int | None,
) -> list[dict]:
    _require_person(principals)
    filters: dict[str, Any] = {"to_user": principals.user}
    if only_unread:
        filters["read"] = 0
    options = {
        "filters": filters,
        "fields": ["name", "activity", "to_user", "read", "creation"],
        "order_by": "creation desc",
    }
    if limit is not None:
        options["limit"] = limit
    rows = frappe.get_all("Drive Notification", **options)
    visible = []
    for row in rows:
        activity = frappe.db.get_value(
            "Drive Activity",
            row.activity,
            ["name", "node", "action", "actor", "at", "via_link", "client", "detail"],
            as_dict=True,
        )
        if not activity or not _can_read(principals, activity.node):
            continue
        activity.detail = _json_value(activity.detail, {})
        row.activity = activity
        visible.append(row)
    return visible


def unread_count(principals: Principals) -> int:
    """Count the caller's unread, currently visible notification pointers."""
    return len(_visible_notifications(principals, only_unread=True, limit=None))


def mark_read(principals: Principals, notification: str | None = None) -> int:
    """Mark one or all of the caller's visible notifications read."""
    _require_person(principals)
    visible = _visible_notifications(principals, only_unread=True, limit=None)
    ids = tuple(row.name for row in visible if notification is None or row.name == notification)
    if not ids:
        return 0
    frappe.db.set_value(
        "Drive Notification",
        {"name": ["in", ids], "to_user": principals.user, "read": 0},
        "read",
        1,
        update_modified=False,
    )
    return len(ids)


def _visible_personal_rows(principals: Principals, rows: list) -> list[dict]:
    visible = []
    for row in rows:
        node = _readable_node(principals, row.node)
        if node is None:
            continue
        row.node = node
        visible.append(row)
    return visible


def _authorized_node(principals: Principals, node: str) -> frappe._dict:
    from suite.drive._core.access import require

    row = frappe.db.get_value(
        "Drive Node",
        node,
        ["name", "parent", "root", "path", "title", "kind", "state", "content_doctype", "content_docname"],
        as_dict=True,
    )
    if not row:
        raise DriveNotFound(_("Drive node {0} was not found").format(node))
    require(row, READ, principals)
    return row


def _readable_node(principals: Principals, node: str) -> frappe._dict | None:
    try:
        return _authorized_node(principals, node)
    except DriveError:
        return None


def _can_read(principals: Principals, node: str) -> bool:
    return _readable_node(principals, node) is not None


def _require_person(principals: Principals) -> None:
    if principals.user == "Guest":
        raise DriveForbidden(_("Guest callers do not have personal Drive records"))


def _limit(value: int) -> int:
    if type(value) is not int or value < 1 or value > MAX_RECORD_LIMIT:
        frappe.throw(
            _("Drive record limit must be between 1 and {0}").format(MAX_RECORD_LIMIT),
            frappe.ValidationError,
        )
    return value


def _json_value(value, default):
    if value is None or value == "":
        return default
    return frappe.parse_json(value) if isinstance(value, str) else value
