"""Writer's readable copy: whether a render holds what a state does, and the render made with no browser."""

import base64
from collections import Counter
from collections.abc import Iterator
from html.parser import HTMLParser

import pycrdt

from suite.content import checker, convert
from suite.writer.content import converter


class LinkTargets(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.targets: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Collect the link and image targets of one start tag."""
        self.targets |= {value for name, value in attrs if name in {"href", "src"} and value}


def read_text(node: pycrdt.XmlText, characters: Counter[str], targets: set[str]) -> None:
    """Count the visible characters of one text node and collect the targets of its links."""
    for run, marks in node.diff():
        if isinstance(run, str):
            characters.update(character for character in run if not character.isspace())

        link = (marks or {}).get("link") or {}
        if link.get("href"):
            targets.add(link["href"])


def is_html_complete(state: bytes, html: str, text: str) -> bool:
    """Check that `text` holds every visible character of `state` and `html` every link and image, or more."""
    doc: pycrdt.Doc = pycrdt.Doc()
    doc.apply_update(state)
    characters: Counter[str] = Counter()
    targets: set[str] = set()
    for node in nodes(doc.get("default", type=pycrdt.XmlFragment)):
        if isinstance(node, pycrdt.XmlText):
            read_text(node, characters, targets)
        elif isinstance(node, pycrdt.XmlElement) and node.attributes.get("src"):
            targets.add(node.attributes["src"])

    parser = LinkTargets()
    parser.feed(html)
    copied = Counter(character for character in text if not character.isspace())
    return not characters - copied and targets <= parser.targets


def render(state: bytes) -> str:
    """Render `state` as its readable copy with the converter, as no browser is there to."""
    legacy = {"content": base64.b64encode(state).decode(), "html": None, "collab": 1, "ycomments": None}
    answer = converter.run(legacy)
    if not isinstance(answer, convert.Refused):
        return answer.html

    # The converter gave no answer, which says nothing of the document
    if answer.reason in {"child_timeout", "child_crash"}:
        raise checker.CheckerFailed(answer.reason)

    raise RuntimeError(f"the converter rendered no copy: {answer.reason}")


def nodes(
    parent: pycrdt.XmlFragment | pycrdt.XmlElement,
) -> Iterator[pycrdt.XmlFragment | pycrdt.XmlElement | pycrdt.XmlText]:
    """Yield every node below `parent`, each before its children."""
    for child in parent.children:
        yield child
        if isinstance(child, pycrdt.XmlElement):
            yield from nodes(child)
