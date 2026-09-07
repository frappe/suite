"""Convert Writer and Sheets embedded comments into Drive rows."""

import base64
import json

import pycrdt

from suite.drive.patches.build.content_mapping import (
    InvalidLegacyContent,
    decode_sheets_data,
    derived_name,
    epoch_millis,
    exact_fields,
    sheet_anchor,
)

MAX_COMMENT_BYTES = 65_535

THREAD_FIELDS = (
    "name",
    "node",
    "anchor",
    "resolved",
    "resolved_by",
    "resolved_at",
    "owner",
    "creation",
    "modified",
    "modified_by",
)

COMMENT_FIELDS = (
    "name",
    "thread",
    "node",
    "content",
    "author",
    "author_name",
    "mentions",
    "owner",
    "creation",
    "modified",
    "modified_by",
    "idx",
)


def convert_document_comments(env, document, node: str, *, batch_size: int) -> int:
    """Convert one document atomically per thread and return comment count."""
    if document.doctype == "Writer Document":
        plans = _writer_threads(env, document, node)
    else:
        plans = _sheet_threads(env, document, node)
    _refuse_colliding_ids(plans)
    count = 0
    for thread, comments in plans:
        count += len(comments)
        _write_thread(env, thread, comments, batch_size)
    return count


def _writer_threads(env, document, node: str) -> list[tuple[dict, list[dict]]]:
    if not document.ycomments:
        return []
    try:
        update = base64.b64decode(document.ycomments, validate=True)
        ydoc = pycrdt.Doc()
        ydoc.apply_update(update)
        values = ydoc.get("comments", type=pycrdt.Map).to_py()
    except BaseException as error:
        if isinstance(error, KeyboardInterrupt | SystemExit):
            raise
        raise InvalidLegacyContent("Writer comments are not a readable Yjs map") from error
    if not isinstance(values, dict):
        raise InvalidLegacyContent("Writer comments root is not a map")
    plans = []
    fallback = _container_fallback(document)
    timezone = env.content.site_timezone()
    for key, value in values.items():
        if not isinstance(value, dict) or value.get("id") != key:
            raise InvalidLegacyContent("Writer comment map key and id disagree")
        if not isinstance(key, str) or not key or len(key) > 140:
            raise InvalidLegacyContent("Writer comment id does not fit the target")
        if len(key) > 255:
            raise InvalidLegacyContent("Writer comment anchor exceeds 255 characters")
        replies = value.get("replies") or []
        if not isinstance(replies, list):
            raise InvalidLegacyContent("Writer comment replies are not a list")
        entries = [value, *replies]
        normalized = [
            _entry(
                entry,
                identity=entry.get("id"),
                owner_key="owner",
                name_key=None,
                time_key="creation",
                fallback=fallback,
                timezone=timezone,
            )
            for entry in entries
        ]
        if any(not entry.get("id") for entry in entries):
            raise InvalidLegacyContent("Writer comment or reply has no id")
        ids = [entry["id"] for entry in entries]
        if any(not isinstance(name, str) or not name or len(name) > 140 for name in ids):
            raise InvalidLegacyContent("Writer comment ids are missing or too long")
        if len(ids) != len(set(ids)):
            raise InvalidLegacyContent("Writer comment ids are duplicate")
        plans.append(_thread_plan(node, key, bool(value.get("resolved")), normalized, fallback))
    return plans


def _sheet_threads(env, document, node: str) -> list[tuple[dict, list[dict]]]:
    plain = decode_sheets_data(document.sheets_data)
    try:
        workbook = json.loads(plain)
    except (TypeError, ValueError) as error:
        raise InvalidLegacyContent("Sheet comments are inside unreadable workbook JSON") from error
    raw = workbook.get("comments", {}) if isinstance(workbook, dict) else {}
    if raw is None:
        return []
    if not isinstance(raw, dict):
        raise InvalidLegacyContent("Sheet comments root is not an object")
    fallback = _sheet_fallback(env, document)
    timezone = env.content.site_timezone()
    plans = []
    for sheet_name, cells in raw.items():
        if not isinstance(sheet_name, str) or not isinstance(cells, dict):
            raise InvalidLegacyContent("Sheet comments contain an invalid sheet entry")
        for cell_id, raw_thread in cells.items():
            if not isinstance(cell_id, str):
                raise InvalidLegacyContent("Sheet comment cell id is not text")
            anchor = sheet_anchor(sheet_name, cell_id)
            thread_id = derived_name("drive-sheet-thread/1", document.name, sheet_name, cell_id)
            if isinstance(raw_thread, str):
                if not raw_thread.strip():
                    raise InvalidLegacyContent("Sheet legacy comment is blank")
                entries = [
                    {
                        "id": derived_name("drive-sheet-comment/1", thread_id, 0),
                        "text": raw_thread,
                        "author": "Guest",
                        "author_name": None,
                        "name": None,
                        "stamp": fallback[1],
                        "source_complete": False,
                    }
                ]
                resolved = False
            elif isinstance(raw_thread, dict) and isinstance(raw_thread.get("thread"), list):
                entries = []
                for index, value in enumerate(raw_thread["thread"]):
                    if not isinstance(value, dict):
                        raise InvalidLegacyContent("Sheet comment thread contains a non-object entry")
                    entry = _entry(
                        value,
                        identity=derived_name("drive-sheet-comment/1", thread_id, index),
                        owner_key="author",
                        name_key="name",
                        time_key="ts",
                        fallback=fallback,
                        timezone=timezone,
                    )
                    entries.append(entry)
                resolved = bool(raw_thread.get("resolved"))
            else:
                raise InvalidLegacyContent("Sheet comment value is malformed")
            plans.append(_thread_plan(node, anchor, resolved, entries, fallback, thread_id=thread_id))
    return plans


def _entry(value, *, identity, owner_key, name_key, time_key, fallback, timezone) -> dict:
    if not isinstance(value, dict):
        raise InvalidLegacyContent("comment entry is not an object")
    text = value.get("text")
    if not isinstance(text, str) or not text.strip():
        raise InvalidLegacyContent("comment text is blank")
    if len(text.encode("utf-8")) > MAX_COMMENT_BYTES:
        raise InvalidLegacyContent("comment text exceeds the target Text column")
    source_author = value.get(owner_key)
    author = source_author if isinstance(source_author, str) and source_author else "Guest"
    author_name = value.get(name_key) if name_key else None
    if author_name is not None and (not isinstance(author_name, str) or len(author_name) > 140):
        raise InvalidLegacyContent("comment author_name exceeds the target field")
    source_complete = isinstance(source_author, str) and bool(source_author)
    try:
        stamp = epoch_millis(value.get(time_key), timezone)
    except InvalidLegacyContent:
        stamp = fallback[1]
        source_complete = False
    mentions = value.get("mentions") or []
    if not isinstance(mentions, list):
        raise InvalidLegacyContent("comment mentions are not a list")
    mention_ids = []
    for mention in mentions:
        candidate = mention.get("id") if isinstance(mention, dict) else mention
        if not isinstance(candidate, str):
            raise InvalidLegacyContent("comment mention has no text id")
        mention_ids.append(candidate)
    return {
        "id": identity,
        "text": text,
        "author": author,
        "author_name": author_name,
        "stamp": stamp,
        "mentions": mention_ids,
        "source_complete": source_complete,
    }


def _thread_plan(node, anchor, resolved, entries, fallback, *, thread_id=None):
    if not entries:
        raise InvalidLegacyContent("comment thread has no comments")
    thread_id = thread_id or anchor
    complete = [
        (entry["stamp"], index, entry["id"], entry)
        for index, entry in enumerate(entries)
        if entry["source_complete"]
    ]
    resolver = (
        max(complete, key=lambda item: item[:3])[3]
        if complete
        else {
            "author": fallback[0],
            "stamp": fallback[1],
        }
    )
    first, last = entries[0], entries[-1]
    thread = {
        "name": thread_id,
        "node": node,
        "anchor": anchor,
        "resolved": int(resolved),
        "resolved_by": resolver["author"] if resolved else None,
        "resolved_at": resolver["stamp"] if resolved else None,
        "owner": first["author"],
        "creation": first["stamp"],
        "modified": last["stamp"],
        "modified_by": last["author"],
        "docstatus": 0,
        "idx": 0,
    }
    comments = []
    for index, entry in enumerate(entries, 1):
        comments.append(
            {
                "name": entry["id"],
                "thread": thread_id,
                "node": node,
                "content": entry["text"],
                "author": entry["author"],
                "author_name": entry["author_name"],
                "mentions": json.dumps(
                    entry.get("mentions") or [], separators=(",", ":"), ensure_ascii=False
                ),
                "owner": entry["author"],
                "creation": entry["stamp"],
                "modified": entry["stamp"],
                "modified_by": entry["author"],
                "docstatus": 0,
                "idx": index,
            }
        )
    return thread, comments


def _write_thread(env, planned, comments, batch_size):
    target = env.content_target
    stored_thread = target.thread_names((planned["name"],)).get(planned["name"])
    stored_comments = target.comment_names(tuple(row["name"] for row in comments))
    if stored_thread:
        exact_fields(stored_thread, planned, THREAD_FIELDS, f"thread {planned['name']}")
    for row in comments:
        stored = stored_comments.get(row["name"])
        if stored:
            exact_fields(stored, row, COMMENT_FIELDS, f"comment {row['name']}")
    fresh = [row for row in comments if row["name"] not in stored_comments]
    if not stored_thread:
        first = fresh[: max(1, batch_size - 1)]
        target.write_thread(planned, first)
        target.commit()
        fresh = fresh[len(first) :]
    for offset in range(0, len(fresh), batch_size):
        target.insert_comments(fresh[offset : offset + batch_size])
        target.commit()


def _refuse_colliding_ids(plans) -> None:
    """Refuse a colliding id set before the first thread of the document commits."""
    thread_names = [thread["name"] for thread, _comments in plans]
    comment_names = [row["name"] for _thread, rows in plans for row in rows]
    if len(thread_names) != len(set(thread_names)):
        raise InvalidLegacyContent("comment thread ids collide")
    if len(comment_names) != len(set(comment_names)):
        raise InvalidLegacyContent("comment ids collide")


def _container_fallback(document) -> tuple[str, str]:
    if not document.modified_by or not document.modified:
        raise InvalidLegacyContent("document has no complete comment timestamp fallback")
    return document.modified_by, str(document.modified)


def _sheet_fallback(env, document) -> tuple[str, str]:
    found = env.content.sheet_op_stamp(document.name, int(document.head_seq or 0))
    return found or _container_fallback(document)
