"""Encoding a starter presentation's slides as its first deck, in the request that makes it.

The converter, which reads every other deck, runs only in background jobs, so a starter is
encoded here instead, as the converter writes the same slides. It covers only the welcome
kickoff's two text element forms (welcome.py's _text), whose only free parts are an id's number
and plain text. Anything else raises. test_starter checks the result against the converter's
answer and the checker.
"""

import html
import json
import re
from typing import NamedTuple

import frappe
import pycrdt

from suite.slides.content.conversion import NEW_ID_LENGTH

# The order a tab appending each item to its list writes (deck.ts's orderPast); a longer list raises
ORDERS = "VWXYZabcdefghijklmnopqrstuvwxyz"
SLIDE = {"background": "#FFFFFFFF", "transition": "None", "transitionDuration": "0"}
# Every field of a starter text element but its id, top and content, as the kickoff sets it
FIXED = {
    "type": "text",
    "left": 80,
    "width": 800,
    "opacity": 100,
    "rotation": 0,
    "editorMetadata": {"lineHeight": 1.3},
}


class Form(NamedTuple):
    top: int
    size: int
    color: str


# Each kickoff form, by its id's prefix
FORMS = {"heading": Form(180, 48, "#171717FF"), "body": Form(280, 24, "#7C7C7CFF")}
ID = re.compile(r"(heading|body)-[1-9][0-9]*")
# Words of anything but whitespace, markup and control characters, or html.escape's entities, one space apart
WORD = r"(?:[^\s<>&\"'\x00-\x1f\x7f]|&amp;|&lt;|&gt;|&quot;|&#x27;)+"
TEXT = re.compile(rf"{WORD}(?: {WORD})*")
LINE_HEIGHT = FIXED["editorMetadata"]["lineHeight"]
FRAME = {
    "left": float(FIXED["left"]),
    "width": float(FIXED["width"]),
    "transform": "none",
    "transformOrigin": "top left",
}
# The editor's textStyle mark carries every one of its attributes, an unset one as null
UNSET_STYLE = dict.fromkeys(("fontWeight", "letterSpacing", "textTransform", "opacity"))


def deck_state(slides: list[list[dict]]) -> bytes:
    """Encode `slides`, each its list of starter text elements, as the deck the editor binds to."""
    doc: pycrdt.Doc = pycrdt.Doc()
    slide_map = doc.get("slides", type=pycrdt.Map)
    element_map = doc.get("elements", type=pycrdt.Map)
    ids: list[str] = []
    for elements in slides:
        ids.extend(element["id"] for element in elements)

    if len(set(ids)) != len(ids):
        raise ValueError("a starter's element ids must differ")

    with doc.transaction():
        for at, elements in enumerate(slides):
            slide_id = frappe.generate_hash(length=NEW_ID_LENGTH)
            slide_map[slide_id] = pycrdt.Map({**SLIDE, "order": ORDERS[at]})
            add_texts(element_map, elements, slide_id)

    return doc.get_update()


def add_texts(elements: pycrdt.Map, texts: list[dict], parent: str) -> None:
    """Add the starter text elements `texts` to `parent`, each over the one before."""
    for at, element in enumerate(texts):
        add_text(elements, element, parent, ORDERS[at])


def add_text(elements: pycrdt.Map, element: dict, parent: str, order: str) -> None:
    """Add the starter text `element` to `parent`, with the fields the converter gives it."""
    form = form_of(element)
    item = pycrdt.Map(
        {
            "type": "text",
            "parent": parent,
            "order": order,
            "frame": {**FRAME, "top": float(form.top)},
            "rotation": float(FIXED["rotation"]),
            "opacity": float(FIXED["opacity"]),
            "lineHeight": float(LINE_HEIGHT),
        }
    )
    elements[element["id"]] = item
    fragment = pycrdt.XmlFragment()
    item["text"] = fragment
    paragraph = fragment.children.append(pycrdt.XmlElement("paragraph", {"lineHeight": str(LINE_HEIGHT)}))
    text = paragraph.children.append(pycrdt.XmlText())
    style = {"fontFamily": "Inter", "fontSize": f"{form.size}px", "color": form.color, **UNSET_STYLE}
    text.insert(0, plain_text(element, form), {"textStyle": style})


def form_of(element: dict) -> Form:
    """Return the kickoff form `element` takes exactly, or raise."""
    matched = None
    if isinstance(element.get("id"), str):
        matched = ID.fullmatch(element["id"])

    if not matched:
        raise ValueError("a starter element's id is a kickoff heading's or body's")

    form = FORMS[matched[1]]
    fixed = {name: element.get(name) for name in FIXED}
    if element.keys() != {*FIXED, "id", "top", "content"} or json.dumps(fixed) != json.dumps(FIXED):
        raise ValueError("a starter element holds exactly the kickoff's fields and values")

    if json.dumps(element["top"]) != json.dumps(form.top):
        raise ValueError("a starter element sits where its kickoff form does")

    return form


def plain_text(element: dict, form: Form) -> str:
    """Return the plain text of a starter element's one paragraph, styled as `form` is, or raise."""
    content = element["content"]
    opening = f'<p><span style="font-family: Inter; font-size: {form.size}px; color: {form.color};">'
    closing = "</span></p>"
    inner = ""
    if isinstance(content, str):
        inner = content[len(opening) : -len(closing)]

    if content != f"{opening}{inner}{closing}" or not TEXT.fullmatch(inner):
        raise ValueError("a starter's text is plain text in its form's one styled paragraph")

    return html.unescape(inner)
