# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.mail.api import get_signup_domains, get_signup_settings
from suite.mail.tests.base import StalwartIntegrationTestCase


class TestMailMisc(StalwartIntegrationTestCase):
    """Signup settings and persisted push keys backing the client shell."""

    def test_signup_settings_and_domains(self):
        with self.set_user("Guest"):
            self.assertIn("allow_signup", get_signup_settings())
            self.assertIsInstance(get_signup_domains(), list)

        with self.mail_settings(allow_signup=1, signup_domains=self.domain):
            with self.set_user("Guest"):
                self.assertTrue(get_signup_settings()["allow_signup"])
                self.assertIn(self.domain, get_signup_domains())

    def test_generate_jmap_push_keys(self):
        settings = frappe.get_doc("Mail Settings")
        settings.generate_jmap_push_keys()

        settings.reload()
        self.assertTrue(settings.jmap_push_p256dh)
        self.assertTrue(settings.jmap_push_auth)
        self.assertTrue(settings.get_password("jmap_push_private_key"))
        frappe.local.request_cache.clear()
