"""Writing a document's body from Markdown in a request with no tab open, as an agent does.

The Markdown becomes HTML as frappe makes it, then a body through the converter old documents take, so a
body an agent writes is one the editor could have made. What the converter can't keep refuses the write.
"""

import base64
import uuid
from typing import Literal

import frappe
import pycrdt
from bs4 import BeautifulSoup
from frappe import _
from frappe.utils import md_to_html

from suite import content, drive
from suite.content import checker, compaction, convert
from suite.writer.content import APP, CONVERTER_BUILD, CONVERTER_VERSION, EDITOR
from suite.writer.content.files import BODY_FRAGMENT

MARKDOWN_MAX = 128 * 1024
ID_ATTRIBUTES = ("id", "data-toc-id")
# The layer's refusals that pass by themselves: another push holds the document, or a compaction makes room
PASSING = ("busy", "compacting")


class MarkdownRefused(frappe.ValidationError):
    """The Markdown holds what a document can't keep."""

    http_status_code = 422


class WriteRefused(frappe.ValidationError):
    """The document refuses the write, for the reason a tab's edit gets."""

    http_status_code = 409


class WriteBusy(frappe.ValidationError):
    """The document or the converter is busy; the same call works later."""

    http_status_code = 429

    def __init__(self, *args: object, retry_ms: object = None) -> None:
        super().__init__(*args)
        self.retry_ms = retry_ms


def create(parent: str, title: str, markdown: str) -> dict:
    """Create a document in the folder `parent` with `markdown` as its body."""
    drive.check(parent, drive.UPLOAD)
    body = body_state(markdown)
    node = drive.create_document(parent, title, content_doctype=EDITOR.doctype)
    return {"node": node, "rev": write_body(node, body, "replace")}


def write(node: str, markdown: str, mode: Literal["replace", "append"]) -> dict:
    """Replace the document's body with `markdown`, or append it."""
    if drive.check(node, drive.EDIT) != EDITOR.doctype:
        raise drive.DriveNotFound(_("That document was not found"))

    return {"node": node, "rev": write_body(node, body_state(markdown), mode)}


def body_state(markdown: str) -> bytes:
    """Convert `markdown` to the state of a document that holds all of it."""
    if len(markdown.encode()) > MARKDOWN_MAX:
        # More than this takes the Markdown reader many seconds, and the converter its memory
        raise MarkdownRefused(_("The Markdown is over 128 KB. Write it in parts."))

    soup = BeautifulSoup(md_to_html(markdown), "html.parser")
    # frappe decorates three tags in ways the converter refuses
    for table in soup.select('table[class="table table-bordered"]'):
        del table["class"]
        for section in table.select("thead, tbody"):
            section.unwrap()

    for image in soup.select('img[class="screenshot"]'):
        del image["class"]

    for code in soup.select("pre > code[class]"):
        language = code["class"][-1]
        if code["class"] == [language.removeprefix("language-"), language]:
            code["class"] = language

    body = converted(html=str(soup))
    if body.dropped:
        kinds = ", ".join(sorted({drop["kind"] for drop in body.dropped}))
        raise MarkdownRefused(_("A document can't keep this Markdown: {0}").format(kinds))

    return body.state


def converted(**old_body: object) -> convert.Converted:
    """Run the converter on an old body, refusing what it refuses."""
    legacy = {"content": None, "html": None, "collab": 0, "ycomments": None, **old_body}
    try:
        answer = convert.convert(CONVERTER_BUILD, CONVERTER_VERSION, legacy)
    except checker.CheckerBusy:
        raise WriteBusy(_("The converter is busy. Try again in a moment.")) from None

    if answer is None:
        raise RuntimeError("the Writer converter needs Node and its built bundle")

    if isinstance(answer, convert.Refused):
        refusal = " ".join(filter(None, [answer.reason, answer.detail]))
        raise MarkdownRefused(_("A document can't keep this Markdown: {0}").format(refusal))

    return answer


def write_body(node: str, body: bytes, mode: Literal["replace", "append"]) -> int:
    """Push `body`'s blocks to the document as the request's user, and answer the rev they make."""
    blocks = compaction.load_doc([body]).get(BODY_FRAGMENT, type=pycrdt.XmlFragment)

    def change(state: pycrdt.Doc) -> None:
        fragment = state.get(BODY_FRAGMENT, type=pycrdt.XmlFragment)
        if mode == "replace":
            del fragment.children[:]

        append_copy(fragment, blocks)

    try:
        return content.write(APP, node, change, html_of)
    except content.Refusal as refusal:
        reason = refusal.body["collab"]
        if reason in PASSING:
            raise WriteBusy(reason, retry_ms=refusal.body.get("retry_ms")) from None

        raise WriteRefused(reason) from None


def append_copy(
    parent: pycrdt.XmlFragment | pycrdt.XmlElement, source: pycrdt.XmlFragment | pycrdt.XmlElement
) -> None:
    """Write `source`'s children again under `parent`, so they are the writing session's own."""
    for child in source.children:
        if isinstance(child, pycrdt.XmlText):
            append_text(parent, child)
        elif isinstance(child, pycrdt.XmlElement):
            append_copy(append_element(parent, child), child)


def append_text(parent: pycrdt.XmlFragment | pycrdt.XmlElement, source: pycrdt.XmlText) -> None:
    """Write `source`'s runs again, with their marks, as new text under `parent`."""
    text = parent.children.append(pycrdt.XmlText())
    for run, marks in source.diff():
        text.insert(len(text), run, marks or {})


def append_element(
    parent: pycrdt.XmlFragment | pycrdt.XmlElement, source: pycrdt.XmlElement
) -> pycrdt.XmlElement:
    """Add an element under `parent` with `source`'s tag and attributes, and answer it."""
    element = parent.children.append(pycrdt.XmlElement(source.tag))
    # The converter numbers its ids within one conversion, so an element gets its own, as a typed heading does
    own_id = str(uuid.uuid4())
    for name, value in source.attributes.__iter__():
        element.attributes[name] = own_id if name in ID_ATTRIBUTES else value

    return element


def html_of(state: bytes) -> str:
    """Render a body's state as its readable copy."""
    return converted(content=base64.b64encode(state).decode(), collab=1).html
