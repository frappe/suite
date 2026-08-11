# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class IntegrationTestScreenedEmailAddress(IntegrationTestCase):
    """
    Integration tests for ScreenedEmailAddress.
    Use this class for testing interactions between multiple components.
    """

    def test_normalize_screened_value(self):
        from suite.mail.utils.validation import normalize_screened_value

        # Trims whitespace and leaves a plain email address untouched.
        self.assertEqual(normalize_screened_value("  john@example.com  "), "john@example.com")
        # Lowercases the domain of a '@domain' entry so it collapses to a single rule.
        self.assertEqual(normalize_screened_value("@Mail.Example.com"), "@mail.example.com")
        self.assertEqual(normalize_screened_value(" @Example.COM "), "@example.com")

    def test_validate_screened_value(self):
        from suite.mail.utils.validation import validate_screened_value

        # Valid: full email addresses and '@domain' entries.
        self.assertTrue(validate_screened_value("john@example.com"))
        self.assertTrue(validate_screened_value("@example.com"))
        self.assertTrue(validate_screened_value("@sub.example.co.uk"))

        # Invalid: bare domains, bare '@', local parts, and blanks.
        self.assertFalse(validate_screened_value("example.com"))
        self.assertFalse(validate_screened_value("@"))
        self.assertFalse(validate_screened_value("@example"))
        self.assertFalse(validate_screened_value("john"))
        self.assertFalse(validate_screened_value(""))

    def tearDown(self):
        frappe.set_user("Administrator")
        # Global rules (no account) are created without hooks firing any sieve rebuild, so a raw
        # delete is enough to clean up.
        frappe.db.delete("Screened Email Address", {"account": ("is", "not set")})
        super().tearDown()

    @staticmethod
    def _insert_global_rule(email: str, action: str) -> None:
        frappe.get_doc({"doctype": "Screened Email Address", "email": email, "action": action}).insert()

    def test_effective_screened_email_addresses_merge(self):
        from suite.mail.doctype.screened_email_address import screened_email_address as module

        self._insert_global_rule("@trusted.com", "Accepted")
        self._insert_global_rule("spammer@junk.com", "Reject")

        # The account screens one of the globally screened values itself — its action must win.
        account_rows = [frappe._dict(email="@Trusted.com", action="Reject", creation=None, modified=None)]
        with patch.object(module, "get_screened_email_addresses", return_value=account_rows):
            effective = module.get_effective_screened_email_addresses("dummy-account")

        actions = {row.email.lower(): row.action for row in effective}
        self.assertEqual(len(effective), 2)
        self.assertEqual(actions["@trusted.com"], "Reject")
        self.assertEqual(actions["spammer@junk.com"], "Reject")

    def test_is_globally_accepted(self):
        from suite.mail.doctype.screened_email_address.screened_email_address import (
            get_global_accepted_values,
            is_globally_accepted,
        )

        self._insert_global_rule("@Trusted.com", "Accepted")
        self._insert_global_rule("@blocked.com", "Reject")
        self._insert_global_rule("someone@accepted.com", "Accepted")

        # Only Accepted rules count (Reject domains don't), lowercased with the '@' prefix kept.
        self.assertEqual(get_global_accepted_values(), {"@trusted.com", "someone@accepted.com"})

        # Covered: by domain rule (case-insensitively) or by exact address.
        self.assertTrue(is_globally_accepted("anyone@trusted.com"))
        self.assertTrue(is_globally_accepted("Anyone@Trusted.COM"))
        self.assertTrue(is_globally_accepted("Someone@accepted.com"))

        # Not covered: other senders from a domain with only an exact-address rule, or from a
        # domain screened with Reject.
        self.assertFalse(is_globally_accepted("other@accepted.com"))
        self.assertFalse(is_globally_accepted("anyone@blocked.com"))

    def test_duplicate_global_screened_email(self):
        self._insert_global_rule("dup@example.com", "Reject")

        with self.assertRaises(frappe.ValidationError):
            self._insert_global_rule("dup@example.com", "Spam")

    def test_global_rule_requires_system_manager(self):
        frappe.set_user("Guest")

        doc = frappe.get_doc(
            {"doctype": "Screened Email Address", "email": "global@example.com", "action": "Reject"}
        )
        # ignore_permissions bypasses the doctype-level create check, so this exercises the
        # global-rule guard in validate() specifically.
        with self.assertRaises(frappe.PermissionError):
            doc.insert(ignore_permissions=True)
