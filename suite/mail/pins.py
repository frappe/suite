# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Pinning: a conversation held at the top of a folder until it is unpinned.

A pin belongs to the folder it was made in: the Inbox, Sent, or a folder of the user's own (one with
no role). Archive, Trash, Junk, Drafts and Snoozed take none. Each folder's pin is a keyword of its
own on the conversation's messages in that folder: the Inbox's is `pinned`, as it always was, and
any other's names the folder (`pinned_<mailbox id>`). Mail in the Inbox and in a folder of its own,
which act as labels on the one message, can so be pinned in one and not the other.

Each of those folders sorts by its keyword first: the server does the sorting, so a list paged by row
count stays one unbroken order, and a pin is kept wherever the account is read from.

The sort asks of each message the list holds rather than of the whole conversation, so a pinned
conversation filed away isn't pinned where it went, and a new reply to it arrives as ordinary mail.
Brought back, by Undo or by hand, it is pinned again: filing never has to touch the keywords, and
only Unpin takes one off, from all of the conversation's messages wherever each now is.
"""

import json

# The Inbox's pin. Any other folder's names the folder (see pin_keyword).
PINNED_KEYWORD = "pinned"
_FOLDER_PIN_PREFIX = "pinned_"
# The system folders that take pins; a folder with no role, the user's own, takes them too.
_PINNED_ROLES = ("inbox", "sent")

# Mail that just came back from waiting (see suite.mail.reminders), held under the pins until removed.
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


def takes_pins(mailbox: dict) -> bool:
    """Whether a folder (a JMAP mailbox) holds pinned mail at its top."""

    role = (mailbox.get("role") or "").lower()
    return not role or role in _PINNED_ROLES


def pin_keyword(mailbox_id: str, inbox_id: str | None) -> str:
    """The keyword that pins mail in a folder.

    A JMAP keyword is one to 255 characters of printable ASCII other than `( ) { ] % * " \\`, and
    Stalwart's ids are lowercase letters and digits, so one in a keyword is a valid keyword, and one
    that a server lowercasing keywords leaves as it is.
    """

    return PINNED_KEYWORD if mailbox_id == inbox_id else f"{_FOLDER_PIN_PREFIX}{mailbox_id}"


def pinned_sort(keyword: str) -> list[dict]:
    """What a folder other than the Inbox sorts by: its pins, then the newest first, as every list."""

    return [
        {"property": "hasKeyword", "keyword": keyword, "isAscending": False},
        {"property": "receivedAt", "isAscending": False},
    ]


def is_pinned(message: dict, keyword: str = PINNED_KEYWORD) -> bool:
    """Whether a message carries a folder's pin, the Inbox's unless `keyword` names another."""

    return _has_keyword(message, keyword)


def pinned_in(message: dict, inbox_id: str | None) -> list[str]:
    """The folders a message is pinned in, by their ids."""

    keywords = message.get("keywords") or {}
    if isinstance(keywords, str):
        keywords = json.loads(keywords or "{}")
    folders = []
    for keyword, value in keywords.items():
        if not value:
            continue
        if keyword == PINNED_KEYWORD and inbox_id:
            folders.append(inbox_id)
        elif keyword.startswith(_FOLDER_PIN_PREFIX):
            folders.append(keyword.removeprefix(_FOLDER_PIN_PREFIX))
    return folders


def is_returned(message: dict) -> bool:
    """Whether a message just came back from waiting."""

    return _has_keyword(message, RETURNED_KEYWORD)


def is_no_reply(message: dict) -> bool:
    """Whether a message of yours came back because nobody answered it."""

    return _has_keyword(message, NO_REPLY_KEYWORD)
