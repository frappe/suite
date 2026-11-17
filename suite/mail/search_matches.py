# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Why a search found what it found: which messages of a conversation matched, and in which words.

`Email/query` with `collapseThreads` names only each conversation's newest match, so the rest are
asked for without collapsing, from the top of the page down. `SearchSnippet/get` then gives the words.

What it does on Stalwart, checked against a live server rather than taken from the RFC:

- Terms come only from `text`, `subject` and `body` conditions. A search by sender or date has no
  words to mark, so every snippet comes back empty and asking is wasted.
- It ignores every other condition: asked about a message a `from:` ruled out, it still marks the
  words. So it says what the words were in a message already known to match, and nothing about
  whether it matched. That is what the uncollapsed query is for.
- `subject` and `preview` are escaped HTML but for `<mark>`, so a `<mark>` written in a mail arrives
  as `&lt;mark&gt;` and can't be taken for a hit.
- It reads the message each time, attachments included, and refuses over 100 ids in one call.
- It doesn't say where in the mail it found the words, and a text attachment comes back as if it
  were the body.

Failures here are never the search's: its results stand without their explanations.
"""

import re
from dataclasses import dataclass
from html import unescape
from typing import Any, TypedDict

import frappe
from frappe.utils import cint

from suite.mail.jmap import JMAP_ERRORS, get_account_client

# How far past the top of a page the uncollapsed query looks. A conversation's older matches can lie
# below this on a mailbox full of hits, where the row just counts fewer of them.
MATCH_WINDOW = 300
SNIPPET_MAX_IDS = 100

TERM_CONDITIONS = ("text", "subject", "body")
MARK = re.compile(r"<mark>(.*?)</mark>", re.DOTALL)
# Tags that can fall inside a word, as an editor's bold or a link does, and so join what they split.
INLINE_TAG = re.compile(
    r"</?(?:a|abbr|b|code|em|font|i|mark|s|small|span|strike|strong|sub|sup|u)\b[^>]*>", re.IGNORECASE
)
TAG = re.compile(r"<[^>]*>")
SPACE = re.compile(r"\s+")


class SearchSegment(TypedDict):
    text: str
    hit: bool


class Snippet(TypedDict):
    subject: list[SearchSegment] | None
    preview: list[SearchSegment] | None


def parse_snippet(marked: str | None) -> list[SearchSegment] | None:
    """A snippet cut where the server marked it, as text: no HTML is left to escape on the way out."""

    if not marked:
        return None
    # The server's only markup is <mark>, so splitting on it splits on nothing the mail wrote.
    parts = MARK.split(marked)
    segments: list[SearchSegment] = [
        {"text": unescape(part), "hit": bool(index % 2)} for index, part in enumerate(parts) if part
    ]
    if segments and not segments[-1]["hit"]:
        segments[-1]["text"] = segments[-1]["text"].rstrip()
    return [segment for segment in segments if segment["text"]] or None


def has_terms(filter: dict[str, Any]) -> bool:
    """Whether a filter holds any words for a snippet to mark, leaving aside those under a NOT."""

    if filter.get("operator") == "NOT":
        return False
    if any(filter.get(key) for key in TERM_CONDITIONS):
        return True
    return any(has_terms(condition) for condition in filter.get("conditions", []))


def matching_messages(
    account: str, filter: dict[str, Any], newest_matches: dict[str, str]
) -> tuple[dict[str, list[str]], bool]:
    """Each conversation's matching messages, newest first, for the page `newest_matches` names (the
    newest match of each, top of the page first). Also whether every match below the top of the page
    was seen, and so whether a conversation with none listed truly has none.
    """

    found: dict[str, list[str]] = {}
    if not newest_matches:
        return found, True

    try:
        client = get_account_client(account)
        with client.batch() as b:
            q = b.mail.email.query(
                filter=filter,
                sort=[{"property": "receivedAt", "isAscending": False}],
                collapseThreads=False,
                anchor=next(iter(newest_matches.values())),
                limit=MATCH_WINDOW,
            )
            g = b.mail.email.get(ids=q.ref_ids(), properties=["id", "threadId"])
        ids = list(q.result.ids)
        threads = {email["id"]: email["threadId"] for email in (item.to_wire() for item in g.result.items)}
    except JMAP_ERRORS:
        frappe.log_error(title="Mail search: listing matches", message=frappe.get_traceback())
        return found, False

    # The query's order is the newest-first one asked for; a get's need not follow its ids.
    for id in ids:
        thread_id = threads.get(id)
        if thread_id in newest_matches:
            found.setdefault(thread_id, []).append(id)
    return found, len(ids) < MATCH_WINDOW


@dataclass(frozen=True)
class ConversationMatch:
    """What a search found in one conversation, for the row that lists it."""

    # The message the row describes and opens on.
    match: dict
    # The matches that aren't reactions, newest first: a reaction only says something about the
    # message it answers, which the pane folds it onto.
    written: list[dict]
    # Found by nothing but a reaction, and so not a result.
    reaction_only: bool

    def describe(self, row: dict, visible: list[dict]) -> None:
        """Marks `row` with its match and the matches it can show, those `visible` holds, one for a
        message and its copies. Their words are read later (see add_match_words)."""

        row["received_at"] = self.match["received_at"]
        row["match_id"] = self.match["id"]
        row["reaction_only"] = cint(self.reaction_only)
        shown = {m["id"] for m in visible}
        seen_copies: set[str] = set()
        row["matches"] = []
        for message in self.written or [self.match]:
            copy_key = message.get("message_id") or message["id"]
            if message["id"] in shown and copy_key not in seen_copies:
                seen_copies.add(copy_key)
                row["matches"].append(
                    {
                        "id": message["id"],
                        "from_name": message.get("from_name"),
                        "from_email": message.get("from_email"),
                        "received_at": message["received_at"],
                        "snippet": None,
                        "in_attachment": 0,
                    }
                )
        row["marked_words"] = []


def conversation_match(
    conversation: list[dict],
    written: list[dict],
    matched_ids: list[str] | None,
    newest_match: str | None,
    saw_all_matches: bool,
) -> ConversationMatch:
    """What matched in a conversation (oldest to newest, with `written` its messages that aren't
    reactions), given its matches as matching_messages listed them, if it did, and its newest match."""

    by_id = {m["id"]: m for m in conversation}
    matched = [by_id[id] for id in matched_ids or [newest_match] if id in by_id]
    written_matches = [m for m in matched if m in written]
    return ConversationMatch(
        match=written_matches[0] if written_matches else written[-1],
        written=written_matches,
        # Only what was seen of the matches can rule a conversation out.
        reaction_only=bool(matched and not written_matches and saw_all_matches and matched_ids),
    )


def add_match_words(account: str, filter: dict[str, Any], rows: list[dict]) -> None:
    """Reads the words of the match each of a page's rows shows: its newest. Asked once the page is
    settled, because it fetches every mail it reads: a search across accounts lists far more rows than
    it returns."""

    shown = [row for row in rows if not row.get("reaction_only")]
    ids = [row["matches"][0]["id"] for row in shown if row["matches"]]
    snippets = get_snippets(account, filter, ids)
    if not snippets:
        return

    for row in shown:
        messages = {copy["id"]: copy for m in row["messages"] for copy in [m, *m.get("duplicates", [])]}
        words: list[str] = []
        for match in row["matches"][:1]:
            snippet = snippets.get(match["id"])
            match["snippet"] = snippet["preview"] if snippet else None
            match["in_attachment"] = cint(found_in_attachment(messages.get(match["id"], {}), snippet))
            words += marked_words(snippet)
        row["marked_words"] = list(dict.fromkeys(words))


def get_snippets(account: str, filter: dict[str, Any], ids: list[str]) -> dict[str, Snippet]:
    """The marked words of each message that holds any, by message id."""

    if not ids or not has_terms(filter):
        return {}

    snippets: dict[str, Snippet] = {}
    try:
        client = get_account_client(account)
        with client.batch() as b:
            handles = [
                b.mail.search_snippet.get(filter=filter, email_ids=ids[start : start + SNIPPET_MAX_IDS])
                for start in range(0, len(ids), SNIPPET_MAX_IDS)
            ]
        for handle in handles:
            for item in handle.result.items:
                if item.email_id and (item.subject or item.preview):
                    snippets[item.email_id] = {
                        "subject": parse_snippet(item.subject),
                        "preview": parse_snippet(item.preview),
                    }
    except JMAP_ERRORS:
        frappe.log_error(title="Mail search: reading snippets", message=frappe.get_traceback())
    return snippets


def marked_words(snippet: Snippet | None) -> list[str]:
    """The words as the mail spells them, which stemming can make other than what was typed."""

    if not snippet:
        return []
    parts = (snippet["subject"] or []) + (snippet["preview"] or [])
    return [segment["text"] for segment in parts if segment["hit"]]


def found_in_attachment(message: dict, snippet: Snippet | None) -> bool:
    """Whether the words shown came from an attachment rather than from what the mail says, for a
    match that would otherwise open on a body without them. The server doesn't say, but a hit is the
    text as the mail spells it, so it can be looked for."""

    if not snippet or not snippet["preview"] or not message.get("attachments"):
        return False
    body = plain_text(f"{message.get('text_body') or ''} {html_text(message.get('html_body') or '')}")
    hits = [plain_text(segment["text"]) for segment in snippet["preview"] if segment["hit"]]
    return bool(hits) and not any(hit in body for hit in hits)


def html_text(html: str) -> str:
    """The words an HTML body shows, as a snippet would quote them: a word split by a tag in the
    middle is whole again, and an entity is the character it stands for."""

    return unescape(TAG.sub(" ", INLINE_TAG.sub("", html)))


def plain_text(text: str) -> str:
    return SPACE.sub(" ", text).strip().lower()
