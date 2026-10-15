"""Authorized comment threads attached to Drive content-document nodes."""

import re
from collections.abc import Callable, Iterable
from uuid import uuid4

import frappe
from frappe import _
from frappe.utils import now_datetime

from suite.drive._core import content
from suite.drive._core.access import effective_role, require
from suite.drive._core.activity import notify_users, record
from suite.drive._core.errors import (
    DriveConflict,
    DriveForbidden,
    DriveNotFound,
    rollback_savepoint,
)
from suite.drive._core.nodes import MAX_PAGE_SIZE
from suite.drive._core.principals import Principals
from suite.drive._core.roles import COMMENT, EDIT, READ

_BRACKET_MENTION = re.compile(r"@\[([^\]\r\n]{1,140})\]")
_EMAIL_MENTION = re.compile(r"(?<![\w@])@([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})")
_DATA_MENTION = re.compile(r"data-(?:id|user)=[\"']([^\"'\r\n]{1,140})[\"']")
_CLIENT_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")


def create_thread(
    principals: Principals,
    node: str,
    anchor: str,
    text: str,
    *,
    author_name: str | None = None,
    client_id: str | None = None,
) -> dict:
    """Create a thread and its first server-authored comment.

    Returns the thread as `threads` lists it, its first comment included, so
    `POST /nodes/<id>/threads` answers the resource it created (§11.2).

    `client_id` is the writing client's own id for this thread, unique per
    node. A resend with the same id, after an answer was lost, writes nothing
    and answers the thread the first send made.
    """
    _validate_anchor(anchor)
    _validate_text(text)
    validate_client_id(client_id)
    savepoint = f"drive_comment_thread_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        node_row = _comment_node(node, for_update=True)
        via_link = require(node_row, COMMENT, principals)
        _require_document(node_row)
        _require_active(node_row)
        sent = first_send("Drive Comment Thread", node_row.name, client_id)
        if sent:
            frappe.db.release_savepoint(savepoint)
            return _thread_view(sent.name)

        thread = frappe.get_doc(
            {
                "doctype": "Drive Comment Thread",
                "node": node_row.name,
                "anchor": anchor,
                "resolved": 0,
                "client_id": client_id,
            }
        ).insert(ignore_permissions=True)
        comment, mentions = _insert_comment(
            principals,
            thread.name,
            node_row.name,
            text,
            author_name=author_name,
            client_id=None,
        )
        activity = record(
            principals,
            node_row.name,
            "comment",
            detail={"thread": thread.name, "comment": comment, "resolved": False},
            via_link=via_link,
        )
        notify_users(activity, mentions)
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    announce_threads(node_row)
    return _thread_view(thread.name)


def reply(
    principals: Principals,
    thread: str,
    text: str,
    *,
    author_name: str | None = None,
    client_id: str | None = None,
) -> frappe._dict:
    """Append a server-authored reply to an existing thread; answer the comment row, the first one on a resend."""
    _validate_text(text)
    validate_client_id(client_id)
    savepoint = f"drive_comment_reply_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        thread_row, node = _locked_thread(thread)
        via_link = require(node, COMMENT, principals)
        _require_document(node)
        _require_active(node)
        sent = first_send("Drive Comment", node.name, client_id)
        if sent:
            if sent.thread != thread_row.name:
                raise DriveConflict(_("This Drive comment id was already used in another thread"))

            frappe.db.release_savepoint(savepoint)
            return _comment_view(sent.name)

        comment, mentions = _insert_comment(
            principals,
            thread_row.name,
            node.name,
            text,
            author_name=author_name,
            client_id=client_id,
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
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    announce_threads(node)
    return _comment_view(comment)


def resolve(principals: Principals, thread: str, resolved: bool = True) -> frappe._dict:
    """Resolve or reopen a thread with Comment access; answer the thread as listed."""
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
            return _thread_view(thread_row.name)
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
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    announce_threads(node)
    return _thread_view(thread_row.name)


def reanchor_threads(principals: Principals, node: str, anchors: dict[str, str]) -> list[frappe._dict]:
    """Move threads of one document to new anchors with Edit access; answer them as listed."""
    _validate_anchor_map(anchors)
    if not anchors:
        return []

    savepoint = f"drive_comment_reanchor_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        node_row = _comment_node(node, for_update=True)
        require(node_row, EDIT, principals)
        _require_document(node_row)
        _require_active(node_row)
        _write_anchors(node_row.name, anchors)
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    announce_threads(node_row)
    return _thread_views({"name": ["in", list(anchors)]})


def _write_anchors(node: str, anchors: dict[str, str]) -> None:
    filters = {"name": ["in", list(anchors)], "node": node}
    held = frappe.get_all("Drive Comment Thread", filters=filters, pluck="name")
    if len(held) != len(anchors):
        raise DriveNotFound(_("A Drive comment thread to move is not on node {0}").format(node))

    for thread, anchor in anchors.items():
        frappe.db.set_value("Drive Comment Thread", thread, "anchor", anchor, update_modified=False)


def edit_comment(principals: Principals, comment: str, text: str) -> frappe._dict:
    """Edit a comment as an editor or as its attributed author; answer the comment row."""
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
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    announce_threads(node)
    return _comment_view(comment_row.name)


def delete_comment(principals: Principals, comment: str) -> None:
    """Delete a comment as an editor or as its attributed author.

    A thread is a group of comments (`CONTEXT.md`, Comment), so one that loses
    its last comment goes with it: `threads` never lists an empty thread, and
    a panel never renders one. The activity row keeps the thread's id.
    """
    savepoint = f"drive_comment_delete_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        comment_row, node = _locked_comment(comment)
        via_link = require(node, READ, principals)
        _require_document(node)
        _require_active(node)
        _require_editor_or_author(principals, node, comment_row, via_link)
        thread = _thread(comment_row.thread, for_update=True)
        frappe.db.delete("Drive Comment", {"name": comment_row.name})
        if not frappe.db.count("Drive Comment", {"thread": thread.name}):
            frappe.db.delete("Drive Comment Thread", {"name": thread.name})
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
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    announce_threads(node)


def record_comment(
    principals: Principals,
    node: str,
    *,
    thread: str,
    comment: str,
    resolved: bool,
    mentions: Iterable[str],
) -> str:
    """Record a comment a content app stores in its own body; answer the activity.

    Writer's inline comments are anchored Yjs data only Writer can read, so
    Writer keeps them and reports each one here (§10.2). The row is the same
    `comment` activity a Drive thread writes, `thread` and `comment` are the
    app's own ids, and the people it mentions get the same notification a
    Drive comment's mention gets. Needs COMMENT on an Active document node,
    as any comment does.
    """
    node_row = _comment_node(node)
    via_link = require(node_row, COMMENT, principals)
    _require_document(node_row)
    _require_active(node_row)
    activity = record(
        principals,
        node_row.name,
        "comment",
        detail={"thread": thread, "comment": comment, "resolved": resolved},
        via_link=via_link,
    )
    notify_users(activity, mentions)
    return activity


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
    return _thread_views(filters)


def _thread_view(thread: str) -> frappe._dict:
    """One thread with its comments, as `threads` lists it. The write answers it."""
    rows = _thread_views({"name": thread})
    if not rows:
        raise DriveNotFound(_("Drive comment thread {0} was not found").format(thread))
    return rows[0]


def _thread_views(filters: dict) -> list[frappe._dict]:
    rows = frappe.get_all(
        "Drive Comment Thread",
        filters=filters,
        fields=["name", "node", "anchor", "resolved", "resolved_by", "resolved_at", "creation"],
        # `creation` alone is not a total order. §14.6 copies `ycomments` and the
        # Sheets cell threads in one pass, so a migrated node can hold many rows
        # at one timestamp and MariaDB may return them in any order between two
        # reads of the same page. `name` breaks the tie so a reader sees one
        # order twice. A thread carries no source position of its own — both
        # doctypes are `autoname: hash` — so this is a stable order, not a
        # chronological one, and Build owes any thread order it wants preserved
        # to `creation` itself.
        order_by="creation asc, name asc",
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
        # `idx` sits between the two, and it is the only key that carries source
        # order. Nothing at runtime writes it, so a native row keeps the 0
        # `base_document.init_valid_columns` leaves, and the key is inert. Build
        # writes the source entry position (`patches/build/comments.py`), and a
        # migrated thread routinely holds several entries at one `creation`:
        # every entry that fell back to its container stamp, and every legacy
        # Sheet cell string. Without `idx` those read back ordered by a sha256
        # id, so a reply can precede the comment it answers.
        order_by="creation asc, idx asc, name asc",
    )
    for comment in comments:
        comment.mentions = _json_value(comment.mentions, [])
        by_thread[comment.thread].comments.append(comment)
    return rows


def _comment_view(comment: str) -> frappe._dict:
    """One comment row as a thread lists it. The write answers it."""
    row = frappe.db.get_value(
        "Drive Comment",
        comment,
        ["name", "thread", "node", "content", "author", "author_name", "mentions", "creation", "modified"],
        as_dict=True,
    )
    if not row:
        raise DriveNotFound(_("Drive comment {0} was not found").format(comment))
    row.mentions = _json_value(row.mentions, [])
    return row


def _comment_node(node: str, *, for_update: bool = False) -> frappe._dict:
    row = frappe.db.get_value(
        "Drive Node",
        node,
        ["name", "parent_node", "root", "path", "kind", "state", "content_doctype"],
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
    client_id: str | None,
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
            "client_id": client_id,
        }
    ).insert(ignore_permissions=True)
    return row.name, mentions


def first_send(doctype: str, node: str, client_id: str | None) -> frappe._dict | None:
    """Return the row an earlier send with this client id made; the caller holds the node's lock."""
    if client_id is None:
        return None

    return frappe.db.get_value(doctype, {"node": node, "client_id": client_id}, "*", as_dict=True)


def announce_threads(node: frappe._dict) -> None:
    """Call the node's `threads_changed` callback once this write commits."""
    spec = content.registry().get(node.content_doctype)
    if spec and spec.threads_changed:
        frappe.db.after_commit.add(lambda: send_threads_changed(spec.threads_changed, node.name))


def send_threads_changed(callback: Callable[[str], None], node: str) -> None:
    try:
        content.call_app(callback, node)
    except Exception:
        # A file log: an Error Log row written after the request's commit would never be committed
        frappe.logger("suite.drive").exception("Drive: could not announce the threads of %s", node)


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


def _validate_anchor_map(anchors: dict[str, str]) -> None:
    if not isinstance(anchors, dict) or len(anchors) > MAX_PAGE_SIZE:
        frappe.throw(
            _("Drive may move at most {0} comment threads at once").format(MAX_PAGE_SIZE),
            frappe.ValidationError,
        )

    for thread, anchor in anchors.items():
        if not isinstance(thread, str) or not thread.strip():
            frappe.throw(_("Drive comment thread ids must be text"), frappe.ValidationError)

        _validate_anchor(anchor)


def validate_client_id(client_id: str | None) -> None:
    if client_id is None:
        return

    if not isinstance(client_id, str) or not _CLIENT_ID.fullmatch(client_id):
        frappe.throw(
            _("Drive comment client id must be 1 to 64 letters, digits, - or _"), frappe.ValidationError
        )


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
