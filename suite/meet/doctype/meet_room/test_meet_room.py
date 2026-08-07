# Copyright (c) 2025, Frappe and Contributors
# See license.txt

import frappe
from frappe.exceptions import ValidationError
from frappe.tests import IntegrationTestCase

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class IntegrationTestMeetRoom(IntegrationTestCase):
    """
    Integration tests for MeetRoom.
    Use this class for testing interactions between multiple components.
    """

    def test_generic_save_cannot_enable_e2ee(self):
        room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert()
        room.e2ee_enabled = True

        with self.assertRaisesRegex(ValidationError, "dedicated meeting policy"):
            room.save()
