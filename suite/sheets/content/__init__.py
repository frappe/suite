"""Sheets' editor: what the content layer needs to know about a sheet's collab doc.

The doc's layout is frontend/src/apps/sheets/collab/schema.ts; PART_MAP and schema.json name its roots
and must change with it. Collaboration stays off until a site turns it on (`always_on` False), so a
sheet keeps its old save path (`sheets_data`) until then.
"""

import json
from pathlib import Path

import frappe
import pycrdt
from frappe import _

from suite import content
from suite.sheets.content.conversion import (
    CheckedSheet,
    OldSheet,
    check,
    fix_up,
    read_fingerprint,
    read_old,
)
from suite.sheets.content.readable_copy import is_html_complete

APP = "sheets"
# Whether the editor reads and writes the room. Until it does, a sheet turned collaborative would keep
# saving to `sheets_data` while its log and versions held an empty doc, and the switch can't go back
# off once logs exist, so `refuse_turning_on` keeps Sheets off. The editor's wiring sets it True
EDITOR_READY = False
# Every root schema.ts `ROOT` names: `sheets` is the tab order, every other root a map
PART_MAP = {
    "meta": pycrdt.Map,
    "sheets": pycrdt.Array,
    "sheetMeta": pycrdt.Map,
    "rows": pycrdt.Map,
    "cols": pycrdt.Map,
    "inputs": pycrdt.Map,
    "formats": pycrdt.Map,
    "rowFormats": pycrdt.Map,
    "colFormats": pycrdt.Map,
    "charts": pycrdt.Map,
    "pivots": pycrdt.Map,
    "condFormats": pycrdt.Map,
    "validations": pycrdt.Map,
    "comments": pycrdt.Map,
    "slicers": pycrdt.Map,
    "names": pycrdt.Map,
    "sheetState": pycrdt.Map,
    "tails": pycrdt.Map,
}
# The Node checker `bench build` makes, which judges suspect documents with the browsers' Yjs and schema.ts
CHECKER_BUILD = Path(__file__).with_name("dist") / "checker.cjs"
# The Node converter `bench build` makes, which turns an old sheet into a collaborative one
CONVERTER_BUILD = Path(__file__).with_name("dist") / "converter.cjs"
CONVERTER_VERSION = json.loads(Path(__file__).with_name("converter-version.json").read_text())["version"]
DECLARED = json.loads(Path(__file__).with_name("schema.json").read_text())
# The glue writes only GC, deleted, type and any content: ids, inputs and JSON values are `any`, and the
# only nested shared type is each sheet's row and column id list, a Y.Array. `features` declares the
# roots and the one fixed key (`meta.schemaVersion`). Every map root but `meta` is open: its keys are made
# at runtime (sheet, row and column ids, cell keys, item ids, defined names), each fitting
# `suite.content.ingest.OPEN_KEY`
OPEN_ROOTS = frozenset(root for root, kind in PART_MAP.items() if kind is pycrdt.Map) - {"meta"}
SCHEMA = content.EditorSchema(
    DECLARED["schema"],
    DECLARED["features"],
    content_refs=frozenset({0, 1, 7, 8}),
    shared_types=frozenset({0}),
    nodes=frozenset(DECLARED["nodes"]),
    marks=frozenset(DECLARED["marks"]),
    open_roots=OPEN_ROOTS,
)

# Built apart from EDITOR, whose bare `Conversion` would hide the body bounds from mypy
CONVERSION: content.Conversion[OldSheet, CheckedSheet] = content.Conversion(
    build=CONVERTER_BUILD,
    version=CONVERTER_VERSION,
    read_old=read_old,
    read_fingerprint=read_fingerprint,
    check=check,
    fix_up=fix_up,
)


EDITOR = content.EditorSpec(
    app=APP,
    doctype="Sheet",
    body_field="content",
    part_map=PART_MAP,
    schema=SCHEMA,
    checker_build=CHECKER_BUILD,
    readable_copy=content.HtmlCopy(field="html", is_html_complete=is_html_complete),
    media=None,
    always_on=False,
    conversion=CONVERSION,
)


def refuse_turning_on(settings, method=None) -> None:
    """Refuse Suite Collab Settings that switch Sheets on before its editor uses the room."""
    if EDITOR_READY:
        return

    before = settings.get_doc_before_save()
    was_on = before is not None and any(row.app == APP and row.mode == "on" for row in before.apps)
    if not was_on and any(row.app == APP and row.mode == "on" for row in settings.apps):
        frappe.throw(_("Sheets collaboration can be turned on once the Sheets editor uses it"))
