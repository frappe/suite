# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Render an HTML mail body as the text/plain alternative sent alongside it.

suite.utils.convert_html_to_text flattens a body to one line, which suits the preview
strings it was written for but destroys a message. This keeps the line breaks, list
markers, quoting and link targets a reader needs, since a terminal client shows this
part and not the HTML one.

flowed=True emits RFC 3676 (format=flowed; delsp=no). Declaring the matching
Content-Type parameters is the caller's job.
"""

import re
import textwrap
from dataclasses import dataclass, replace
from itertools import groupby
from urllib.parse import urlsplit

from bs4 import BeautifulSoup
from bs4.element import NavigableString, PreformattedString, Tag

DEFAULT_WIDTH = 72
# Floor for the wrap column, so deep quoting or list nesting cannot squeeze text down to
# a word per line.
MIN_WIDTH = 24
# Two blank lines is a sender pressing Return twice. Beyond that it is HTML padding.
MAX_BLANK_RUN = 2
# RFC 3676 4.3. The trailing space is what identifies it, so it survives every trim here.
SIGNATURE_SEPARATOR = "-- "
# Class the composer puts on the signature it inserts, mirroring frappe_mail_quote.
SIGNATURE_CLASS = "frappe_mail_signature"

# Tags that never contribute text. `button` is among them because a call to action worth
# reading is an <a>; a real <button> is a dead control whose label only adds noise.
_DROPPED = frozenset(
    {
        "audio",
        "button",
        "canvas",
        "embed",
        "head",
        "iframe",
        "input",
        "link",
        "meta",
        "noscript",
        "object",
        "option",
        "script",
        "select",
        "style",
        "svg",
        "template",
        "textarea",
        "title",
        "video",
    }
)

# Blank lines a block leaves above and below itself. 1 sets it apart from its neighbours.
# 0 only ends the line, so consecutive blocks read as consecutive lines, which is what the
# composer writes (one <div> per line). Tags absent here are treated as inline: reading a
# block as inline costs a line break, the reverse splits a sentence in half.
_BLOCK_MARGIN = {
    "address": 1,
    "article": 1,
    "dl": 1,
    "figure": 1,
    "footer": 1,
    "form": 1,
    "h1": 1,
    "h2": 1,
    "h3": 1,
    "h4": 1,
    "h5": 1,
    "h6": 1,
    "header": 1,
    "main": 1,
    "p": 1,
    "section": 1,
    "table": 1,
    "caption": 0,
    "center": 0,
    "dd": 0,
    "div": 0,
    "dt": 0,
    "figcaption": 0,
    "li": 0,
    "tbody": 0,
    "tfoot": 0,
    "thead": 0,
    "tr": 0,
}

# Zero width marks, bidi controls, soft hyphen, and controls other than tab and newline.
# Invisible in a browser, literal mojibake in a terminal.
_INVISIBLE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f\xad​-‏‪-‮⁠-⁯﻿]")
_WHITESPACE = re.compile(r"\s+")
# A line with no content, quote prefix aside.
_BLANK = re.compile(r"^>*\s*$")
# How preheaders, tracking pixel wrappers and alternate layouts hide from the HTML reader.
# Unhidden, the preheader is the first thing in the text part.
_HIDDEN = re.compile(r"(?:^|;)\s*(?:display\s*:\s*none|mso-hide\s*:\s*all)\s*(?:;|$)", re.I)
# Hrefs naming no destination a reader could act on.
_OPAQUE_HREF = ("javascript:", "data:", "cid:", "about:", "#")
_SCHEME_AND_WWW = re.compile(r"^(?:[a-z][a-z0-9+.-]*:)?(?://)?(?:www\.)?", re.I)


def html_to_text(html: str | None, *, width: int = DEFAULT_WIDTH, flowed: bool = False) -> str:
    """Plain text rendering of an HTML mail body.

    width is the column to wrap at, quote prefix and list indent included. flowed emits
    RFC 3676 soft line breaks.
    """

    if not html or not (content := html.strip()):
        return ""
    soup = BeautifulSoup(content, "html.parser")
    return _render(_paragraphs(_tokenize(soup.body or soup, _State())), width, flowed)


def to_flowed(text: str | None) -> str:
    """Re-encode ready-made plain text as `format=flowed`, without reflowing it.

    Every line comes out fixed, so a reader shows the breaks the sender chose. This is for
    text the app did not generate, so a part can declare one wire format either way.

    Unlike _wire, a leading `>` is left alone: in text written as text it is a quote, and
    stuffing it would show the reader a literal `>` instead.
    """

    if not text:
        return ""
    lines = []
    for line in text.splitlines():
        fixed = line if line == SIGNATURE_SEPARATOR else line.rstrip()
        stuff = fixed[:1] == " " or fixed.startswith("From ")
        lines.append((" " + fixed) if stuff else fixed)
    return "\n".join(lines)


@dataclass(frozen=True)
class _State:
    """What the enclosing elements say about the text being collected."""

    quote: int = 0
    # Indent a list item's content sits on, the marker's width included.
    padding: str = ""
    is_pre: bool = False


# The tree is flattened to these before any layout happens, so building paragraphs is a
# fold over a flat list rather than a walk carrying shared state.


@dataclass(frozen=True)
class _Text:
    value: str
    state: _State


@dataclass(frozen=True)
class _Break:
    state: _State


@dataclass(frozen=True)
class _Boundary:
    """Ends the paragraph in progress and asks for margin blank lines around it."""

    margin: int


@dataclass(frozen=True)
class _Marker:
    """First line indent for the next paragraph, set by a list item."""

    indent: str


type _Token = _Text | _Break | _Boundary | _Marker


@dataclass(frozen=True)
class _Pending:
    """Text gathered since the last boundary."""

    line: tuple[str, ...] = ()  # pieces of the line being built
    lines: tuple[str, ...] = ()  # lines already closed by a <br>
    # Taken from the first content, so a paragraph renders under the element that produced
    # it rather than whatever the fold had reached by the time something closed it.
    state: _State | None = None
    trailing_break: bool = False


@dataclass(frozen=True)
class _Paragraph:
    """A block of text, split at its hard breaks but not yet wrapped."""

    lines: tuple[str, ...] = ()
    quote: int = 0
    indent: str = ""  # first line, carrying the list marker where there is one
    hang: str = ""  # every line after it
    wrap: bool = True  # False for <pre>, whose breaks and spacing are the content
    margin: int = 0  # blank lines above


def _tokenize(node: Tag, state: _State) -> list[_Token]:
    """Flatten an element's children into tokens."""

    tokens: list[_Token] = []
    for child in node.children:
        if isinstance(child, Tag):
            tokens += _tag_tokens(child, state)
        # PreformattedString covers comments, doctypes and CDATA, which subclass
        # NavigableString but are markup rather than content.
        elif isinstance(child, NavigableString) and not isinstance(child, PreformattedString):
            tokens.append(_Text(_clean(str(child), state.is_pre), state))
    return tokens


def _tag_tokens(el: Tag, state: _State) -> list[_Token]:
    """Tokens for one element, chosen by tag."""

    name = (el.name or "").lower()
    if name in _DROPPED or el.has_attr("hidden") or _HIDDEN.search(str(el.get("style") or "")):
        return []
    if SIGNATURE_CLASS in (el.get("class") or []):
        return _signature_tokens(el, state)
    if name == "br":
        return [_Break(state)]
    if name == "hr":
        return _bounded([_Text("---", state)], 1)
    if name == "img":
        alt = _clean(str(el.get("alt") or ""), False).strip()
        return [_Text("[" + alt + "]", state)] if alt else []
    if name == "a":
        return _anchor_tokens(el, state)
    if name == "pre":
        return _bounded(_tokenize(el, replace(state, is_pre=True)), 1)
    if name == "blockquote":
        return _bounded(_tokenize(el, replace(state, quote=state.quote + 1)), 1)
    if name in ("ul", "ol"):
        return _list_tokens(el, state)
    if name in ("td", "th"):
        # A row is one line, so cells are separated rather than broken. _add_text drops
        # this space again when the line is empty or already ends in one.
        return [_Text(" ", state), *_tokenize(el, state)]
    if (margin := _BLOCK_MARGIN.get(name)) is not None:
        return _bounded(_tokenize(el, state), margin)
    return _tokenize(el, state)


def _bounded(inner: list[_Token], margin: int) -> list[_Token]:
    """Fence tokens off as their own paragraph."""

    return [_Boundary(margin), *inner, _Boundary(margin)]


def _signature_tokens(el: Tag, state: _State) -> list[_Token]:
    """The signature block, introduced by the separator a reader looks for.

    The composer marks the block it inserts, because by the time a body reaches here the
    signature is ordinary markup and nothing else could tell it apart.
    """

    inner = _tokenize(el, state)
    if not any(isinstance(token, _Text) and token.value.strip() for token in inner):
        return []

    # Margin 0 after the separator keeps the signature on the line below it, not a blank
    # line below it.
    return [_Boundary(1), _Text(SIGNATURE_SEPARATOR, state), _Boundary(0), *inner, _Boundary(1)]


def _list_tokens(el: Tag, state: _State) -> list[_Token]:
    """Tokens for a <ul> or <ol>, one marker per item."""

    # A nested list belongs to the item above it, so no blank line comes between them.
    margin = 0 if state.padding else 1
    ordered = (el.name or "").lower() == "ol"
    start = str(el.get("start") or "")
    first = int(start) if start.isdigit() else 1

    tokens: list[_Token] = [_Boundary(margin)]
    for offset, item in enumerate(el.find_all("li", recursive=False)):
        marker = (str(first + offset) + ". ") if ordered else "- "
        # Padding lines the item's later content up under the marker, not under the bullet.
        inner = _tokenize(item, replace(state, padding=state.padding + " " * len(marker)))
        # The empty marker stops an item that produced nothing from passing its own on.
        tokens += [_Boundary(0), _Marker(state.padding + marker), *inner, _Boundary(0), _Marker("")]
    return [*tokens, _Boundary(margin)]


def _anchor_tokens(el: Tag, state: _State) -> list[_Token]:
    """Tokens for an <a>, with its destination spelled out after the label."""

    inner = _tokenize(el, state)
    # Only the text after the last break, since that is the line the URL will follow.
    breaks = [index for index, token in enumerate(inner) if isinstance(token, _Break)]
    tail = inner[breaks[-1] + 1 :] if breaks else inner
    label = "".join(token.value for token in tail if isinstance(token, _Text)).strip()

    if not (target := _link_target(str(el.get("href") or ""), label)):
        return inner
    return [*inner, _Text((" <" if label else "<") + target + ">", state)]


def _paragraphs(tokens: list[_Token]) -> list[_Paragraph]:
    """Fold tokens into paragraphs."""

    paragraphs: list[_Paragraph] = []
    pending, marker, margin = _Pending(), "", 0

    # The appended boundary closes whatever the last token left pending.
    for token in [*tokens, _Boundary(0)]:
        match token:
            case _Text(value, state):
                pending = _add_text(pending, value, state)
            case _Break(state):
                pending = _add_break(pending, state)
            case _Marker(indent):
                marker = indent
            case _Boundary(block_margin):
                # Marker and margin are spent only when a paragraph is actually emitted.
                # A boundary that closed nothing leaves both for the next one.
                if paragraph := _close(pending, marker, margin):
                    paragraphs.append(paragraph)
                    marker, margin = "", 0
                pending = _Pending()
                # The gap between two blocks is the larger of what each asked for.
                margin = max(margin, block_margin)

    return paragraphs


def _add_text(pending: _Pending, value: str, state: _State) -> _Pending:
    """Append inline text, leaving one space between adjacent runs however many the
    source spells. Inside <pre> a leading space is indentation and is kept."""

    current = "".join(pending.line)
    collapse = not state.is_pre and (not current or current.endswith(" "))
    text = value.lstrip(" ") if collapse else value
    if not text:
        return pending
    return replace(pending, line=(*pending.line, text), state=pending.state or state, trailing_break=False)


def _add_break(pending: _Pending, state: _State) -> _Pending:
    """Close the line on a <br> without closing the paragraph."""

    return replace(
        pending,
        line=(),
        lines=(*pending.lines, "".join(pending.line)),
        state=pending.state or state,
        trailing_break=True,
    )


def _close(pending: _Pending, marker: str, margin: int) -> _Paragraph | None:
    """Turn pending text into a paragraph, or None if it held no content."""

    if (state := pending.state) is None:
        return None

    tail = ["".join(pending.line)] if pending.line or pending.trailing_break else []
    collected = [*pending.lines, *tail]

    if state.is_pre:
        # <pre> arrives as one node holding its own newlines. Keep the blank lines inside
        # it, drop the ones its tags sit on.
        parts = [part for line in collected for part in line.split("\n")]
        filled = [index for index, part in enumerate(parts) if part.strip()]
        lines = parts[filled[0] : filled[-1] + 1] if filled else []
    else:
        stripped = [line if line == SIGNATURE_SEPARATOR else line.rstrip() for line in collected]
        # A block ending in <br> is one line tall in a browser, not two.
        ends_blank = pending.trailing_break and stripped and not stripped[-1]
        lines = stripped[:-1] if ends_blank else stripped

    # A block holding only markup (a spacer <div>, a pixel's wrapper) is not a blank line
    # anyone wrote. One holding a <br> is.
    if not any(lines) and not pending.trailing_break:
        return None

    return _Paragraph(
        lines=tuple(lines) or ("",),
        quote=state.quote,
        indent=marker or state.padding,
        hang=state.padding,
        wrap=not state.is_pre,
        margin=margin,
    )


def _render(paragraphs: list[_Paragraph], width: int, flowed: bool) -> str:
    """Lay the paragraphs out and join them into the finished body."""

    out: list[str] = []
    previous_quote = 0
    for index, paragraph in enumerate(paragraphs):
        prefix = ">" * paragraph.quote + (" " if paragraph.quote else "")
        is_blank = not any(line.strip() for line in paragraph.lines)
        separated = not out or bool(_BLANK.match(out[-1]))
        # A gap already left by an empty paragraph is the separation. Adding the margin on
        # top would double the blank line around every list the composer's own empty <div>
        # happens to sit next to.
        if index and not is_blank and not separated:
            # The blank line stays in the quote only where both sides are quoted, and
            # keeps the `>` without its trailing space, which a fixed line may not have.
            out += [">" * min(previous_quote, paragraph.quote)] * paragraph.margin
        out += [
            _wire(line, prefix, paragraph.quote, flowed)
            for line in _layout(paragraph, width - len(prefix), flowed)
        ]
        previous_quote = paragraph.quote

    # Cap the runs of blank lines that pathological markup piles up.
    kept = []
    for blank, run in groupby(out, key=lambda line: bool(_BLANK.match(line))):
        group = list(run)
        kept += group[:MAX_BLANK_RUN] if blank else group
    return "\n".join(kept).strip("\n")


def _layout(paragraph: _Paragraph, width: int, flowed: bool) -> list[str]:
    """Wrap a paragraph to the column, marking the breaks it introduced when flowed."""

    column = max(width, MIN_WIDTH)
    # Indented text is never flowed: re-wrapping it would pull the continuation up beside
    # the marker.
    soft = flowed and paragraph.wrap and not paragraph.indent and not paragraph.hang
    laid: list[str] = []
    for index, line in enumerate(paragraph.lines):
        indent = paragraph.hang if index else paragraph.indent
        if line == SIGNATURE_SEPARATOR:
            laid.append(line)  # textwrap would take the space that defines it
        elif not paragraph.wrap:
            # Trailing space in <pre> is content, but flowed it would read as a soft break.
            laid.append((indent + line).rstrip() if flowed else indent + line)
        elif not line.strip():
            laid.append("")
        else:
            wrapped = textwrap.wrap(
                line,
                column,
                initial_indent=indent,
                subsequent_indent=paragraph.hang,
                break_long_words=False,  # a broken URL is an unclickable URL
                break_on_hyphens=False,
            ) or [indent.rstrip()]
            # Every line but the last was broken to fit, so offer it back for re-wrapping.
            laid += ([piece + " " for piece in wrapped[:-1]] + wrapped[-1:]) if soft else wrapped
    return laid


def _wire(line: str, prefix: str, quote: int, flowed: bool) -> str:
    """Put one laid out line on the wire, quoted and space stuffed."""

    if line == SIGNATURE_SEPARATOR:
        return prefix + line if quote else line
    if quote:
        # RFC 3676 4.5: the prefix is the run of `>` alone, and a reader deletes one
        # leading space. So this displays as "> text" everywhere and still arrives as
        # "text", whatever the content starts with.
        return prefix + line if line.strip() else prefix.rstrip()
    # 4.4 space stuffing. Without it the reader eats the line's own leading space, or
    # reads it as a quote it never was.
    stuff = flowed and (line[:1] in (" ", ">") or line.startswith("From "))
    return (" " + line) if stuff else line


def _clean(value: str, pre: bool) -> str:
    """Drop what a terminal cannot show, and collapse whitespace outside <pre>."""

    # A no-break space reads as a space but never wraps, so it becomes one.
    text = _INVISIBLE.sub("", value.replace("\xa0", " "))
    return text if pre else _WHITESPACE.sub(" ", text)


def _link_target(url: str, label: str) -> str:
    """The URL worth spelling out beside a label, or "" when it adds nothing."""

    href = url.strip()
    if not href or href.lower().startswith(_OPAQUE_HREF):
        return ""
    # A mailto's query string (?subject=) addresses a composer, not a reader.
    parts = urlsplit(href)
    target = parts.path if parts.scheme.lower() == "mailto" else href
    if not target or (label and _bare(label) in (_bare(target), _bare(href))):
        return ""
    return target


def _bare(url: str) -> str:
    """A URL cut down to what a label has to say to be saying the same thing."""

    return _SCHEME_AND_WWW.sub("", url.strip()).rstrip("/").lower()
