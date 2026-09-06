# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase

# On IntegrationTestCase, the doctype's schema is already installed by
# the test runner. Use `self.get_doc` to access the document.

EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class IntegrationTestWriterDocument(IntegrationTestCase):
    """A Writer document during the expand phase, with no node of its own.

    Adoption is staged: `Writer Document` carries the `node` Link and the
    `DriveContent` mixin from ticket 17, but `drive_content_types` stays empty
    until ticket 29. So a legacy row still inserts, saves, and cascades exactly
    as it did. The Drive-native side, which does require a node, is covered in
    `suite/writer/tests/test_drive_adoption.py`, where the Drive fixtures live.
    """

    def test_delete_purges_versions(self):
        doc = frappe.new_doc("Writer Document")
        doc.save()
        version = frappe.get_doc(
            {
                "doctype": "Writer Version",
                "doc": doc.name,
                "snapshot": "<p>hello</p>",
                "title": "2026-01-01 00:00",
            }
        ).insert()

        # a version links back to the document — without the cascade the
        # framework's link check refuses the delete
        doc.delete()

        self.assertFalse(frappe.db.exists("Writer Document", doc.name))
        self.assertFalse(frappe.db.exists("Writer Version", version.name))

    def test_a_legacy_row_still_has_no_node_and_stays_legacy(self):
        # The node column exists from ticket 17 and stays empty until Build
        # links the row (§14.6). Nothing about a bare insert may change.
        doc = frappe.new_doc("Writer Document")
        doc.save()
        self.addCleanup(frappe.delete_doc, "Writer Document", doc.name, force=1, ignore_missing=True)

        self.assertIsNone(frappe.db.get_value("Writer Document", doc.name, "node"))
        self.assertFalse(frappe.get_doc("Writer Document", doc.name).drive_native)
