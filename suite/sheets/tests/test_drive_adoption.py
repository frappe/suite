# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt
"""Sheets' adoption of the Drive content contract (ticket 19, §6.7, §10.7, §14.6).

Adoption is an expand phase, not a switch. Sheets declares its `ContentTypeSpec`
and `Sheet` gains the `node` Link, but `suite/hooks.py` leaves
`drive_content_types` empty and keeps every `Sheet` permission entry on
`suite.sheets.permissions`. Build links the rows and ticket 29 makes the
registry and the hook changes together.

So the classes here split along that seam:

`TestSheetsDeclaration`   the declaration itself, and the proof that the hooks
                          are dormant. No rows and no database.
`TestSheetsWorkbook`      the xlsx importer, the version envelope, and the media
                          scan, exercised as the pure functions they are.
`TestSheetsBeforeActivation`
                          what a site running this commit does: legacy sheets
                          keep working, and every legacy path refuses a sheet
                          Build has linked.
`TestSheetsInDrive`       the Drive-native lifecycle, versions, purge, media,
                          and satellites, under `activated()`.

`activated()` injects the registry and the hook targets rather than shipping
them, so nothing here depends on the site being activated and nothing here
activates it.

The first two classes are plain `unittest.TestCase`: they mock `frappe.db` where
they need it and run without a site. The last two need real rows.
"""

from __future__ import annotations

import dataclasses
import datetime
import io
import json
import pathlib
import unittest
import zipfile
from contextlib import contextmanager
from unittest import mock

import frappe
from frappe.tests import IntegrationTestCase

from suite import drive
from suite import hooks as suite_hooks
from suite.drive._core.access import grant
from suite.drive._core.content import clear_registry_cache, governs, spec_for
from suite.drive._core.errors import DriveConflict, DriveForbidden, DriveNotFound
from suite.drive._core.nodes import create_file, create_folder, purge, update
from suite.drive._core.principals import Principals
from suite.drive._core.roots import create_root, purge_root, update_root
from suite.drive._core.versions import restore_version
from suite.drive.framework import satellite_has_permission, satellite_query_conditions
from suite.sheets import drive as sheets
from suite.sheets.doctype.sheet.storage import decode_sheets_data, encode_sheets_data
from suite.tests.utils import ensure_user

USER = "sheets-adoption-user@example.com"
OTHER = "sheets-adoption-other@example.com"

DOCTYPE = "Sheet"
OP_LOG = "Sheet Op Log"
COLLAB_STATE = "Sheet Collab State"

# The entries ticket 29 installs together, once Build has linked every `Sheet`
# row. `suite/hooks.py` carries none of them yet.
ACTIVATION = {
    "drive_content_types": ["suite.sheets.drive.SPEC"],
    "has_permission": {
        DOCTYPE: ["suite.drive.framework.doc_has_permission"],
        OP_LOG: ["suite.drive.framework.satellite_has_permission"],
        COLLAB_STATE: ["suite.drive.framework.satellite_has_permission"],
    },
    "permission_query_conditions": {
        DOCTYPE: ["suite.drive.framework.doc_query_conditions"],
        OP_LOG: ["suite.drive.framework.satellite_query_conditions"],
        COLLAB_STATE: ["suite.drive.framework.satellite_query_conditions"],
    },
}


@contextmanager
def activated():
    """Register Sheets for the block, exactly the way ticket 29 will register it.

    The registry is built from `drive_content_types` and the framework reads
    both permission hooks from the same hook map, so injecting the map is the
    whole activation. Nothing is written and nothing survives the block.
    """
    real_get_hooks = frappe.get_hooks

    # `hook`, not `key`: frappe's own signature is `get_hooks(hook=None, ...)`
    # and three framework call sites pass it by keyword.
    def hooks(hook=None, *args, **kwargs):
        if hook == "drive_content_types":
            return list(ACTIVATION[hook])
        if hook in ("has_permission", "permission_query_conditions"):
            wired = dict(real_get_hooks(hook, *args, **kwargs) or {})
            wired.update({name: list(paths) for name, paths in ACTIVATION[hook].items()})
            return wired
        return real_get_hooks(hook, *args, **kwargs)

    clear_registry_cache()
    try:
        with patch_hooks(hooks):
            yield
    finally:
        clear_registry_cache()


def patch_hooks(hooks):
    return mock.patch("frappe.get_hooks", hooks)


# ── xlsx fixtures ────────────────────────────────────────────────────────────


def workbook_bytes(build) -> bytes:
    """Render one openpyxl workbook `build` filled in, as xlsx bytes."""
    from openpyxl import Workbook

    book = Workbook()
    build(book)
    output = io.BytesIO()
    book.save(output)
    return output.getvalue()


def sheet_doctype_json() -> dict:
    """The shipped `Sheet` DocType JSON, read from disk rather than a site."""
    path = pathlib.Path(sheets.__file__).parent / "doctype" / "sheet" / "sheet.json"
    return json.loads(path.read_text())


def _doc_perm(role: str) -> dict:
    for row in sheet_doctype_json()["permissions"]:
        if row.get("role") == role:
            return row
    raise AssertionError(f"no DocPerm row for role {role}")


def simple_workbook() -> bytes:
    def build(book):
        sheet = book.active
        sheet.title = "Data"
        sheet["A1"] = "Name"
        sheet["B1"] = "Amount"
        sheet["A2"] = "Widget"
        sheet["B2"] = 42.0
        sheet["B3"] = "=SUM(B2:B2)"

    return workbook_bytes(build)


def respliced_workbook(**parts: bytes) -> bytes:
    """A real xlsx package with named members replaced verbatim.

    openpyxl writes a valid package; this swaps one part for a hostile one, so
    every test below starts from a file Excel would open.
    """
    book = workbook_bytes(lambda book: book.active.__setitem__("A1", "x"))
    source = zipfile.ZipFile(io.BytesIO(book))
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as package:
        for item in source.namelist():
            package.writestr(item, parts.get(item, source.read(item)))
    return output.getvalue()


def _reordered_tabs(raw: bytes, order: list[str]) -> bytes:
    """Rewrite `xl/workbook.xml` so the tab order differs from the part order.

    Excel does this whenever a tab is dragged: the `<sheet>` elements move and
    `sheet1.xml` stays where it is.
    """
    from xml.etree import ElementTree

    namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    ElementTree.register_namespace("", namespace)
    source = zipfile.ZipFile(io.BytesIO(raw))
    tree = ElementTree.fromstring(source.read("xl/workbook.xml"))
    sheets_element = tree.find(f"{{{namespace}}}sheets")
    by_name = {element.get("name"): element for element in list(sheets_element)}
    for element in list(sheets_element):
        sheets_element.remove(element)
    for name in order:
        sheets_element.append(by_name[name])
    rewritten = ElementTree.tostring(tree, encoding="UTF-8", xml_declaration=True)

    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as package:
        for item in source.namelist():
            package.writestr(item, rewritten if item == "xl/workbook.xml" else source.read(item))
    return output.getvalue()


def worksheet_xml(body: str) -> bytes:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"{body}</worksheet>"
    ).encode()


# ── the declaration ──────────────────────────────────────────────────────────


class TestSheetsDeclaration(unittest.TestCase):
    """What §10.7 fixes about Sheets, and the proof nothing is switched on."""

    def test_it_declares_the_identity_section_ten_seven_fixes(self):
        self.assertEqual(sheets.SPEC.doctype, DOCTYPE)
        self.assertEqual(sheets.SPEC.mime, "frappe/sheet")
        self.assertEqual(sheets.SPEC.node_field, "node")

    def test_a_sheet_has_no_default_export_and_no_export_at_all(self):
        """§10.7: Sheets stays hidden over WebDAV for this release."""
        self.assertIsNone(sheets.SPEC.default_export)
        self.assertIsNone(sheets.SPEC.export)
        self.assertEqual(sheets.SPEC.export_formats, ())

    def test_drive_never_renders_a_sheet_and_sheets_never_pushes_one(self):
        self.assertFalse(sheets.SPEC.pushes_preview)

    def test_the_three_required_callbacks_are_declared(self):
        self.assertIs(sheets.SPEC.create_empty, sheets.create_empty)
        self.assertIs(sheets.SPEC.duplicate, sheets.duplicate)
        self.assertIs(sheets.SPEC.on_purge, sheets.on_purge)

    def test_an_xlsx_can_become_a_sheet(self):
        self.assertIs(sheets.SPEC.import_from_file, sheets.import_from_file)

    def test_a_sheet_has_versions_it_can_be_restored_from(self):
        self.assertIs(sheets.SPEC.version_bytes, sheets.version_bytes)
        self.assertIs(sheets.SPEC.restore_version, sheets.restore_version)

    def test_the_two_satellites_are_the_op_log_and_the_collaborative_document(self):
        self.assertEqual(
            [(one.doctype, one.link_field) for one in sheets.SPEC.satellites],
            [(OP_LOG, "sheet"), (COLLAB_STATE, "sheet")],
        )

    def test_sheet_snapshot_is_not_a_satellite_because_build_still_reads_it(self):
        """§14.6 migrates its rows into `Drive Node Version` (§14.10 drops it)."""
        self.assertNotIn("Sheet Snapshot", [one.doctype for one in sheets.SPEC.satellites])

    def test_the_media_sweep_can_ask_what_a_body_names(self):
        self.assertIs(sheets.SPEC.used_nodes, sheets.used_nodes)

    def test_no_remap_media_because_a_body_names_no_media_yet(self):
        """Declaring a no-op would let a copy carry media nothing names (§8.9)."""
        self.assertIsNone(sheets.SPEC.remap_media)

    def test_the_four_cleanup_pending_columns_are_declared(self):
        self.assertEqual(
            sheets.SPEC.legacy_fields, ("title", "trashed", "trashed_on", "trashed_by")
        )

    def test_head_snapshot_needs_no_exemption_because_ten_two_allows_it(self):
        from suite.drive._core.content import FORBIDDEN_FIELD_NAMES

        self.assertNotIn("head_snapshot", FORBIDDEN_FIELD_NAMES)

    # the `All` DocPerm, which the guards deny against

    def test_the_open_baseline_row_still_carries_every_legacy_right(self):
        """§10.4 needs the row open; it does not need it narrower than before.

        A Frappe permission hook can only deny, so `sheet_has_permission` is
        what puts the owner rule back. A right this row drops is a right the
        hook can never return: `share_sheet` asks `ptype="share"` and
        `frappe.share.check_share_permission` asks it again
        (`frappe/share.py:239`), so dropping `share` here refuses the owner of
        a legacy sheet, which ticket 23 still owns.
        """
        baseline = _doc_perm("All")
        for right in ("read", "write", "create", "delete", "share", "export", "print", "email", "report"):
            self.assertEqual(baseline.get(right), 1, f"the `All` row must keep `{right}`")

    def test_the_open_baseline_row_no_longer_restricts_itself_to_the_owner(self):
        self.assertNotIn("if_owner", _doc_perm("All"))

    def test_guest_reads_only_through_a_link_grant(self):
        guest = _doc_perm("Guest")
        self.assertEqual(guest.get("read"), 1)
        for right in ("write", "create", "delete", "share"):
            self.assertNotIn(right, guest)

    # the hooks stay dormant until ticket 29

    # Read from `suite.hooks` rather than `frappe.get_hooks`: the module is what
    # the site ships, and reading it directly means these assertions hold with
    # no site bound.

    def test_the_registry_is_still_empty(self):
        self.assertEqual(suite_hooks.drive_content_types, [])

    def test_both_sheet_permission_hooks_are_still_the_app_s_own(self):
        self.assertEqual(
            suite_hooks.has_permission[DOCTYPE],
            "suite.sheets.permissions.sheet_has_permission",
        )
        self.assertEqual(
            suite_hooks.permission_query_conditions[DOCTYPE],
            "suite.sheets.permissions.sheet_query_conditions",
        )

    def test_neither_satellite_is_wired_to_the_framework_yet(self):
        self.assertNotIn(COLLAB_STATE, suite_hooks.has_permission)
        self.assertEqual(
            suite_hooks.has_permission[OP_LOG],
            "suite.sheets.permissions.sheet_op_log_has_permission",
        )

    def test_activation_registers_exactly_this_declaration(self):
        with activated():
            self.assertTrue(governs(DOCTYPE))
            self.assertIs(spec_for(DOCTYPE), sheets.SPEC)
        self.assertFalse(governs(DOCTYPE))

    def test_the_declaration_is_frozen_so_nothing_can_edit_it_at_runtime(self):
        with self.assertRaises(dataclasses.FrozenInstanceError):
            sheets.SPEC.default_export = "xlsx"


# ── the body, as pure functions ──────────────────────────────────────────────


class TestSheetsWorkbook(unittest.TestCase):
    """The importer, the version envelope, and the media scan. No database."""

    def _frappe(self, **db):
        """Replace `suite.sheets.drive.frappe` — nothing here reads a row.

        `frappe.db` is an unbound proxy outside a request, so the module's own
        reference is what gets replaced, exactly as the other Sheets unit tests
        do it.
        """
        patcher = mock.patch("suite.sheets.drive.frappe")
        patched = patcher.start()
        self.addCleanup(patcher.stop)
        patched.ValidationError = ValueError
        patched.DoesNotExistError = LookupError
        patched.throw.side_effect = lambda msg, exc=Exception: (_ for _ in ()).throw(exc(msg))
        for name, value in db.items():
            getattr(patched.db, name).return_value = value
        return patched

    # the version envelope

    def test_version_bytes_carries_the_workbook_and_the_head_seq(self):
        self._frappe(get_value=frappe._dict(sheets_data=None, head_seq=7))
        stream, mime = sheets.version_bytes("SH-1")
        self.assertEqual(mime, "application/json")
        payload = json.loads(stream.read())
        self.assertEqual(payload["schema"], "sheet/1")
        self.assertEqual(payload["head_seq"], 7)
        self.assertEqual(payload["sheets_data"], "{}")

    def test_version_bytes_decodes_the_stored_envelope(self):
        stored = encode_sheets_data(json.dumps({"sheet": {"v": 2}}))
        self._frappe(get_value=frappe._dict(sheets_data=stored, head_seq=1))
        stream, _mime = sheets.version_bytes("SH-1")
        payload = json.loads(stream.read())
        self.assertEqual(json.loads(payload["sheets_data"]), {"sheet": {"v": 2}})

    def test_a_payload_that_is_not_a_sheet_envelope_is_refused_whole(self):
        """A truncated workbook would read as an empty one, so it is refused."""
        self._frappe()
        for raw in (
            b"",
            b"not json",
            json.dumps({"sheets_data": "{}"}).encode(),
            json.dumps({"schema": "deck/1", "sheets_data": "{}"}).encode(),
        ):
            with self.subTest(raw=raw), self.assertRaises(Exception):
                sheets._version_payload(raw)

    def test_a_payload_whose_workbook_is_not_json_is_refused(self):
        self._frappe()
        raw = json.dumps({"schema": "sheet/1", "sheets_data": "{oops"}).encode()
        with self.assertRaises(Exception):
            sheets._version_payload(raw)

    def test_a_valid_payload_survives_the_round_trip(self):
        self._frappe()
        raw = json.dumps({"schema": "sheet/1", "sheets_data": '{"a":1}', "head_seq": 3}).encode()
        self.assertEqual(
            sheets._version_payload(raw), {"sheets_data": '{"a":1}', "head_seq": 3}
        )

    def test_a_missing_head_seq_reads_as_zero_rather_than_failing(self):
        self._frappe()
        raw = json.dumps({"schema": "sheet/1", "sheets_data": "{}"}).encode()
        self.assertEqual(sheets._version_payload(raw)["head_seq"], 0)

    # the media scan

    def _used(self, body: dict | str) -> set[str]:
        stored = encode_sheets_data(body if isinstance(body, str) else json.dumps(body))
        self._frappe(get_value=stored)
        return sheets.used_nodes("SH-1")

    def test_it_reports_every_id_shaped_token_at_every_depth(self):
        found = self._used(
            {"sheet": {"sheets": {"Data": {"rows": {"0": ["nodeone", {"src": "nodetwo"}]}}}}}
        )
        self.assertIn("nodeone", found)
        self.assertIn("nodetwo", found)

    def test_it_over_reports_rather_than_letting_the_sweep_trash_live_media(self):
        """§10.6 trashes what the app does not report, so a plain word costs nothing."""
        self.assertIn("total", self._used({"sheet": {"sheets": {"Data": {"rows": {"0": ["total"]}}}}}))

    def test_a_token_no_node_id_can_be_is_not_reported(self):
        found = self._used({"cells": ["=SUM(A1:A2)", "https://example.com/x", "a b", ""]})
        self.assertNotIn("=SUM(A1:A2)", found)
        self.assertNotIn("https://example.com/x", found)
        self.assertNotIn("a b", found)

    def test_an_unreadable_body_reports_what_it_can_read_instead_of_raising(self):
        """One bad row must not stop the daily pass."""
        self._frappe(get_value="{oops nodeone")
        self.assertIn("nodeone", sheets.used_nodes("SH-1"))

    def test_a_sheet_that_is_gone_names_nothing(self):
        self._frappe(get_value=None, exists=False)
        self.assertEqual(sheets.used_nodes("SH-1"), set())

    # the xlsx importer

    def _import(self, raw: bytes) -> dict:
        self._frappe()
        return json.loads(sheets._workbook_from_xlsx(raw))

    def test_it_writes_the_version_two_pack_the_client_reads(self):
        packed = self._import(simple_workbook())["sheet"]
        self.assertEqual(packed["v"], 2)
        self.assertEqual(packed["current"], "Data")
        self.assertEqual(list(packed["sheets"]), ["Data"])

    def test_cells_arrive_row_major_at_their_own_columns(self):
        rows = self._import(simple_workbook())["sheet"]["sheets"]["Data"]["rows"]
        self.assertEqual(rows["0"], ["Name", "Amount"])
        self.assertEqual(rows["1"], ["Widget", "42"])

    def test_a_formula_keeps_its_leading_equals(self):
        rows = self._import(simple_workbook())["sheet"]["sheets"]["Data"]["rows"]
        self.assertEqual(rows["2"], [None, "=SUM(B2:B2)"])

    def test_every_worksheet_becomes_a_sub_sheet(self):
        def build(book):
            book.active.title = "First"
            book.active["A1"] = "a"
            second = book.create_sheet("Second")
            second["A1"] = "b"

        packed = self._import(workbook_bytes(build))["sheet"]
        self.assertEqual(list(packed["sheets"]), ["First", "Second"])
        self.assertEqual(packed["current"], "First")

    def test_a_whole_float_arrives_as_an_integer_string_like_the_browser(self):
        def build(book):
            book.active["A1"] = 42.0
            book.active["A2"] = 42.5

        rows = self._import(workbook_bytes(build))["sheet"]["sheets"]["Sheet"]["rows"]
        self.assertEqual(rows["0"], ["42"])
        self.assertEqual(rows["1"], ["42.5"])

    def test_a_boolean_arrives_as_the_engine_spells_it(self):
        def build(book):
            book.active["A1"] = True
            book.active["A2"] = False

        rows = self._import(workbook_bytes(build))["sheet"]["sheets"]["Sheet"]["rows"]
        self.assertEqual([rows["0"][0], rows["1"][0]], ["TRUE", "FALSE"])

    def test_a_date_arrives_as_the_iso_text_the_engine_reads_back(self):
        def build(book):
            book.active["A1"] = datetime.datetime(2026, 9, 6)
            book.active["A2"] = datetime.datetime(2026, 9, 6, 13, 30, 5)

        rows = self._import(workbook_bytes(build))["sheet"]["sheets"]["Sheet"]["rows"]
        self.assertEqual(rows["0"], ["2026-09-06"])
        self.assertEqual(rows["1"], ["2026-09-06 13:30:05"])

    def test_merges_come_across_as_the_master_and_slave_maps(self):
        def build(book):
            sheet = book.active
            sheet.title = "Data"
            sheet["A1"] = "banner"
            sheet.merge_cells("A1:C2")

        merged = self._import(workbook_bytes(build))["merge"]["Data"]
        self.assertEqual(merged["masterMap"], {"A1": {"rowSpan": 2, "colSpan": 3, "r": 0, "c": 0}})
        self.assertEqual(
            sorted(merged["slaveMap"]), ["A2", "B1", "B2", "C1", "C2"]
        )
        self.assertEqual(set(merged["slaveMap"].values()), {"A1"})

    def test_a_workbook_with_no_merges_writes_null_like_the_client_does(self):
        self.assertIsNone(self._import(simple_workbook())["merge"])

    def test_merges_stay_with_their_own_worksheet(self):
        def build(book):
            first = book.active
            first.title = "First"
            first["A1"] = "x"
            second = book.create_sheet("Second")
            second["A1"] = "y"
            second.merge_cells("A1:B1")

        merged = self._import(workbook_bytes(build))["merge"]
        self.assertEqual(list(merged), ["Second"])

    def test_a_number_format_travels_as_the_engine_s_format_string(self):
        def build(book):
            sheet = book.active
            sheet.title = "Data"
            sheet["A1"] = 0.125
            sheet["A1"].number_format = "0.00%"
            sheet["A2"] = datetime.datetime(2026, 9, 6)
            sheet["A2"].number_format = "yyyy-mm-dd"
            sheet["A3"] = "text"
            sheet["A3"].number_format = "@"

        cells = self._import(workbook_bytes(build))["formats"]["Data"]["cells"]
        self.assertEqual(cells["A1"], {"numberFormat": "percentage"})
        self.assertEqual(cells["A2"], {"numberFormat": "date:ymd"})
        self.assertEqual(cells["A3"], {"numberFormat": "text"})

    def test_a_general_format_is_not_recorded_at_all(self):
        self.assertNotIn("Data", self._import(simple_workbook()).get("formats", {}))

    def test_an_unknown_format_code_is_preserved_verbatim(self):
        def build(book):
            book.active.title = "Data"
            book.active["A1"] = 1
            book.active["A1"].number_format = '"€"#,##0.00'

        cells = self._import(workbook_bytes(build))["formats"]["Data"]["cells"]
        self.assertEqual(cells["A1"], {"numberFormat": 'custom:"€"#,##0.00'})

    def test_a_file_openpyxl_cannot_read_is_refused_with_a_plain_message(self):
        self._frappe()
        with self.assertRaises(sheets.UnreadableWorkbook):
            sheets._workbook_from_xlsx(b"this is not a spreadsheet")

    def test_a_zip_that_is_not_a_workbook_is_refused_too(self):
        self._frappe()
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as package:
            package.writestr("hello.txt", "hi")
        with self.assertRaises(sheets.UnreadableWorkbook):
            sheets._workbook_from_xlsx(buffer.getvalue())

    # the format table, in isolation

    def test_the_number_format_table_maps_both_ways_the_client_does(self):
        cases = {
            "": "",
            "General": "",
            "@": "text",
            "dd/mm/yyyy": "date:dmy",
            "hh:mm:ss": "time:hms",
            "yyyy-mm-dd hh:mm": "datetime:ymd_hm",
            "0.00%": "percentage",
            "0.0%": "percentage:1",
            "#,##0": "number",
            "#,##0.00": "number:2",
        }
        for code, expected in cases.items():
            with self.subTest(code=code):
                self.assertEqual(sheets._number_format(code), expected)

    def test_a_quoted_or_escaped_percent_does_not_scale_the_value(self):
        self.assertTrue(sheets._number_format('#,##0"%"').startswith("custom:"))
        self.assertTrue(sheets._number_format("#,##0\\%").startswith("custom:"))

    # what a hostile workbook costs

    def test_one_merge_range_cannot_expand_into_the_whole_grid(self):
        """`A1:XFD1048576` is legal, is 4 KB on the wire, and covers 17e9 cells.

        Before the bound, `_merge_slice` wrote one `slaveMap` entry for each of
        them: measured, that took a worker past 2 GB in 20 seconds.
        """
        evil = respliced_workbook(
            **{
                "xl/worksheets/sheet1.xml": worksheet_xml(
                    '<sheetData><row r="1"><c r="A1" t="inlineStr">'
                    "<is><t>x</t></is></c></row></sheetData>"
                    '<mergeCells count="1"><mergeCell ref="A1:XFD1048576"/></mergeCells>'
                )
            }
        )
        self._frappe()
        with self.assertRaises(ValueError) as refusal:
            sheets._workbook_from_xlsx(evil)
        self.assertIn("merges more than", str(refusal.exception))

    def test_an_ordinary_merge_still_comes_across(self):
        """The bound must refuse the bomb and nothing a person would send."""
        def build(book):
            book.active.title = "Data"
            book.active["A1"] = "x"
            book.active.merge_cells("A1:C3")

        merge = self._import(workbook_bytes(build))["merge"]["Data"]
        self.assertEqual(merge["masterMap"]["A1"]["rowSpan"], 3)
        self.assertEqual(merge["slaveMap"]["C3"], "A1")

    def test_a_sparse_row_cannot_allocate_the_columns_it_skips(self):
        """A row is a dense list, so one cell at XFD costs 16384 slots.

        `MAX_IMPORT_CELLS` counts values, not slots, so 20000 cells in a 105 KB
        file allocated 327 million of them: measured, past 2 GB in 8 seconds.
        """
        rows = "".join(
            f'<row r="{r}"><c r="XFD{r}" t="inlineStr"><is><t>v</t></is></c></row>'
            for r in range(1, 501)
        )
        evil = respliced_workbook(
            **{"xl/worksheets/sheet1.xml": worksheet_xml(f"<sheetData>{rows}</sheetData>")}
        )
        self._frappe()
        with self.assertRaises(ValueError) as refusal:
            sheets._workbook_from_xlsx(evil)
        self.assertIn("too sparse", str(refusal.exception))

    def test_a_wide_but_honest_row_is_not_refused(self):
        def build(book):
            for column in range(1, 51):
                book.active.cell(row=1, column=column, value=column)

        rows = self._import(workbook_bytes(build))["sheet"]["sheets"]["Sheet"]["rows"]
        self.assertEqual(len(rows["0"]), 50)

    def test_a_package_that_claims_to_expand_past_the_bound_is_refused(self):
        """A zip bomb is small on the wire and large once inflated."""
        evil = respliced_workbook(
            **{"xl/worksheets/sheet1.xml": worksheet_xml("<sheetData/>") + b" " * (2 * 1024 * 1024)}
        )
        self._frappe()
        with mock.patch.object(sheets, "MAX_IMPORT_UNZIPPED", 64 * 1024):
            with self.assertRaises(ValueError) as refusal:
                sheets._workbook_from_xlsx(evil)
        self.assertIn("expands to more than", str(refusal.exception))

    def test_a_part_carrying_a_document_type_declaration_is_refused(self):
        """`xml.etree.ElementTree` expands internal entities, so a DTD is a bomb.

        A spreadsheet never carries one, so its presence is the whole check.
        """
        bomb = (
            b'<?xml version="1.0"?>'
            b'<!DOCTYPE worksheet [<!ENTITY a "aaaaaaaaaa">'
            b'<!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>'
            b'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            b"<sheetData/></worksheet>"
        )
        evil = respliced_workbook(**{"xl/worksheets/sheet1.xml": bomb})
        self._frappe()
        with self.assertRaises(sheets.UnreadableWorkbook):
            sheets._workbook_from_xlsx(evil)

    def test_a_merge_lands_on_its_own_worksheet_whatever_the_part_order(self):
        """Part numbering does not track tab order once a tab is moved.

        Pairing `sheetnames` with the parts sorted by suffix gave Beta's merge
        to Gamma. The workbook's own relationship is the authority.
        """
        def build(book):
            book.active.title = "Gamma"
            book.active["A1"] = "g"
            book.create_sheet("Alpha")["A1"] = "a"
            beta = book.create_sheet("Beta")
            beta["A1"] = "b"
            beta.merge_cells("A1:B1")

        raw = workbook_bytes(build)
        source = zipfile.ZipFile(io.BytesIO(raw))
        # Beta is the last tab and the last part, so the bug is only visible
        # once the two orders differ. Reorder the tabs, not the parts.
        merged = self._import(_reordered_tabs(raw, ["Beta", "Gamma", "Alpha"]))["merge"]
        self.assertIn("xl/worksheets/sheet3.xml", source.namelist())
        self.assertEqual(list(merged), ["Beta"])
        self.assertEqual(merged["Beta"]["slaveMap"]["B1"], "A1")

    def test_a_restore_drops_the_collaborative_document_it_replaces(self):
        """A live Y.Doc outranks `sheets_data`, so a restore must clear it."""
        patched = self._frappe(exists=True)
        version = json.dumps(
            {"schema": "sheet/1", "sheets_data": json.dumps({"sheet": {"v": 2}}), "head_seq": 3}
        ).encode()
        with mock.patch.object(sheets, "_append_op", return_value=9):
            sheets.restore_version("SH-1", io.BytesIO(version))
        patched.db.delete.assert_called_once_with("Sheet Collab State", {"sheet": "SH-1"})

    def test_a_workbook_that_declares_too_many_merge_ranges_is_refused(self):
        many = "".join(
            f'<mergeCell ref="A{r}:B{r}"/>' for r in range(1, 12)
        )
        evil = respliced_workbook(
            **{
                "xl/worksheets/sheet1.xml": worksheet_xml(
                    '<sheetData><row r="1"><c r="A1" t="inlineStr">'
                    "<is><t>x</t></is></c></row></sheetData>"
                    f'<mergeCells count="11">{many}</mergeCells>'
                )
            }
        )
        self._frappe()
        with mock.patch.object(sheets, "MAX_IMPORT_MERGE_RANGES", 10):
            with self.assertRaises(ValueError) as refusal:
                sheets._workbook_from_xlsx(evil)
        self.assertIn("merged ranges", str(refusal.exception))

    def test_column_labels_match_the_client_and_the_cell_codec(self):
        from suite.sheets.doctype.sheet.cell_codec import _col_label

        for index in (0, 1, 25, 26, 27, 51, 52, 701, 702):
            with self.subTest(index=index):
                self.assertEqual(sheets._column_label(index), _col_label(index))
                self.assertEqual(sheets._column_index(sheets._column_label(index)), index)


# ── a site running this commit ───────────────────────────────────────────────


class TestSheetsBeforeActivation(IntegrationTestCase):
    """Legacy sheets keep working, and a linked sheet refuses every legacy path."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(USER)
        _purge_fixture_roots()
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.addCleanup(self._remove_fixture_rows)
        self.addCleanup(frappe.set_user, "Administrator")

    def _remove_fixture_rows(self):
        frappe.set_user("Administrator")
        _purge_fixture_roots()
        for name in frappe.get_all(DOCTYPE, filters={"title": ("like", "adoption-%")}, pluck="name"):
            frappe.db.delete(OP_LOG, {"sheet": name})
            frappe.db.delete("Sheet Seq", {"sheet": name})
            frappe.delete_doc(DOCTYPE, name, force=1, ignore_permissions=True, ignore_missing=True)
        frappe.db.commit()

    def _legacy_sheet(self, title="adoption-legacy") -> str:
        return frappe.get_doc({"doctype": DOCTYPE, "title": title, "sheets_data": "{}"}).insert().name

    def _linked_sheet(self) -> tuple[str, str]:
        """One sheet linked the way Build links it: through Drive, then read back."""
        with activated():
            root = create_root(kind="Personal", title="Sheets Root", user=USER)
            node = drive.create_document(root.node, "adoption-linked", content_doctype=DOCTYPE)
        return node, frappe.db.get_value("Drive Node", node, "content_docname")

    # the legacy row is untouched

    def test_a_legacy_sheet_still_requires_a_title(self):
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc({"doctype": DOCTYPE, "sheets_data": "{}"}).insert()

    def test_a_legacy_sheet_still_gets_its_backing_drive_file(self):
        from suite.drive.overrides.file import File as DriveFile

        name = self._legacy_sheet()
        self.assertTrue(DriveFile.get_for_doc(DOCTYPE, name))

    def test_a_legacy_sheet_can_still_be_renamed_shared_and_trashed(self):
        from suite.sheets import api

        name = self._legacy_sheet()
        api.rename_sheet(name, "adoption-renamed")
        self.assertEqual(frappe.db.get_value(DOCTYPE, name, "title"), "adoption-renamed")
        api.delete_sheet(name)
        self.assertTrue(frappe.db.get_value(DOCTYPE, name, "trashed"))
        api.restore_sheet(name)
        self.assertFalse(frappe.db.get_value(DOCTYPE, name, "trashed"))

    # a linked row refuses every one of them

    def test_a_linked_sheet_gets_no_backing_file(self):
        """A second backing row would be a second answer to "who may open this"."""
        from suite.drive.overrides.file import File as DriveFile

        _node, docname = self._linked_sheet()
        self.assertFalse(DriveFile.get_for_doc(DOCTYPE, docname))

    def test_every_legacy_endpoint_refuses_a_linked_sheet(self):
        from suite.sheets import api

        _node, docname = self._linked_sheet()
        calls = {
            "get_sheet_shares": lambda: api.get_sheet_shares(docname),
            "share_sheet": lambda: api.share_sheet(docname, OTHER, write=1),
            "unshare_sheet": lambda: api.unshare_sheet(docname, OTHER),
            "delete_sheet": lambda: api.delete_sheet(docname),
            "restore_sheet": lambda: api.restore_sheet(docname),
            "delete_sheet_permanent": lambda: api.delete_sheet_permanent(docname),
            "rename_sheet": lambda: api.rename_sheet(docname, "nope"),
            "duplicate_sheet": lambda: api.duplicate_sheet(docname),
        }
        for label, call in calls.items():
            with self.subTest(endpoint=label), self.assertRaises(frappe.ValidationError):
                call()

    def test_the_sheets_trash_cascade_refuses_a_linked_sheet(self):
        from suite.sheets.trash import hard_delete_sheet

        _node, docname = self._linked_sheet()
        with self.assertRaises(frappe.ValidationError):
            hard_delete_sheet(docname)

    def test_the_nightly_purge_never_sees_a_linked_sheet(self):
        from suite.sheets.trash import purge_trashed_sheets

        _node, docname = self._linked_sheet()
        # Even with the frozen column forced past the retention window.
        frappe.db.set_value(
            DOCTYPE,
            docname,
            {"trashed": 1, "trashed_on": "2020-01-01 00:00:00"},
            update_modified=False,
        )
        purge_trashed_sheets()
        self.assertTrue(frappe.db.exists(DOCTYPE, docname))

    def test_a_linked_sheet_never_answers_from_a_docshare(self):
        """Frappe widens a denied row check; Drive refuses instead (§1)."""
        import frappe.share

        _node, docname = self._linked_sheet()
        ensure_user(OTHER)
        frappe.share.add(DOCTYPE, docname, OTHER, write=1, notify=False)
        self.addCleanup(frappe.db.delete, "DocShare", {"share_doctype": DOCTYPE, "share_name": docname})

        frappe.set_user(OTHER)
        with self.assertRaises(DriveForbidden):
            frappe.has_permission(DOCTYPE, doc=docname, ptype="read")

    def test_a_legacy_sheet_is_still_readable_through_a_docshare(self):
        import frappe.share

        name = self._legacy_sheet()
        ensure_user(OTHER)
        frappe.share.add(DOCTYPE, name, OTHER, write=0, notify=False)
        self.addCleanup(frappe.db.delete, "DocShare", {"share_doctype": DOCTYPE, "share_name": name})

        frappe.set_user(OTHER)
        self.assertTrue(frappe.has_permission(DOCTYPE, doc=name, ptype="read"))
        self.assertFalse(frappe.has_permission(DOCTYPE, doc=name, ptype="write"))

    def test_a_stranger_still_cannot_read_a_legacy_sheet(self):
        """The `All` DocPerm lost `if_owner`; the guard is what puts it back."""
        name = self._legacy_sheet()
        ensure_user(OTHER)
        frappe.set_user(OTHER)
        self.assertFalse(frappe.has_permission(DOCTYPE, doc=name, ptype="read"))

    def test_a_linked_sheet_is_not_in_the_legacy_list(self):
        _node, docname = self._linked_sheet()
        self._legacy_sheet()
        frappe.set_user(USER)
        listed = frappe.get_list(DOCTYPE, pluck="name", limit_page_length=0)
        self.assertNotIn(docname, listed)


# ── the Drive-native lifecycle ───────────────────────────────────────────────


class TestSheetsInDrive(IntegrationTestCase):
    """Create, copy, import, version, restore, purge, media, and satellites.

    Every test runs under `activated()`, because none of these workflows exist
    on a site until ticket 29 registers the declaration.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(USER)
        ensure_user(OTHER)
        _purge_fixture_roots()
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self._blobs_before = set(frappe.get_all("File Blob", pluck="name"))
        # Entered first, so its exit runs last: the fixture purge below is a
        # Drive workflow and needs the registry it injects.
        activation = activated()
        activation.__enter__()
        self.addCleanup(activation.__exit__, None, None, None)
        self.addCleanup(self._remove_fixture_rows)
        self.root = create_root(kind="Personal", title="Sheets Root", user=USER)
        self.other_root = create_root(kind="Personal", title="Sheets Other", user=OTHER)
        self.admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        self.person = Principals(USER, (USER, "$GENERAL"), ("$PUBLIC",))

    def _remove_fixture_rows(self):
        frappe.set_user("Administrator")
        _purge_fixture_roots()
        for blob in set(frappe.get_all("File Blob", pluck="name")) - self._blobs_before:
            frappe.delete_doc("File Blob", blob, force=1, ignore_permissions=True, ignore_missing=True)
        frappe.db.commit()

    # helpers

    def _sheet(self, title="Sheet", parent=None, **kwargs) -> str:
        return drive.create_document(parent or self.root.node, title, content_doctype=DOCTYPE, **kwargs)

    def _docname(self, node: str) -> str:
        return frappe.db.get_value("Drive Node", node, "content_docname")

    def _body(self, node: str) -> str:
        return decode_sheets_data(frappe.db.get_value(DOCTYPE, self._docname(node), "sheets_data"))

    def _write_body(self, node: str, body: dict) -> None:
        frappe.db.set_value(
            DOCTYPE, self._docname(node), "sheets_data", encode_sheets_data(json.dumps(body))
        )

    def _ops(self, node: str) -> list[dict]:
        return frappe.get_all(
            OP_LOG,
            filters={"sheet": self._docname(node)},
            fields=["seq", "op_type", "summary"],
            order_by="seq asc",
        )

    def _xlsx_node(self, raw: bytes, title="book.xlsx") -> str:
        from frappe.storage.blob import put_blob

        blob = put_blob(io.BytesIO(raw), is_private=True, filename=title)
        return create_file(
            self.admin, self.root.node, title, blob=blob.name, size=blob.file_size, mime=blob.mime_type
        )

    def _as(self, user: str):
        frappe.set_user(user)
        self.addCleanup(frappe.set_user, "Administrator")

    # creation, and the immutable link

    def test_a_new_sheet_carries_its_node_and_its_node_carries_it(self):
        node = self._sheet(title="Budget")
        row = frappe.db.get_value(
            "Drive Node", node, ("kind", "mime", "title", "content_doctype", "content_docname"), as_dict=True
        )
        self.assertEqual(row.kind, "document")
        self.assertEqual(row.mime, "frappe/sheet")
        self.assertEqual(row.title, "Budget")
        self.assertEqual(row.content_doctype, DOCTYPE)
        self.assertEqual(frappe.db.get_value(DOCTYPE, row.content_docname, "node"), node)

    def test_a_new_sheet_starts_empty_and_has_no_title_of_its_own(self):
        node = self._sheet(title="Budget")
        row = frappe.db.get_value(DOCTYPE, self._docname(node), ("title", "sheets_data"), as_dict=True)
        self.assertFalse(row.title, "Drive owns the title; §10.2 forbids a mirror")
        self.assertEqual(decode_sheets_data(row.sheets_data), "{}")

    def test_a_new_sheet_opens_its_history_with_a_create_op(self):
        node = self._sheet()
        self.assertEqual([op["op_type"] for op in self._ops(node)], ["create"])

    def test_the_head_seq_names_the_op_that_wrote_the_body(self):
        node = self._sheet()
        ops = self._ops(node)
        self.assertEqual(
            frappe.db.get_value(DOCTYPE, self._docname(node), "head_seq"), ops[-1]["seq"]
        )

    def test_a_linked_sheet_cannot_write_the_frozen_legacy_title(self):
        node = self._sheet()
        sheet = frappe.get_doc(DOCTYPE, self._docname(node))
        sheet.title = "A mirror of the node title"
        with self.assertRaises(DriveConflict):
            sheet.save(ignore_permissions=True)

    def test_a_linked_sheet_cannot_write_the_frozen_trash_columns(self):
        node = self._sheet()
        sheet = frappe.get_doc(DOCTYPE, self._docname(node))
        sheet.trashed = 1
        with self.assertRaises(DriveConflict):
            sheet.save(ignore_permissions=True)

    def test_a_save_keeps_the_build_title_so_the_rollback_source_survives(self):
        """§14.11: the post-Build rollback is "ship the old code", which reads it."""
        node = self._sheet()
        docname = self._docname(node)
        frappe.db.set_value(DOCTYPE, docname, "title", "The Build title", update_modified=False)
        sheet = frappe.get_doc(DOCTYPE, docname)
        sheet.sheets_data = encode_sheets_data('{"a":1}')
        sheet.save(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value(DOCTYPE, docname, "title"), "The Build title")

    def test_a_sheet_cannot_be_repointed_at_another_node(self):
        first = self._sheet(title="One")
        second = self._sheet(title="Two")
        sheet = frappe.get_doc(DOCTYPE, self._docname(first))
        sheet.node = second
        with self.assertRaises(DriveConflict):
            sheet.save(ignore_permissions=True)

    # copy

    def test_a_copy_carries_the_body(self):
        node = self._sheet(title="Source")
        self._write_body(node, {"sheet": {"v": 2, "current": "Data", "sheets": {}}})
        copy = drive.copy(node, self.root.node, title="Copy")
        self.assertEqual(json.loads(self._body(copy))["sheet"]["current"], "Data")

    def test_a_copy_gets_no_history_of_its_own_beyond_its_creation(self):
        """§8.9: a copy starts clean; it does not inherit the source's ops."""
        node = self._sheet(title="Source")
        sheets._append_op(self._docname(node), "save", "Saved")
        copy = drive.copy(node, self.root.node, title="Copy")
        self.assertEqual([op["op_type"] for op in self._ops(copy)], ["create"])

    def test_a_copy_gets_its_own_collaborative_document(self):
        """Inheriting the source's Y.Doc would rebase every editor onto the copy."""
        node = self._sheet(title="Source")
        frappe.get_doc(
            {"doctype": COLLAB_STATE, "sheet": self._docname(node), "ydoc_state": "AAA", "byte_size": 3}
        ).insert(ignore_permissions=True)
        copy = drive.copy(node, self.root.node, title="Copy")
        self.assertFalse(frappe.db.exists(COLLAB_STATE, self._docname(copy)))

    def test_a_copy_has_a_title_only_on_its_node(self):
        node = self._sheet(title="Source")
        copy = drive.copy(node, self.root.node, title="Copy")
        self.assertEqual(frappe.db.get_value("Drive Node", copy, "title"), "Copy")
        self.assertFalse(frappe.db.get_value(DOCTYPE, self._docname(copy), "title"))

    # xlsx import

    def test_an_xlsx_becomes_a_sheet_under_the_folder_the_caller_chose(self):
        source = self._xlsx_node(simple_workbook())
        node = drive.import_document(
            self.root.node, "Imported", content_doctype=DOCTYPE, from_node=source
        )
        row = frappe.db.get_value("Drive Node", node, ("kind", "mime", "title"), as_dict=True)
        self.assertEqual(row.kind, "document")
        self.assertEqual(row.mime, "frappe/sheet")
        self.assertEqual(row.title, "Imported")

    def test_an_import_carries_the_workbook_the_file_held(self):
        source = self._xlsx_node(simple_workbook())
        node = drive.import_document(
            self.root.node, "Imported", content_doctype=DOCTYPE, from_node=source
        )
        rows = json.loads(self._body(node))["sheet"]["sheets"]["Data"]["rows"]
        self.assertEqual(rows["0"], ["Name", "Amount"])

    def test_an_import_says_so_in_the_history(self):
        source = self._xlsx_node(simple_workbook())
        node = drive.import_document(
            self.root.node, "Imported", content_doctype=DOCTYPE, from_node=source
        )
        self.assertEqual([op["op_type"] for op in self._ops(node)], ["import"])

    def test_an_import_leaves_the_source_file_exactly_as_it_was(self):
        """An import is neither a move nor a copy."""
        source = self._xlsx_node(simple_workbook())
        before = frappe.db.get_value("Drive Node", source, ("parent", "state", "blob"), as_dict=True)
        drive.import_document(self.root.node, "Imported", content_doctype=DOCTYPE, from_node=source)
        after = frappe.db.get_value("Drive Node", source, ("parent", "state", "blob"), as_dict=True)
        self.assertEqual(before, after)

    def test_a_caller_who_cannot_read_the_file_cannot_import_it(self):
        source = self._xlsx_node(simple_workbook())
        self._as(OTHER)
        with self.assertRaises((DriveNotFound, DriveForbidden)):
            drive.import_document(
                self.other_root.node, "Imported", content_doctype=DOCTYPE, from_node=source
            )

    def test_a_file_that_is_not_a_workbook_is_refused_and_leaves_no_node(self):
        source = self._xlsx_node(b"not a spreadsheet", title="notes.txt")
        before = frappe.db.count("Drive Node")
        with self.assertRaises(Exception):
            drive.import_document(
                self.root.node, "Imported", content_doctype=DOCTYPE, from_node=source
            )
        self.assertEqual(frappe.db.count("Drive Node"), before)

    # versions

    def test_a_version_stores_the_workbook_and_the_head_seq(self):
        node = self._sheet()
        self._write_body(node, {"sheet": {"v": 2, "current": "Data", "sheets": {}}})
        seq = drive.take_version(node, kind="named", label="Before the edit")
        self.assertTrue(frappe.db.exists("Drive Node Version", {"node": node, "seq": seq}))

    def test_a_sheet_body_is_free_and_a_version_is_charged(self):
        """§7.1: the body is a column, so only the version blob is admitted."""
        node = self._sheet()
        self._write_body(node, {"sheet": {"v": 2, "current": "Data", "sheets": {}}})
        before = frappe.db.get_value("Drive Root", self.root.name, "used_bytes")
        drive.take_version(node)
        after = frappe.db.get_value("Drive Root", self.root.name, "used_bytes")
        self.assertGreater(after, before, "a version blob is charged")

        self._write_body(node, {"sheet": {"v": 2, "current": "Other", "sheets": {}}})
        self.assertEqual(
            frappe.db.get_value("Drive Root", self.root.name, "used_bytes"),
            after,
            "the body itself costs the root nothing",
        )

    def test_a_restore_puts_the_body_back(self):
        node = self._sheet()
        self._write_body(node, {"sheet": {"v": 2, "current": "First", "sheets": {}}})
        seq = drive.take_version(node, kind="named", label="First")
        self._write_body(node, {"sheet": {"v": 2, "current": "Second", "sheets": {}}})

        restore_version(self.admin, node, seq)
        self.assertEqual(json.loads(self._body(node))["sheet"]["current"], "First")

    def test_a_restore_is_one_op_of_its_own_at_a_fresh_seq(self):
        node = self._sheet()
        self._write_body(node, {"sheet": {"v": 2, "current": "First", "sheets": {}}})
        seq = drive.take_version(node, kind="named", label="First")
        self._write_body(node, {"sheet": {"v": 2, "current": "Second", "sheets": {}}})
        before = self._ops(node)[-1]["seq"]

        restore_version(self.admin, node, seq)
        ops = self._ops(node)
        self.assertEqual(ops[-1]["op_type"], "restore")
        self.assertGreater(ops[-1]["seq"], before, "head_seq never regresses")
        self.assertEqual(
            frappe.db.get_value(DOCTYPE, self._docname(node), "head_seq"), ops[-1]["seq"]
        )

    def test_a_restore_takes_a_version_of_what_it_replaces(self):
        node = self._sheet()
        self._write_body(node, {"sheet": {"v": 2, "current": "First", "sheets": {}}})
        seq = drive.take_version(node, kind="named", label="First")
        self._write_body(node, {"sheet": {"v": 2, "current": "Second", "sheets": {}}})

        restore_version(self.admin, node, seq)
        self.assertGreater(frappe.db.count("Drive Node Version", {"node": node}), 1)

    # purge

    def test_a_purge_takes_the_sheet_and_every_app_owned_row_with_it(self):
        node = self._sheet()
        docname = self._docname(node)
        frappe.get_doc(
            {"doctype": COLLAB_STATE, "sheet": docname, "ydoc_state": "AAA", "byte_size": 3}
        ).insert(ignore_permissions=True)

        update(node, self.admin, state="Trashed")
        purge(node, self.admin)

        self.assertFalse(frappe.db.exists(DOCTYPE, docname))
        self.assertFalse(frappe.db.exists(OP_LOG, {"sheet": docname}))
        self.assertFalse(frappe.db.exists(COLLAB_STATE, docname))
        self.assertFalse(frappe.db.exists("Sheet Seq", docname))

    def test_a_purge_leaves_no_copy_of_the_workbook_behind(self):
        """`delete_permanently` is what makes a purge a purge."""
        node = self._sheet()
        docname = self._docname(node)
        update(node, self.admin, state="Trashed")
        purge(node, self.admin)
        self.assertFalse(frappe.db.exists("Deleted Document", {"deleted_name": docname}))

    # media discovery

    def test_the_sweep_is_told_every_id_a_body_still_names(self):
        node = self._sheet()
        media = self._media_node("picture.png")
        self._write_body(node, {"sheet": {"sheets": {"Data": {"rows": {"0": [media]}}}}})
        self.assertIn(media, sheets.used_nodes(self._docname(node)))

    def _media_node(self, title: str) -> str:
        from frappe.storage.blob import put_blob

        blob = put_blob(io.BytesIO(b"\x89PNG payload"), is_private=True, filename=title)
        with mock.patch("suite.drive._core.previews.enqueue_render"):
            return create_file(
                self.admin, self.root.node, title, blob=blob.name, size=blob.file_size, mime="image/png"
            )

    # satellites

    def test_the_op_log_takes_its_rights_from_the_sheet_s_node(self):
        node = self._sheet()
        op = frappe.get_all(OP_LOG, filters={"sheet": self._docname(node)}, pluck="name")[0]

        self._as(OTHER)
        self.assertFalse(satellite_has_permission(frappe.get_doc(OP_LOG, op), "read", OTHER))

    def test_a_reader_of_the_sheet_may_read_its_op_log(self):
        node = self._sheet()
        op = frappe.get_all(OP_LOG, filters={"sheet": self._docname(node)}, pluck="name")[0]
        grant(node, OTHER, drive.READ, self.admin)

        self._as(OTHER)
        self.assertTrue(satellite_has_permission(frappe.get_doc(OP_LOG, op), "read", OTHER))

    def test_the_op_log_list_is_scoped_to_readable_sheets(self):
        mine = self._sheet(title="Mine")
        theirs = drive.create_document(self.other_root.node, "Theirs", content_doctype=DOCTYPE)
        grant(mine, OTHER, drive.READ, self.admin)

        self._as(OTHER)
        condition = satellite_query_conditions(OP_LOG, OTHER)
        listed = frappe.get_all(OP_LOG, pluck="sheet", limit_page_length=0)
        self.assertTrue(condition, "a non-admin gets a predicate")
        self.assertIn(self._docname(mine), listed)
        self.assertNotIn(self._docname(theirs), listed)

    def test_the_collaborative_document_takes_the_same_rights(self):
        node = self._sheet()
        state = frappe.get_doc(
            {"doctype": COLLAB_STATE, "sheet": self._docname(node), "ydoc_state": "AAA", "byte_size": 3}
        ).insert(ignore_permissions=True)

        self._as(OTHER)
        self.assertFalse(satellite_has_permission(state, "read", OTHER))

    def test_edit_is_what_changes_a_satellite_not_read(self):
        node = self._sheet()
        op = frappe.get_all(OP_LOG, filters={"sheet": self._docname(node)}, pluck="name")[0]
        grant(node, OTHER, drive.READ, self.admin)

        self._as(OTHER)
        document = frappe.get_doc(OP_LOG, op)
        self.assertTrue(satellite_has_permission(document, "read", OTHER))
        self.assertFalse(satellite_has_permission(document, "write", OTHER))


def _purge_fixture_roots() -> None:
    """Hand back every Drive root the two fixture users own, through Drive's purge.

    `USER` and `OTHER` belong to this module alone, so the filter can never
    reach a live account or another test.
    """
    admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
    roots = frappe.get_all("Drive Root", filters={"user": ["in", (USER, OTHER)]}, pluck="name")
    # Purging a document node calls the app's `on_purge`, which Drive reads from
    # the registry, so the purge runs registered even when the caller is not.
    with activated():
        for root in roots:
            if frappe.db.get_value("Drive Root", root, "state") == "Active":
                update_root(root, admin, state="Archived")
            purge_root(root, admin)


if __name__ == "__main__":
    unittest.main()
