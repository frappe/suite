# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.api.account import forget_logged_in_users, get_logged_in_user
from suite.calendar.doctype.calendar_event.mailing_lists import expand_mailing_list_participants
from suite.mail.api import admin
from suite.mail.api.account import get_calendar_client_config, get_user_info
from suite.mail.tests.fake_suite_cloud import fake_suite_cloud
from suite.mail.utils import is_jmap_server_configured
from suite.mail.utils.user import can_use_mail

JMAP_URL = "https://mail.c1.example.test"
SUITE_CLOUD = {
    "suite_cloud_url": "https://cloud.example.test",
    "site_api_key": "key",
    "site_api_secret": "secret",
}
NO_SUITE_CLOUD = {"suite_cloud_url": "", "site_api_key": "", "site_api_secret": ""}


class SiteConnectionTestCase(IntegrationTestCase):
    """A site whose JMAP server and Suite Cloud are configured, or not, independently of each other."""

    def connect(self, jmap: bool, suite_cloud: bool) -> None:
        self.enterContext(self.change_settings("Mail Settings", server_url=JMAP_URL if jmap else ""))
        self.enterContext(
            self.change_settings("Suite Settings", **(SUITE_CLOUD if suite_cloud else NO_SUITE_CLOUD))
        )
        # Neither may leak in from the site config of whoever runs the tests.
        self.enterContext(patch.dict(frappe.local.conf, {"mail": {}, **{key: None for key in SUITE_CLOUD}}))
        frappe.local.request_cache.clear()
        self.addCleanup(frappe.local.request_cache.clear)
        forget_logged_in_users()  # kept for an hour otherwise, across tests too
        self.addCleanup(forget_logged_in_users)


class TestMailAndCalendarNeedOnlyTheJmapServer(SiteConnectionTestCase):
    def test_a_jmap_server_alone_is_a_configured_mail_server(self) -> None:
        self.connect(jmap=True, suite_cloud=False)
        self.assertTrue(is_jmap_server_configured())

    def test_no_jmap_server_is_not_configured_even_with_suite_cloud(self) -> None:
        self.connect(jmap=False, suite_cloud=True)
        self.assertFalse(is_jmap_server_configured())
        self.assertRaisesRegex(
            frappe.ValidationError, "Mail Settings", is_jmap_server_configured, raise_exception=True
        )

    def test_the_apps_are_offered_to_a_user_with_an_account_whatever_suite_cloud_says(self) -> None:
        frappe.set_user("Administrator")
        with patch("suite.mail.utils.user.is_jmap_configured", return_value=True):
            self.connect(jmap=True, suite_cloud=False)
            self.assertTrue(get_logged_in_user()["is_jmap_configured"])
            self.assertTrue(can_use_mail("Administrator"))

    def test_the_apps_are_not_offered_on_a_site_without_a_jmap_server(self) -> None:
        frappe.set_user("Administrator")
        with patch("suite.mail.utils.user.is_jmap_configured", return_value=True):
            self.connect(jmap=False, suite_cloud=True)
            self.assertFalse(get_logged_in_user()["is_jmap_configured"])
            self.assertFalse(get_user_info()["is_jmap_configured"])

    def test_the_launcher_follows_a_change_of_the_jmap_url_at_once(self) -> None:
        frappe.set_user("Administrator")
        with patch("suite.mail.utils.user.is_jmap_configured", return_value=True):
            self.connect(jmap=False, suite_cloud=False)
            self.assertFalse(get_logged_in_user()["is_jmap_configured"])  # and now remembered

            with self.change_settings("Mail Settings", server_url=JMAP_URL):
                frappe.local.request_cache.clear()
                self.assertTrue(get_logged_in_user()["is_jmap_configured"])

    def test_calendar_connection_details_do_not_wait_for_suite_cloud(self) -> None:
        self.connect(jmap=True, suite_cloud=False)
        with (
            self.change_settings("Mail Settings", show_calendar_client_config=1),
            patch("frappe.db.get_value", return_value="alice@acme.test"),
        ):
            config = get_calendar_client_config()
        self.assertEqual(config["calendar_url"], f"{JMAP_URL}/dav/cal/alice@acme.test")

    def test_inviting_a_local_address_does_not_reach_for_a_directory_that_is_not_there(self) -> None:
        self.connect(jmap=True, suite_cloud=False)
        participants = [{"email": "team@acme.test", "kind": "individual"}]
        with (
            self.change_settings("Mail Settings", expand_mailing_list_participants=1),
            patch("suite.calendar.doctype.calendar_event.mailing_lists.get_domains") as get_domains,
            patch("suite.calendar.doctype.calendar_event.mailing_lists.log_mail_error") as log_mail_error,
        ):
            frappe.local.request_cache.clear()
            self.assertEqual(expand_mailing_list_participants(participants), participants)
        get_domains.assert_not_called()
        log_mail_error.assert_not_called()


class TestAdminDashboardNeedsSuiteCloud(SiteConnectionTestCase):
    def test_an_admin_is_refused_while_the_site_has_no_suite_cloud(self) -> None:
        self.connect(jmap=True, suite_cloud=False)
        frappe.set_user("Administrator")
        self.assertRaisesRegex(frappe.ValidationError, "Suite Cloud is not configured", admin.get_members)
        self.assertRaisesRegex(frappe.ValidationError, "Suite Cloud is not configured", admin.get_overview)

    def test_someone_who_is_no_admin_learns_nothing_about_the_connection(self) -> None:
        self.connect(jmap=True, suite_cloud=False)
        with self.set_user("Guest"):
            self.assertRaises(frappe.PermissionError, admin.get_members)

    def test_an_admin_gets_in_once_suite_cloud_is_configured(self) -> None:
        self.connect(jmap=False, suite_cloud=True)
        frappe.set_user("Administrator")
        self.assertIn("items", admin.get_members())

    def test_no_account_is_created_on_a_site_whose_jmap_server_is_unknown(self) -> None:
        self.connect(jmap=False, suite_cloud=True)
        frappe.set_user("Administrator")
        with fake_suite_cloud() as fake:
            fake.domains__create_domain("acme.test", description="Acme")
            fake.domains["acme.test"]["is_verified"] = 1
            self.assertRaisesRegex(
                frappe.ValidationError,
                "JMAP server is not configured",
                admin.add_member,
                "heidi",
                "acme.test",
                is_admin=False,
                send_invite=False,
                backup_email="heidi@backup.test",
                first_name="Heidi",
                password="a-strong-password-9",
            )
            # Refused before Suite Cloud was asked: nothing to create, nothing to clean up.
            self.assertNotIn("heidi@acme.test", fake.accounts)
            self.assertEqual([c for c in fake.calls if c[0] == "mail.accounts.create_account"], [])

    def test_nobody_is_invited_on_a_site_without_suite_cloud(self) -> None:
        self.connect(jmap=True, suite_cloud=False)
        request = frappe.new_doc("Mail Account Request")
        request.account = "ivan@acme.test"
        request.backup_email = "ivan@backup.test"
        self.assertRaisesRegex(frappe.ValidationError, "Suite Cloud is not configured", request.insert)

    def test_the_interface_is_told_whether_to_offer_the_dashboard(self) -> None:
        frappe.set_user("Administrator")
        self.connect(jmap=True, suite_cloud=False)
        self.assertFalse(get_user_info()["is_suite_cloud_configured"])

    def test_the_interface_offers_the_dashboard_once_connected(self) -> None:
        frappe.set_user("Administrator")
        self.connect(jmap=True, suite_cloud=True)
        self.assertTrue(get_user_info()["is_suite_cloud_configured"])
