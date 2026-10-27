"""Turn an old Writer document into a collaborative one.

The layer's `convert_document` (suite.content.conversions) runs the converter on the row `read_old`
answers and installs the answer in one transaction under the row's lock. Writer's `check` runs before
the first write and `fix_up` moves the old comments; a refusal writes only its record. The records, the
attempts and the failure counts are the layer's.
"""

import base64
import hashlib
import json
from collections.abc import Collection
from dataclasses import dataclass, field
from datetime import datetime

import frappe
import pycrdt

from suite import drive
from suite.content import compaction, convert, copies
from suite.content.conversions import ConversionRefused
from suite.writer import content as writer_content

DOCTYPE = "Writer Document"
FIELDS = ("content", "html", "collab", "ycomments")


@dataclass(frozen=True)
class OldDocument:
    docname: str
    legacy: dict = field(repr=False)
    fingerprint: str
    threads: list[dict] = field(repr=False)
    modified: datetime


@dataclass(frozen=True)
class CheckedDocument:
    html: str = field(repr=False)
    dropped: list[dict]
    anchors: dict[str, str] = field(repr=False)
    threads: list[dict] = field(repr=False)


def old_row(node: str, columns: Collection[str], *, lock: bool = False) -> frappe._dict | None:
    """Load `columns` of `node`'s row, the lowest name of any it has, or None when it has none."""
    # Must order as app_row.body_row does, pinned by the tests
    # test_writes_the_body_and_clears_the_comments_on_the_same_row_of_a_node_with_two_rows and
    # test_fingerprints_the_row_the_body_is_written_to_on_a_node_with_two_rows
    selected = ", ".join(f"`{column}`" for column in columns)
    lock_clause = " FOR UPDATE" if lock else ""
    found = frappe.db.sql(
        f"SELECT {selected} FROM `tab{DOCTYPE}` WHERE `node` = %s ORDER BY `name` LIMIT 1{lock_clause}",
        node,
        as_dict=True,
    )
    if not found:
        return None

    return found[0]


def read_fingerprint(node: str) -> str:
    """Hash `node`'s old body as `fingerprint_of` does, from the row alone; a gone row hashes as empty."""
    legacy = old_row(node, FIELDS)
    return fingerprint_of(legacy or {})


def fingerprint_of(legacy: dict) -> str:
    """Hash the old body's stores, so a changed body is converted again."""
    return hashlib.sha256(json.dumps([legacy.get(name) for name in FIELDS]).encode()).hexdigest()


def read_old(node: str, *, lock: bool = False) -> OldDocument | None:
    """Read the old body and the node's Drive threads, or None once a purge took the row; with `lock`, lock it first."""
    row = old_row(node, ("name", "modified", *FIELDS), lock=lock)
    if row is None:
        return None

    if lock:
        # Lock the node with no plain read before it, which would take a snapshot missing a thread made meanwhile
        frappe.db.sql("SELECT `name` FROM `tabDrive Node` WHERE `name` = %s FOR UPDATE", (node,))

    legacy = {name: row[name] for name in FIELDS}
    threads = drive.comment_threads(node)
    [[newest]] = frappe.db.sql(f"SELECT MAX(`modified`) FROM `tab{DOCTYPE}` WHERE `node` = %s", node)
    return OldDocument(row.name, legacy, fingerprint_of(legacy), threads, newest)


def check(node: str, old: OldDocument, converted: convert.Converted) -> CheckedDocument:
    """Check `converted` against the old comments and its copy before anything writes; refuse what can't install whole."""
    names = thread_names(node, old.legacy["ycomments"], old.threads)
    anchors = {names[key]: anchor for key, anchor in converted.anchors.items() if key in names}
    dead = [key for key in converted.anchors if key not in names]

    threads = [old_thread(thread) for thread in converted.threads]
    if drive.has_blank_old_comment(threads):
        raise ConversionRefused("check")

    html = checked_html(old, converted)
    named = set(names.values())
    unknown = [thread["name"] for thread in old.threads if thread["name"] not in named]
    dropped = [
        *({"kind": "dead-highlight", "key": key} for key in dead),
        *({"kind": "unknown-anchor", "thread": name} for name in unknown),
    ]
    return CheckedDocument(html, dropped, anchors, threads)


def fix_up(node: str, old: OldDocument, checked: CheckedDocument) -> None:
    """Move the old comments to Drive threads on the converted body, in the caller's transaction."""
    drive.install_threads(node, checked.anchors, checked.threads)
    clear_ycomments(old.docname)


def checked_html(old: OldDocument, converted: convert.Converted) -> str:
    """Answer the readable copy to install; refuse a state the checker can't take whole, or a copy that doesn't hold it."""
    try:
        if not compaction.compact(converted.state, [], writer_content.PART_MAP).integrated:
            raise ConversionRefused("check", "fallback")
    except compaction.CompactionFailed as failed:
        raise ConversionRefused("check", failed.reason) from None

    if not converted.html:
        if old.legacy["html"]:
            raise ConversionRefused("check", "empty")

        return ""

    clean, text = copies.cleaned(converted.html)
    if not writer_content.is_html_complete(converted.state, clean, text):
        raise ConversionRefused("check", "copy")

    return clean


def thread_names(node: str, ycomments: str | None, threads: list[dict]) -> dict[str, str]:
    """Each old comment's Drive thread, as Build named it; refuses a comment or reply no thread holds."""
    held = {thread["name"]: set(thread["comments"]) for thread in threads}
    names: dict[str, str] = {}
    for key, ids in old_comment_ids(ycomments).items():
        name = held_name(node, key, held)
        if name is None or any(held_name(node, id_, held[name]) is None for id_ in ids):
            raise ConversionRefused("check", "orphan")

        names[key] = name

    return names


def held_name(node: str, source_id: str, held: Collection[str]) -> str | None:
    """Find the name Build gave `source_id` among `held`: its own, or its rename when another node held it."""
    for name in (source_id, renamed_id(node, source_id)):
        if name in held:
            return name

    return None


def renamed_id(node: str, source_id: str) -> str:
    """Rename an id another node held as Build does (build/comments.py `_renamed_id`); a test pins it."""
    material = json.dumps(
        ["drive-comment-rename/1", node, source_id], ensure_ascii=False, separators=(",", ":")
    )
    return hashlib.sha256(material.encode()).hexdigest()


def old_comment_ids(ycomments: str | None) -> dict[str, list[str]]:
    """Each thread id in the old comments and the ids of its comment and replies; refuses unreadable ones."""
    if not ycomments:
        return {}

    try:
        doc: pycrdt.Doc = pycrdt.Doc()
        doc.apply_update(base64.b64decode(ycomments, validate=True))
        values = doc.get("comments", type=pycrdt.Map).to_py()
        ids: dict[str, list[str]] = {}
        for key, value in values.items():
            ids[key] = [entry["id"] for entry in [value, *(value.get("replies") or [])]]

        return ids
    except Exception:
        raise ConversionRefused("check", "comments") from None


def old_thread(thread: dict) -> dict:
    """Map a 2023 thread to the shape Drive installs."""
    comments: list[dict] = []
    for comment in thread["comments"]:
        comments.append(
            {"content": comment["content"], "author_name": comment["authorName"], "time": comment["time"]}
        )

    return {"anchor": thread["anchor"], "comments": comments}


def clear_ycomments(docname: str) -> None:
    """Empty the old comments once Drive holds their anchors."""
    frappe.db.set_value(DOCTYPE, docname, "ycomments", None, update_modified=False)
