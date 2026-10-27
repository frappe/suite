"""An editor for an app with no product code: plain text notes, one Text root."""

import hashlib
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import frappe
import pycrdt

from suite import drive
from suite.content import convert, with_content
from suite.content.conversions import ConversionRefused
from suite.content.editors import Conversion, EditorSpec, HtmlCopy
from suite.content.ingest import EditorSchema


@dataclass(frozen=True)
class OldNote:
    fingerprint: str
    legacy: dict
    modified: datetime


@dataclass(frozen=True)
class CheckedNote:
    html: str
    dropped: list[dict]


def fingerprint_of(html: str | None) -> str:
    return hashlib.sha256((html or "").encode()).hexdigest()


def read_fingerprint(node: str) -> str:
    return fingerprint_of(frappe.db.get_value("Content Layer Note", {"node": node}, "html", order_by=None))


def read_old(node: str, *, lock: bool = False) -> OldNote | None:
    row = frappe.db.get_value(
        "Content Layer Note",
        {"node": node},
        ["html", "modified"],
        as_dict=True,
        for_update=lock,
        order_by=None,
    )
    if row is None:
        return None

    return OldNote(fingerprint_of(row.html), {"html": row.html}, row.modified)


def check(node: str, old: OldNote, converted: convert.Converted) -> CheckedNote:
    if not converted.html and old.legacy["html"]:
        raise ConversionRefused("check", "empty")

    return CheckedNote(converted.html, [])


def fix_up(node: str, old: OldNote, checked: CheckedNote) -> None:
    pass


EDITOR = EditorSpec(
    app="note",
    doctype="Content Layer Note",
    body_field="body",
    part_map={"text": pycrdt.Text},
    schema=EditorSchema(
        1,
        {"text": 1},
        content_refs=frozenset({0, 1, 4}),
        shared_types=frozenset(),
        nodes=frozenset(),
        marks=frozenset(),
    ),
    checker_build=Path(__file__).with_name("note_checker.cjs"),
    readable_copy=HtmlCopy(field="html", is_html_complete=lambda state, html, text: True),
    media=None,
    conversion=Conversion(
        # No such file: the note converts only in tests, with convert.convert stubbed
        build=Path(__file__).with_name("note_converter.cjs"),
        version="1",
        read_old=read_old,
        read_fingerprint=read_fingerprint,
        check=check,
        fix_up=fix_up,
    ),
)


def never_called(*args):
    raise NotImplementedError("The note tests call no Drive callback")


SPEC = with_content(
    drive.ContentTypeSpec(
        doctype="Content Layer Note",
        mime="text/plain",
        node_field="node",
        create_empty=never_called,
        duplicate=never_called,
        export=never_called,
        version_bytes=never_called,
        restore_version=never_called,
        on_purge=never_called,
        used_nodes=never_called,
        remap_media=never_called,
    )
)
