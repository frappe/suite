# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Pinning: a conversation held at the top of the Inbox until it is unpinned.

A pin is a keyword on the conversation's messages in the Inbox, and the Inbox sorts by it: the server
does the sorting, so a list paged by row count stays one unbroken order, and a pin is kept wherever
the account is read from.

It acts only in the Inbox. The sort asks of each message the list holds rather than of the whole
conversation, so a pinned conversation filed away isn't pinned where it went, and a new reply to it
arrives as ordinary mail. Brought back to the Inbox, by Undo or by hand, it is pinned again: filing
never has to touch the keyword, and only Unpin takes it off.
"""

import json

PINNED_KEYWORD = "pinned"

# Mail that just came back from waiting (see suite.mail.reminders), held under the pins for a day.
RETURNED_KEYWORD = "returned"
# Returned because nobody answered it: your own mail, back in the Inbox to chase.
NO_REPLY_KEYWORD = "noreply"

# What the Inbox sorts by. The newest first within each part, as every list is.
INBOX_SORT = [
    {"property": "hasKeyword", "keyword": PINNED_KEYWORD, "isAscending": False},
    {"property": "hasKeyword", "keyword": RETURNED_KEYWORD, "isAscending": False},
    {"property": "receivedAt", "isAscending": False},
]


def _has_keyword(message: dict, keyword: str) -> bool:
    # Its keywords as JMAP has them, or as the cache holds them.
    keywords = message.get("keywords") or {}
    if isinstance(keywords, str):
        keywords = json.loads(keywords or "{}")
    return bool(keywords.get(keyword))


def is_pinned(message: dict) -> bool:
    """Whether a message carries the pin."""

    return _has_keyword(message, PINNED_KEYWORD)


def is_returned(message: dict) -> bool:
    """Whether a message just came back from waiting."""

    return _has_keyword(message, RETURNED_KEYWORD)


def is_no_reply(message: dict) -> bool:
    """Whether a message of yours came back because nobody answered it."""

    return _has_keyword(message, NO_REPLY_KEYWORD)
