# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import json
import re
from pathlib import Path

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class UnitTestDriveDiskSettings(UnitTestCase):
    """
    Unit tests for DriveDiskSettings.
    Use this class for testing individual functions and methods.
    """

    def test_preview_size_defaults_to_512_pixels(self):
        """§9.2: one derived preview is a 512 px longest-side WebP."""
        doctype = json.loads((Path(__file__).parent / "drive_disk_settings.json").read_text())
        field = next(f for f in doctype["fields"] if f["fieldname"] == "preview_size")
        self.assertEqual(field["default"], "512")
        self.assertIn("pixels", field["description"].lower())
        self.assertIn("longest side", field["description"].lower())
        self.assertNotIn("megabyte", field["description"].lower())

    def test_the_legacy_personal_team_patch_no_longer_clobbers_preview_size(self):
        """§9.2's pixel contract must survive `patches.remove_personal`.

        That patch predates the rewrite and once pinned `preview_size` to
        100 under its old megabyte-cutoff meaning. Left in place, an old
        site replaying this patch on upgrade would silently overwrite the
        512 px default with a value that no longer means anything under the
        current contract.
        """
        source = (Path(__file__).parents[2] / "patches" / "remove_personal.py").read_text()
        self.assertNotRegex(source, r"preview_size\s*=\s*\d")


class IntegrationTestDriveDiskSettings(IntegrationTestCase):
    """
    Integration tests for DriveDiskSettings.
    Use this class for testing interactions between multiple components.
    """

    def test_guest_safe_settings_publish_the_pixel_preview_size(self):
        from suite.drive.api.product import disk_settings

        frappe.db.set_single_value("Drive Disk Settings", "preview_size", 512)
        with self.set_user("Guest"):
            result = disk_settings()

        self.assertEqual(result["preview_size"], 512)
