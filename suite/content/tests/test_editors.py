import dataclasses
from contextlib import contextmanager
from unittest.mock import patch

import frappe
from frappe.tests import UnitTestCase

from suite.content import editors
from suite.content.tests import note
from suite.drive._core.content import clear_registry_cache

HOOK = "suite.content.tests.note.EDITOR"
DRIVE_HOOK = "suite.content.tests.note.SPEC"


@contextmanager
def registered(*paths: str):
    real = frappe.get_hooks

    def get_hooks(hook=None, *args, **kwargs):
        if hook == "suite_content_editors":
            return list(paths)

        found = real(hook, *args, **kwargs)
        if hook == "drive_content_types":
            return [*found, DRIVE_HOOK]

        return found

    clear_registry_cache()
    try:
        with patch.object(frappe, "get_hooks", get_hooks):
            yield
    finally:
        clear_registry_cache()


def declared(**changes):
    return patch.object(note, "EDITOR", dataclasses.replace(note.EDITOR, **changes))


class TestEditorDeclarations(UnitTestCase):
    def refusal(self, *paths: str) -> str:
        with registered(*paths), self.assertRaises(ValueError) as refused:
            editors.editors()

        return str(refused.exception)

    def test_an_app_that_declares_everything_is_registered(self):
        with registered(HOOK):
            self.assertEqual(editors.editors(), {"note": note.EDITOR})

    def test_an_app_with_no_readable_copy_or_media_is_registered(self):
        with registered(HOOK), declared(readable_copy=None, media=None):
            self.assertIsNone(editors.editors()["note"].readable_copy)

    def test_an_app_with_a_declaration_left_empty_is_refused_naming_the_app_and_the_declaration(self):
        with declared(body_field=None):
            refused = self.refusal(HOOK)

        self.assertIn("(note)", refused)
        self.assertIn("body_field", refused)

    def test_an_app_that_leaves_a_declaration_out_is_refused_naming_its_path(self):
        def construct(path):
            return editors.EditorSpec(app="note")

        with patch.object(frappe, "get_attr", construct):
            refused = self.refusal(HOOK)

        self.assertIn(HOOK, refused)
        self.assertIn("missing", refused)

    def test_each_wrongly_declared_value_is_named(self):
        build = note.EDITOR.checker_build
        cases = [
            ("app", "Not A Table Name"),
            ("part_map", {}),
            ("readable_copy", editors.HtmlCopy(field="", is_html_complete=lambda state, html, text: True)),
            ("media", editors.MediaReferences(node_ids="not callable", value_rewriter=lambda mapping: str)),
            (
                "conversion",
                editors.Conversion(
                    build,
                    "1",
                    read_old="not callable",
                    read_fingerprint=lambda node: "",
                    check=lambda *args: None,
                    fix_up=lambda *args: None,
                ),
            ),
            (
                "conversion",
                editors.Conversion(
                    build,
                    "1",
                    read_old=lambda node: None,
                    read_fingerprint=lambda node: "",
                    check="not callable",
                    fix_up=lambda *args: None,
                ),
            ),
            (
                "conversion",
                editors.Conversion(
                    build,
                    "1",
                    read_old=lambda node: None,
                    read_fingerprint=lambda node: "",
                    check=lambda *args: None,
                    fix_up="not callable",
                ),
            ),
            (
                "conversion",
                editors.Conversion(
                    build,
                    "1",
                    read_old=lambda node: None,
                    read_fingerprint="not callable",
                    check=lambda *args: None,
                    fix_up=lambda *args: None,
                ),
            ),
        ]
        for field, value in cases:
            with self.subTest(field=field), declared(**{field: value}):
                self.assertIn(f"declares {field} wrongly", self.refusal(HOOK))

    def test_two_apps_with_one_name_are_refused(self):
        self.assertIn("note", self.refusal(HOOK, HOOK))
