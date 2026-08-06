# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

from unittest.mock import patch

from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.drive.doctype.drive_permission.drive_permission import DrivePermission

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class UnitTestDrivePermission(UnitTestCase):
    """
    Unit tests for DrivePermission.
    Use this class for testing individual functions and methods.
    """

    @patch("suite.drive.doctype.drive_permission.drive_permission.frappe.enqueue")
    def test_after_insert_enqueues_share_notification(self, enqueue):
        permission = DrivePermission(
            {
                "doctype": "Drive Permission",
                "name": "permission-1",
                "entity": "file-1",
                "user": "user@example.com",
            }
        )

        permission.after_insert()

        enqueue.assert_called_once()
        self.assertNotIn("now", enqueue.call_args.kwargs)
        self.assertTrue(enqueue.call_args.kwargs["enqueue_after_commit"])


class IntegrationTestDrivePermission(IntegrationTestCase):
    """
    Integration tests for DrivePermission.
    Use this class for testing interactions between multiple components.
    """

    pass
