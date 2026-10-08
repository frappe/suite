"""Writer's content adapter: what the content layer needs to know about a Writer document."""

import base64
import gzip
import json
from pathlib import Path

import frappe
import pycrdt

from suite import drive
from suite.suite_core import content
from suite.suite_core.content.adapters import ContentAdapterSpec

ADAPTER = "writer"
# The editor's fragment, and tab labels
ROOTS = {"default": pycrdt.XmlFragment, "meta": pycrdt.Map}
# The Node kernel `bench build` makes, which judges suspect documents with the browsers' Yjs and this schema
KERNEL = Path(__file__).with_name("dist") / "kernel.cjs"
DECLARED = json.loads(Path(__file__).with_name("features.json").read_text())
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


def document_owner(node: str) -> str | None:
    return frappe.db.get_value("Drive Node", node, "owner")


def touch(node: str) -> None:
    drive.touch("Writer Document", frappe.db.get_value("Writer Document", {"node": node}))


SPEC = ContentAdapterSpec(
    name=ADAPTER,
    content_type="Writer Document",
    body_field="content",
    node_field="node",
    roots=ROOTS,
    schema=SCHEMA,
    kernel=KERNEL,
    owner=document_owner,
    touch=touch,
)


def version_payload(read: dict, state: bytes) -> dict:
    """`state` as a `writer-document/2` version. The readable copy is not built yet, so `html` is null."""
    return {
        "schema": "writer-document/2",
        "codec": "yjs1",
        "lineage": read["lineage"],
        "through_rev": read["head_rev"],
        "chain": read["head_chain"].hex(),
        "state": base64.b64encode(gzip.compress(state)).decode("ascii"),
        "html": None,
    }
