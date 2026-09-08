"""Drive activity, recents, favourites, and notification workflows."""

from collections.abc import Iterable
from typing import Any
from uuid import uuid4

import frappe
from frappe import _
from frappe.utils import now_datetime

from suite.drive._core.errors import (
    DriveConflict,
    DriveError,
    DriveForbidden,
    DriveNotFound,
    rollback_savepoint,
)
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
# §11.4 fixes one page size for the whole HTTP surface. A record listing is
# paged by the same helper as a folder page, so it keeps the same default and
# the same cap rather than a second pair that could drift.
DEFAULT_RECORD_LIMIT = 60

# §9.4: `client` holds the User-Agent on WebDAV requests only. The engine may
# not read the transport request, so the adapter names its client once per
# request and every write below that point picks it up. Longer than the column
# is truncated, not refused: the row is the record of a write that succeeded.
MAX_CLIENT_LENGTH = 255


def bind_client(client: str | None) -> None:
    """Name the client every activity row written in this request belongs to."""
    frappe.local.drive_activity_client = (
        client.strip()[:MAX_CLIENT_LENGTH] if isinstance(client, str) and client.strip() else None
    )


def current_client() -> str | None:
    """The client an adapter named for this request, or None on an unnamed one."""
    return getattr(frappe.local, "drive_activity_client", None)


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
    if client is None:
        client = current_client()
    if client is not None and len(client) > MAX_CLIENT_LENGTH:
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
    cursor: str | None = None,
    limit: int = DEFAULT_RECORD_LIMIT,
) -> dict:
    """Page a newest-first node history after checking current Read access.

    §11.4's page, the one every Drive listing answers with. Nothing is dropped
    after the SQL window here - the READ check is on the node, once - so the
    window size and the row count always agree.
    """
    from suite.drive._core.nodes import decode_cursor, page_limit, page_of

    _authorized_node(principals, node)
    window = page_limit(limit)
    offset = decode_cursor(cursor)
    rows = frappe.get_all(
        "Drive Activity",
        filters={"node": node},
        fields=["name", "node", "action", "actor", "at", "via_link", "client", "detail"],
        order_by="at desc, creation desc",
        limit=window,
        start=offset,
    )
    for row in rows:
        row.detail = _json_value(row.detail, {})
    return page_of(rows, offset, len(rows), window)


def visit(principals: Principals, node: str) -> str:
    """Upsert the caller's Recent row without writing Activity."""
    _require_person(principals)
    _authorized_node(principals, node)
    stamp = now_datetime()
    existing = _recent_row(principals.user, node)
    if not existing:
        # `recent_user_node` is a database unique index, and a row that does
        # not exist yet cannot be locked. Two concurrent opens therefore both
        # reach the insert; the loser adopts the winner's row.
        existing, _inserted = _insert_unique(
            {
                "doctype": "Drive Recent",
                "user": principals.user,
                "node": node,
                "opened_at": stamp,
            },
            lambda: _recent_row(principals.user, node),
        )
        if existing is None:
            raise DriveConflict(_("The Drive recent row could not be recorded"))
    frappe.db.set_value("Drive Recent", existing, "opened_at", stamp, update_modified=False)
    return existing


def _recent_row(user: str, node: str) -> str | None:
    return frappe.db.get_value(
        "Drive Recent",
        {"user": user, "node": node},
        "name",
        for_update=True,
    )


def _insert_unique(doc: dict, reread) -> tuple[str | None, bool]:
    """Insert a row guarded by a unique index, tolerating a concurrent winner.

    Returns the row name and whether this call is the one that inserted it.
    """
    savepoint = f"drive_record_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        name = frappe.get_doc(doc).insert(ignore_permissions=True).name
    except frappe.UniqueValidationError as exc:
        rollback_savepoint(savepoint, exc)
        return reread(), False
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    frappe.db.release_savepoint(savepoint)
    return name, True


def recents(
    principals: Principals,
    *,
    cursor: str | None = None,
    limit: int = DEFAULT_RECORD_LIMIT,
) -> dict:
    """Page only the caller's still-readable recent nodes, newest first."""
    from suite.drive._core.nodes import decode_cursor, page_limit, page_of

    _require_person(principals)
    window = page_limit(limit)
    offset = decode_cursor(cursor)
    rows = frappe.get_all(
        "Drive Recent",
        filters={"user": principals.user},
        fields=["name", "node", "opened_at"],
        order_by="opened_at desc",
        limit=window,
        start=offset,
    )
    return page_of(_visible_personal_rows(principals, rows), offset, len(rows), window)


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
    """Set or clear the caller's private favourite mark."""
    _require_person(principals)
    if type(value) is not bool:
        frappe.throw(_("Drive favourite value must be a boolean"), frappe.ValidationError)
    # Adding a mark needs Read on the node. Removing the caller's own private
    # mark does not, or a node that stopped being readable would leave a
    # favourite its owner can neither see nor clear.
    if value:
        _authorized_node(principals, node)
    existing = frappe.db.get_value(
        "Drive Favourite",
        {"user": principals.user, "node": node},
        "name",
        for_update=True,
    )
    if value and not existing:
        _insert_unique(
            {"doctype": "Drive Favourite", "user": principals.user, "node": node},
            lambda: frappe.db.get_value("Drive Favourite", {"user": principals.user, "node": node}, "name"),
        )
    elif not value and existing:
        frappe.db.delete("Drive Favourite", {"name": existing, "user": principals.user})
    return value


def favourites(
    principals: Principals,
    *,
    cursor: str | None = None,
    limit: int = DEFAULT_RECORD_LIMIT,
) -> dict:
    """Page only the caller's still-readable favourite nodes."""
    from suite.drive._core.nodes import decode_cursor, page_limit, page_of

    _require_person(principals)
    window = page_limit(limit)
    offset = decode_cursor(cursor)
    rows = frappe.get_all(
        "Drive Favourite",
        filters={"user": principals.user},
        fields=["name", "node", "creation"],
        order_by="creation desc",
        limit=window,
        start=offset,
    )
    return page_of(_visible_personal_rows(principals, rows), offset, len(rows), window)


def personal_marks(principals: Principals, nodes: Iterable[str]) -> dict[str, dict]:
    """Report the caller's own favourite and recent marks on named nodes.

    Two indexed reads for a whole page, keyed by the caller. `favourites` and
    `recents` answer "which nodes are marked"; a listing needs the transpose,
    "is this row marked", and deriving it from those pages would read the
    caller's entire personal lists to decorate sixty rows.

    No node is checked. The rows belong to the caller, not to the node, and the
    caller is looking at a page a workflow already authorized. A Guest holds no
    personal records at all (§11.2), so the answer is empty rather than a
    refusal: a listing must not fail because the reader is anonymous.
    """
    wanted = tuple(dict.fromkeys(node for node in nodes if node))
    if not wanted or principals.user == "Guest":
        return {}
    marks: dict[str, dict] = {node: {"favourite": None, "opened_at": None} for node in wanted}
    for row in frappe.get_all(
        "Drive Favourite",
        filters={"user": principals.user, "node": ["in", wanted]},
        fields=["name", "node"],
    ):
        marks[row.node]["favourite"] = row.name
    for row in frappe.get_all(
        "Drive Recent",
        filters={"user": principals.user, "node": ["in", wanted]},
        fields=["node", "opened_at"],
    ):
        marks[row.node]["opened_at"] = row.opened_at
    return marks


def notify_users(activity: str, users: Iterable[str]) -> int:
    """Create one notification pointer for each distinct existing target user."""
    created = 0
    for user in dict.fromkeys(users):
        if not isinstance(user, str) or not user or not frappe.db.exists("User", user):
            continue
        if frappe.db.exists("Drive Notification", {"activity": activity, "to_user": user}):
            continue
        # `notif_activity_user` keeps one row per person per activity even when
        # a concurrent writer inserts the same pair between the check and here.
        _, inserted = _insert_unique(
            {"doctype": "Drive Notification", "activity": activity, "to_user": user, "read": 0},
            lambda: frappe.db.get_value(
                "Drive Notification", {"activity": activity, "to_user": user}, "name"
            ),
        )
        created += int(inserted)
    return created


def notifications(
    principals: Principals,
    *,
    only_unread: bool = False,
    cursor: str | None = None,
    limit: int = DEFAULT_RECORD_LIMIT,
) -> dict:
    """Page the caller's notification pointers with authorized activity data.

    A pointer whose activity is gone, or whose node the caller can no longer
    read, is dropped after the SQL window, so a full page can answer short.
    `next_cursor` still advances by the window (§11.4).
    """
    from suite.drive._core.nodes import decode_cursor, page_limit, page_of

    window = page_limit(limit)
    offset = decode_cursor(cursor)
    rows, seen = _visible_notifications(principals, only_unread=only_unread, limit=window, offset=offset)
    return page_of(rows, offset, seen, window)


def _visible_notifications(
    principals: Principals,
    *,
    only_unread: bool,
    limit: int | None,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """Return the visible pointers, and how many rows the SQL window held."""
    _require_person(principals)
    # §14.6 drops the legacy inbox: those rows carry no activity pointer, so
    # the inbox starts empty after Build. Saying so in SQL is what keeps
    # `unread_count` from reading every one of them to reach the same answer.
    filters: dict[str, Any] = {"to_user": principals.user, "activity": ["is", "set"]}
    if only_unread:
        filters["read"] = 0
    options = {
        "filters": filters,
        "fields": ["name", "activity", "to_user", "read", "creation"],
        "order_by": "creation desc",
    }
    if limit is not None:
        options["limit"] = limit
        options["start"] = offset
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
    return visible, len(rows)


def unread_count(principals: Principals) -> int:
    """Count the caller's unread, currently visible notification pointers."""
    return len(_visible_notifications(principals, only_unread=True, limit=None)[0])


def mark_read(principals: Principals, notifications: Iterable[str] | str | None = None) -> int:
    """Mark named, or all, of the caller's visible notifications read.

    §11.2 gives `POST /notifications/read` two bodies: a list of ids, or
    `{all: true}`. `None` is the second one. A single id is accepted as well,
    because a mention badge marks exactly one.

    The unread inbox is read once whatever the body says, so marking fifty
    pointers costs one pass, not fifty. Ids the caller does not hold are simply
    absent from that pass and are not counted.
    """
    _require_person(principals)
    if isinstance(notifications, str):
        notifications = (notifications,)
    wanted = None if notifications is None else frozenset(notifications)
    if wanted is not None and not wanted:
        return 0
    visible, _seen = _visible_notifications(principals, only_unread=True, limit=None)
    ids = tuple(row.name for row in visible if wanted is None or row.name in wanted)
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


def discard_personal_records(user: str) -> dict[str, int]:
    """Delete one person's private Drive records during offboarding.

    Recents, favourites, and the notification inbox are keyed by email, not by
    a root id. Archiving the Personal Root leaves them behind, so a User row
    recreated on the same address would read the previous person's open
    history, stars, and inbox. Grants, comments, activity, and versions are
    deliberately kept: they are attributed history and specified access that
    the archived tree still needs (spec sections 3.2 and 9.5).

    Idempotent, and safe on a site whose Build has not created the tables yet.
    Runs in the caller's transaction so a refused User delete keeps the rows.
    """
    if not isinstance(user, str) or not user:
        frappe.throw(_("Drive personal records need a user"), frappe.ValidationError)
    removed = {}
    for doctype, fieldname in (
        ("Drive Recent", "user"),
        ("Drive Favourite", "user"),
        ("Drive Notification", "to_user"),
    ):
        removed[doctype] = _delete_personal_rows(doctype, fieldname, user)
    return removed


def _delete_personal_rows(doctype: str, fieldname: str, user: str) -> int:
    if not frappe.db.exists("DocType", doctype) or not frappe.db.table_exists(doctype):
        return 0
    if not frappe.get_meta(doctype).get_field(fieldname):
        return 0
    filters = {fieldname: user}
    count = frappe.db.count(doctype, filters)
    if count:
        frappe.db.delete(doctype, filters)
    return count


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
    from suite.drive._core.nodes import NODE_FIELD_NAMES

    # The whole stored row, because a personal-list row carries its node into
    # §11.3's shape and a partial read would publish a node whose size, mime,
    # and owner are silently null.
    row = frappe.db.get_value("Drive Node", node, NODE_FIELD_NAMES, as_dict=True)
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


def _json_value(value, default):
    if value is None or value == "":
        return default
    return frappe.parse_json(value) if isinstance(value, str) else value
