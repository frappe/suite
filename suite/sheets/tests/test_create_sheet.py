# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt
"""create_sheet's Drive-native adapter (ticket 29).

Once `Sheet` joined `drive_content_types`, `content.require_node` refuses an
insert with no node (`content.py:757-770`). The legacy `create_sheet` built a
bare `Sheet` through `versioning.save`, so every call raised `DriveConflict`.

These are shape tests, not integration tests: `frappe` and `suite.sheets.api.drive`
are mocked wholesale, the way `test_api_security.py` and `test_list_sheets.py`
already do for this module, so they pin the adapter's contract — what it calls,
in what order, and what it returns — without a site. The Drive-native lifecycle
itself (`drive.create_document`, `require_node`, the reciprocal link) is
`suite.sheets.tests.test_drive_adoption`'s `TestSheetsInDrive`.
"""

from __future__ import annotations

import unittest
from unittest import mock


class _CreateSheetBase(unittest.TestCase):
    def setUp(self):
        frappe_patcher = mock.patch("suite.sheets.api.frappe")
        self.frappe = frappe_patcher.start()
        self.addCleanup(frappe_patcher.stop)
        self.frappe.session.user = "alice@example.com"

        drive_patcher = mock.patch("suite.sheets.api.drive")
        self.drive = drive_patcher.start()
        self.addCleanup(drive_patcher.stop)

        docname_patcher = mock.patch("suite.sheets.api.docname_for_node")
        self.docname_for_node = docname_patcher.start()
        self.addCleanup(docname_patcher.stop)

        self.drive.create_document.return_value = "node-1"
        self.docname_for_node.return_value = "SH-1"


class CreateSheetWithAGivenParent(_CreateSheetBase):
    def test_creates_through_drive_and_resolves_the_docname(self):
        from suite.sheets import api

        result = api.create_sheet(title="Budget", parent="folder-1")

        self.drive.create_document.assert_called_once_with("folder-1", "Budget", content_doctype="Sheet")
        self.docname_for_node.assert_called_once_with("node-1")
        self.assertEqual(result, "SH-1")

    def test_does_not_look_up_a_home_folder(self):
        # An explicit parent needs no personal-root fallback — Drive's own
        # UPLOAD check on `parent` is the only authorization that runs.
        from suite.sheets import api

        api.create_sheet(title="Budget", parent="folder-1")

        self.drive.personal_root_for.assert_not_called()
        self.drive.ensure_personal_root.assert_not_called()

    def test_blank_title_becomes_untitled(self):
        from suite.sheets import api

        api.create_sheet(title="   ", parent="folder-1")

        self.drive.create_document.assert_called_once_with(
            "folder-1", "Untitled Spreadsheet", content_doctype="Sheet"
        )


class CreateSheetWithNoParent(_CreateSheetBase):
    def test_falls_back_to_the_callers_existing_root(self):
        from suite.sheets import api

        self.drive.personal_root_for.return_value = "root-alice"

        api.create_sheet(title="Budget", parent="")

        self.drive.personal_root_for.assert_called_once_with("alice@example.com")
        self.drive.ensure_personal_root.assert_not_called()
        self.drive.create_document.assert_called_once_with("root-alice", "Budget", content_doctype="Sheet")

    def test_provisions_a_root_on_first_use(self):
        from suite.sheets import api

        self.drive.personal_root_for.return_value = None
        self.drive.ensure_personal_root.return_value = "root-fresh"

        api.create_sheet(title="Budget", parent="")

        self.drive.ensure_personal_root.assert_called_once_with("alice@example.com")
        self.drive.create_document.assert_called_once_with("root-fresh", "Budget", content_doctype="Sheet")

    def test_refuses_when_the_caller_has_no_home_folder(self):
        # Guest and Administrator both come back None from `ensure_personal_root`
        # (§7: a Personal root belongs to an ordinary Suite user).
        from suite.sheets import api

        self.drive.personal_root_for.return_value = None
        self.drive.ensure_personal_root.return_value = None
        self.frappe.throw.side_effect = RuntimeError("no folder")

        with self.assertRaises(RuntimeError):
            api.create_sheet(title="Budget", parent="")

        self.drive.create_document.assert_not_called()


class CreateSheetRollsBackOnRefusal(_CreateSheetBase):
    def test_a_drive_refusal_propagates_without_reading_a_docname(self):
        # drive.create_document runs the whole create in its own savepoint
        # (node + Sheet + reciprocal link) and rolls it back on any failure;
        # the adapter must not paper over that by still trying to resolve
        # a docname for a create that never happened.
        from suite.sheets import api

        class _Refused(Exception):
            pass

        self.drive.create_document.side_effect = _Refused("no upload rights")

        with self.assertRaises(_Refused):
            api.create_sheet(title="Budget", parent="folder-1")

        self.docname_for_node.assert_not_called()

    def test_a_missing_reciprocal_link_is_never_silently_returned(self):
        # Structurally shouldn't happen — `nodes._link_document` guarantees the
        # reciprocal link before `create_document` returns — but the adapter
        # must refuse loudly rather than hand the caller a null sheet id.
        from suite.sheets import api

        self.docname_for_node.return_value = None
        self.frappe.throw.side_effect = RuntimeError("not found")

        with self.assertRaises(RuntimeError):
            api.create_sheet(title="Budget", parent="folder-1")
