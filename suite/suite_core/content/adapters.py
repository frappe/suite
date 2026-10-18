"""The apps whose documents the content layer keeps, found through the `suite_content_adapters` hook."""

import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path

import frappe

from suite.suite_core.content.ingest import EditorSchema


@dataclass(frozen=True)
class ContentAdapterSpec:
    """One app's plug-in. `name` is also its table prefix; `content_type` is its Drive content type and
    the doctype whose row holds each document's latest checked body, base64, in `body_field`, and its
    checked readable copy in `copy_field`, found by its node in `node_field`; `roots` names every root
    type it writes; `kernel` is the Node bundle that judges suspect documents and checks what trimming
    deletes. `codec` names the update format of its
    state, `max_state` the most a compacted document may hold and `max_change` the most one change may,
    in bytes. `check_copy(state, html, text)` says whether a readable copy a browser rendered holds what
    the state does. `file_values(state)` names the Drive nodes a state uses, and `rewrite_files(mapping)`
    is how a stored value names a copy's nodes instead."""

    name: str
    content_type: str
    body_field: str
    node_field: str
    copy_field: str
    roots: Mapping[str, type]
    schema: EditorSchema
    kernel: Path
    codec: str
    max_state: int
    max_change: int
    check_copy: Callable[[bytes, str, str], bool]
    # The state an old body holds. It decides none of the conversion rules (when, whether for good, what is
    # kept), which wait for the second grill and ticket 29
    convert: Callable[[str], bytes]
    file_values: Callable[[bytes], set[str]]
    rewrite_files: Callable[[Mapping[str, str]], Callable[[str], str]]


@dataclass(frozen=True)
class NodeHooks:
    """What the layer asks about a document's node, the same for every app, given through the
    `suite_content_nodes` hook: `owner` names the node's owner, `touch` records that the body
    of an app's document changed, and `take_version` stores the body as an automatic version."""

    owner: Callable[[str], str | None]
    touch: Callable[[ContentAdapterSpec, str], None]
    take_version: Callable[[ContentAdapterSpec, str], None]


CODECS = frozenset({"yjs1"})
# Short enough that every table name the layer makes from it fits MariaDB's 64 characters
NAME = re.compile(r"[a-z][a-z0-9_]{0,39}")
# The specs this process has checked, by hook path
checked: dict[str, ContentAdapterSpec] = {}


def adapters() -> dict[str, ContentAdapterSpec]:
    found: dict[str, ContentAdapterSpec] = {}
    for path in frappe.get_hooks("suite_content_adapters") or ():
        spec = load(path)
        if spec.name in found:
            raise ValueError(f"Two content adapters are named {spec.name}")

        found[spec.name] = spec

    return found


def load(path: str) -> ContentAdapterSpec:
    try:
        spec = frappe.get_attr(path)
    except TypeError as missing:
        raise ValueError(f"The content adapter {path} is missing a declaration: {missing}") from missing

    if not isinstance(spec, ContentAdapterSpec):
        raise ValueError(f"{path} is not a content adapter")

    if checked.get(path) is spec:
        return spec

    wrong = wrong_declarations(spec)
    if wrong:
        raise ValueError(f"The content adapter {path} ({spec.name}) declares {', '.join(wrong)} wrongly")

    checked[path] = spec
    return spec


def wrong_declarations(spec: ContentAdapterSpec) -> list[str]:
    def text(value: object) -> bool:
        return isinstance(value, str) and bool(value)

    def size(value: object) -> bool:
        return type(value) is int and value > 0

    right = {
        "name": isinstance(spec.name, str) and NAME.fullmatch(spec.name) is not None,
        "content_type": text(spec.content_type),
        "body_field": text(spec.body_field),
        "node_field": text(spec.node_field),
        "copy_field": text(spec.copy_field),
        "roots": isinstance(spec.roots, Mapping)
        and bool(spec.roots)
        and all(text(root) and isinstance(kind, type) for root, kind in spec.roots.items()),
        "schema": isinstance(spec.schema, EditorSchema),
        "kernel": isinstance(spec.kernel, Path),
        "codec": spec.codec in CODECS,
        "max_state": size(spec.max_state),
        "max_change": size(spec.max_change),
        "check_copy": callable(spec.check_copy),
        "convert": callable(spec.convert),
        "file_values": callable(spec.file_values),
        "rewrite_files": callable(spec.rewrite_files),
    }
    return [field for field, ok in right.items() if not ok]


def spec_of(name: str) -> ContentAdapterSpec:
    found = adapters().get(name)
    if found is None:
        raise frappe.DoesNotExistError(f"Unknown content adapter {name}")

    return found


def for_type(content_type: str) -> ContentAdapterSpec | None:
    """The adapter for a Drive content type, or None when no app keeps that type's documents here."""
    return next((spec for spec in adapters().values() if spec.content_type == content_type), None)


def node_hooks() -> NodeHooks:
    paths = list(frappe.get_hooks("suite_content_nodes") or ())
    if len(paths) != 1:
        raise ValueError(f"Expected one suite_content_nodes hook, found {len(paths)}")

    hooks = frappe.get_attr(paths[0])
    if not isinstance(hooks, NodeHooks):
        raise ValueError(f"Invalid content node hooks {paths[0]}")

    return hooks
