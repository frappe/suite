"""Strip the quoted reply trail from a message body.

Mirrors the client's ``findQuoteRoots`` (frontend/src/apps/mail/utils/quotedContent.ts) — the two must
agree so the preview never surfaces text the reader collapses. Every client marks its trail differently:
Gmail, Yahoo, Proton, Zoho and our own composer wrap it in a classed container; Apple Mail and
Thunderbird use ``<blockquote type="cite">``, Thunderbird with a classed attribution line as the sibling
before it; Outlook on the web wraps nothing and the original simply follows its From/Sent/To/Subject
header. It also rewrites every class and id it quotes with an ``x_`` prefix.
"""

import re

from bs4 import BeautifulSoup, Tag

QUOTE_CLASS = re.compile(
    r"^(?:x_)?(?:gmail_quote|frappe_mail_quote|yahoo_quoted|protonmail_quote|zmail_extra)$"
)
CITE_PREFIX_CLASS = re.compile(r"^(?:x_)?moz-cite-prefix$")
OUTLOOK_MARKER_ID = re.compile(r"^(?:x_)?appendonsend$")
OUTLOOK_WEB_HEADER_ID = re.compile(r"^(?:x_)?divRplyFwdMsg$")


def _classes(tag: Tag) -> list[str]:
    value = tag.get("class") or []
    return value if isinstance(value, list) else str(value).split()


def _outlook_trail_start(header: Tag) -> Tag:
    start = header
    prev = start.find_previous_sibling()
    while prev is not None and (prev.name == "hr" or OUTLOOK_MARKER_ID.match(prev.get("id") or "")):
        start = prev
        prev = start.find_previous_sibling()
    return start


def _trail_from(start: Tag) -> list[Tag]:
    return [start, *[s for s in start.find_next_siblings()]]


def _attribution_before(quote: Tag) -> Tag | None:
    prev = quote.find_previous_sibling()
    if prev is not None and any(CITE_PREFIX_CLASS.match(c) for c in _classes(prev)):
        return prev
    return None


def strip_quote_trail(soup: BeautifulSoup) -> None:
    """Remove every quoted trail from ``soup`` in place."""

    doomed: list[Tag] = []

    for tag in soup.find_all(True):
        if any(QUOTE_CLASS.match(c) for c in _classes(tag)):
            doomed.append(tag)
        if OUTLOOK_WEB_HEADER_ID.match(tag.get("id") or ""):
            doomed.extend(_trail_from(_outlook_trail_start(tag)))
        if tag.name == "blockquote" and (tag.get("type") or "").lower() == "cite":
            attribution = _attribution_before(tag)
            if attribution is not None:
                doomed.append(attribution)
            doomed.append(tag)

    for tag in doomed:
        if not tag.decomposed:
            tag.decompose()
