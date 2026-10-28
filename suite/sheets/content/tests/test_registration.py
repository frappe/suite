from unittest.mock import patch

import frappe
import pycrdt
from frappe.tests import IntegrationTestCase

from suite.content import convert, editors, log, updates
from suite.sheets import content as sheets_content
from suite.sheets.content.tests.support import (
    PERMISSIVE_SCHEMA,
    converted,
    in_job,
    require_converter,
    schema_roots,
)
from suite.sheets.drive import SPEC


class TestRegistration(IntegrationTestCase):
    def test_sheets_registers_on_the_content_layer(self):
        spec = editors.editors()["sheets"]

        self.assertIs(spec, sheets_content.EDITOR)
        self.assertEqual((spec.doctype, spec.body_field), ("Sheet", "content"))
        self.assertEqual(spec.readable_copy.field, "html")
        self.assertIsNone(spec.media)
        self.assertEqual(editors.for_type("Sheet"), spec)

    def test_names_every_root_the_browser_layout_writes(self):
        self.assertEqual(sorted(sheets_content.PART_MAP), sorted(schema_roots()))
        self.assertEqual(len(schema_roots()), 18)
        self.assertIs(sheets_content.PART_MAP["sheets"], pycrdt.Array)
        declared = set(sheets_content.SCHEMA.features)
        self.assertEqual(declared, {*schema_roots(), "schemaVersion"})

    def test_stays_off_until_a_site_turns_it_on(self):
        self.assertFalse(sheets_content.EDITOR.always_on)
        self.assertEqual(log.mode("sheets"), "off")

    def test_refuses_turning_sheets_on_before_the_editor_uses_the_room(self):
        with self.assertRaises(frappe.ValidationError):
            log.set_mode("sheets", "on")

        frappe.db.rollback()
        self.assertEqual(log.mode("sheets"), "off")

    def test_turns_sheets_on_once_the_editor_uses_the_room(self):
        with patch.object(sheets_content, "EDITOR_READY", True):
            log.set_mode("sheets", "on")
            self.assertEqual(log.mode("sheets"), "on")

        frappe.db.rollback()

    def test_drive_still_offers_no_export_and_copies_no_pictures(self):
        # The declaration the `drive_content_types` hook registers
        spec = SPEC

        self.assertIsNone(spec.export)
        self.assertEqual(spec.export_formats, ())
        self.assertIsNone(spec.remap_media)
        self.assertIn("Sheet", editors.wrapped)

    def test_the_built_converter_holds_the_version_the_server_expects(self):
        require_converter(self)
        in_job(self)
        self.assertTrue(
            convert.bundle_ready(sheets_content.CONVERTER_BUILD, sheets_content.CONVERTER_VERSION)
        )


class TestSchema(IntegrationTestCase):
    def setUp(self):
        require_converter(self)
        in_job(self)
        result = converted('{"sheet": {"v": 2, "sheets": {"Budget": {"rows": {"0": ["Rent"]}}}}}')
        assert isinstance(result, convert.Converted)
        self.update = updates.parse(result.state)

    def test_a_converted_doc_holds_only_content_the_editor_writes(self):
        self.assertTrue(sheets_content.SCHEMA.could_write(self.update))

    def test_the_key_check_refuses_runtime_cell_keys_until_the_layer_takes_them(self):
        # pushes.py checks every map key against `features`; a cell key `sheetId:rowId:colId` is made
        # at runtime, so the real schema refuses it. Merge only after the layer takes runtime keys
        self.assertFalse(sheets_content.SCHEMA.allows(self.update.names, 1))
        self.assertTrue(PERMISSIVE_SCHEMA.allows(self.update.names, 1))
        roots_and_fixed = {*sheets_content.PART_MAP, "schemaVersion"}
        self.assertTrue(sheets_content.SCHEMA.allows(self.update.names & roots_and_fixed, 1))
