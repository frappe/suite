"""Legacy drawing bodies, identity, grants, and rollback survive adoption."""

from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import get_datetime

from suite.drive.patches import adopt_drawings
from suite.drive.patches.build.docshare_journal import DocSharePreimageJournal
from suite.tests.utils import ensure_user

OWNER = "draw-adopt-owner@example.com"
READER = "draw-adopt-reader@example.com"
STAMP = "2024-01-02 03:04:05.000000"
CONTENT = '{"rectangles":[],"lines":[]}'


class TestDrawingAdoption(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        ensure_user(OWNER)
        ensure_user(READER)
        # IntegrationTestCase rolls back once per class, so isolate each fixture.
        savepoint = "draw_test_" + frappe.generate_hash(length=10)
        frappe.db.savepoint(savepoint)
        self.addCleanup(frappe.db.rollback, save_point=savepoint)
        self.name = "draw-adoption-" + frappe.generate_hash(length=10)
        frappe.get_doc(
            {
                "doctype": "Drawing",
                "name": self.name,
                "title": "Legacy drawing",
                "owner": OWNER,
                "creation": STAMP,
                "modified": STAMP,
                "modified_by": OWNER,
                "content": CONTENT,
            }
        ).db_insert()
        self.share = "draw-share-" + frappe.generate_hash(length=10)
        frappe.get_doc(
            {
                "doctype": "DocShare",
                "name": self.share,
                "share_doctype": "Drawing",
                "share_name": self.name,
                "user": READER,
                "read": 1,
                "write": 0,
                "share": 0,
                "everyone": 0,
                "owner": OWNER,
            }
        ).db_insert()
        self.temp = self.enterContext(TemporaryDirectory())
        self.enterContext(patch.dict(frappe.conf, {"draw_adoption_backup": self.temp}))
        self.enterContext(
            patch.object(
                DocSharePreimageJournal, "for_site", return_value=DocSharePreimageJournal(Path(self.temp))
            )
        )

    def test_adoption_preserves_body_metadata_and_read_grant_on_rerun(self):
        adopt_drawings.execute()
        adopt_drawings.execute()
        body = frappe.db.get_value(
            "Drawing",
            self.name,
            ["node", "content", "title", "owner", "creation", "modified", "modified_by"],
            as_dict=True,
        )
        self.assertEqual(
            dict(body),
            {
                "node": self.name,
                "content": CONTENT,
                "title": "Legacy drawing",
                "owner": OWNER,
                "creation": get_datetime(STAMP),
                "modified": get_datetime(STAMP),
                "modified_by": OWNER,
            },
        )
        self.assertEqual(
            frappe.db.get_value("Drive Grant", {"node": self.name, "principal": READER}, "role"), 10
        )
        self.assertEqual(
            frappe.db.get_value("Drive Grant", {"node": self.name, "principal": OWNER}, "role"), 50
        )
        self.assertFalse(frappe.db.exists("DocShare", self.share))

    def test_failed_share_journal_rolls_back_nodes_links_and_grants(self):
        with patch.object(DocSharePreimageJournal, "append", side_effect=OSError("journal failed")):
            with self.assertRaisesRegex(OSError, "journal failed"):
                adopt_drawings.execute()
        self.assertFalse(frappe.db.get_value("Drawing", self.name, "node"))
        self.assertEqual(frappe.db.get_value("Drawing", self.name, "content"), CONTENT)
        self.assertFalse(frappe.db.exists("Drive Node", self.name))
        self.assertFalse(frappe.db.exists("Drive Grant", {"node": self.name}))
        self.assertTrue(frappe.db.exists("DocShare", self.share))
