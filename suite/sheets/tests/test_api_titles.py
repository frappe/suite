# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt
"""The legacy Sheets API, on sheets Drive owns (ticket 29).

`Sheet.title` is frozen once the declaration is registered (§10.2), so a sheet
written since activation carries its name on its node and nothing else. These
run on a site, through the whitelisted endpoints, and check the one thing the
shape tests in `test_list_sheets.py` cannot: that the name a caller gave
`create_sheet` is the name `get_sheet` and `list_sheets` give back, and that
reading Drive's column with permissions off does not widen who may see it.
"""

from __future__ import annotations

import frappe
from frappe.tests import IntegrationTestCase

from suite.sheets import api
from suite.tests.utils import ensure_user

USER = "sheets-title-user@example.com"
OTHER = "sheets-title-other@example.com"


class TestSheetTitlesOnSite(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for user in (USER, OTHER):
            ensure_user(user)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.title = f"Budget {frappe.generate_hash(6)}"
        self.name = api.create_sheet(title=self.title)
        self.node = frappe.db.get_value("Sheet", self.name, "node")
        self.addCleanup(self._drop, self.node)

    @staticmethod
    def _drop(node: str):
        from suite.drive._core.nodes import purge, update
        from suite.drive._core.principals import Principals

        frappe.set_user("Administrator")
        if not frappe.db.exists("Drive Node", node):
            return
        admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        update(admin, node, state="Trashed")
        purge(admin, node)
        frappe.db.commit()

    def _listed(self, **kwargs) -> dict | None:
        rows = api.list_sheets(**kwargs)["sheets"]
        return next((row for row in rows if row["name"] == self.name), None)

    def test_the_new_sheet_is_named_on_its_node_and_not_on_its_row(self):
        self.assertEqual(frappe.db.get_value("Drive Node", self.node, "title"), self.title)
        self.assertFalse(frappe.db.get_value("Sheet", self.name, "title"))

    def test_the_editor_opens_it_under_the_name_it_was_given(self):
        self.assertEqual(api.get_sheet(self.name)["title"], self.title)

    def test_the_list_names_it_the_same_way(self):
        row = self._listed()
        self.assertIsNotNone(row)
        self.assertEqual(row["title"], self.title)

    def test_the_list_does_not_publish_the_node_id(self):
        self.assertNotIn("node", self._listed())

    def test_a_search_finds_it_by_the_name_on_its_node(self):
        row = self._listed(search=self.title.split()[-1])
        self.assertIsNotNone(row, "the frozen column holds nothing to match")

    def test_a_search_that_matches_nothing_returns_nothing(self):
        self.assertEqual(api.list_sheets(search=frappe.generate_hash(10))["sheets"], [])

    def test_a_stranger_searching_the_same_word_is_not_shown_it(self):
        """`_sheets_titled_like` reads Drive's title column with permissions
        off, so the refusal has to come from the `Sheet` query it feeds."""
        frappe.set_user(OTHER)
        self.assertIsNone(self._listed(search=self.title.split()[-1]))

    def test_the_count_a_stranger_is_given_does_not_include_it(self):
        frappe.set_user(USER)
        mine = api.list_sheets(search=self.title.split()[-1])["total"]
        frappe.set_user(OTHER)
        theirs = api.list_sheets(search=self.title.split()[-1])["total"]
        self.assertEqual(mine, 1)
        self.assertEqual(theirs, 0)

    def test_a_stranger_cannot_open_it_by_id(self):
        frappe.set_user(OTHER)
        with self.assertRaises(frappe.PermissionError):
            api.get_sheet(self.name)
