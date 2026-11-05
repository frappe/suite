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

# What the Inbox sorts by. The newest first within each part, as every list is.
INBOX_SORT = [
    {"property": "hasKeyword", "keyword": PINNED_KEYWORD, "isAscending": False},
    {"property": "receivedAt", "isAscending": False},
]


def is_pinned(message: dict) -> bool:
    """Whether a message carries the pin, its keywords as JMAP has them or as the cache holds them."""

    keywords = message.get("keywords") or {}
    if isinstance(keywords, str):
        keywords = json.loads(keywords or "{}")
    return bool(keywords.get(PINNED_KEYWORD))
