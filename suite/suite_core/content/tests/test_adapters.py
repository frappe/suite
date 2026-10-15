import dataclasses
from unittest.mock import patch

import frappe
from frappe.tests import UnitTestCase

from suite.suite_core.content import adapters
from suite.suite_core.content.tests import note

HOOK = "suite.suite_core.content.tests.note.SPEC"


def registered(*paths: str):
    real = frappe.get_hooks

    def get_hooks(hook=None, *args, **kwargs):
        return list(paths) if hook == "suite_content_adapters" else real(hook, *args, **kwargs)

    return patch.object(frappe, "get_hooks", get_hooks)


def declared(**changes):
    return patch.object(note, "SPEC", dataclasses.replace(note.SPEC, **changes))


class TestAdapterDeclarations(UnitTestCase):
    def refusal(self, *paths: str) -> str:
        with registered(*paths), self.assertRaises(ValueError) as refused:
            adapters.adapters()
        return str(refused.exception)

    def test_an_app_that_declares_everything_is_registered(self):
        with registered(HOOK):
            self.assertEqual(adapters.adapters(), {"note": note.SPEC})

    def test_an_app_with_a_declaration_left_empty_is_refused_naming_the_app_and_the_declaration(self):
        with declared(check_copy=None):
            refused = self.refusal(HOOK)

        self.assertIn("(note)", refused)
        self.assertIn("check_copy", refused)

    def test_an_app_that_leaves_a_declaration_out_is_refused_naming_its_path(self):
        def construct(path):
            return adapters.ContentAdapterSpec(name="note")

        with patch.object(frappe, "get_attr", construct):
            refused = self.refusal(HOOK)

        self.assertIn(HOOK, refused)
        self.assertIn("missing", refused)

    def test_each_wrongly_declared_value_is_named(self):
        cases = {
            "name": "Not A Table Name",
            "roots": {},
            "copy_field": "",
            "codec": "json",
            "max_state": 0,
            "max_change": -1,
            "file_values": "not callable",
        }
        for field, value in cases.items():
            with self.subTest(field=field), declared(**{field: value}):
                self.assertIn(f"declares {field} wrongly", self.refusal(HOOK))

    def test_two_apps_with_one_name_are_refused(self):
        self.assertIn("note", self.refusal(HOOK, HOOK))
