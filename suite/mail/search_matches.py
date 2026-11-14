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
from html import unescape
from typing import Any, TypedDict

import frappe
from jmap import AuthenticationError, MethodError, RequestError, TransportError

from suite.mail.jmap import MailServerUnavailableError, get_account_client

# How far past the top of a page the uncollapsed query looks. A conversation's older matches can lie
# below this on a mailbox full of hits, where the row just counts fewer of them.
MATCH_WINDOW = 300
# How many of a conversation's matches are read for their words: reading one fetches the whole mail,
# and a row has room for this many.
SHOWN_MATCHES = 3
SNIPPET_MAX_IDS = 100

JMAP_ERRORS = (AuthenticationError, MailServerUnavailableError, MethodError, RequestError, TransportError)
TERM_CONDITIONS = ("text", "subject", "body")
MARK = re.compile(r"<mark>(.*?)</mark>", re.DOTALL)


class Segment(TypedDict):
    text: str
    hit: bool


class Snippet(TypedDict):
    subject: list[Segment] | None
    preview: list[Segment] | None


def parse_snippet(marked: str | None) -> list[Segment] | None:
    """A snippet cut where the server marked it, as text: no HTML is left to escape on the way out."""

    if not marked:
        return None
    # The server's only markup is <mark>, so splitting on it splits on nothing the mail wrote.
    parts = MARK.split(marked)
    segments: list[Segment] = [
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
        emails = [email.to_wire() for email in g.result.items]
    except JMAP_ERRORS:
        frappe.log_error(title="Mail search: listing matches", message=frappe.get_traceback())
        return found, False

    for email in emails:
        if email["threadId"] in newest_matches:
            found.setdefault(email["threadId"], []).append(email["id"])
    return found, len(emails) < MATCH_WINDOW


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
    body = f"{message.get('text_body') or ''} {message.get('html_body') or ''}".lower()
    hits = [segment["text"].lower() for segment in snippet["preview"] if segment["hit"]]
    return bool(hits) and not any(hit in body for hit in hits)
