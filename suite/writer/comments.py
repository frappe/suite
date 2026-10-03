"""The one runtime reader of a Writer document's inline comment blob.

Inline comments are a Yjs document of their own, stored base64 in
`Writer Document.ycomments`: a `comments` map of threads keyed by id, each
thread holding its first comment's fields and a `replies` list. The editor
writes the whole blob on every change (`useComments.saveComments`), so the
server learns what changed by comparing the blob it holds with the one it is
given. Drive owns the activity and the notifications a comment causes; this
module only tells it which comments gained a mention (`drive.record_comment`).

A mention is stored as the editor's suggestion item, `{"value": <user id>,
"label": <name>}`; an older blob spells the id `id`, and the Build patch that
copied legacy comments (`suite/drive/patches/build/comments.py`) read a plain
string too. All three are accepted here. A blob pycrdt cannot read is treated
as holding no comments: the save still lands, and nobody is notified from it.
"""

import base64
from dataclasses import dataclass

import pycrdt

MAP_NAME = "comments"


@dataclass(frozen=True)
class MentionedComment:
    """One comment or reply whose mentions grew since the stored blob."""

    thread: str
    comment: str
    resolved: bool
    users: tuple[str, ...]


def new_mentions(before: str | None, after: str | None) -> list[MentionedComment]:
    """The comments in `after` that mention someone `before` did not mention in them."""
    previous = _mentions_by_comment(before)
    found = []
    for thread_id, thread in _threads(after).items():
        for entry in (thread, *_replies(thread)):
            comment_id = entry.get("id")
            if not isinstance(comment_id, str) or not comment_id:
                continue
            added = tuple(user for user in _mentions(entry) if user not in previous.get(comment_id, ()))
            if added:
                found.append(
                    MentionedComment(
                        thread=thread_id,
                        comment=comment_id,
                        resolved=bool(thread.get("resolved")),
                        users=added,
                    )
                )
    return found


def _mentions_by_comment(blob: str | None) -> dict[str, set[str]]:
    known: dict[str, set[str]] = {}
    for thread in _threads(blob).values():
        for entry in (thread, *_replies(thread)):
            comment_id = entry.get("id")
            if isinstance(comment_id, str):
                known.setdefault(comment_id, set()).update(_mentions(entry))
    return known


def _threads(blob: str | None) -> dict[str, dict]:
    if not blob:
        return {}
    try:
        update = base64.b64decode(blob, validate=True)
        document = pycrdt.Doc()
        document.apply_update(update)
        values = document.get(MAP_NAME, type=pycrdt.Map).to_py()
    except KeyboardInterrupt, SystemExit:
        raise
    except BaseException:
        # pycrdt raises `pyo3_runtime.PanicException`, a `BaseException`, for
        # bytes that are not a Yjs update; bad base64 raises `binascii.Error`.
        return {}
    if not isinstance(values, dict):
        return {}
    return {key: value for key, value in values.items() if isinstance(key, str) and isinstance(value, dict)}


def _replies(thread: dict) -> list[dict]:
    replies = thread.get("replies")
    if not isinstance(replies, list):
        return []
    return [reply for reply in replies if isinstance(reply, dict)]


def _mentions(entry: dict) -> list[str]:
    mentions = entry.get("mentions")
    if not isinstance(mentions, list):
        return []
    found = []
    for mention in mentions:
        user = mention.get("value", mention.get("id")) if isinstance(mention, dict) else mention
        if isinstance(user, str) and user and user not in found:
            found.append(user)
    return found
