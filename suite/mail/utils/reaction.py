# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""What a reaction is, in one place.

A reaction is an ordinary email that says one thing: an emoji, aimed at the message its
``In-Reply-To`` names. Two shapes of it exist in the wild, both read here:

- RFC 9078 marks a ``text/plain`` part holding a line of emoji with ``Content-Disposition: reaction``.
- Gmail sends ``multipart/alternative`` of a text part opening with the emoji, a
  ``text/vnd.google.email-reaction+json`` part, and an HTML part. No disposition.

Sending uses Gmail's shape alone. Gmail shows a chip only for that shape, and shows a bare RFC 9078
reaction as a reply. Outlook.com shows the fallback HTML as a short message, as it does for Gmail's
own reactions, but turns a part marked ``Content-Disposition: reaction`` into an attachment
(``ATT00001.txt``), which rules out sending both markers in one message.

Neither shape can take a reaction back. RFC 9078 defines no withdrawal, and its grammar requires at
least one emoji, so an empty reaction is not a reaction but a blank message to every other client.
Nor does either replace an earlier one: Gmail keeps every emoji a person sends, so reactions add up.
"""

import json
from html import escape

from frappe import _

REACTION_DISPOSITION = "reaction"
GMAIL_REACTION_TYPE = "text/vnd.google.email-reaction+json"

# When not to offer a reaction, as Gmail recommends for any client that sends them. A reaction goes
# where a reply-all would, so on a list it reaches everyone on it, and through a Reply-To address it
# can land somewhere else entirely: a GitHub notification's posts a comment on the pull request.
MAX_REACTION_RECIPIENTS = 20
MAX_OWN_REACTIONS = 20

# Headers that say a message came through a list: RFC 2369's, and those only a list manager adds.
MAILING_LIST_HEADERS = (
    "List-Id",
    "List-Post",
    "List-Unsubscribe",
    "Mailing-List",
    "X-Mailman-Version",
    "X-Google-Group-Id",
)
MAILING_LIST_PRECEDENCES = ("list", "bulk")
MAILING_LIST_PROPERTIES = [f"header:{name}:asText" for name in (*MAILING_LIST_HEADERS, "Precedence")]

# The longest emoji in Unicode, a kiss with two skin tones, is ten code points. Anything much past
# that is not one emoji, however emoji-like its characters are.
MAX_EMOJI_CODE_POINTS = 16

VARIATION_SELECTOR = "️"

# Codepoints that carry an emoji on their own. Ranges rather than a table: the set grows with every
# Unicode revision, and a reaction whose emoji the table hadn't heard of would render as a message.
_PICTOGRAPHIC_RANGES = (
    (0x00A9, 0x00A9),  # ©
    (0x00AE, 0x00AE),  # ®
    (0x203C, 0x203C),  # ‼
    (0x2049, 0x2049),  # ⁉
    (0x20E3, 0x20E3),  # combining enclosing keycap, which only ever ends a keycap emoji (1️⃣)
    (0x2122, 0x2122),  # ™
    (0x2139, 0x2139),  # information source
    (0x2190, 0x21FF),  # arrows
    (0x2300, 0x23FF),  # misc technical (⌚ ⏰ ⏸)
    (0x25A0, 0x27BF),  # geometric shapes, misc symbols, dingbats (★ ☀ ✅ ❤)
    (0x2934, 0x2935),  # ⤴ ⤵
    (0x2B00, 0x2BFF),  # arrows, ⭐
    (0x3030, 0x3030),  # 〰
    (0x303D, 0x303D),  # 〽
    (0x3297, 0x3299),  # ㊗ ㊙
    (0x1F000, 0x1FAFF),  # mahjong through symbols and pictographs extended-A, flags and skin tones
)

# Codepoints that are part of an emoji without being one: the joiner, the variation selectors, and
# what a keycap or a subdivision flag is built on. Alone they are not a reaction.
_MODIFIER_RANGES = (
    (0x0023, 0x0023),  # # keycap base
    (0x002A, 0x002A),  # * keycap base
    (0x0030, 0x0039),  # 0-9 keycap bases
    (0x200D, 0x200D),  # zero-width joiner
    (0xFE0E, 0xFE0F),  # variation selectors
    (0xE0020, 0xE007F),  # tag characters (subdivision flags)
)


def _in_ranges(codepoint: int, ranges: tuple[tuple[int, int], ...]) -> bool:
    return any(start <= codepoint <= end for start, end in ranges)


def is_emoji(text: str | None) -> bool:
    """Whether the text is one run of emoji characters, with no space or prose in it."""

    if not text or len(text) > MAX_EMOJI_CODE_POINTS:
        return False

    has_pictograph = False
    for char in text:
        codepoint = ord(char)
        if _in_ranges(codepoint, _PICTOGRAPHIC_RANGES):
            has_pictograph = True
        elif not _in_ranges(codepoint, _MODIFIER_RANGES):
            return False

    return has_pictograph


def emoji_key(emoji: str) -> str:
    """What makes two emoji the same one: ❤ and ❤️ differ only in how they ask to be drawn."""

    return emoji.replace(VARIATION_SELECTOR, "")


def read_reactions(message: dict) -> list[str]:
    """The emoji a formatted message reacts with, or nothing if it isn't a reaction.

    Read off the fields a cached message already holds, rather than derived once when it is formatted
    and stored: the cache is not rebuilt on upgrade, and reactions received before this existed
    should fold too.

    A marker alone is not enough. A client that sets it on a written reply, or attaches a file to a
    reaction, has written something, and folding that into a chip would lose it. So would folding a
    plain reply that happens to be a lone emoji, which carries no marker at all and stays a message.
    """

    if not message.get("in_reply_to"):
        return []

    attachments = message.get("attachments") or []
    if any(attachment.get("filename") for attachment in attachments):
        return []

    text = message.get("text_body") or ""
    parts = message.get("_text_body") or []

    if any((part.get("disposition") or "").lower() == REACTION_DISPOSITION for part in parts):
        # RFC 9078 lets invalid candidates on the line be dropped one at a time. A further text part
        # is more than the reaction.
        return [token for token in text.split() if is_emoji(token)] if len(parts) == 1 else []

    if any(attachment.get("type") == GMAIL_REACTION_TYPE for attachment in attachments):
        # The JSON part holds the emoji too, but as an attachment its content would take a blob
        # download per message. The text part opens with the same emoji.
        first_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
        return [first_line] if is_emoji(first_line) else []

    return []


def from_mailing_list(email: dict) -> bool:
    """Whether an Email, in wire form with `MAILING_LIST_PROPERTIES` among its properties, came
    through a list."""

    if any(email.get(f"header:{name}:asText") for name in MAILING_LIST_HEADERS):
        return True

    precedence = (email.get("header:Precedence:asText") or "").strip().lower()
    return precedence in MAILING_LIST_PRECEDENCES


def _takes_no_replies(address: str) -> bool:
    """Whether an address says it isn't read: "no-reply", "noreply+abc" and "do_not_reply" alike."""

    from suite.mail.classification.headers import AUTOMATED_SENDER_PREFIXES

    local = address.rpartition("@")[0].partition("+")[0]
    return local.translate(str.maketrans("", "", "-_.")).startswith(AUTOMATED_SENDER_PREFIXES)


def reaction_refusal(message: dict, own_emails: set[str], own_reactions: int = 0) -> str | None:
    """Why this message can't be reacted to, in words for the reader, or None if it can.

    `own_emails` are the account's addresses, lowercased; with none known, whether the reader was
    addressed can't be told and isn't asked. `own_reactions` is how many they have on it already.
    """

    if message.get("mailing_list"):
        return _("You can't react to mail from a mailing list.")

    addressed = {
        (recipient.get("email") or "").lower()
        for recipient in message.get("recipients") or []
        if recipient.get("type") in ("To", "Cc")
    }
    sender = (message.get("from_email") or "").lower()
    if own_emails and sender not in own_emails and not addressed & own_emails:
        return _("You can't react to this message because you aren't in To or Cc.")

    # A reaction goes where a reply would. Reply-To can lead somewhere that files what it gets, like
    # a helpdesk's ticket, where a reaction reads as an odd comment; your own mail is yours to mark.
    if sender not in own_emails:
        reply_to = {(address.get("email") or "").lower() for address in message.get("reply_to") or []}
        if reply_to - {"", sender}:
            return _("You can't react to this message because replies to it go to a different address.")
        if _takes_no_replies(sender):
            return _("You can't react to mail from an address that doesn't take replies.")

    if len(addressed) > MAX_REACTION_RECIPIENTS:
        return _("This message went to too many people to react to.")

    if own_reactions >= MAX_OWN_REACTIONS:
        return _("You've reached the limit of reactions on this message.")

    return None


def reaction_payload(emoji: str) -> str:
    """The content of the part Gmail recognises a reaction by."""

    return json.dumps({"emoji": emoji, "version": 1}, ensure_ascii=False, indent=2)


def reaction_bodies(emoji: str, notice: str) -> tuple[str, str]:
    """The text and HTML a client with no chip to draw shows instead, as Gmail writes them.

    `notice` is the line under the emoji, saying who reacted. The text opens with the emoji because
    that is what `read_reactions` reads back.
    """

    html = (
        f'<div><p style="font-size:50px;margin-top:0;margin-bottom:0">{escape(emoji)}</p>'
        f'<p style="margin-top:10px;margin-bottom:0">{escape(notice)}</p></div>'
    )
    return f"{emoji}\n\n{notice}\n", html
