# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt
"""The Sheets API names a sheet by its node.

A sheet carries its name on its Drive node and nowhere else. These run on a
site, through the whitelisted endpoints, and check that the name a caller gave
`create_sheet` is the name `get_sheet` gives back, and that a stranger is not
told the sheet exists.
"""

from __future__ import annotations

import frappe
from frappe.tests import IntegrationTestCase

from suite import drive
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

    def test_the_new_sheet_is_named_on_its_node(self):
        self.assertEqual(frappe.db.get_value("Drive Node", self.node, "title"), self.title)

    def test_the_editor_opens_it_under_the_name_it_was_given(self):
        self.assertEqual(api.get_sheet(self.name)["title"], self.title)

    def test_the_editor_gets_the_node_it_records_a_visit_on(self):
        self.assertEqual(api.get_sheet(self.name)["node"], self.node)

    def test_a_stranger_cannot_open_it_by_id(self):
        frappe.set_user(OTHER)
        # Drive answers a caller below Read with `DriveNotFound`, so the reply
        # does not say whether the sheet exists (§5.4).
        with self.assertRaises(drive.DriveNotFound):
            api.get_sheet(self.name)
