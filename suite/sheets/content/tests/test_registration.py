from unittest.mock import patch

import frappe
import pycrdt
from frappe.tests import IntegrationTestCase

from suite.content import convert, editors, updates
from suite.sheets import content as sheets_content
from suite.sheets.content.tests.support import (
    converted,
    in_job,
    require_converter,
    schema_roots,
)
from suite.sheets.drive import SPEC


def settings(sheets_mode: str, *, before: str | None) -> frappe._dict:
    """Suite Collab Settings being saved with Sheets at `sheets_mode`, after Sheets at `before` (None: a new doc)."""

    def apps(mode: str) -> list[frappe._dict]:
        return [frappe._dict(app="writer", mode="on"), frappe._dict(app="sheets", mode=mode)]

    previous = frappe._dict(apps=apps(before)) if before else None
    return frappe._dict(apps=apps(sheets_mode), get_doc_before_save=lambda: previous)


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

    def test_settings_saves_go_through_the_guard(self):
        validate = frappe.get_hooks("doc_events")["Suite Collab Settings"]["validate"]
        self.assertIn("suite.sheets.content.refuse_turning_on", validate)

    def test_refuses_switching_sheets_on_before_the_editor_uses_the_room(self):
        for before in (None, "off"):
            with self.subTest(before=before):
                with self.assertRaises(frappe.ValidationError):
                    sheets_content.refuse_turning_on(settings("on", before=before))

    def test_a_site_left_on_can_still_change_other_apps(self):
        sheets_content.refuse_turning_on(settings("on", before="on"))
        sheets_content.refuse_turning_on(settings("off", before="on"))

    def test_switches_sheets_on_once_the_editor_uses_the_room(self):
        with patch.object(sheets_content, "EDITOR_READY", True):
            sheets_content.refuse_turning_on(settings("on", before="off"))

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
        self.state = result.state
        self.update = updates.parse(result.state)

    def edit(self, change) -> updates.Update:
        """One tab's edit on the converted doc, as the update it pushes."""
        doc: pycrdt.Doc = pycrdt.Doc(client_id=4242)
        doc.apply_update(self.state)
        seen = doc.get_state()
        change(doc)
        return updates.parse(doc.get_update(seen))

    def test_every_map_root_but_meta_takes_runtime_keys(self):
        self.assertEqual(sheets_content.SCHEMA.open_roots, {*schema_roots()} - {"meta", "sheets"})

    def test_a_converted_doc_passes_the_push_checks(self):
        self.assertTrue(sheets_content.SCHEMA.allows(self.update, 1))
        self.assertTrue(sheets_content.SCHEMA.could_write(self.update))

    def test_a_tab_typing_into_a_new_row_passes_the_push_checks(self):
        def type_below(doc: pycrdt.Doc) -> None:
            [sheet] = doc.get("sheets", type=pycrdt.Array).to_py()
            rows = doc.get("rows", type=pycrdt.Map)[sheet]
            rows.append("e2")
            [col] = doc.get("cols", type=pycrdt.Map)[sheet].to_py()
            doc.get("tails", type=pycrdt.Map)[f"{sheet}:rows:e"] = 2
            doc.get("inputs", type=pycrdt.Map)[f"{sheet}:e2:{col}"] = "=SUM(A1:A1)"
            doc.get("formats", type=pycrdt.Map)[f"{sheet}:e2:{col}"] = {"bold": True}
            doc.get("names", type=pycrdt.Map)["REVENUE"] = {"name": "Revenue", "range": "A1"}
            doc.get("charts", type=pycrdt.Map)["k3j9x0a1bq"] = {"type": "bar"}

        update = self.edit(type_below)

        self.assertTrue(sheets_content.SCHEMA.allows(update, 1))
        self.assertTrue(sheets_content.SCHEMA.could_write(update))

    def test_refuses_a_key_the_layer_cannot_take(self):
        bad = {
            "non-ASCII": ("names", "GRÖSSE"),
            "too long": ("names", "N" * 129),
            "a space": ("inputs", "s1 r1 c1"),
            "a new fixed key": ("meta", "colour"),
        }
        for label, (root, key) in bad.items():
            with self.subTest(label):
                update = self.edit(
                    lambda doc, root=root, key=key: doc.get(root, type=pycrdt.Map).__setitem__(key, 1)
                )
                self.assertFalse(sheets_content.SCHEMA.allows(update, 1))
