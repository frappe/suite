"""The apps whose documents the content layer keeps, found through the `suite_content_adapters` hook."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path

import frappe

from suite.suite_core.content.ingest import EditorSchema


@dataclass(frozen=True)
class ContentAdapterSpec:
    """One app's plug-in. `name` is also its table prefix; `content_type` is its Drive content type;
    `roots` names every root type it writes; `kernel` is the Node bundle that judges suspect documents;
    `owner` names a document's owner from its node."""

    name: str
    content_type: str
    roots: Mapping[str, type]
    schema: EditorSchema
    kernel: Path
    owner: Callable[[str], str | None]


def adapters() -> dict[str, ContentAdapterSpec]:
    found: dict[str, ContentAdapterSpec] = {}
    for path in frappe.get_hooks("suite_content_adapters") or ():
        spec = frappe.get_attr(path)
        if not isinstance(spec, ContentAdapterSpec) or spec.name in found:
            raise ValueError(f"Invalid content adapter {path}")
        found[spec.name] = spec
    return found


def spec_of(name: str) -> ContentAdapterSpec:
    found = adapters().get(name)
    if found is None:
        raise frappe.DoesNotExistError(f"Unknown content adapter {name}")
    return found


def for_type(content_type: str) -> ContentAdapterSpec | None:
    """The adapter for a Drive content type, or None when no app keeps that type's documents here."""
    return next((spec for spec in adapters().values() if spec.content_type == content_type), None)
