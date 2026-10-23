# Copyright (c) 2026, Asif and Contributors
# See license.txt
"""Tests for the input-validation surface of `versioning.save`.

We only assert pure validation behaviour here (size cap, JSON shape, ops
coercion). End-to-end save + op-log writing is integration-tested under
bench, not here.
"""

from __future__ import annotations

import json
import unittest
from unittest import mock

from suite.sheets.doctype.sheet.storage import encode_sheets_data
from suite.sheets.versioning import save as save_mod


class PayloadValidation(unittest.TestCase):
    def test_plain_json_passes(self):
        payload = json.dumps({"A1": "hi"})
        self.assertEqual(save_mod._validate_payload(payload), payload)

    def test_envelope_decoded_for_size_check(self):
        # A compressed envelope around a tiny JSON payload should validate
        # against the *uncompressed* size.
        plain = json.dumps({"A1": "hi"})
        envelope = encode_sheets_data(plain)
        self.assertEqual(save_mod._validate_payload(envelope), plain)

    def test_non_string_throws(self):
        with mock.patch(
            "suite.sheets.versioning.save.frappe.throw",
            side_effect=ValueError("must be string"),
        ):
            with self.assertRaises(ValueError):
                save_mod._validate_payload({"not": "a string"})

    def test_invalid_json_throws(self):
        with mock.patch(
            "suite.sheets.versioning.save.frappe.throw",
            side_effect=ValueError("not valid JSON"),
        ):
            with self.assertRaises(ValueError):
                save_mod._validate_payload("{not json}")


class OpsCoercion(unittest.TestCase):
    def test_none_returns_empty(self):
        self.assertEqual(save_mod._coerce_ops(None), [])

    def test_empty_string_returns_empty(self):
        self.assertEqual(save_mod._coerce_ops(""), [])

    def test_string_json_array_parsed(self):
        ops = save_mod._coerce_ops('[{"op_type":"edit"}]')
        self.assertEqual(ops, [{"op_type": "edit"}])

    def test_list_passes_through(self):
        ops = [{"op_type": "paste"}]
        self.assertEqual(save_mod._coerce_ops(ops), ops)

    def test_non_array_throws(self):
        with mock.patch(
            "suite.sheets.versioning.save.frappe.throw",
            side_effect=ValueError("must be array"),
        ):
            with self.assertRaises(ValueError):
                save_mod._coerce_ops('{"not": "an array"}')

    def test_too_many_ops_throws(self):
        too_many = [{"op_type": "edit"}] * (save_mod.MAX_OPS_PER_SAVE + 1)
        with mock.patch(
            "suite.sheets.versioning.save.frappe.throw",
            side_effect=ValueError("too many"),
        ):
            with self.assertRaises(ValueError):
                save_mod._coerce_ops(too_many)


class ByteFormatter(unittest.TestCase):
    def test_bytes(self):
        self.assertEqual(save_mod._format_bytes(900), "900 B")

    def test_kilobytes(self):
        self.assertIn("KB", save_mod._format_bytes(5000))

    def test_megabytes(self):
        self.assertIn("MB", save_mod._format_bytes(5 * 1024 * 1024))


if __name__ == "__main__":
    unittest.main()
