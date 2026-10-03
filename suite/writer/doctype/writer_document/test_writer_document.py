# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase

from suite.drive._core.errors import DriveConflict

# On IntegrationTestCase, the doctype's schema is already installed by
# the test runner. Use `self.get_doc` to access the document.

EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class IntegrationTestWriterDocument(IntegrationTestCase):
    """A Writer document after ticket 29 registered the declaration.

    Adoption was staged: `Writer Document` carried the `node` Link and the
    `DriveContent` mixin from ticket 17 while `drive_content_types` stayed
    empty, so a bare insert wrote a legacy row. Build linked every one of those
    rows (§14.6) and ticket 29 registered the type, so §5.13 now holds here:
    a document with no node cannot exist. `require_node` is what refuses one
    (`suite/drive/_core/content.py:769-772`).

    The Drive-native lifecycle, the version cascade included, is covered in
    `suite/writer/tests/test_drive_adoption.py`, where the Drive fixtures live.
    """

    def test_a_document_with_no_node_is_refused(self):
        with self.assertRaises(DriveConflict):
            frappe.new_doc("Writer Document").save()

    def test_the_node_column_is_still_the_declared_one(self):
        # `drive_node_field` names the column until the declaration does, and
        # `_validate_mixin` refuses an activation where the two disagree.
        from suite.writer import drive as writer
        from suite.writer.doctype.writer_document.writer_document import WriterDocument

        self.assertEqual(WriterDocument.drive_node_field, writer.SPEC.node_field)
        self.assertTrue(frappe.get_meta("Writer Document").get_field(writer.SPEC.node_field))
