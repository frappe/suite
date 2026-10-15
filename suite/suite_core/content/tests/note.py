"""A content adapter for an app with no product code: plain text notes, one Text root."""

import base64
from pathlib import Path

import pycrdt

from suite.suite_core.content.adapters import ContentAdapterSpec
from suite.suite_core.content.ingest import EditorSchema

SPEC = ContentAdapterSpec(
    name="note",
    content_type="Content Layer Note",
    body_field="body",
    node_field="node",
    copy_field="html",
    roots={"text": pycrdt.Text},
    schema=EditorSchema(
        1,
        {"text": 1},
        content_refs=frozenset({0, 1, 4}),
        shared_types=frozenset(),
        nodes=frozenset(),
        marks=frozenset(),
    ),
    kernel=Path(__file__).with_name("note_kernel.cjs"),
    codec="yjs1",
    max_state=2**20,
    max_change=2**16,
    check_copy=lambda state, html, text: True,
    convert=base64.b64decode,
    file_values=lambda state: set(),
    rewrite_files=lambda mapping: lambda value: value,
)
