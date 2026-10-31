"""Writer's editor: what the content layer needs to know about a Writer document."""

import json
from pathlib import Path

import pycrdt

from suite import content
from suite.content.log import set_mode
from suite.writer.content.conversion import (
    CheckedDocument,
    OldDocument,
    check,
    fix_up,
    read_fingerprint,
    read_old,
)
from suite.writer.content.files import node_ids, value_rewriter
from suite.writer.content.readable_copy import is_html_complete

APP = "writer"
# The editor's fragment, and tab labels
PART_MAP = {"default": pycrdt.XmlFragment, "meta": pycrdt.Map}
# The Node checker `bench build` makes, which judges suspect documents with the browsers' Yjs and this schema
CHECKER_BUILD = Path(__file__).with_name("dist") / "checker.cjs"
# The Node converter `bench build` makes, which turns an old document into a collaborative one
CONVERTER_BUILD = Path(__file__).with_name("dist") / "converter.cjs"
CONVERTER_VERSION = json.loads(Path(__file__).with_name("converter-version.json").read_text())["version"]
DECLARED = json.loads(Path(__file__).with_name("schema.json").read_text())
# y-prosemirror writes only GC, deleted, string, format, type and any content, and only XmlElement and
# XmlText shared types. `meta` holds only plain values; if it ever nests a Map, Array or Text,
# `shared_types` must change in the same commit
SCHEMA = content.EditorSchema(
    DECLARED["schema"],
    DECLARED["features"],
    content_refs=frozenset({0, 1, 4, 6, 7, 8}),
    shared_types=frozenset({3, 6}),
    nodes=frozenset(DECLARED["nodes"]),
    marks=frozenset(DECLARED["marks"]),
)

# Built apart from EDITOR, whose bare `Conversion` would hide the body bounds from mypy
CONVERSION: content.Conversion[OldDocument, CheckedDocument] = content.Conversion(
    build=CONVERTER_BUILD,
    version=CONVERTER_VERSION,
    read_old=read_old,
    read_fingerprint=read_fingerprint,
    check=check,
    fix_up=fix_up,
)


EDITOR = content.EditorSpec(
    app=APP,
    doctype="Writer Document",
    body_field="content",
    part_map=PART_MAP,
    schema=SCHEMA,
    checker_build=CHECKER_BUILD,
    readable_copy=content.HtmlCopy(field="html", is_html_complete=is_html_complete),
    media=content.MediaReferences(node_ids=node_ids, value_rewriter=value_rewriter),
    always_on=True,
    conversion=CONVERSION,
)


def turn_on() -> None:
    """Turn Writer's collaboration on, which it then stays."""
    set_mode(APP, "on")
