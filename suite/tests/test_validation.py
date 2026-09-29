# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""``parse`` turns a Pydantic failure into the ValidationError a Frappe user or API client reads:
it must say which field is wrong, and must be safe to render as HTML."""

from typing import Literal

import frappe
from frappe.tests import UnitTestCase
from pydantic import BaseModel

from suite.utils.validation import JSONList, parse, parse_json


class Settings(BaseModel):
    mode: Literal["fast", "slow"]
    retries: int = 3


class TestParse(UnitTestCase):
    def test_returns_the_parsed_value(self):
        settings = parse(Settings, {"mode": "fast", "retries": "5"})

        self.assertEqual((settings.mode, settings.retries), ("fast", 5))

    def test_failure_names_the_field(self):
        with self.assertRaisesRegex(frappe.ValidationError, "^mode: Input should be 'fast' or 'slow'$"):
            parse(Settings, {"mode": "medium"})

    def test_label_names_a_value_without_a_field(self):
        with self.assertRaisesRegex(frappe.ValidationError, "^page: Input should be a valid integer"):
            parse(int, "ten", "page")

    def test_every_failure_is_reported(self):
        with self.assertRaises(frappe.ValidationError) as caught:
            parse(Settings, {"mode": "medium", "retries": "many"})

        self.assertIn("mode:", str(caught.exception))
        self.assertIn("retries:", str(caught.exception))

    def test_caller_supplied_keys_are_escaped(self):
        with self.assertRaises(frappe.ValidationError) as caught:
            parse(dict[str, int], {"<img src=x onerror=alert(1)>": "x"})

        self.assertNotIn("<img", str(caught.exception))
        self.assertIn("&lt;img", str(caught.exception))

    def test_malformed_json_fails_like_a_wrong_shape(self):
        with self.assertRaisesRegex(frappe.ValidationError, "^Metadata: Invalid JSON"):
            parse_json(dict[str, bool], "{calendarIds: true}", "Metadata")

        with self.assertRaisesRegex(frappe.ValidationError, "^Metadata: Input should be an object"):
            parse_json(dict[str, bool], "[1, 2]", "Metadata")


class TestJSONList(UnitTestCase):
    def test_accepts_a_list_or_the_json_string_desk_sends(self):
        self.assertEqual(parse(JSONList[str], ["a|1"]), ["a|1"])
        self.assertEqual(parse(JSONList[str], '["a|1", "b|2"]'), ["a|1", "b|2"])

    def test_a_string_that_is_not_a_json_list_is_refused(self):
        for value in ("a|1", '{"name": "a|1"}', "[1, 2]"):
            with self.subTest(value=value), self.assertRaises(frappe.ValidationError):
                parse(JSONList[str], value)
