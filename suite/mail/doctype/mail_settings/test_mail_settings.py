# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.mail.doctype.sieve_script import sieve_script

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class UnitTestMailSettings(UnitTestCase):
    """
    Unit tests for MailSettings.
    Use this class for testing individual functions and methods.
    """

    pass


class IntegrationTestMailSettings(IntegrationTestCase):
    """
    Integration tests for MailSettings.
    Use this class for testing interactions between multiple components.
    """

    def test_turning_classification_on_or_off_rebuilds_every_automation_script(self):
        """The automation Sieve script marks mail with its category only while mail is classified,
        and each account keeps its stored script until something rebuilds it."""

        frappe.get_doc({"doctype": "JMAP Account", "name": "category-rebuild"}).db_insert()

        settings = frappe.get_doc("Mail Settings")
        settings.enable_email_classification = 0 if settings.enable_email_classification else 1
        with patch.object(sieve_script, "enqueue_job") as enqueue_job:
            settings.save()
        self.assertIn(
            "category-rebuild", [a for call in enqueue_job.call_args_list for a in call.kwargs["accounts"]]
        )

        # A save that leaves the setting as it is rebuilds nothing.
        with patch.object(sieve_script, "enqueue_job") as enqueue_job:
            frappe.get_doc("Mail Settings").save()
        enqueue_job.assert_not_called()
