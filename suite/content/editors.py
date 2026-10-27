"""The apps whose documents the content layer keeps, found through the `suite_content_editors` hook."""

import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

import frappe

from suite import drive
from suite.content.ingest import EditorSchema

if TYPE_CHECKING:
    # convert.py imports this module
    from suite.content.convert import Converted


class ReadableCopy(Protocol):
    """The readable copy of each document, as rows the app keeps by key."""

    def is_html_complete(self, state: bytes, html: str, text: str) -> bool:
        """Whether a copy a browser rendered holds what the state does."""

    def read(self, doctype: str, docname: str) -> Mapping[str, str]:
        """Answer the rows the copy holds now; called under the app row lock, so a plain SELECT is enough."""

    def write(self, doctype: str, docname: str, changed: Mapping[str, str | None]) -> None:
        """Write only the `changed` rows, None removing a row."""

    def serialized(self, rows: Mapping[str, str]) -> str:
        """Answer the string hashed and kept as evidence; several rows as JSON, sorted keys, `(",", ":")`."""

    def rows(self, html: str) -> Mapping[str, str]:
        """Make a checked render into the copy's rows."""

    def html(self, rows: Mapping[str, str]) -> str:
        """Answer the copy as HTML."""


@dataclass(frozen=True)
class HtmlCopy:
    """A readable copy of one row, the HTML in the app's row in `field`."""

    field: str
    is_html_complete: Callable[[bytes, str, str], bool]

    def read(self, doctype: str, docname: str) -> Mapping[str, str]:
        """Answer the field as the copy's one row, or no row when it is empty."""
        found = frappe.db.sql(f"SELECT `{self.field}` FROM `tab{doctype}` WHERE `name` = %s", docname)
        if not found or not found[0][0]:
            return {}

        return {self.field: found[0][0]}

    def write(self, doctype: str, docname: str, changed: Mapping[str, str | None]) -> None:
        """Write the field, emptied when its row is removed."""
        frappe.db.sql(
            f"UPDATE `tab{doctype}` SET `{self.field}` = %s WHERE `name` = %s",
            (changed[self.field] or "", docname),
        )

    def serialized(self, rows: Mapping[str, str]) -> str:
        """Answer the field's HTML."""
        return rows.get(self.field, "")

    def rows(self, html: str) -> Mapping[str, str]:
        """Make the render the field's one row."""
        return {self.field: html}

    def html(self, rows: Mapping[str, str]) -> str:
        """Answer the field's HTML."""
        return rows.get(self.field, "")


@dataclass(frozen=True)
class MediaReferences:
    """The Drive files a document uses: `node_ids(state)` names their nodes, and `value_rewriter(mapping)` is
    how a stored value names a copy's nodes instead."""

    node_ids: Callable[[bytes], set[str]]
    value_rewriter: Callable[[Mapping[str, str]], Callable[[str], str]]


class OldBody(Protocol):
    @property
    def fingerprint(self) -> str:
        """Answer the hash of the old body, so a changed body is converted again."""

    @property
    def legacy(self) -> dict:
        """Answer the old body as the converter's input."""

    @property
    def modified(self) -> datetime:
        """Answer the newest `modified` of the node's rows."""


class CheckedBody(Protocol):
    @property
    def html(self) -> str:
        """Answer the readable copy to install."""

    @property
    def dropped(self) -> list[dict]:
        """Answer what the conversion dropped, one entry each."""


class OldReader[Old: OldBody](Protocol):
    def __call__(self, node: str, *, lock: bool = False) -> Old | None:
        """Answer `node`'s old body, its row locked when `lock`, or None once it is gone."""


@dataclass(frozen=True)
class Conversion[Old: OldBody, Checked: CheckedBody]:
    """How an app's old documents become collaborative: `build` is the Node converter, which holds
    `version`; `read_old(node, lock=False)` answers the old body, with its `fingerprint`, the newest `modified` of
    the node's rows and the converter's input `legacy`, or None once it is gone; `read_fingerprint(node)` answers that `fingerprint` from the row
    alone, with no access check; `check(node, old, converted)` refuses with ConversionRefused
    before anything writes, or answers the copy's `html` and what it `dropped`; `fix_up(node, old, checked)`
    writes the app's own rows in the conversion's transaction."""

    build: Path
    version: str
    read_old: OldReader[Old]
    read_fingerprint: Callable[[str], str]
    check: Callable[[str, Old, Converted], Checked]
    fix_up: Callable[[str, Old, Checked], None]


@dataclass(frozen=True)
class EditorSpec:
    """One app's plug-in. `app` is also its table prefix; `doctype` is its Drive content type and the
    doctype whose row holds each document's latest checked body, base64, in `body_field`; `part_map` names
    every root type it writes; `checker_build` is the Node bundle that judges suspect documents and checks
    what trimming deletes. `readable_copy` and `media` are None for an app whose documents keep no HTML
    copy or use no Drive files. `always_on` keeps the app's collaboration from being turned off.
    `conversion` is None for an app with no old documents to convert."""

    app: str
    doctype: str
    body_field: str
    part_map: Mapping[str, type]
    schema: EditorSchema
    checker_build: Path
    readable_copy: ReadableCopy | None
    media: MediaReferences | None
    always_on: bool = False
    conversion: Conversion | None = None


# Short enough that every table name the layer makes from it fits MariaDB's 64 characters
NAME = re.compile(r"[a-z][a-z0-9_]{0,39}")
# The specs this process has checked, by hook path
checked: dict[str, EditorSpec] = {}
# The Drive content types `with_content` has wrapped in this process
wrapped: set[str] = set()


def editors() -> dict[str, EditorSpec]:
    """Load every editor the apps declare, by app, refusing two for one app."""
    found: dict[str, EditorSpec] = {}
    for path in frappe.get_hooks("suite_content_editors") or ():
        spec = load(path)
        if spec.app in found:
            raise ValueError(f"Two editors are for the app {spec.app}")

        found[spec.app] = spec

    return found


def load(path: str) -> EditorSpec:
    """Load and check the editor declared at a hook path, once per process."""
    try:
        spec = frappe.get_attr(path)
    except TypeError as missing:
        raise ValueError(f"The editor {path} is missing a declaration: {missing}") from missing

    if not isinstance(spec, EditorSpec):
        raise ValueError(f"{path} is not an editor")

    if checked.get(path) is spec:
        return spec

    wrong = wrong_declarations(spec)
    if wrong:
        wrong_names = ", ".join(wrong)
        raise ValueError(f"The editor {path} ({spec.app}) declares {wrong_names} wrongly")

    # node_field imports the app's spec, which registers it in wrapped
    drive.node_field(spec.doctype)
    if spec.doctype not in wrapped:
        raise ValueError(
            f"The editor {path} ({spec.app}) names a Drive content type not wrapped with_content"
        )

    checked[path] = spec
    return spec


def wrong_declarations(spec: EditorSpec) -> list[str]:
    """List the fields of an editor's declaration that are missing or of the wrong kind."""

    def text(value: object) -> bool:
        return isinstance(value, str) and bool(value)

    def copy_right(copy: object) -> bool:
        if isinstance(copy, HtmlCopy):
            return text(copy.field) and callable(copy.is_html_complete)

        names = ("is_html_complete", "read", "write", "serialized", "rows", "html")
        return copy is None or all(callable(getattr(copy, name, None)) for name in names)

    def media_right(media: object) -> bool:
        return media is None or (
            isinstance(media, MediaReferences) and callable(media.node_ids) and callable(media.value_rewriter)
        )

    right = {
        "app": isinstance(spec.app, str) and NAME.fullmatch(spec.app) is not None,
        "doctype": text(spec.doctype),
        "body_field": text(spec.body_field),
        "part_map": isinstance(spec.part_map, Mapping)
        and bool(spec.part_map)
        and all(text(root) and isinstance(kind, type) for root, kind in spec.part_map.items()),
        "schema": isinstance(spec.schema, EditorSchema),
        "checker_build": isinstance(spec.checker_build, Path),
        "readable_copy": copy_right(spec.readable_copy),
        "media": media_right(spec.media),
        "conversion": conversion_right(spec.conversion),
    }
    return [field for field, ok in right.items() if not ok]


def conversion_right(conversion: object) -> bool:
    """Whether an editor's `conversion` is None or a whole Conversion."""
    return conversion is None or (
        isinstance(conversion, Conversion)
        and isinstance(conversion.build, Path)
        and isinstance(conversion.version, str)
        and bool(conversion.version)
        and callable(conversion.read_old)
        and callable(conversion.read_fingerprint)
        and callable(conversion.check)
        and callable(conversion.fix_up)
    )


def spec_of(app: str) -> EditorSpec:
    """Answer the app's editor, refused as missing when no editor is for it."""
    found = editors().get(app)
    if found is None:
        raise frappe.DoesNotExistError(f"No editor for the app {app}")

    return found


def for_type(content_type: str | None) -> EditorSpec | None:
    """Answer the editor for a Drive content type, or None when no app keeps that type's documents here."""
    return next((spec for spec in editors().values() if spec.doctype == content_type), None)
