"""The Drive files a Writer state names, and how a copy renames them.

A picture is an element attribute holding a Drive node id, written either as an embed URL or as a plain
`data-node` attribute. In `html` an attribute is text, so every pattern reads it. In a state an attribute is
a name and a value held apart, and the plain spelling puts the bare id in the value with `data-node` nowhere
in it, so the attribute name is read as well.
"""

import re
from collections.abc import Callable, Iterator, Mapping

import pycrdt

BODY_FRAGMENT = "default"
NODE_ATTRIBUTE = "data-node"
MEDIA_ID = r"[A-Za-z0-9_-]{1,140}"
# The embed URL Writer writes, the old Drive embed URL (`embed_name=`, relative or absolute), both with and
# without the `suite.` prefix the standalone apps used, and the plain node attribute the Drive media route
# uses. `suite.drive.patches.build.writer_bodies` keeps a copy, and the two must change together
MEDIA_PATTERNS = (
    re.compile(rf"(?:suite\.)?writer\.api\.embed\.get\?id=({MEDIA_ID})"),
    re.compile(rf"(?:suite\.)?drive\.api\.embed\.get_file_content\?[^\"'<>\s]*?\bembed_name=({MEDIA_ID})"),
    re.compile(rf'{NODE_ATTRIBUTE}="({MEDIA_ID})"'),
)
BARE_MEDIA_ID = re.compile(MEDIA_ID)


def element_ids(element: pycrdt.XmlElement) -> set[str]:
    """Find the node ids the attributes of one element name."""
    found: set[str] = set()
    # pycrdt types the view's `__iter__` as an Iterable, which mypy will not loop over
    for key, value in element.attributes.__iter__():
        if isinstance(value, str):
            found |= attribute_ids(key, value)

    return found


def node_ids(state: bytes) -> set[str]:
    """Find the node ids the live element attributes of `state` name, never its tombstones."""
    _document, fragment = load(state)
    found: set[str] = set()
    for element in elements(fragment):
        found |= element_ids(element)

    return found


def value_rewriter(mapping: Mapping[str, str]) -> Callable[[str], str]:
    """Make the rewrite for a copy's stored values: a bare id becomes its new id, a URL is rewritten."""

    def rewrite(value: str) -> str:
        if value in mapping:
            return mapping[value]

        return remap_text(value, mapping)

    return rewrite


def load(state: bytes) -> tuple[pycrdt.Doc, pycrdt.XmlFragment]:
    """Load `state` with its body fragment, refusing a root of another type rather than reading it empty."""
    document: pycrdt.Doc = pycrdt.Doc()
    fragment = pycrdt.XmlFragment()
    document[BODY_FRAGMENT] = fragment
    document.apply_update(state)
    if len(fragment.children) != sum(1 for _child in fragment.children):
        raise ValueError("The body is not an XmlFragment")

    return document, fragment


def elements(fragment: pycrdt.XmlFragment) -> Iterator[pycrdt.XmlElement]:
    """Yield every element below `fragment`."""
    stack = list(fragment.children)
    while stack:
        node = stack.pop()
        if isinstance(node, pycrdt.XmlElement):
            yield node
            stack.extend(node.children)


def ids_in(text: str) -> set[str]:
    """Find the node ids the media patterns name in `text`."""
    found: set[str] = set()
    for pattern in MEDIA_PATTERNS:
        for match in pattern.finditer(text):
            found.add(match.group(1))

    return found


def attribute_ids(key: str, value: str) -> set[str]:
    """Find the node ids one attribute names, reading the plain node attribute as a bare id."""
    if key == NODE_ATTRIBUTE and BARE_MEDIA_ID.fullmatch(value):
        return {value}

    return ids_in(value)


def remapped_attribute(key: str, value: str, mapping: Mapping[str, str]) -> str:
    """Rename the pictures one attribute names, as a copy maps them."""
    if key == NODE_ATTRIBUTE:
        return mapping.get(value, value)

    return remap_text(value, mapping)


def remap_text(text: str, mapping: Mapping[str, str]) -> str:
    """Rename the pictures `text` names, as a copy maps them."""

    def swap(match: re.Match) -> str:
        replacement = mapping.get(match.group(1))
        if replacement is None:
            return match.group(0)

        start, end = match.span(1)
        start -= match.start()
        end -= match.start()
        return match.group(0)[:start] + replacement + match.group(0)[end:]

    for pattern in MEDIA_PATTERNS:
        text = pattern.sub(swap, text)

    return text
