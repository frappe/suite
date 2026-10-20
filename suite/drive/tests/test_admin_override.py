"""A Suite Admin administers Drive but reads and edits only through grants (ADR 0001)."""

import json
from io import BytesIO
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite import drive
from suite.drive._core import comments
from suite.drive._core.access import describe, grant
from suite.drive._core.nodes import _node, get, purge, store_file, update
from suite.drive._core.roots import usage_for
from suite.drive.framework import principals_for
from suite.drive.patches import grant_admin_creators_edit
from suite.sheets import api as sheets_api
from suite.slides.api.slides import save_slides
from suite.suite_core.administration import update_user
from suite.tests.utils import ensure_user

REFUSED = (frappe.PermissionError, drive.DriveError)
SHEET_BODY = json.dumps({"sheets": [{"name": "Sheet1", "cells": {"A1": {"v": "admin"}}}]})


class TestSuiteAdminOverride(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.addCleanup(frappe.set_user, "Administrator")
        self.enterContext(patch("suite.sheets.api.frappe.publish_realtime"))
        suffix = frappe.generate_hash(length=8)
        self.owner = f"override-owner-{suffix}@example.test"
        self.admin = f"override-admin-{suffix}@example.test"
        self.other = f"override-other-{suffix}@example.test"
        for user in (self.owner, self.admin, self.other):
            ensure_user(user)
        frappe.get_doc("User", self.admin).add_roles("Suite Admin")
        self.owner_root = self._root_node(self.owner)
        self.other_root = self._root_node(self.other)

    def _root_node(self, user: str) -> str:
        root = frappe.db.get_value("Drive Root", {"kind": "Personal", "user": user}, "name")
        return frappe.db.get_value("Drive Root", root, "node")

    def _as(self, user: str):
        frappe.set_user(user)
        return principals_for(user)

    def _document(self, doctype: str, title: str) -> tuple[str, str]:
        owner = self._as(self.owner)
        node = drive.create_document(self.owner_root, title, content_doctype=doctype)
        grant(node, self.admin, drive.COMMENT, owner)
        return node, _node(node).content_docname

    def test_a_commenting_admin_comments_but_no_editor_saves_for_them(self):
        sheet_node, sheet = self._document("Sheet", "Budget")
        writer_node, writer = self._document("Writer Document", "Plan")
        deck_node, deck = self._document("Presentation", "Pitch")

        admin = self._as(self.admin)
        for node in (sheet_node, writer_node, deck_node):
            access = describe(_node(node), admin)
            self.assertEqual(access["role"], drive.COMMENT)
            self.assertTrue(access["can_manage"])
        comments.create_thread(admin, sheet_node, "A1", "Looks off by one")

        self.assertFalse(sheets_api.get_sheet(sheet)["can_write"])
        head = frappe.db.get_value("Sheet", sheet, "head_seq")
        with self.assertRaises(REFUSED):
            sheets_api.save_sheet("Ignored", SHEET_BODY, name=sheet, base_seq=head)
        with self.assertRaises(REFUSED):
            frappe.get_doc("Writer Document", writer).save_doc(json.dumps({"admin": True}))
        modified = str(frappe.db.get_value("Presentation", deck, "modified"))
        with self.assertRaises(REFUSED):
            save_slides(deck, [], modified)

    def test_a_commenting_admin_still_shares_and_restores_what_others_trashed(self):
        node, _docname = self._document("Sheet", "Shared budget")
        update(self._as(self.owner), node, state="Trashed")

        admin = self._as(self.admin)
        update(admin, node, state="Active")
        self.assertEqual(_node(node).state, "Active")
        grant(node, self.other, drive.READ, admin)
        self.assertEqual(describe(_node(node), principals_for(self.other))["role"], drive.READ)

    def test_an_admin_without_a_grant_administers_what_they_cannot_open(self):
        owner = self._as(self.owner)
        private = store_file(owner, self.owner_root, "private.txt", BytesIO(b"secret"))
        trashed = store_file(owner, self.owner_root, "old.txt", BytesIO(b"old"))
        update(owner, trashed, state="Trashed")

        admin = self._as(self.admin)
        with self.assertRaises(drive.DriveNotFound):
            get(admin, private)
        root = frappe.db.get_value("Drive Root", {"kind": "Personal", "user": self.owner}, "name")
        self.assertIn("largest", usage_for(root, admin, breakdown=True))
        grant(private, self.other, drive.READ, admin)
        self.assertEqual(purge(admin, trashed), 1)

    def test_an_admin_transfers_a_departed_users_content_without_any_grant(self):
        private = store_file(self._as(self.owner), self.owner_root, "handover.txt", BytesIO(b"notes"))
        frappe.set_user("Administrator")
        destination = drive.ensure_folder(self.other_root, "From departed")
        update_user(self.owner, enabled=False)

        self._as(self.admin)
        with (
            patch("suite.suite_core.utils.is_suite_cloud_configured", return_value=False),
            patch("suite.drive._core.offboarding.is_suite_cloud_configured", return_value=False),
        ):
            preview = drive.preview_user_transfer(self.owner, destination)
            result = drive.transfer_user_drive(
                self.owner, destination, preview["fingerprint"], confirm_access=True
            )
        self.assertTrue(result["complete"], result)
        self.assertEqual(_node(private).parent_node, destination)
        self.assertFalse(frappe.db.exists("Drive Grant", {"node": private, "principal": self.admin}))

    def test_the_patch_gives_an_admin_the_creator_grant_the_override_skipped(self):
        owner = self._as(self.owner)
        grant(self.owner_root, self.admin, drive.UPLOAD, owner)
        created = store_file(self._as(self.admin), self.owner_root, "admin.txt", BytesIO(b"mine"))
        creator_grant = {"node": created, "principal": self.admin, "role": drive.EDIT}
        self.assertTrue(frappe.db.exists("Drive Grant", creator_grant))

        frappe.db.delete("Drive Grant", creator_grant)
        frappe.set_user("Administrator")
        grant_admin_creators_edit.execute()
        grant_admin_creators_edit.execute()
        self.assertEqual(frappe.db.count("Drive Grant", creator_grant), 1)
