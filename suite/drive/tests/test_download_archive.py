import unittest
from unittest.mock import patch

import frappe

from suite.drive.api.files import _collect_download_files
from suite.drive.utils import STATUS_ACTIVE, STATUS_TRASHED


class TestDownloadArchive(unittest.TestCase):
    @patch("suite.drive.api.files.user_has_permission", return_value=True)
    def test_collect_files_skips_trashed_entities(self, mock_perm):
        active_file = frappe._dict(
            name="f1",
            file_name="active.png",
            is_folder=0,
            file_type="Image",
            file_url="/files/active.png",
            status=STATUS_ACTIVE,
        )
        trashed_file = frappe._dict(
            name="f2",
            file_name="trashed.png",
            is_folder=0,
            file_type="Image",
            file_url="/files/trashed.png",
            status=STATUS_TRASHED,
        )

        def fake_get_value(doctype, name, fields, as_dict=True):
            if name == "f1":
                return active_file
            if name == "f2":
                return trashed_file
            return None

        with patch("frappe.get_value", side_effect=fake_get_value):
            results = list(_collect_download_files(["f1", "f2", "nonexistent"]))
            self.assertEqual(len(results), 1)
            arcname, entity = results[0]
            self.assertEqual(arcname, "active.png")
            self.assertEqual(entity.name, "f1")

    def test_collect_files_enforces_permission(self):
        with patch("suite.drive.api.files.user_has_permission", return_value=False):
            with self.assertRaises(frappe.PermissionError):
                list(_collect_download_files(["denied-file"]))
