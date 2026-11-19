# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Deciding on a waiting sender changes the account's screening rules, so it is for the people who
hold the account alone."""

import frappe
from frappe.tests import IntegrationTestCase

from suite.mail.api.mail import allow_screening_senders, screen_out_senders

EXTRA_TEST_RECORD_DEPENDENCIES = ["User"]

OWNER = "test2@example.com"
STRANGER = "test1@example.com"
ACCOUNT = "screening-owner-account"
SENDER = "someone@elsewhere.example.org"


class TestScreeningOwnership(IntegrationTestCase):
    def setUp(self):
        if not frappe.db.exists("JMAP Account", ACCOUNT):
            frappe.get_doc({"doctype": "JMAP Account", "name": ACCOUNT}).db_insert()
        if not frappe.db.exists("User Account", ACCOUNT):
            frappe.get_doc(
                {"doctype": "User Account", "name": ACCOUNT, "account": ACCOUNT, "user": OWNER}
            ).db_insert()

        frappe.set_user(STRANGER)
        self.addCleanup(frappe.set_user, "Administrator")

    def _rules(self) -> list[dict]:
        return frappe.db.get_all("Screened Email Address", {"account": ACCOUNT}, ["email", "action"])

    def test_someone_else_cannot_allow_a_sender_into_the_account(self):
        with self.assertRaises(frappe.ValidationError):
            allow_screening_senders(ACCOUNT, [SENDER])

        self.assertEqual(self._rules(), [])

    def test_someone_else_cannot_screen_a_sender_out_of_the_account(self):
        with self.assertRaises(frappe.ValidationError):
            screen_out_senders(ACCOUNT, [SENDER])

        self.assertEqual(self._rules(), [])
