"""Authorized comment threads attached to Drive content-document nodes."""

import re
from collections.abc import Callable
from datetime import UTC, datetime
from uuid import uuid4
from zoneinfo import ZoneInfo

import frappe
from bs4 import BeautifulSoup, NavigableString, Tag
from frappe import _
from frappe.model.document import Document
from frappe.utils import get_system_timezone, now_datetime

from suite.drive._core import content
from suite.drive._core.access import effective_role, require
from suite.drive._core.activity import notify_users, record
from suite.drive._core.errors import (
    DriveConflict,
    DriveForbidden,
    DriveNotFound,
    rollback_savepoint,
)
from suite.drive._core.nodes import MAX_PAGE_SIZE, node_owner
from suite.drive._core.principals import Principals
from suite.drive._core.roles import COMMENT, EDIT, READ

_BRACKET_MENTION = re.compile(r"@\[([^\]\r\n]{1,140})\]")
_EMAIL_MENTION = re.compile(r"(?<![\w@])@([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})")
_DATA_MENTION = re.compile(r"data-(?:id|user)=[\"']([^\"'\r\n]{1,140})[\"']")
_CLIENT_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
# The most a comment holds, in UTF-8 bytes, as the old Text column did
MAX_COMMENT_BYTES = 65_535
# The most an old Drive commenter's name holds, as the old Data column did
MAX_AUTHOR_NAME_CHARS = 140

# Every tag the old comment editors wrote; text holding none of them isn't HTML
COMMENT_TAGS = frozenset(
    "p br span a img iframe video div ul ol li strong em b i u s code mark pre blockquote hr"
    " h1 h2 h3 h4 h5 h6 table tbody tr td th colgroup col label input".split()
)


def insert_thread(
    principals: Principals,
    node_row: frappe._dict,
    anchor: str,
    text: str,
    via_link: str | None,
    author_name: str | None,
    client_id: str | None,
) -> str:
    """Insert a thread with its first comment and record the comment; answer the thread."""
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
        principals, thread.name, node_row.name, text, author_name=author_name, client_id=None
    )
    activity = record(
        principals,
        node_row.name,
        "comment",
        detail={"thread": thread.name, "comment": comment, "resolved": False},
        via_link=via_link,
    )
    notify_users(activity, mentions)
    return thread.name


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
        sent = first_send("Drive Comment Thread", node_row.name, client_id, text)
        if sent:
            frappe.db.release_savepoint(savepoint)
            return _thread_view(sent.name)

        thread = insert_thread(principals, node_row, anchor, text, via_link, author_name, client_id)
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    announce_threads(node_row)
    return _thread_view(thread)


def insert_reply(
    principals: Principals,
    thread_row: frappe._dict,
    node: frappe._dict,
    text: str,
    via_link: str | None,
    author_name: str | None,
    client_id: str | None,
) -> str:
    """Insert a reply into a thread and record it; answer the comment."""
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
    return comment


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
        sent = first_send("Drive Comment", node.name, client_id, text)
        if sent:
            if sent.thread != thread_row.name:
                raise DriveConflict(_("This Drive comment id was already used in another thread"))

            frappe.db.release_savepoint(savepoint)
            return _comment_view(sent.name)

        comment = insert_reply(principals, thread_row, node, text, via_link, author_name, client_id)
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    announce_threads(node)
    return _comment_view(comment)


def write_resolution(
    principals: Principals,
    thread_row: frappe._dict,
    node: frappe._dict,
    resolved: bool,
    via_link: str | None,
) -> None:
    """Resolve or reopen a thread and record it."""
    values: dict[str, object] = {"resolved": int(resolved), "resolved_by": None, "resolved_at": None}
    if resolved:
        values["resolved_by"] = principals.user
        values["resolved_at"] = now_datetime()

    frappe.db.set_value("Drive Comment Thread", thread_row.name, values)
    record(
        principals,
        node.name,
        "comment",
        detail={"thread": thread_row.name, "comment": None, "resolved": resolved},
        via_link=via_link,
    )


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

        write_resolution(principals, thread_row, node, resolved, via_link)
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    announce_threads(node)
    return _thread_view(thread_row.name)


def reanchor_threads(principals: Principals, node: str, anchors: dict[str, str]) -> list[frappe._dict]:
    """Move threads of one document to new anchors with Edit access; answer them as listed."""
    validate_anchor_map(anchors)
    if not anchors:
        return []

    savepoint = f"drive_comment_reanchor_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        node_row = _comment_node(node, for_update=True)
        require(node_row, EDIT, principals)
        _require_document(node_row)
        _require_active(node_row)
        write_anchors(node_row.name, anchors)
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    announce_threads(node_row)
    return _thread_views({"name": ["in", list(anchors)]})


def comment_threads(principals: Principals, node: str) -> list[dict]:
    """Answer each thread of one document with its anchor and comment ids, in thread order, with no words."""
    listed: list[dict] = []
    for row in threads(principals, node):
        comments = [comment.name for comment in row.comments]
        listed.append({"name": row.name, "anchor": row.anchor, "comments": comments})

    return listed


def has_blank_old_comment(new_threads: list[dict]) -> bool:
    """Answer whether any old comment in `new_threads` stores as blank text."""
    for thread in new_threads:
        converted = [html_comment_text(comment["content"]) for comment in thread["comments"]]
        if any(not text.strip() for text, _span_ids in converted):
            return True

    return False


def install_threads(
    principals: Principals, node: str, anchors: dict[str, str], new_threads: list[dict]
) -> list[str]:
    """Move threads and add old Drive threads under the node's owner at their own times; answer the new ids."""
    times = old_thread_stamps(anchors, new_threads)
    if not anchors and not new_threads:
        return []

    savepoint = f"drive_comment_install_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        node_row = _comment_node(node, for_update=True)
        require(node_row, EDIT, principals)
        _require_document(node_row)
        _require_active(node_row)
        write_anchors(node_row.name, anchors)
        owner = node_owner(node_row.name)
        installed: list[str] = []
        for entry, stamps in zip(new_threads, times, strict=True):
            installed.append(insert_old_thread(node_row.name, owner, entry, stamps))
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    announce_threads(node_row)
    return installed


def old_thread_stamps(anchors: object, new_threads: object) -> list[list[str]]:
    """Refuse malformed install input, and answer each old Drive thread's comment times at the site."""
    if not isinstance(anchors, dict) or not isinstance(new_threads, list):
        raise frappe.ValidationError(_("Drive needs an anchor map and a list of comment threads"))

    for thread, anchor in anchors.items():
        if not isinstance(thread, str) or not thread.strip():
            frappe.throw(_("Drive comment thread ids must be text"), frappe.ValidationError)

        _validate_anchor(anchor)

    zone = get_system_timezone()
    times: list[list[str]] = []
    for entry in new_threads:
        if (
            not isinstance(entry, dict)
            or not isinstance(entry.get("comments"), list)
            or not entry["comments"]
        ):
            frappe.throw(
                _("An old Drive comment thread needs an anchor and comments"), frappe.ValidationError
            )

        _validate_anchor(entry.get("anchor"))
        for comment in entry["comments"]:
            validate_old_comment(comment)

        times.append([site_time(comment.get("time"), zone) for comment in entry["comments"]])

    return times


def validate_old_comment(comment: object) -> None:
    if not isinstance(comment, dict):
        raise frappe.ValidationError(_("An old Drive comment must be an object"))

    text = comment.get("content")
    if isinstance(text, str):
        text, _span_ids = html_comment_text(text)

    _validate_text(text)
    name = comment.get("author_name")
    if not isinstance(name, str) or not name.strip() or len(name) > MAX_AUTHOR_NAME_CHARS:
        frappe.throw(
            _("An old Drive commenter name must contain 1 to {0} characters").format(MAX_AUTHOR_NAME_CHARS),
            frappe.ValidationError,
        )


def insert_old_thread(node: str, owner: str, entry: dict, stamps: list[str]) -> str:
    """Write one old Drive thread and its comments under the owner at their own times, with no activity."""
    thread = frappe.get_doc(
        {
            "doctype": "Drive Comment Thread",
            "node": node,
            "anchor": entry["anchor"],
            "resolved": 0,
            "client_id": None,
            "owner": owner,
            "modified_by": owner,
            "creation": stamps[0],
            "modified": stamps[-1],
        }
    )
    thread.db_insert()
    for index, (comment, stamp) in enumerate(zip(entry["comments"], stamps, strict=True), 1):
        insert_old_comment(thread, owner, comment, stamp, index)

    return thread.name


def insert_old_comment(thread: Document, owner: str, comment: dict, stamp: str, index: int) -> None:
    text, span_ids = html_comment_text(comment["content"])
    frappe.get_doc(
        {
            "doctype": "Drive Comment",
            "thread": thread.name,
            "node": thread.node,
            "content": text,
            "author": owner,
            "author_name": comment["author_name"].strip(),
            "mentions": frappe.as_json(
                mentioned_users(span_ids, lambda user: frappe.db.get_value("User", user, "name"))
            ),
            "client_id": None,
            "owner": owner,
            "modified_by": owner,
            "creation": stamp,
            "modified": stamp,
            "idx": index,
        }
    ).db_insert()


def site_time(value: object, timezone: str) -> str:
    """Answer one UTC epoch-millisecond time as a naive site datetime, as Build's `epoch_millis` does."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise frappe.ValidationError(_("An old Drive comment time must be epoch milliseconds"))

    try:
        converted = datetime.fromtimestamp(value / 1000, UTC).astimezone(ZoneInfo(timezone))
    except (OSError, OverflowError, ValueError):
        frappe.throw(_("An old Drive comment time is outside the datetime range"), frappe.ValidationError)

    return converted.replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S.%f")


def write_anchors(node: str, anchors: dict[str, str]) -> None:
    """Move threads of one node to new anchors, refusing a thread that is not on it."""
    filters = {"name": ["in", list(anchors)], "node": node}
    held = frappe.get_all("Drive Comment Thread", filters=filters, pluck="name")
    if len(held) != len(anchors):
        raise DriveNotFound(_("A Drive comment thread to move is not on node {0}").format(node))

    for thread, anchor in anchors.items():
        frappe.db.set_value("Drive Comment Thread", thread, "anchor", anchor, update_modified=False)


def write_comment_edit(
    principals: Principals,
    comment_row: frappe._dict,
    node: frappe._dict,
    text: str,
    via_link: str | None,
) -> None:
    """Rewrite a comment's text and record it, telling only the people it newly mentions."""
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
    notify_users(activity, set(mentions) - set(_json_value(comment_row.mentions, [])))


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
        write_comment_edit(principals, comment_row, node, text, via_link)
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    announce_threads(node)
    return _comment_view(comment_row.name)


def delete_comment_row(
    principals: Principals,
    comment_row: frappe._dict,
    node: frappe._dict,
    via_link: str | None,
) -> None:
    """Delete a comment, and its thread once it holds no other, and record it."""
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
        delete_comment_row(principals, comment_row, node, via_link)
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    announce_threads(node)


def threads(
    principals: Principals,
    node: str,
    *,
    resolved: bool | None = None,
) -> list[frappe._dict]:
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
        ["name", "thread", "node", "author", "author_name", "mentions"],
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
    # Frappe counts words made only of tags as missing; _validate_text already refuses blank words
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
    ).insert(ignore_permissions=True, ignore_mandatory=True)
    return row.name, mentions


def first_send(doctype: str, node: str, client_id: str | None, text: str) -> frappe._dict | None:
    """Return the row an earlier send of these words under this id made; the caller holds the lock."""
    if client_id is None:
        return None

    sent = frappe.db.get_value(doctype, {"node": node, "client_id": client_id}, "*", as_dict=True)
    if not sent:
        return None

    words = sent.get("content")
    if doctype == "Drive Comment Thread":
        words = frappe.db.get_value(
            "Drive Comment", {"thread": sent.name}, "content", order_by="creation asc"
        )

    if words != text:
        raise DriveConflict(_("This Drive comment id was already used for other words"))

    return sent


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


def html_comment_text(text: str) -> tuple[str, list[str]]:
    """Turn an old HTML comment into text with `@[user]` tokens and the ids it mentions; keep other text."""
    if not text.startswith("<"):
        return text, []

    soup = BeautifulSoup(text, "html.parser")
    if soup.find(COMMENT_TAGS) is None:
        return text, []

    parts: list[str] = []
    mentions: list[str] = []
    append_comment_text(soup, parts, mentions)
    converted = "".join(parts).rstrip("\n")
    return converted, list(dict.fromkeys(mentions))


def append_comment_text(node: Tag, parts: list[str], mentions: list[str]) -> None:
    for child in node.children:
        if isinstance(child, Tag):
            append_tag_text(child, parts, mentions)
        elif type(child) is NavigableString:
            parts.append(str(child))


def append_tag_text(tag: Tag, parts: list[str], mentions: list[str]) -> None:
    name = tag.name
    if name == "br":
        parts.append("\n")
    elif name in {"img", "iframe"}:
        append_source(text_attribute(tag, "src"), parts)
    elif is_mention(tag):
        user = str(tag["data-id"])
        parts.append(f"@[{user}]")
        mentions.append(user)
    elif name == "a":
        parts.append(link_text(tag.get_text(), text_attribute(tag, "href")))
    elif name in {"ul", "ol"}:
        append_list_items(tag, parts, mentions)
    else:
        append_comment_text(tag, parts, mentions)
        if name == "p":
            parts.append("\n")


def text_attribute(tag: Tag, key: str) -> str | None:
    value = tag.get(key)
    return value if isinstance(value, str) else None


def append_source(source: str | None, parts: list[str]) -> None:
    if not source:
        return

    if parts and not parts[-1].endswith("\n"):
        parts.append("\n")

    parts.append(f"{source}\n")


def is_mention(tag: Tag) -> bool:
    marked = tag.get("data-type") == "mention" or "mention" in tag.get_attribute_list("class")
    return tag.name == "span" and marked and bool(tag.get("data-id"))


def append_list_items(tag: Tag, parts: list[str], mentions: list[str]) -> None:
    for number, item in enumerate(tag.find_all("li", recursive=False), 1):
        marker = "- "
        if tag.name == "ol":
            marker = f"{number}. "

        item_parts: list[str] = []
        append_comment_text(item, item_parts, mentions)
        item_text = "".join(item_parts).rstrip("\n")
        parts.append(f"{marker}{item_text}\n")


def link_text(text: str, href: str | None) -> str:
    if not href:
        return text

    if text in {"", href}:
        return href

    return f"{text} ({href})"


def mentioned_users(ids: list[str], user_name: Callable[[str], str | None]) -> list[str]:
    """Answer the stored name of each User in `ids` once, in first-seen order."""
    return list(dict.fromkeys(filter(None, map(user_name, ids))))


def _mentions(text: str) -> list[str]:
    candidates = []
    for pattern in (_BRACKET_MENTION, _EMAIL_MENTION, _DATA_MENTION):
        candidates.extend(pattern.findall(text))

    return list(
        dict.fromkeys(filter(None, (frappe.db.get_value("User", user, "name") for user in candidates)))
    )


def _validate_anchor(anchor: str) -> None:
    if not isinstance(anchor, str) or not anchor or len(anchor) > 255:
        frappe.throw(_("Drive comment anchor must contain 1 to 255 characters"), frappe.ValidationError)


def validate_anchor_map(anchors: dict[str, str]) -> None:
    """Refuse an anchor map that is too big or names a thread or an anchor badly."""
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


def _validate_text(text: object) -> None:
    if not isinstance(text, str) or not text.strip():
        raise frappe.ValidationError(_("Drive comment text is required"))

    if len(text.encode("utf-8")) > MAX_COMMENT_BYTES:
        frappe.throw(_("Drive comment text must be at most 64 KB"), frappe.ValidationError)


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
