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
from suite.drive.patches.build.state import LegacyComment

MAX_COMMENT_BYTES = 65_535

# Every column `_bulk` writes, so a rerun validates the whole row rather than
# blessing one whose primary key happens to exist (plan §13).
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
    "docstatus",
    "idx",
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
    "docstatus",
    "idx",
)


def convert_document_comments(env, content, document, node: str, *, batch_size: int) -> int:
    """Convert one document atomically per thread and return comment count."""
    if document.doctype == "Writer Document":
        plans = _writer_threads(env, document, node)
    else:
        plans = _sheet_threads(env, document, node)
    _refuse_colliding_ids(plans)
    _rename_ids_another_node_holds(env, content, document, node, plans)
    count = 0
    for thread, comments in plans:
        count += len(comments)
        content.legacy_comments_superseded += _write_thread(env, thread, comments, batch_size)
    return count


def port_legacy_comments(env, content, *, batch_size: int) -> None:
    """Give the legacy child rows no Yjs entry claimed a thread and a node.

    §14 names no rule for them. The plan lists `drive_comment/` as a new
    DocType, so nobody wrote a reshape for the table it reuses. Build loses
    no comment. A row a Yjs entry claims is the same comment under the same
    id, and `_write_thread` completes it there. What is left is a Writer
    annotation the editor no longer holds, so it becomes its own
    one-comment thread on the node its `File` became. A row whose `File`
    never became a node has nothing to hang off. It is counted and listed,
    and left where it is: Build removes nothing (`tests/test_dormancy.py`).
    """
    target = env.content_target
    # A row Build rewrote never looks legacy again, so the two rewrite
    # counters are cumulative across passes. A row it could not place stays
    # legacy and every sweep sees it, so this census is taken fresh.
    content.legacy_comments_unported = 0
    content.legacy_comment_rows = []
    after = ""
    while True:
        rows = target.legacy_comments(after, batch_size)
        if not rows:
            return
        for row in rows:
            _port_legacy(env, content, row, batch_size)
        # Per page, as the document loop does per document: `_write_thread`
        # has committed these rows, so a kill here must not lose the count
        # of rows no later sweep can recognise.
        env.state.put_content(content)
        # Keyset, not offset: a ported row leaves the legacy set, and a row
        # left where it is would otherwise be read forever.
        after = rows[-1]["name"]
        if len(rows) < batch_size:
            return


def _port_legacy(env, content, row: dict, batch_size: int) -> None:
    file = row.get("parent") or ""
    node = env.content_target.nodes((file,)).get(file) if file else None
    if not node or node.get("kind") != "document":
        content.record_legacy_comment(LegacyComment(row["name"], file))
        return
    thread, comments = _legacy_plan(node["name"], row)
    _write_thread(env, thread, comments, batch_size)
    content.legacy_comments_ported += 1


def _legacy_plan(node: str, row: dict) -> tuple[dict, list[dict]]:
    """One thread of one comment, from one `Drive File.comments` child row.

    The old row carried `content` and `resolved` and nothing else of its
    own, so its `owner` is the author and its `creation` is the stamp.
    """
    text = row.get("content")
    if not isinstance(text, str) or not text.strip():
        raise InvalidLegacyContent("legacy comment text is blank")
    if len(text.encode("utf-8")) > MAX_COMMENT_BYTES:
        raise InvalidLegacyContent("legacy comment text exceeds the target Text column")
    author = row.get("owner") or "Guest"
    if len(author) > 140:
        raise InvalidLegacyContent("legacy comment author exceeds the target Link column")
    stamp = str(row.get("creation") or "")
    if not stamp:
        raise InvalidLegacyContent("legacy comment has no creation stamp")
    entry = {
        "id": row["name"],
        "text": text,
        "author": author,
        "author_name": None,
        "stamp": stamp,
        "mentions": [],
        "source_complete": True,
    }
    return _thread_plan(node, row["name"], bool(row.get("resolved")), [entry], _lazy(lambda: (author, stamp)))


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
    # Lazy: a document whose entries all carry a complete author and stamp
    # never needs a fallback, and refusing it for an incomplete container
    # stamp it never reads would drop comments the source can express.
    fallback = _lazy(lambda: _container_fallback(document))
    timezone = env.content.site_timezone()
    # `to_py()` hands back the yrs map order, and yrs hashes with a seed
    # that changes per process. Sorted keys give one thread order, so an
    # interrupted run resumes over the same threads it stopped inside.
    for key, value in sorted(values.items(), key=lambda item: str(item[0])):
        if not isinstance(value, dict) or value.get("id") != key:
            raise InvalidLegacyContent("Writer comment map key and id disagree")
        # 140 is the `name` bound and it is the tighter of the two: the same id
        # is also the thread anchor, whose column takes 255.
        if not isinstance(key, str) or not key or len(key) > 140:
            raise InvalidLegacyContent("Writer comment id does not fit the target")
        replies = value.get("replies") or []
        if not isinstance(replies, list):
            raise InvalidLegacyContent("Writer comment replies are not a list")
        entries = [value, *replies]
        # `identity` is read off the entry below, so the shape check cannot wait
        # for `_entry`: a string reply would raise `AttributeError`, which
        # `history.py` does not catch, and one malformed reply would end the run
        # with a traceback instead of a recorded refusal.
        if any(not isinstance(entry, dict) for entry in entries):
            raise InvalidLegacyContent("Writer comment or reply is not an object")
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
    fallback = _lazy(lambda: _sheet_fallback(env, document))
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
                # §9: the creation of a legacy string is `Sheet.modified`. The
                # op-log stamp `_sheet_fallback` finds is the *resolution*
                # fallback, and a resolved-at from an old head op would date the
                # comment years before the sheet last changed.
                entries = [
                    {
                        "id": derived_name("drive-sheet-comment/1", thread_id, 0),
                        "text": raw_thread,
                        "author": "Guest",
                        "author_name": None,
                        "name": None,
                        "stamp": _container_fallback(document)[1],
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
    if len(author) > 140:
        # `Drive Comment.author` is `varchar(140)`. Over it, MariaDB raises
        # error 1406, which is neither `InvalidLegacyContent` nor
        # `ValueError`, so it would escape and repeat on every rerun.
        raise InvalidLegacyContent("comment author exceeds the target Link column")
    author_name = value.get(name_key) if name_key else None
    if author_name is not None and (not isinstance(author_name, str) or len(author_name) > 140):
        raise InvalidLegacyContent("comment author_name exceeds the target field")
    source_complete = isinstance(source_author, str) and bool(source_author)
    try:
        stamp = epoch_millis(value.get(time_key), timezone)
    except InvalidLegacyContent:
        stamp = fallback()[1]
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
            "author": fallback()[0],
            "stamp": fallback()[1],
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


def _write_thread(env, planned, comments, batch_size) -> int:
    """Store one thread and return how many legacy rows it rewrote in place."""
    target = env.content_target
    stored_thread = target.thread_names((planned["name"],)).get(planned["name"])
    stored_comments = target.comment_names(tuple(row["name"] for row in comments))
    # `new_writer.py:34` named each child row after the Yjs entry it came
    # from, so a stored row under a planned id is this comment as the old
    # Drive held it. The Yjs entry is the only side that carries the author,
    # the thread, and the resolution, so it supersedes the row rather than
    # being refused by it.
    legacy = [row for row in comments if _is_legacy(stored_comments.get(row["name"]))]
    superseded = {row["name"] for row in legacy}
    if stored_thread:
        exact_fields(stored_thread, planned, THREAD_FIELDS, f"thread {planned['name']}")
    for row in comments:
        stored = stored_comments.get(row["name"])
        if stored and row["name"] not in superseded:
            exact_fields(stored, row, COMMENT_FIELDS, f"comment {row['name']}")
    fresh = [row for row in comments if row["name"] not in stored_comments]
    if not stored_thread:
        first = fresh[: max(1, batch_size - 1)]
        target.write_thread(planned, first)
        target.commit()
        fresh = fresh[len(first) :]
    # After the thread, never before: a rewritten row stops looking legacy,
    # so a run killed between the two would leave a comment whose thread no
    # later pass knows to write.
    if legacy:
        target.replace_comments(legacy)
        target.commit()
    for offset in range(0, len(fresh), batch_size):
        target.insert_comments(fresh[offset : offset + batch_size])
        target.commit()
    return len(legacy)


def _is_legacy(stored) -> bool:
    """A row from the old `Drive File.comments` grid, kept by the reused table.

    `thread` is `reqd` in the new schema and `_bulk` writes it on every row,
    so a stored comment with no thread predates the rewrite.
    """
    return bool(stored) and not stored.get("thread")


def _refuse_colliding_ids(plans) -> None:
    """Refuse a colliding id set before the first thread of the document commits."""
    thread_names = [thread["name"] for thread, _comments in plans]
    comment_names = [row["name"] for _thread, rows in plans for row in rows]
    if len(thread_names) != len(set(thread_names)):
        raise InvalidLegacyContent("comment thread ids collide")
    if len(comment_names) != len(set(comment_names)):
        raise InvalidLegacyContent("comment ids collide")


def _rename_ids_another_node_holds(env, content, document, node: str, plans) -> None:
    """Give this node its own `name` for an id another node already stored.

    §14.6 makes the Yjs comment id the thread *anchor*, and §3.6 keeps that
    anchor opaque: "Drive stores and returns it; the app resolves it". The
    `name` carries no such promise. Both DocTypes are `autoname: hash`, the
    runtime reads a node's threads by `node` and hands back `name` and
    `anchor` as separate values (`_core/comments.py:238-251`), and nothing at
    runtime derives one from the other. So the id belongs in the anchor, and
    the `name` may be anything unique.

    It has to be. A `Writer Document` that is a copy of another carries its
    source's `ycomments` verbatim, ids and all, and `name` is a primary key.
    Named after the id, the second node's thread would be the first node's
    row, `exact_fields` would refuse it as sitting on the wrong node, and
    every later pass would refuse it again.

    The derivation is `(node, id)`, so it is stable: a rerun plans the same
    name, finds the row the last pass wrote, and validates it. It happens
    here, at plan time, on one batched read for the whole document, rather
    than at write time where a name minted per attempt would never match.

    A collision *inside* one document is still a refusal
    (`_refuse_colliding_ids`), because one document cannot hold one id twice
    and still be readable back.

    `port_legacy_comments` does not come through here. Its thread and its
    comment are both named after the `Drive Comment` row itself, whose name
    is already unique in the reused table, and the stored row under that name
    is that same legacy row, which `_write_thread` supersedes in place.
    """
    if not plans:
        return
    target = env.content_target
    stored_threads = target.thread_names(tuple(thread["name"] for thread, _rows in plans))
    stored_comments = target.comment_names(tuple(row["name"] for _thread, rows in plans for row in rows))
    threads_renamed = 0
    comments_renamed = 0
    holders = []
    for thread, comments in plans:
        stored = stored_threads.get(thread["name"])
        if stored and stored.get("node") != node:
            holders.append(stored.get("node"))
            thread["name"] = _renamed_id(node, thread["name"])
            threads_renamed += 1
        for row in comments:
            # After the thread, always: a renamed thread renames the link
            # every one of its comments carries, and the stored comparison
            # below is against the name this run will really write.
            row["thread"] = thread["name"]
            stored = stored_comments.get(row["name"])
            if not stored or _is_legacy(stored):
                # A legacy `Drive File.comments` row carries no `thread`.
                # It is this comment as the old Drive held it, not another
                # node's claim on the id, and `_write_thread` completes it
                # where it stands.
                continue
            if (stored.get("node"), stored.get("thread")) == (node, row["thread"]):
                continue
            holders.append(stored.get("node"))
            row["name"] = _renamed_id(node, row["name"])
            comments_renamed += 1
    if not threads_renamed and not comments_renamed:
        return
    content.comment_threads_renamed += threads_renamed
    content.comments_renamed += comments_renamed
    held = sorted({holder for holder in holders if holder})
    content.record_issue(
        f"{document.doctype}:{document.name}",
        f"{threads_renamed} thread id(s) and {comments_renamed} comment id(s) already belong to "
        f"node {held[0] if held else 'no node'}; renamed on this node",
        phase="history",
    )


def _renamed_id(node: str, source_id: str) -> str:
    """This node's own primary key for an id another node already holds.

    `derived_name` is the same 64-character sha256 the Sheets threads are
    named with, so Build has one derivation and one length to reason about,
    well inside the 140 `name` takes. One domain covers both tables: a
    top-level Writer comment and its thread share an id in the source, and
    renaming keeps them equal.
    """
    return derived_name("drive-comment-rename/1", node, source_id)


def _lazy(compute):
    """Compute one fallback at most once, and only if something reads it."""
    cache = []

    def get():
        if not cache:
            cache.append(compute())
        return cache[0]

    return get


def _container_fallback(document) -> tuple[str, str]:
    if not document.modified_by or not document.modified:
        raise InvalidLegacyContent("document has no complete comment timestamp fallback")
    return document.modified_by, str(document.modified)


def _sheet_fallback(env, document) -> tuple[str, str]:
    found = env.content.sheet_op_stamp(document.name, int(document.head_seq or 0))
    return found or _container_fallback(document)
