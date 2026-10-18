"""Mail account deletion never dispatches Suite User/Drive deletion."""

import json
from unittest.mock import Mock, patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.mail.api.admin import delete_members
from suite.suite_core.administration import update_user
from suite.suite_core.storage import state
from suite.tests.utils import ensure_user


class TestMailAccountDeletion(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.user = f"delete-mail-{frappe.generate_hash(length=8)}@example.test"
        ensure_user(self.user)
        self.root = frappe.db.get_value("Drive Root", {"user": self.user, "kind": "Personal"}, "name")
        with patch("suite.suite_core.utils.is_suite_cloud_configured", return_value=False):
            update_user(self.user, enabled=False)
        settings = frappe.get_doc("User Settings", {"user": self.user})
        frappe.db.set_value("User Settings", settings.name, "username", self.user)
        frappe.local.request_cache.clear()
        self.enterContext(patch("suite.mail.api.admin.is_suite_cloud_configured", return_value=True))

    def test_confirmed_deletion_preserves_the_disabled_user_root_and_clears_usage_identity(self):
        doc, _policy, _measurements = state(lock=True)
        doc.measurements = json.dumps(
            {"entries": {self.user: {"bytes": 123}}, "personal": {self.user: 123}, "site_mail": 123}
        )
        doc.save(ignore_permissions=True)
        provider = Mock()
        with patch("suite.mail.directory.get_client", return_value=provider):
            delete_members([self.user], confirmation=self.user)
        provider.call.assert_called_once_with("mail.accounts.delete_account", email=self.user)
        self.assertTrue(frappe.db.exists("User", self.user))
        self.assertEqual(frappe.db.get_value("User", self.user, "enabled"), 0)
        self.assertTrue(frappe.db.exists("Drive Root", self.root))
        self.assertFalse(frappe.db.get_value("User Settings", {"user": self.user}, "username"))
        _doc, _policy, cache = state()
        self.assertNotIn(self.user, cache.get("entries", {}))
        self.assertIsNone(cache["site_mail"])

    def test_failed_provider_deletion_keeps_the_claimed_address_and_user_disabled(self):
        provider = Mock()
        provider.call.side_effect = frappe.ValidationError("provider offline")
        with patch("suite.mail.directory.get_client", return_value=provider):
            with self.assertRaises(frappe.ValidationError):
                delete_members([self.user], confirmation=self.user)
        self.assertEqual(frappe.db.get_value("User Settings", {"user": self.user}, "username"), self.user)
        self.assertEqual(frappe.db.get_value("User", self.user, "enabled"), 0)

    def test_wrong_confirmation_cannot_delete_any_provider_account(self):
        with patch("suite.mail.directory.get_client") as provider:
            with self.assertRaises(frappe.ValidationError):
                delete_members([self.user], confirmation="wrong@example.test")
        provider.assert_not_called()
