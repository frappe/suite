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


def file_values(state: bytes) -> set[str]:
    """The node ids the live element attributes of `state` name, never its tombstones."""
    _document, fragment = load(state)
    found: set[str] = set()
    for element in elements(fragment):
        # pycrdt types the view's `__iter__` as an Iterable, which mypy will not loop over
        for key, value in element.attributes.__iter__():
            if isinstance(value, str):
                found |= attribute_ids(key, value)
    return found


def rewrite_files(mapping: Mapping[str, str]) -> Callable[[str], str]:
    """How a stored value names a copied picture: a bare old id becomes the new id, and an embed URL is rewritten."""
    return lambda value: mapping[value] if value in mapping else remap_text(value, mapping)


def load(state: bytes) -> tuple[pycrdt.Doc, pycrdt.XmlFragment]:
    """`state` with its body fragment. A root written as another type applies cleanly and reads as a
    fragment with no children, so it is refused rather than read as empty."""
    document: pycrdt.Doc = pycrdt.Doc()
    fragment = pycrdt.XmlFragment()
    document[BODY_FRAGMENT] = fragment
    document.apply_update(state)
    if len(fragment.children) != sum(1 for _child in fragment.children):
        raise ValueError("The body is not an XmlFragment")
    return document, fragment


def elements(fragment: pycrdt.XmlFragment) -> Iterator[pycrdt.XmlElement]:
    stack = list(fragment.children)
    while stack:
        node = stack.pop()
        if isinstance(node, pycrdt.XmlElement):
            yield node
            stack.extend(node.children)


def ids_in(text: str) -> set[str]:
    return {match.group(1) for pattern in MEDIA_PATTERNS for match in pattern.finditer(text)}


def attribute_ids(key: str, value: str) -> set[str]:
    if key == NODE_ATTRIBUTE and BARE_MEDIA_ID.fullmatch(value):
        return {value}
    return ids_in(value)


def remapped_attribute(key: str, value: str, mapping: Mapping[str, str]) -> str:
    if key == NODE_ATTRIBUTE:
        return mapping.get(value, value)
    return remap_text(value, mapping)


def remap_text(text: str, mapping: Mapping[str, str]) -> str:
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
