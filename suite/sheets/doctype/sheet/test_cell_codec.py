# Copyright (c) 2026, Asif and Contributors
# See license.txt
"""Tests for the server-side compact `sheet` slice reader.

Parity with the frontend packer (frontend/src/utils/sheet-codec.js) matters:
AI Assist reads cell values out of a payload the browser wrote, so the column
labelling and row offsets must agree exactly.
"""

import unittest

from suite.sheets.doctype.sheet.cell_codec import cell_map


class CellMapCompact(unittest.TestCase):
	def test_reads_compact_v2_slice(self):
		# As produced by packSheet: rows keyed by 0-based row, value arrays by
		# 0-based column.
		slice_ = {
			"v": 2,
			"current": "Sheet1",
			"sheets": {"Sheet1": {"rows": {"0": ["Date", "Day"], "1": ["2013-11-26", "26"]}}},
		}
		self.assertEqual(
			cell_map(slice_, "Sheet1"),
			{"A1": "Date", "B1": "Day", "A2": "2013-11-26", "B2": "26"},
		)

	def test_column_labels_past_z(self):
		# Column 26 -> "AA"; holes before it must not become cells.
		slice_ = {"v": 2, "sheets": {"S": {"rows": {"0": [None] * 26 + ["wide"]}}}}
		self.assertEqual(cell_map(slice_, "S"), {"AA1": "wide"})

	def test_skips_empty_and_null_slots(self):
		slice_ = {"v": 2, "sheets": {"S": {"rows": {"0": ["keep", "", None]}}}}
		self.assertEqual(cell_map(slice_, "S"), {"A1": "keep"})

	def test_unknown_sheet_is_empty(self):
		slice_ = {"v": 2, "sheets": {"S": {"rows": {"0": ["x"]}}}}
		self.assertEqual(cell_map(slice_, "Other"), {})


class CellMapLegacy(unittest.TestCase):
	def test_reads_legacy_unversioned_slice(self):
		slice_ = {"current": "Sheet1", "sheets": {"Sheet1": {"A1": "old", "B2": "v"}}}
		self.assertEqual(cell_map(slice_, "Sheet1"), {"A1": "old", "B2": "v"})

	def test_garbage_inputs_yield_empty(self):
		self.assertEqual(cell_map(None, "Sheet1"), {})
		self.assertEqual(cell_map({}, "Sheet1"), {})
		self.assertEqual(cell_map({"sheets": {"Sheet1": "nope"}}, "Sheet1"), {})


if __name__ == "__main__":
	unittest.main()
