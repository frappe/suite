"""Authorized comment threads attached to Drive content-document nodes."""

import re
from uuid import uuid4

import frappe
from frappe import _
from frappe.utils import now_datetime

from suite.drive._core.access import effective_role, require
from suite.drive._core.activity import notify_users, record
from suite.drive._core.errors import DriveConflict, DriveForbidden, DriveNotFound
from suite.drive._core.principals import Principals
from suite.drive._core.roles import COMMENT, EDIT, READ

_BRACKET_MENTION = re.compile(r"@\[([^\]\r\n]{1,140})\]")
_EMAIL_MENTION = re.compile(r"(?<![\w@])@([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})")
_DATA_MENTION = re.compile(r"data-(?:id|user)=[\"']([^\"'\r\n]{1,140})[\"']")


def create_thread(
    principals: Principals,
    node: str,
    anchor: str,
    text: str,
    *,
    author_name: str | None = None,
) -> str:
    """Create a thread and its first server-authored comment."""
    _validate_anchor(anchor)
    _validate_text(text)
    savepoint = f"drive_comment_thread_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        node_row = _comment_node(node, for_update=True)
        via_link = require(node_row, COMMENT, principals)
        _require_document(node_row)
        _require_active(node_row)
        thread = frappe.get_doc(
            {
                "doctype": "Drive Comment Thread",
                "node": node_row.name,
                "anchor": anchor,
                "resolved": 0,
            }
        ).insert(ignore_permissions=True)
        comment, mentions = _insert_comment(
            principals,
            thread.name,
            node_row.name,
            text,
            author_name=author_name,
        )
        activity = record(
            principals,
            node_row.name,
            "comment",
            detail={"thread": thread.name, "comment": comment, "resolved": False},
            via_link=via_link,
        )
        notify_users(activity, mentions)
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return thread.name


def reply(
    principals: Principals,
    thread: str,
    text: str,
    *,
    author_name: str | None = None,
) -> str:
    """Append a server-authored reply to an existing thread."""
    _validate_text(text)
    savepoint = f"drive_comment_reply_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        thread_row, node = _locked_thread(thread)
        via_link = require(node, COMMENT, principals)
        _require_document(node)
        _require_active(node)
        comment, mentions = _insert_comment(
            principals,
            thread_row.name,
            node.name,
            text,
            author_name=author_name,
        )
        activity = record(
            principals,
            node.name,
            "comment",
            detail={
                "thread": thread_row.name,
                "comment": comment,
                "resolved": bool(thread_row.resolved),
            },
            via_link=via_link,
        )
        notify_users(activity, mentions)
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return comment


def resolve(principals: Principals, thread: str, resolved: bool = True) -> None:
    """Resolve or reopen a thread with Comment access."""
    if type(resolved) is not bool:
        frappe.throw(_("Drive comment resolution must be a boolean"), frappe.ValidationError)
    savepoint = f"drive_comment_resolve_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        thread_row, node = _locked_thread(thread)
        via_link = require(node, COMMENT, principals)
        _require_document(node)
        _require_active(node)
        if bool(thread_row.resolved) == resolved:
            frappe.db.release_savepoint(savepoint)
            return
        values = {
            "resolved": int(resolved),
            "resolved_by": principals.user if resolved else None,
            "resolved_at": now_datetime() if resolved else None,
        }
        frappe.db.set_value("Drive Comment Thread", thread_row.name, values)
        record(
            principals,
            node.name,
            "comment",
            detail={"thread": thread_row.name, "comment": None, "resolved": resolved},
            via_link=via_link,
        )
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    else:
        frappe.db.release_savepoint(savepoint)


def edit_comment(principals: Principals, comment: str, text: str) -> None:
    """Edit a comment as an editor or as its attributed author."""
    _validate_text(text)
    savepoint = f"drive_comment_edit_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        comment_row, node = _locked_comment(comment)
        via_link = require(node, READ, principals)
        _require_document(node)
        _require_active(node)
        _require_editor_or_author(principals, node, comment_row, via_link)
        mentions = _mentions(text)
        frappe.db.set_value(
            "Drive Comment",
            comment_row.name,
            {"content": text, "mentions": frappe.as_json(mentions)},
        )
        thread = _thread(comment_row.thread)
        activity = record(
            principals,
            node.name,
            "comment",
            detail={
                "thread": comment_row.thread,
                "comment": comment_row.name,
                "resolved": bool(thread.resolved),
            },
            via_link=via_link,
        )
        notify_users(activity, mentions)
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    else:
        frappe.db.release_savepoint(savepoint)


def delete_comment(principals: Principals, comment: str) -> None:
    """Delete a comment as an editor or as its attributed author."""
    savepoint = f"drive_comment_delete_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        comment_row, node = _locked_comment(comment)
        via_link = require(node, READ, principals)
        _require_document(node)
        _require_active(node)
        _require_editor_or_author(principals, node, comment_row, via_link)
        thread = _thread(comment_row.thread)
        frappe.db.delete("Drive Comment", {"name": comment_row.name})
        record(
            principals,
            node.name,
            "comment",
            detail={
                "thread": comment_row.thread,
                "comment": comment_row.name,
                "resolved": bool(thread.resolved),
            },
            via_link=via_link,
        )
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    else:
        frappe.db.release_savepoint(savepoint)


def threads(
    principals: Principals,
    node: str,
    *,
    resolved: bool | None = None,
) -> list[dict]:
    """Return authorized threads with their comments and opaque anchors."""
    if resolved is not None and type(resolved) is not bool:
        frappe.throw(_("Drive comment resolution filter must be a boolean"), frappe.ValidationError)
    node_row = _comment_node(node)
    require(node_row, READ, principals)
    _require_document(node_row)
    filters = {"node": node_row.name}
    if resolved is not None:
        filters["resolved"] = int(resolved)
    rows = frappe.get_all(
        "Drive Comment Thread",
        filters=filters,
        fields=["name", "node", "anchor", "resolved", "resolved_by", "resolved_at", "creation"],
        order_by="creation asc",
    )
    by_thread = {row.name: row for row in rows}
    for row in rows:
        row.resolved = bool(row.resolved)
        row.comments = []
    if not rows:
        return rows
    comments = frappe.get_all(
        "Drive Comment",
        filters={"thread": ["in", tuple(by_thread)]},
        fields=[
            "name",
            "thread",
            "node",
            "content",
            "author",
            "author_name",
            "mentions",
            "creation",
            "modified",
        ],
        order_by="creation asc",
    )
    for comment in comments:
        comment.mentions = _json_value(comment.mentions, [])
        by_thread[comment.thread].comments.append(comment)
    return rows


def _comment_node(node: str, *, for_update: bool = False) -> frappe._dict:
    row = frappe.db.get_value(
        "Drive Node",
        node,
        ["name", "parent", "root", "path", "kind", "state"],
        as_dict=True,
        for_update=for_update,
    )
    if not row:
        raise DriveNotFound(_("Drive node {0} was not found").format(node))
    return row


def _thread(thread: str, *, for_update: bool = False) -> frappe._dict:
    row = frappe.db.get_value(
        "Drive Comment Thread",
        thread,
        ["name", "node", "resolved", "resolved_by", "resolved_at"],
        as_dict=True,
        for_update=for_update,
    )
    if not row:
        raise DriveNotFound(_("Drive comment thread {0} was not found").format(thread))
    return row


def _comment(comment: str, *, for_update: bool = False) -> frappe._dict:
    row = frappe.db.get_value(
        "Drive Comment",
        comment,
        ["name", "thread", "node", "author", "author_name"],
        as_dict=True,
        for_update=for_update,
    )
    if not row:
        raise DriveNotFound(_("Drive comment {0} was not found").format(comment))
    return row


def _locked_thread(thread: str) -> tuple[frappe._dict, frappe._dict]:
    """Lock the node before its thread, the order every node workflow uses.

    `nodes.purge` locks the Drive Node row and then deletes the thread and
    comment rows beneath it. Locking a thread first would invert that order
    and deadlock a reply against a concurrent purge.
    """
    node = _comment_node(_thread(thread).node, for_update=True)
    locked = _thread(thread, for_update=True)
    if locked.node != node.name:
        raise DriveConflict(_("The Drive comment thread moved during the write"))
    return locked, node


def _locked_comment(comment: str) -> tuple[frappe._dict, frappe._dict]:
    """Lock the node before its comment, matching `_locked_thread`."""
    node = _comment_node(_comment(comment).node, for_update=True)
    locked = _comment(comment, for_update=True)
    if locked.node != node.name:
        raise DriveConflict(_("The Drive comment moved during the write"))
    return locked, node


def _insert_comment(
    principals: Principals,
    thread: str,
    node: str,
    text: str,
    *,
    author_name: str | None,
) -> tuple[str, list[str]]:
    guest_name = _guest_name(principals, author_name)
    mentions = _mentions(text)
    row = frappe.get_doc(
        {
            "doctype": "Drive Comment",
            "thread": thread,
            "node": node,
            "content": text,
            "author": principals.user,
            "author_name": guest_name,
            "mentions": frappe.as_json(mentions),
        }
    ).insert(ignore_permissions=True)
    return row.name, mentions


def _require_editor_or_author(
    principals: Principals,
    node: frappe._dict,
    comment: frappe._dict,
    via_link: str | None,
) -> None:
    if effective_role(node, principals) >= EDIT:
        return
    if comment.author != principals.user:
        raise DriveForbidden(_("Only a Drive comment author or editor can modify it"))
    if principals.user != "Guest":
        return
    if not via_link or not _guest_comment_link(comment, via_link):
        raise DriveForbidden(_("This Guest caller did not author the Drive comment"))


def _guest_comment_link(comment: frappe._dict, via_link: str) -> bool:
    rows = frappe.get_all(
        "Drive Activity",
        filters={"node": comment.node, "action": "comment", "actor": "Guest", "via_link": via_link},
        fields=["detail"],
        order_by="creation asc",
    )
    return any(_json_value(row.detail, {}).get("comment") == comment.name for row in rows)


def _mentions(text: str) -> list[str]:
    candidates = []
    for pattern in (_BRACKET_MENTION, _EMAIL_MENTION, _DATA_MENTION):
        candidates.extend(pattern.findall(text))
    return [user for user in dict.fromkeys(candidates) if frappe.db.exists("User", user)]


def _validate_anchor(anchor: str) -> None:
    if not isinstance(anchor, str) or not anchor or len(anchor) > 255:
        frappe.throw(_("Drive comment anchor must contain 1 to 255 characters"), frappe.ValidationError)


def _validate_text(text: str) -> None:
    if not isinstance(text, str) or not text.strip():
        frappe.throw(_("Drive comment text is required"), frappe.ValidationError)


def _guest_name(principals: Principals, author_name: str | None) -> str | None:
    if principals.user != "Guest":
        return None
    if author_name is None:
        return None
    if not isinstance(author_name, str) or not author_name.strip() or len(author_name) > 140:
        frappe.throw(_("Drive Guest display name must contain 1 to 140 characters"), frappe.ValidationError)
    return author_name.strip()


def _require_active(node: frappe._dict) -> None:
    if node.state != "Active":
        raise DriveForbidden(_("A trashed Drive node cannot be commented on"))


def _require_document(node: frappe._dict) -> None:
    if node.kind != "document":
        raise DriveConflict(_("Drive comments require a content document node"))


def _json_value(value, default):
    if value is None or value == "":
        return default
    return frappe.parse_json(value) if isinstance(value, str) else value
