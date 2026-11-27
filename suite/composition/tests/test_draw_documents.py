"""Ordinary-user scene access and stale-save protection against real Drive grants."""

import json
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite import draw, drive
from suite.drive._core.access import grant
from suite.drive._core.roots import personal_root_for
from suite.drive.framework import principals_for
from suite.drive.http.routes import node_version_restore
from suite.drive.tests.fixtures import storage_v2
from suite.tests.utils import ensure_user

OWNER = "draw-save-owner@example.com"
READER = "draw-save-reader@example.com"
STRANGER = "draw-save-stranger@example.com"
SCENE = '{"rectangles":[],"lines":[]}'
BOX = {"id": "box", "x": 1, "y": 2, "width": 30, "height": 40, "rotation": 0, "cornerRadius": 0}
EDITED_SCENE = json.dumps({"rectangles": [BOX], "lines": []})


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
        with storage_v2():
            saved = draw.save_drawing(self.node, EDITED_SCENE, self.body["modified"])
        with self.assertRaises(draw.DrawingConflict):
            draw.save_drawing(self.node, SCENE, self.body["modified"])
        current = draw.get_drawing(self.node)
        self.assertEqual(json.loads(current["content"]), json.loads(EDITED_SCENE))
        self.assertEqual(current["modified"], saved["modified"])

    def test_generic_document_save_cannot_replace_a_linked_scene(self):
        frappe.set_user(OWNER)
        document = frappe.get_doc("Drawing", self.body["name"])
        document.content = EDITED_SCENE

        with self.assertRaisesRegex(frappe.PermissionError, "Save drawing scenes through Draw"):
            document.save()

        self.assertEqual(draw.get_drawing(self.node)["content"], self.body["content"])

    def test_save_locks_the_drive_node_before_the_drawing_row(self):
        statements = []
        original_sql = frappe.db.sql

        def record_sql(query, values=(), *args, **kwargs):
            if isinstance(query, str) and "FOR UPDATE" in query.upper():
                parameters = values.values() if isinstance(values, dict) else values
                statements.append((query, parameters))
            return original_sql(query, values, *args, **kwargs)

        with patch.object(frappe.db, "sql", side_effect=record_sql), storage_v2():
            draw.save_drawing(self.node, SCENE, self.body["modified"])

        drive_lock = next(
            i
            for i, (query, parameters) in enumerate(statements)
            if "tabDrive Node" in query and self.node in (parameters or ())
        )
        drawing_lock = next(i for i, (query, _) in enumerate(statements) if "tabDrawing" in query)
        self.assertLess(drive_lock, drawing_lock)

    def test_valid_version_repairs_a_legacy_scene(self):
        legacy_scene = {"rectangles": [{**BOX, "labelFontSize": 0}], "lines": []}
        with storage_v2():
            draw.save_drawing(self.node, EDITED_SCENE, self.body["modified"])
            valid_version = drive.list_versions(self.node)["rows"][0]["seq"]
            # Represent a scene stored before Draw validated editor metadata.
            frappe.db.set_value("Drawing", self.body["name"], "content", json.dumps(legacy_scene))
            legacy_version = node_version_restore(self.node, valid_version)
            self.assertIsNotNone(legacy_version)

            restored = draw.get_drawing(self.node)
            self.assertEqual(json.loads(restored["content"]), json.loads(EDITED_SCENE))
            with self.assertRaisesRegex(frappe.ValidationError, "invalid style or metadata"):
                node_version_restore(self.node, legacy_version["seq"])
            self.assertEqual(draw.get_drawing(self.node), restored)

    def test_a_non_drawing_node_is_a_missing_drawing(self):
        folder = personal_root_for(OWNER)
        with self.assertRaises(draw.DrawingNotFound):
            draw.save_drawing(folder, SCENE, self.body["modified"])
