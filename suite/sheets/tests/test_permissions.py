# Copyright (c) 2026, Asif and Contributors
# See license.txt
"""Lock-in tests for child-doctype permission scoping.

These guard against regressions in the most serious finding from the
security audit: the stock `frappe.client.get_list` reading Sheet Op Log /
Sheet Snapshot must be scoped to sheets the caller can actually read.

We exercise the pure functions directly — they're branch-y but free of
side effects, so we mock `frappe.session.user`, `frappe.get_roles`,
`frappe.has_permission`, and `frappe.db.escape` to keep the tests
hermetic.

Ticket 19 gave every guard a second side to answer on, so each test here says
which one it is exercising: `db.get_value` answering `None` is a legacy sheet
Build has not linked. The Drive-native side is in
`suite.sheets.tests.test_drive_adoption`.
"""

from __future__ import annotations

import unittest
from unittest import mock

from suite.sheets import permissions


def _esc(value):
    return f"'{value}'"


def _legacy(f):
    """Make the mocked frappe answer "no sheet carries a node".

    Every guard reads the node column first, so a mock that answers a
    `MagicMock` there sends each of these tests down the Drive-native branch.
    """
    f.db.get_value.return_value = None
    f.db.sql.return_value = []


class QueryConditions(unittest.TestCase):
    def test_administrator_gets_no_filter(self):
        with mock.patch("suite.sheets.permissions.frappe") as f:
            f.session.user = "Administrator"
            self.assertEqual(permissions.sheet_op_log_query(), "")
            self.assertEqual(permissions.sheet_snapshot_query(), "")

    def test_system_manager_gets_no_filter(self):
        with mock.patch("suite.sheets.permissions.frappe") as f:
            f.session.user = "sm@example.com"
            f.get_roles.return_value = ["System Manager", "All"]
            self.assertEqual(permissions.sheet_op_log_query(), "")

    @mock.patch("frappe.share.get_shared", return_value=[])
    def test_regular_user_scoped_to_owned_and_shared(self, _shared):
        with mock.patch("suite.sheets.permissions.frappe") as f:
            f.session.user = "alice@example.com"
            f.get_roles.return_value = ["All"]
            f.db.escape.side_effect = _esc
            _legacy(f)
            sql = permissions.sheet_op_log_query()
        # Restriction must reference both ownership and DocShare paths, AND
        # must scope by the *caller's* identity (no other email leaked in).
        self.assertIn("`tabSheet Op Log`.sheet IN", sql)
        self.assertIn("`tabSheet`.`owner` = 'alice@example.com'", sql)
        self.assertIn("FROM `tabDocShare`", sql)
        self.assertIn("share_doctype = 'Sheet'", sql)
        self.assertIn("user = 'alice@example.com'", sql)
        # Ticket 19: neither arm may answer for a sheet Drive owns.
        self.assertEqual(sql.count("`tabSheet`.`node` IS NULL"), 2)

    @mock.patch("frappe.share.get_shared", return_value=[])
    def test_snapshot_query_targets_snapshot_table(self, _shared):
        with mock.patch("suite.sheets.permissions.frappe") as f:
            f.session.user = "alice@example.com"
            f.get_roles.return_value = ["All"]
            f.db.escape.side_effect = _esc
            _legacy(f)
            sql = permissions.sheet_snapshot_query()
        self.assertIn("`tabSheet Snapshot`.sheet IN", sql)


class HasPermission(unittest.TestCase):
    def test_admin_short_circuits(self):
        with mock.patch("suite.sheets.permissions.frappe") as f:
            f.session.user = "Administrator"
            doc = mock.Mock(sheet="SH-1")
            self.assertTrue(permissions.sheet_op_log_has_permission(doc, ptype="read"))
            # `has_permission` on parent must not be consulted for the admin.
            f.has_permission.assert_not_called()

    def test_read_on_child_delegates_to_read_on_parent(self):
        with mock.patch("suite.sheets.permissions.frappe") as f:
            f.session.user = "alice@example.com"
            f.get_roles.return_value = ["All"]
            _legacy(f)
            f.has_permission.return_value = True
            doc = mock.Mock(sheet="SH-1")
            self.assertTrue(permissions.sheet_op_log_has_permission(doc, ptype="read"))
            f.has_permission.assert_called_once_with(
                "Sheet", doc="SH-1", ptype="read", user="alice@example.com"
            )

    def test_write_on_child_requires_write_on_parent(self):
        with mock.patch("suite.sheets.permissions.frappe") as f:
            f.session.user = "alice@example.com"
            f.get_roles.return_value = ["All"]
            _legacy(f)
            f.has_permission.return_value = False
            doc = mock.Mock(sheet="SH-1")
            self.assertFalse(permissions.sheet_snapshot_has_permission(doc, ptype="write"))
            f.has_permission.assert_called_once_with(
                "Sheet", doc="SH-1", ptype="write", user="alice@example.com"
            )

    def test_doc_with_no_sheet_denied(self):
        with mock.patch("suite.sheets.permissions.frappe") as f:
            f.session.user = "alice@example.com"
            f.get_roles.return_value = ["All"]
            _legacy(f)
            # Plain dict shape (Frappe sometimes hands raw dicts to the hook).
            self.assertFalse(permissions.sheet_op_log_has_permission({}, ptype="read"))

    def test_dict_doc_extracts_sheet(self):
        with mock.patch("suite.sheets.permissions.frappe") as f:
            f.session.user = "alice@example.com"
            f.get_roles.return_value = ["All"]
            _legacy(f)
            f.has_permission.return_value = True
            self.assertTrue(permissions.sheet_snapshot_has_permission({"sheet": "SH-7"}, ptype="read"))


if __name__ == "__main__":
    unittest.main()
