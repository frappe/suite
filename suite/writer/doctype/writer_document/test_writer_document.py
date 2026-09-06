# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class IntegrationTestWriterDocument(IntegrationTestCase):
    """A Writer document exists only under a Drive node.

    The lifecycle, history, media, and permission behaviour is covered in
    `suite/writer/tests/test_drive_adoption.py`, which owns the Drive fixtures.
    """

    def test_a_document_cannot_be_created_outside_drive(self):
        # `create_document` writes the node first and calls the app's factory
        # with it (§8.3), so a bare insert has no node and cannot exist.
        # `DriveConflict` subclasses `frappe.ValidationError`; the concrete type
        # is asserted in `suite/writer/tests/test_drive_adoption.py`, which is
        # where the Drive imports are owned.
        with self.assertRaises(frappe.ValidationError):
            frappe.new_doc("Writer Document").insert(ignore_permissions=True)
