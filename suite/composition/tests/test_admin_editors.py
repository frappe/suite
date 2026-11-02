"""A Suite Admin with only Comment access cannot save through any product's editor (ADR 0001)."""

import json
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite import drive
from suite.drive._core.access import grant
from suite.drive._core.nodes import _node
from suite.drive.framework import principals_for
from suite.sheets import api as sheets_api
from suite.slides.api.slides import save_slides
from suite.tests.utils import ensure_user

REFUSED = (frappe.PermissionError, drive.DriveError)
SHEET_BODY = json.dumps({"sheets": [{"name": "Sheet1", "cells": {"A1": {"v": "admin"}}}]})


class TestAdminEditorRefusals(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.addCleanup(frappe.set_user, "Administrator")
        self.enterContext(patch("frappe.publish_realtime"))
        suffix = frappe.generate_hash(length=8)
        self.owner = f"editors-owner-{suffix}@example.test"
        self.admin = f"editors-admin-{suffix}@example.test"
        for user in (self.owner, self.admin):
            ensure_user(user)
        frappe.get_doc("User", self.admin).add_roles("Suite Admin")
        root = frappe.db.get_value("Drive Root", {"kind": "Personal", "user": self.owner}, "name")
        self.owner_root = frappe.db.get_value("Drive Root", root, "node")

    def _commentable_document(self, doctype: str, title: str) -> str:
        frappe.set_user(self.owner)
        node = drive.create_document(self.owner_root, title, content_doctype=doctype)
        grant(node, self.admin, drive.COMMENT, principals_for(self.owner))
        return _node(node).content_docname

    def test_a_sheet_save_is_refused(self):
        sheet = self._commentable_document("Sheet", "Budget")
        frappe.set_user(self.admin)
        self.assertFalse(sheets_api.get_sheet(sheet)["can_write"])
        with self.assertRaises(REFUSED):
            sheets_api.save_sheet("Ignored", SHEET_BODY, name=sheet)

    def test_a_writer_save_is_refused(self):
        writer = self._commentable_document("Writer Document", "Plan")
        frappe.set_user(self.admin)
        with self.assertRaises(REFUSED):
            frappe.get_doc("Writer Document", writer).update_settings(json.dumps({"admin": True}))

    def test_a_slides_save_is_refused(self):
        deck = self._commentable_document("Presentation", "Pitch")
        frappe.set_user(self.admin)
        modified = str(frappe.db.get_value("Presentation", deck, "modified"))
        with self.assertRaises(REFUSED):
            save_slides(deck, [], modified)
