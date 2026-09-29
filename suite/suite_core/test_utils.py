# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.mail.utils import get_config
from suite.suite_core.utils import get_suite_cloud_config, is_suite_cloud_configured

SITE_CONFIG = {
    "suite_cloud_url": "https://cloud.from-site-config.test",
    "site_api_key": "config-key",
    "site_api_secret": "config-secret",
}


class TestSuiteCloudConfig(IntegrationTestCase):
    def setUp(self) -> None:
        super().setUp()
        frappe.local.request_cache.clear()
        self.addCleanup(frappe.local.request_cache.clear)

    def settings(self, **values):
        """Suite Settings with these Suite Cloud values; the request cache must not remember older ones."""

        context = self.change_settings(
            "Suite Settings", **{"suite_cloud_url": "", "site_api_key": "", "site_api_secret": "", **values}
        )
        self.enterContext(context)
        frappe.local.request_cache.clear()

    def test_suite_settings_holds_the_configuration(self) -> None:
        self.settings(suite_cloud_url="https://cloud.test", site_api_key="key", site_api_secret="secret")
        self.assertEqual(
            get_suite_cloud_config(),
            {"suite_cloud_url": "https://cloud.test", "site_api_key": "key", "site_api_secret": "secret"},
        )
        self.assertEqual(get_suite_cloud_config("site_api_secret"), "secret")
        self.assertEqual(
            get_suite_cloud_config(("site_api_key", "suite_cloud_url")), ("key", "https://cloud.test")
        )

    def test_a_blank_value_falls_back_to_the_site_config_key_of_the_same_name(self) -> None:
        self.settings(site_api_key="settings-key")
        with patch.dict(frappe.local.conf, SITE_CONFIG):
            self.assertEqual(
                get_suite_cloud_config(),
                {
                    "suite_cloud_url": "https://cloud.from-site-config.test",
                    "site_api_key": "settings-key",
                    "site_api_secret": "config-secret",
                },
            )
            self.assertTrue(is_suite_cloud_configured())

    def test_not_configured_until_all_three_are_known(self) -> None:
        self.settings(suite_cloud_url="https://cloud.test", site_api_key="key")
        with patch.dict(frappe.local.conf, {key: None for key in SITE_CONFIG}):
            self.assertFalse(is_suite_cloud_configured())
            self.assertRaisesRegex(
                frappe.ValidationError, "Suite Settings", is_suite_cloud_configured, raise_exception=True
            )

    def test_an_unknown_key_is_refused(self) -> None:
        self.assertRaisesRegex(frappe.ValidationError, "not found", get_suite_cloud_config, "server_url")

    def test_the_mail_config_no_longer_carries_suite_cloud(self) -> None:
        self.assertFalse(set(SITE_CONFIG) & set(get_config()))
        self.assertRaisesRegex(frappe.ValidationError, "not found", get_config, "suite_cloud_url")
