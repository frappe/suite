"""Encoding a starter presentation's slides as its first deck, in the request that makes it.

The converter, which reads every other deck, runs only in background jobs, so a starter is
encoded here instead, as the converter writes the same slides. It covers only what starters
hold: white slides with no transition, and text elements of one styled paragraph. Anything
else raises. test_starter checks the result against the converter's answer and the checker.
"""

from xml.etree import ElementTree as ET

import frappe
import pycrdt

from suite.slides.content.conversion import NEW_ID_LENGTH

# The order a tab appending each item to its list writes (deck.ts's orderPast); a longer list raises
ORDERS = "VWXYZabcdefghijklmnopqrstuvwxyz"
SLIDE = {"background": "#FFFFFFFF", "transition": "None", "transitionDuration": "0"}
# The editor's textStyle mark carries every one of its attributes, an unset one as null
TEXT_STYLE = {
    "font-family": "fontFamily",
    "font-size": "fontSize",
    "color": "color",
    "font-weight": "fontWeight",
    "letter-spacing": "letterSpacing",
    "text-transform": "textTransform",
    "opacity": "opacity",
}


def deck_state(slides: list[list[dict]]) -> bytes:
    """Encode `slides`, each its list of starter text elements, as the deck the editor binds to."""
    doc: pycrdt.Doc = pycrdt.Doc()
    slide_map = doc.get("slides", type=pycrdt.Map)
    element_map = doc.get("elements", type=pycrdt.Map)
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
    span = styled_span(element)
    line_height = element["editorMetadata"]["lineHeight"]
    frame = {name: float(element[name]) for name in ("left", "top", "width")}
    item = pycrdt.Map(
        {
            "type": "text",
            "parent": parent,
            "order": order,
            "frame": {**frame, "transform": "none", "transformOrigin": "top left"},
            "rotation": float(element["rotation"]),
            "opacity": float(element["opacity"]),
            "lineHeight": float(line_height),
        }
    )
    elements[element["id"]] = item
    fragment = pycrdt.XmlFragment()
    item["text"] = fragment
    paragraph = fragment.children.append(pycrdt.XmlElement("paragraph", {"lineHeight": str(line_height)}))
    text = paragraph.children.append(pycrdt.XmlText())
    text.insert(0, span.text or "", {"textStyle": text_style(span.get("style", ""))})


def styled_span(element: dict) -> ET.Element:
    """Find the one styled span a starter text element's paragraph holds."""
    if element.get("type") != "text" or element.get("transform"):
        raise ValueError("a starter holds only text elements")

    paragraph = ET.fromstring(element["content"])
    spans = list(paragraph)
    if paragraph.tag != "p" or paragraph.text or len(spans) != 1 or spans[0].tag != "span":
        raise ValueError("a starter's text is one styled paragraph")

    if list(spans[0]) or spans[0].tail:
        raise ValueError("a starter's text is one styled paragraph")

    return spans[0]


def text_style(style: str) -> dict:
    """Read a span's inline `style` into the textStyle mark the editor writes."""
    declared = [part.split(":", 1) for part in style.split(";") if part.strip()]
    named = {name.strip(): value.strip() for name, value in declared}
    if not named.keys() <= TEXT_STYLE.keys():
        raise ValueError("a starter's text uses a style the encoder doesn't know")

    return {key: named.get(css) for css, key in TEXT_STYLE.items()}
