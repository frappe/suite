"""Forgetting a Mail account on this site, with no mail server involved."""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils.password import get_decrypted_password, set_encrypted_password

from suite import mail
from suite.tests.utils import ensure_user


def has_account_rows(account: str) -> bool:
    return bool(
        frappe.db.exists("User Account", {"account": account})
        or frappe.db.exists("Mail Sync History", {"account": account})
    )


class TestForgetLocalAccount(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.addCleanup(frappe.db.rollback)
        self.user = f"forget-mail-{frappe.generate_hash(length=8)}@example.test"
        ensure_user(self.user)
        self.settings = frappe.db.get_value("User Settings", {"user": self.user})
        frappe.db.set_value("User Settings", self.settings, "username", self.user)
        set_encrypted_password("User Settings", self.settings, "app-secret", "app_password")

    def link_account(self, named_after: str) -> str:
        """Link a new account to the user; `db_insert` skips the hooks that call the mail server."""
        account = frappe.generate_hash(length=12)
        frappe.get_doc(
            {"doctype": "JMAP Account", "account_id": account, "_name": named_after, "is_personal": 1}
        ).db_insert()
        for row in (
            {"doctype": "User Account", "user": self.user, "user_settings": self.settings},
            {"doctype": "Mail Sync History", "source": "imported@example.test"},
        ):
            frappe.get_doc({**row, "account": account}).insert(ignore_permissions=True)
        return account

    def test_forgetting_removes_the_users_account_and_keeps_one_they_only_reach(self):
        own = self.link_account(self.user)
        reached = self.link_account("someone-else@example.test")
        frappe.local.request_cache.clear()

        mail.forget_local_account(self.user)

        self.assertFalse(frappe.db.exists("JMAP Account", own))
        self.assertFalse(has_account_rows(own))
        self.assertFalse(frappe.db.get_value("User Settings", self.settings, "username"))
        self.assertIsNone(
            get_decrypted_password("User Settings", self.settings, "app_password", raise_exception=False)
        )
        self.assertTrue(frappe.db.exists("JMAP Account", reached))
        self.assertTrue(frappe.db.exists("User Account", {"account": reached, "user": self.user}))
        self.assertTrue(frappe.db.exists("Mail Sync History", {"account": reached}))
