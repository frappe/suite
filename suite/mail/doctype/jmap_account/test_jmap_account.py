# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase

from suite.mail.patches import set_default_message_cache_quota

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class IntegrationTestJMAPAccount(IntegrationTestCase):
    """
    Integration tests for JMAP Account.
    Use this class for testing interactions between multiple components.
    """

    def insert_account(self, account_id: str, quota_mb: int) -> None:
        """Insert the row alone: the document's hooks would reach a JMAP server."""

        doc = frappe.new_doc("JMAP Account")
        doc.update(
            {
                "name": account_id,
                "account_id": account_id,
                "_name": account_id,
                "message_cache_quota_mb": quota_mb,
            }
        )
        doc.db_insert()

    def get_quota(self, account_id: str) -> int:
        return frappe.db.get_value("JMAP Account", account_id, "message_cache_quota_mb")

    def test_quota_patch_gives_an_account_at_zero_the_default(self):
        self.insert_account("quota-patch-zero", 0)

        set_default_message_cache_quota.execute()

        self.assertEqual(self.get_quota("quota-patch-zero"), 512)

    def test_quota_patch_keeps_a_quota_already_set(self):
        self.insert_account("quota-patch-custom", 2048)

        set_default_message_cache_quota.execute()

        self.assertEqual(self.get_quota("quota-patch-custom"), 2048)
