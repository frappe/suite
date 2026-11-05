"""Slides' editor: what the content layer needs to know about a deck's collab doc.

The doc's layout is frontend/src/apps/slides/collab/deck.ts; PART_MAP and schema.json name its roots and
must change with it. Collaboration stays off until ticket 57: with no log every callback falls through to
the deck's rows.
"""

import json
import uuid
from pathlib import Path

import pycrdt

from suite import content
from suite.slides.content import files

APP = "slides"
# `slides` and `boxes` hold one fixed-shape Y.Map per item, keyed by the item's id
PART_MAP = {"slides": pycrdt.Map, "boxes": pycrdt.Map}
# The Node checker `bench build` makes, which judges suspect documents with the browsers' Yjs and deck.ts
CHECKER_BUILD = Path(__file__).with_name("dist") / "checker.cjs"
DECLARED = json.loads(Path(__file__).with_name("schema.json").read_text())
# deck.ts writes GC, deleted, string, format, type and any content: each item is a Y.Map and each text
# body a Y.XmlFragment of TipTap's nodes, never a Y.Array or Y.Text. `features` declares the roots, the
# items' fields and the editor's names. Both roots are open: their keys are the items' random ids, each
# fitting `suite.content.ingest.OPEN_KEY`
# Opening a root loosens the push key check, so a new root is opened here by name, never by default
OPEN_ROOTS = frozenset({"slides", "boxes"})
SCHEMA = content.EditorSchema(
    DECLARED["schema"],
    DECLARED["features"],
    content_refs=frozenset({0, 1, 4, 6, 7, 8}),
    shared_types=frozenset({1, 3, 4, 6}),
    nodes=frozenset(DECLARED["nodes"]),
    marks=frozenset(DECLARED["marks"]),
    open_roots=OPEN_ROOTS,
)

# The place deck.ts gives a deck's first slide, so a later insert sorts around it
FIRST_ORDER = "V"


def blank_state() -> bytes:
    """Encode a new deck: one blank slide under a fresh random id, as a tab adding one would write it."""
    doc: pycrdt.Doc = pycrdt.Doc()
    slide = pycrdt.Map()
    slides = pycrdt.Map()
    doc["slides"] = slides
    doc["boxes"] = pycrdt.Map()
    slides[str(uuid.uuid4())] = slide
    slide["order"] = FIRST_ORDER
    return doc.get_update()


EDITOR = content.EditorSpec(
    app=APP,
    doctype="Presentation",
    body_field="content",
    part_map=PART_MAP,
    schema=SCHEMA,
    checker_build=CHECKER_BUILD,
    readable_copy=None,
    media=content.MediaReferences(
        node_ids=lambda state: files.node_ids(PART_MAP, state), value_rewriter=files.value_rewriter
    ),
    always_on=False,
    conversion=None,
)
