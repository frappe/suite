"""The Drive files a deck's state names, and how a copy renames them.

A picture is a stored value holding a bare Drive node id: an image's `src`, a video's `poster`, a slide's
`background`, or a string anywhere inside one of those. So every value counts, not a list of fields. Nearly
every id-shaped string names no file, and that over-report is the safe side: an unlisted id is a picture
Drive's sweep would trash, while an extra one matches no node.

`node_ids` walks with `content_json`'s `rewrite` hook, which reaches what `value_rewriter` reaches when a
copy is renamed, so what is counted can't drift from what is rewritten.
"""

import re
from collections.abc import Callable, Mapping

import pycrdt

from suite import content
from suite.content import compaction

# A media reference is one whole node id. Node names are opaque hashes, so a colour and a `/files/` URL both
# fail this and a body value is never mistaken for a picture
MEDIA_ID = re.compile(r"[A-Za-z0-9_-]{1,140}")


def node_ids(part_map: Mapping[str, type], state: bytes) -> set[str]:
    """Find the node ids the live values of `state` name; bytes that don't read as a deck raise."""
    found: set[str] = set()

    def note(value: str) -> str:
        if MEDIA_ID.fullmatch(value):
            found.add(value)

        return value

    doc: pycrdt.Doc = compaction.load_doc([state])
    content.content_json(doc, part_map, rewrite=note)
    return found


def value_rewriter(mapping: Mapping[str, str]) -> Callable[[str], str]:
    """Make the rewrite for a copy's stored values: a bare id becomes its new id."""

    def rewrite(value: str) -> str:
        return mapping.get(value, value)

    return rewrite
