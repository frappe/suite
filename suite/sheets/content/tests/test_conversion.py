import uuid
from unittest.mock import patch

import frappe
import pycrdt
from bs4 import BeautifulSoup
from frappe.tests import IntegrationTestCase

from suite import drive
from suite.content import capacity, conversions, convert, log, logged, tables
from suite.content.conversions import ConversionRefused
from suite.sheets import content as sheets_content
from suite.sheets.content import conversion
from suite.sheets.content.tests.support import (
    CURRENT_BODY,
    DEVELOP_BODY,
    cells_of,
    converted,
    in_job,
    require_converter,
)
from suite.sheets.doctype.sheet.storage import encode_sheets_data
from suite.tests.utils import ensure_user

OWNER = "sheets-collab-owner@example.com"


class TestConverter(IntegrationTestCase):
    """The built converter bundle, run by the layer on one stored body."""

    def setUp(self):
        require_converter(self)
        in_job(self)

    def test_converts_a_body_todays_editor_saved(self):
        result = converted(CURRENT_BODY)

        assert isinstance(result, convert.Converted)
        self.assertEqual(
            cells_of(result.state),
            {"Budget": {"A1": "Rent", "B1": "1200", "A2": "Food", "B2": "350.5", "B4": "=SUM(B1:B2)"}},
        )
        self.assertEqual(result.dropped, [])
        self.assertIn("<td>=SUM(B1:B2)</td>", result.html)

    def test_converts_a_develop_body_and_records_the_renamed_sheet(self):
        result = converted(DEVELOP_BODY)

        assert isinstance(result, convert.Converted)
        self.assertEqual(
            cells_of(result.state),
            {
                "Budget": {"A1": "Item", "B1": "Amount", "A2": "Rent", "B2": "1200"},
                "Q1_Q2": {"B3": "=Budget!B2*2"},
            },
        )
        self.assertEqual(result.dropped, [{"kind": "renamed-sheet", "from": "Q1/Q2", "to": "Q1_Q2"}])

    def test_refuses_a_sheet_bigger_than_a_room(self):
        self.assertEqual(converted(CURRENT_BODY, max_state=64), convert.Refused("too_large"))

    def test_refuses_a_body_it_cannot_read(self):
        for body in ("not json", '{"_z": "gzip", "data": "H4sI"}', '{"engine": "AQID"}'):
            with self.subTest(body):
                self.assertEqual(converted(body), convert.Refused("check"))


class TestCheck(IntegrationTestCase):
    """`check`, which refuses before anything writes."""

    def setUp(self):
        require_converter(self)
        in_job(self)
        result = converted(CURRENT_BODY)
        assert isinstance(result, convert.Converted)
        self.result = result
        self.old = conversion.OldSheet("sheet", {}, "print", frappe.utils.now_datetime())

    def test_answers_the_cleaned_copy(self):
        checked = conversion.check("node", self.old, self.result)

        text = BeautifulSoup(checked.html, "html.parser").get_text()
        self.assertTrue(sheets_content.is_html_complete(self.result.state, checked.html, text))
        self.assertEqual(checked.dropped, [])

    def test_refuses_a_state_over_the_room_limit(self):
        with patch.object(capacity, "STATE_MAX", len(self.result.state) - 1):
            with self.assertRaises(ConversionRefused) as refused:
                conversion.check("node", self.old, self.result)

        self.assertEqual(refused.exception.outcome, "too_large")

    def test_refuses_a_copy_missing_a_cell(self):
        partial = convert.Converted(**{**self.result.__dict__, "html": self.result.html.replace("Rent", "")})

        with self.assertRaises(ConversionRefused) as refused:
            conversion.check("node", self.old, partial)

        self.assertEqual((refused.exception.outcome, refused.exception.reason), ("check", "copy"))

    def test_refuses_a_root_the_layout_has_no_place_for(self):
        doc: pycrdt.Doc = pycrdt.Doc()
        doc.apply_update(self.result.state)
        doc.get("stray", type=pycrdt.Map)["x"] = 1
        stray = convert.Converted(**{**self.result.__dict__, "state": doc.get_update()})

        with self.assertRaises(ConversionRefused) as refused:
            conversion.check("node", self.old, stray)

        self.assertEqual(refused.exception.outcome, "check")


class TestConvertDocument(IntegrationTestCase):
    """The layer converting a real sheet, as its scheduler job and first open do."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        logged.ensure_tables()
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        require_converter(self)
        in_job(self)
        # The layer converts only while Sheets is on, which the editor's wiring allows
        ready = patch.object(sheets_content, "EDITOR_READY", True)
        ready.start()
        self.addCleanup(ready.stop)
        saved_mode = log.mode(sheets_content.APP)
        log.set_mode(sheets_content.APP, "on")
        frappe.db.commit()
        self.addCleanup(self.restore_mode, saved_mode)
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")

    def restore_mode(self, mode: str):
        log.set_mode(sheets_content.APP, mode)
        frappe.db.commit()

    def old_sheet(self, sheets_data: str) -> str:
        """A sheet made before collab was on: a row with a body and no log."""
        log.set_mode(sheets_content.APP, "off")
        root = drive.ensure_personal_root(OWNER)
        parent = frappe.db.get_value("Drive Root", root, "node")
        node = drive.create_document(parent, f"Old {uuid.uuid4().hex[:8]}", content_doctype="Sheet")
        docname = frappe.db.get_value("Drive Node", node, "content_docname")
        frappe.db.set_value("Sheet", docname, "sheets_data", encode_sheets_data(sheets_data))
        log.set_mode(sheets_content.APP, "on")
        frappe.db.commit()
        self.addCleanup(self.delete_log, node)
        return node

    def delete_log(self, node: str):
        doc = log.find(sheets_content.APP, node)
        if doc:
            for kind in ("update", "session", "stage", "checkpoint", "copy"):
                frappe.db.sql(f"DELETE FROM `{tables.table('sheets', kind)}` WHERE `doc_id` = %s", doc.id)

            frappe.db.sql(f"DELETE FROM `{tables.table('sheets', 'doc')}` WHERE `id` = %s", doc.id)

        frappe.db.sql(f"DELETE FROM `{tables.table('sheets', 'conversion')}` WHERE `node` = %s", node)
        frappe.db.commit()

    def records(self, node: str) -> list[tuple]:
        return frappe.db.sql(
            f"SELECT `outcome`, `reason` FROM `{tables.table('sheets', 'conversion')}` WHERE `node` = %s",
            node,
        )

    def test_converts_an_old_sheet_into_a_log_with_its_readable_copy(self):
        node = self.old_sheet(CURRENT_BODY)
        docname = frappe.db.get_value("Drive Node", node, "content_docname")
        stored = frappe.db.get_value("Sheet", docname, "sheets_data")

        self.assertEqual(conversions.convert_document(sheets_content.APP, node), "converted")

        snapshot = logged.live_checkpoint(sheets_content.APP, node)
        assert snapshot is not None
        self.assertEqual(cells_of(snapshot[1])["Budget"]["B4"], "=SUM(B1:B2)")
        html = frappe.db.get_value("Sheet", docname, "html")
        self.assertIn("<td>=SUM(B1:B2)</td>", html)
        self.assertEqual(frappe.db.get_value("Sheet", docname, "sheets_data"), stored)
        self.assertEqual(self.records(node), (("converted", None),))

    def test_converts_a_develop_sheet(self):
        node = self.old_sheet(DEVELOP_BODY)

        self.assertEqual(conversions.convert_document(sheets_content.APP, node), "converted")

        snapshot = logged.live_checkpoint(sheets_content.APP, node)
        assert snapshot is not None
        self.assertEqual(sorted(cells_of(snapshot[1])), ["Budget", "Q1_Q2"])

    def test_a_refused_sheet_keeps_its_old_body_and_gets_no_log(self):
        node = self.old_sheet("not json")
        docname = frappe.db.get_value("Drive Node", node, "content_docname")

        self.assertEqual(conversions.convert_document(sheets_content.APP, node), "check")

        self.assertIsNone(log.find(sheets_content.APP, node))
        self.assertEqual(self.records(node), (("check", None),))
        self.assertTrue(frappe.db.get_value("Sheet", docname, "sheets_data"))

    def test_a_changed_body_fingerprints_again(self):
        node = self.old_sheet(CURRENT_BODY)
        before = conversion.read_fingerprint(node)
        docname = frappe.db.get_value("Drive Node", node, "content_docname")
        frappe.db.set_value(
            "Sheet", docname, "sheets_data", encode_sheets_data(DEVELOP_BODY), update_modified=False
        )

        self.assertNotEqual(conversion.read_fingerprint(node), before)
        self.assertEqual(conversion.read_old(node).fingerprint, conversion.read_fingerprint(node))

    def test_a_save_that_only_touches_modified_fingerprints_again(self):
        node = self.old_sheet(CURRENT_BODY)
        before = conversion.read_fingerprint(node)
        docname = frappe.db.get_value("Drive Node", node, "content_docname")
        frappe.db.set_value("Sheet", docname, "modified", frappe.utils.add_to_date(None, days=1))

        self.assertNotEqual(conversion.read_fingerprint(node), before)

    def test_reads_the_lowest_named_row_of_a_node_with_two_rows(self):
        # app_row.body_row writes the body to the same row, by the same order
        node = self.old_sheet(CURRENT_BODY)
        docname = frappe.db.get_value("Drive Node", node, "content_docname")
        twin = frappe.get_doc(
            {"doctype": "Sheet", "node": node, "sheets_data": encode_sheets_data(DEVELOP_BODY)}
        )
        twin.name = ("0" if docname > "0" else "~") + docname
        twin.db_insert()
        frappe.db.commit()
        self.addCleanup(frappe.db.delete, "Sheet", twin.name)
        lowest = min(docname, twin.name)

        self.assertEqual(conversion.read_old(node).docname, lowest)
