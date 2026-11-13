"""Slides' editor: what the content layer needs to know about a deck's collab doc.

The doc's layout is frontend/src/apps/slides/collab/deck.ts; PART_MAP and schema.json name its roots and
must change with it. Collaboration is turned on at install and migrate and stays on (Q15'). A deck with no
log yet is read from its rows until it converts.
"""

import json
import uuid
from pathlib import Path

import pycrdt

from suite import content
from suite.content.log import set_mode
from suite.slides.content import files
from suite.slides.content.conversion import (
    CheckedDeck,
    OldDeck,
    check,
    fix_up,
    read_fingerprint,
    read_old,
)

APP = "slides"
# `slides` and `elements` hold one fixed-shape Y.Map per item, keyed by the item's id
PART_MAP = {"slides": pycrdt.Map, "elements": pycrdt.Map}
# The Node checker `bench build` makes, which judges suspect documents with the browsers' Yjs and deck.ts
CHECKER_BUILD = Path(__file__).with_name("dist") / "checker.cjs"
# The Node converter `bench build` makes, which turns an old deck into a collaborative one
CONVERTER_BUILD = Path(__file__).with_name("dist") / "converter.cjs"
CONVERTER_VERSION = json.loads(Path(__file__).with_name("converter-version.json").read_text())["version"]
DECLARED = json.loads(Path(__file__).with_name("schema.json").read_text())
# deck.ts writes GC, deleted, string, format, type and any content: each item is a Y.Map and each text
# body a Y.XmlFragment of TipTap's nodes, never a Y.Array or Y.Text. `features` declares the roots, the
# items' fields and the editor's names. Both roots are open: their keys are the items' random ids, each
# fitting `suite.content.ingest.OPEN_KEY`
# Opening a root loosens the push key check, so a new root is opened here by name, never by default
OPEN_ROOTS = frozenset({"slides", "elements"})
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
    doc["elements"] = pycrdt.Map()
    slides[str(uuid.uuid4())] = slide
    slide["order"] = FIRST_ORDER
    return doc.get_update()


# Built apart from EDITOR, whose bare `Conversion` would hide the body bounds from mypy
CONVERSION: content.Conversion[OldDeck, CheckedDeck] = content.Conversion(
    build=CONVERTER_BUILD,
    version=CONVERTER_VERSION,
    read_old=read_old,
    read_fingerprint=read_fingerprint,
    check=check,
    fix_up=fix_up,
    # A combined deck has no slides of its own and never converts (Q154)
    excluded={"is_composite": 1},
)

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
    always_on=True,
    conversion=CONVERSION,
)


def turn_on() -> None:
    """Turn Slides' collaboration on, which it then stays."""
    set_mode(APP, "on")
