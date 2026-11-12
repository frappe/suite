"""Ordinary-user scene access and stale-save protection against real Drive grants."""

import json

import frappe
from frappe.tests import IntegrationTestCase

from suite import draw, drive
from suite.drive._core.access import grant
from suite.drive._core.roots import personal_root_for
from suite.drive.framework import principals_for
from suite.drive.tests.fixtures import storage_v2
from suite.tests.utils import ensure_user

OWNER = "draw-save-owner@example.com"
READER = "draw-save-reader@example.com"
STRANGER = "draw-save-stranger@example.com"
SCENE = '{"rectangles":[],"lines":[]}'


class TestDrawingDocuments(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        for user in (OWNER, READER, STRANGER):
            ensure_user(user)
        # IntegrationTestCase rolls back once per class, so isolate each fixture.
        savepoint = "draw_test_" + frappe.generate_hash(length=10)
        frappe.db.savepoint(savepoint)
        self.addCleanup(frappe.db.rollback, save_point=savepoint)
        frappe.set_user(OWNER)
        self.node = drive.create_document(
            personal_root_for(OWNER), "Save protection", content_doctype="Drawing"
        )
        self.body = draw.get_drawing(self.node)
        grant(self.node, READER, drive.READ, principals_for())
        self.addCleanup(frappe.set_user, "Administrator")

    def test_stranger_and_guest_cannot_read_or_save(self):
        for user, error in ((STRANGER, drive.DriveNotFound), ("Guest", frappe.PermissionError)):
            with self.subTest(user=user):
                frappe.set_user(user)
                with self.assertRaises(error):
                    draw.get_drawing(self.node)
                with self.assertRaises(error):
                    draw.save_drawing(self.node, SCENE, self.body["modified"])
        frappe.set_user(OWNER)
        self.assertEqual(draw.get_drawing(self.node), self.body)

    def test_reader_can_open_but_cannot_replace_scene(self):
        frappe.set_user(READER)
        self.assertEqual(draw.get_drawing(self.node)["content"], self.body["content"])
        with self.assertRaises(drive.DriveForbidden):
            draw.save_drawing(self.node, SCENE, self.body["modified"])
        frappe.set_user(OWNER)
        self.assertEqual(draw.get_drawing(self.node), self.body)

    def test_stale_save_keeps_the_last_acknowledged_scene(self):
        content = json.dumps(
            {
                "rectangles": [
                    {"id": "box", "x": 1, "y": 2, "width": 30, "height": 40, "rotation": 0, "cornerRadius": 0}
                ],
                "lines": [],
            }
        )
        with storage_v2():
            saved = draw.save_drawing(self.node, content, self.body["modified"])
        with self.assertRaises(draw.DrawingConflict):
            draw.save_drawing(self.node, SCENE, self.body["modified"])
        current = draw.get_drawing(self.node)
        self.assertEqual(json.loads(current["content"]), json.loads(content))
        self.assertEqual(current["modified"], saved["modified"])
