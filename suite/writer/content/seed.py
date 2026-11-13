"""Starting a new Writer document from HTML, for starter files and the demo seed.

The HTML uses only what the editor declares: paragraphs, two heading levels,
lists and task lists, tables, bold, italic and links. Whitespace between blocks
is formatting, not content.
"""

from xml.etree import ElementTree as ET

import pycrdt

from suite import content
from suite.content import checkpoints, copies
from suite.writer.content import APP, EDITOR
from suite.writer.content.files import BODY_FRAGMENT


def fill(node: str, html: str) -> None:
    """Replace the start of `node`'s log with `html`, and its readable copy with the same body."""
    log = content.find(APP, node)
    html_copy = EDITOR.readable_copy
    if log is None or html_copy is None:
        raise RuntimeError(f"Writer collaboration must be on to fill {node!r}")
    checkpoints.replace_start(APP, log.id, body_state(html), EDITOR.schema.version)
    copies.replace_copy(APP, log.id, 1, copies.cleaned(html)[0], html_copy)


def body_state(html: str) -> bytes:
    """Encode `html` as the Yjs state the editor binds to."""
    ydoc: pycrdt.Doc = pycrdt.Doc()
    fragment = ydoc.get(BODY_FRAGMENT, type=pycrdt.XmlFragment)
    _append(fragment, ET.fromstring(f"<doc>{html}</doc>"))
    return ydoc.get_update()


def _append(parent: pycrdt.XmlFragment | pycrdt.XmlElement, source: ET.Element) -> None:
    if source.text:
        _text(parent, source.text, {})
    tags = {
        "p": "paragraph",
        "h1": "heading",
        "h2": "heading",
        "ul": "bulletList",
        "ol": "orderedList",
        "li": "listItem",
        "table": "table",
        "tr": "tableRow",
        "td": "tableCell",
        "th": "tableHeader",
    }
    for child in source:
        if child.tag == "tbody":
            _append(parent, child)
        elif child.tag in ("strong", "em", "a"):
            mark = {"strong": "bold", "em": "italic", "a": "link"}[child.tag]
            attributes = (
                {"href": child.attrib["href"], "target": "_blank", "rel": "noopener noreferrer"}
                if mark == "link"
                else {}
            )
            _text(parent, "".join(child.itertext()), {mark: attributes})
        else:
            tag = child.attrib.get("data-type", tags[child.tag])
            element = parent.children.append(pycrdt.XmlElement(tag))
            if child.tag in ("h1", "h2"):
                element.attributes["level"] = int(child.tag[1])
            if tag == "taskItem":
                element.attributes["checked"] = child.attrib.get("data-checked") == "true"
            _append(element, child)
        if child.tail:
            _text(parent, child.tail, {})


def _text(parent: pycrdt.XmlFragment | pycrdt.XmlElement, value: str, marks: dict) -> None:
    # Formatting whitespace between HTML blocks is not editor content.
    if not value.strip():
        return
    value = (
        (" " if value[0].isspace() else "") + " ".join(value.split()) + (" " if value[-1].isspace() else "")
    )
    last = parent.children[len(parent.children) - 1] if len(parent.children) else None
    text = last if isinstance(last, pycrdt.XmlText) else parent.children.append(pycrdt.XmlText())
    text.insert(len(text), value, marks)
