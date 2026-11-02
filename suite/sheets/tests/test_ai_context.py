# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt
"""AI Assist builds its context from the cells the editor sends.

The live room holds a sheet, and only the browser has formula results, so
`sheets_data` is stale once a sheet is collaborative: `ai_assist` never reads it.
"""

from __future__ import annotations

import json
from unittest import mock

import frappe
from frappe.tests import IntegrationTestCase

from suite.sheets import api
from suite.sheets.ai import context as ai_context
from suite.tests.utils import ensure_user

OWNER = "sheets-ai-owner@example.com"
STRANGER = "sheets-ai-stranger@example.com"
SELECTION = json.dumps({"sheet": "Sheet1", "r0": 1, "c0": 1, "r1": 2, "c1": 1, "active": "B2"})


class TestAiContext(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for user in (OWNER, STRANGER):
            ensure_user(user)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        settings = frappe.get_doc(api.AI_SETTINGS)
        kept = (settings.enabled, settings.model)
        self.addCleanup(self._settings, *kept)
        # The keyless model: heuristics only, nothing leaves the site
        self._settings(1, "mock")
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.name = api.create_sheet(title=f"AI {frappe.generate_hash(6)}")

    @staticmethod
    def _settings(enabled: int, model: str | None) -> None:
        frappe.db.set_single_value(api.AI_SETTINGS, {"enabled": enabled, "model": model})
        frappe.clear_document_cache(api.AI_SETTINGS, api.AI_SETTINGS)

    def ask(self, cells) -> dict:
        built = mock.patch.object(ai_context, "build_context", wraps=ai_context.build_context)
        stale = mock.patch.object(api, "decode_sheets_data", side_effect=AssertionError("read sheets_data"))
        with built as build, stale:
            answer = api.ai_assist(self.name, "sum", SELECTION, cells)
        self.context = build.call_args.args[0]
        return answer

    def test_the_context_is_the_cells_the_editor_sent(self):
        answer = self.ask(json.dumps({"B1": "Amount", "B2": "5", "B3": "7", "C9": ""}))

        self.assertEqual(self.context, {"B1": "Amount", "B2": "5", "B3": "7"})
        self.assertEqual(answer["source"], "heuristic")
        self.assertTrue([action for action in answer["actions"] if action["type"] == "setCell"])

    def test_no_cells_is_an_empty_sheet(self):
        self.ask("")
        self.assertEqual(self.context, {})

    def test_a_long_value_is_cut_short(self):
        self.ask(json.dumps({"A1": "x" * 5000}))
        self.assertEqual(len(self.context["A1"]), api.MAX_CONTEXT_VALUE_LEN)

    def test_someone_who_may_not_edit_the_sheet_is_refused(self):
        frappe.set_user(STRANGER)
        with self.assertRaises(frappe.PermissionError):
            api.ai_assist(self.name, "sum", SELECTION, json.dumps({"A1": "1"}))

    def test_cells_that_are_not_a_map_or_too_many_are_refused(self):
        too_many = {f"A{row}": "1" for row in range(1, api.MAX_CONTEXT_CELLS + 2)}
        for cells in ("[1, 2]", "not json", json.dumps(too_many)):
            with self.subTest(cells=cells[:20]), self.assertRaises(frappe.ValidationError):
                api.ai_assist(self.name, "sum", SELECTION, cells)
