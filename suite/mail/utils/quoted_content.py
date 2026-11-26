"""Strip the quoted reply trail from a message body, and defuse the links a sent one carries.

Mirrors the client's ``findQuoteRoots`` (frontend/src/apps/mail/utils/quotedContent.ts) — the two must
agree so the preview never surfaces text the reader collapses. Every client marks its trail differently:
Gmail, Yahoo, Proton, Zoho and our own composer wrap it in a classed container; Apple Mail and
Thunderbird use ``<blockquote type="cite">``, Thunderbird with a classed attribution line as the sibling
before it; Outlook on the web wraps nothing and the original simply follows its From/Sent/To/Subject
header. It also rewrites every class and id it quotes with an ``x_`` prefix.
"""

import re
from urllib.parse import urlsplit

from bs4 import BeautifulSoup, Tag

QUOTE_CLASS = re.compile(
    r"^(?:x_)?(?:gmail_quote|frappe_mail_quote|yahoo_quoted|protonmail_quote|zmail_extra)$"
)
CITE_PREFIX_CLASS = re.compile(r"^(?:x_)?moz-cite-prefix$")
OUTLOOK_MARKER_ID = re.compile(r"^(?:x_)?appendonsend$")
OUTLOOK_WEB_HEADER_ID = re.compile(r"^(?:x_)?divRplyFwdMsg$")
# What our composer wraps a replied-to or forwarded mail in.
CARRIED_OVER_CLASSES = ("frappe_mail_quote", "frappe_mail_fwd")
# Link text a reader takes for an address: an optional http(s) scheme, a host, an optional path.
HOST_LIKE_TEXT = re.compile(
    r"^(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,63})(?::\d+)?(?:[/?#]\S*)?$", re.IGNORECASE
)


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


def unlink_lookalike_links(html: str | None) -> str | None:
    """``html`` with each carried-over link whose text names another host reduced to its text.

    Rspamd scores PHISHING (+4) when a link reads as one host and leads to another, and one is
    common in quoted signatures: Gmail's `e<a href="https://example.com">xample.com</a>` reads as
    `xample.com`. The sender did not write those links, so only the blocks the
    composer carries over are touched; a body without a lookalike comes back unchanged.
    """

    if not html or not any(marker in html for marker in CARRIED_OVER_CLASSES):
        return html

    soup = BeautifulSoup(html, "html.parser")
    lookalikes = [
        link
        for link in soup.find_all("a", href=True)
        if link.find_parent("div", class_=CARRIED_OVER_CLASSES) and is_lookalike_link(link)
    ]
    if not lookalikes:
        return html

    for link in lookalikes:
        link.unwrap()
    return str(soup)


def is_lookalike_link(link: Tag) -> bool:
    """Whether the link's text reads as a host that its http(s) target is not on."""

    if not (match := HOST_LIKE_TEXT.match(link.get_text().strip())):
        return False

    href = str(link["href"]).strip()
    if not href.lower().startswith(("http://", "https://")):
        return False

    try:
        target = urlsplit(href).hostname or ""
    except ValueError:
        return True

    shown, target = (_bare_host(host) for host in (match.group(1), target))
    return not (shown == target or shown.endswith(f".{target}") or target.endswith(f".{shown}"))


def _bare_host(host: str) -> str:
    return host.lower().removeprefix("www.")
