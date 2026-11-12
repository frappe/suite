"""Which products a failed Mail setup closes."""

from unittest.mock import patch

import frappe
from cryptography.fernet import Fernet
from frappe.auth import CookieManager, LoginManager
from frappe.tests import IntegrationTestCase, UnitTestCase
from frappe.utils import add_to_date, now_datetime, set_request
from frappe.utils.password import update_password

from suite import mail
from suite.composition import access
from suite.composition.access import AccountSetupRequired, PasswordChangeRequired, require_access
from suite.mail import health
from suite.mail.suite_cloud import SuiteCloudClient, SuiteCloudUnavailableError, get_client
from suite.mail.tests.test_suite_cloud_client import _frappe_error
from suite.mail.tests.test_suite_cloud_directory import SuiteCloudTestCase
from suite.suite_core.account_state import write as write_account_state

USER = "failed-setup@example.test"


class TestFailedSetupGate(UnitTestCase):
    def setUp(self):
        super().setUp()
        self.enterContext(patch.object(access, "is_suite_cloud_configured", return_value=True))
        self.enterContext(patch.object(mail, "provider_health", return_value={"suspended": False}))
        self.enterContext(patch.object(access, "read", return_value={"status": "Setup failed"}))
        self.enterContext(patch.object(access, "is_suite_admin", return_value=False))
        self.enterContext(patch.object(frappe.db, "get_value", return_value=None))

    def test_drive_and_writer_stay_open(self):
        for method in ("suite.drive.http.routes.node_children", "suite.writer.http.routes.document"):
            with self.subTest(method=method):
                require_access(USER, method=method)

    def test_mail_and_calendar_are_refused(self):
        for method in ("suite.mail.http.routes.inbox_summary", "suite.calendar.http.routes.events"):
            with self.subTest(method=method), self.assertRaises(AccountSetupRequired):
                require_access(USER, method=method)


class TestSuspendedSite(SuiteCloudTestCase):
    def setUp(self):
        # Logging in commits, which would keep the Suite Cloud settings past the test's rollback
        self.enterContext(patch.object(frappe.db, "commit"))
        super().setUp()
        frappe.cache.delete_value("suite:provider_suspended")
        self.addCleanup(frappe.cache.delete_value, "suite:provider_suspended")
        frappe.local.request_ip = "127.0.0.1"
        set_request(path="/random")
        frappe.local.response = frappe._dict()
        frappe.local.cookie_manager = CookieManager()
        frappe.local.login_manager = LoginManager()

    def test_the_suspension_suite_cloud_reports_refuses_logins_and_requests(self):
        self.assertFalse(mail.provider_health()["suspended"])

        client = SuiteCloudClient("https://cloud.example.test", "key", "secret")
        refusal = _frappe_error(403, "TenantSuspendedError", "Suspended")
        with (
            patch.object(client.session, "request", return_value=refusal),
            self.assertRaises(frappe.PermissionError),
        ):
            client.call("tenant.ping")

        with self.assertRaisesRegex(frappe.AuthenticationError, "suspended"):
            frappe.local.login_manager.login_as(USER)

        with self.assertRaisesRegex(frappe.PermissionError, "suspended"):
            require_access(USER)


class TestUnreadableSecret(IntegrationTestCase):
    """The site has Suite Cloud but can't read its secret: the local gates and logins still work."""

    USER = "lost-secret@example.test"
    PASSWORD = "a-strong-password-9"

    def setUp(self):
        # Logging in commits, which would keep the changes past the test's rollback
        self.enterContext(patch.object(frappe.db, "commit"))
        super().setUp()
        frappe.db.savepoint("unreadable_secret_test")
        self.addCleanup(frappe.clear_document_cache, "Suite Settings", "Suite Settings")
        self.addCleanup(frappe.db.rollback, save_point="unreadable_secret_test")
        self.addCleanup(frappe.set_user, frappe.session.user)
        self.addCleanup(frappe.local.request_cache.clear)
        self.addCleanup(frappe.clear_messages)
        self.addCleanup(frappe.form_dict.pop, "usr", None)
        self.addCleanup(frappe.form_dict.pop, "pwd", None)
        for key in ("suite:provider_suspended", "suite:provider_health", "suite:provider_health_attempt"):
            frappe.cache.delete_value(key)
            self.addCleanup(frappe.cache.delete_value, key)

        self.log = self.enterContext(patch("suite.mail.suite_cloud.log_mail_error"))
        self.enterContext(patch.dict(frappe.local.conf, {"suite_cloud_secret": None}))
        self.make_user_and_settings()
        frappe.clear_messages()

    def make_user_and_settings(self):
        frappe.local.request_ip = "127.0.0.1"
        set_request(path="/random")
        frappe.local.response = frappe._dict()
        frappe.local.cookie_manager = CookieManager()
        frappe.local.login_manager = LoginManager()
        frappe.get_doc(doctype="User", email=self.USER, first_name="Lost", send_welcome_email=0).insert(
            ignore_permissions=True
        )
        update_password(self.USER, self.PASSWORD)
        self.enterContext(
            self.change_settings(
                "Suite Settings",
                suite_cloud_url="https://cloud.example.test",
                suite_cloud_tenant="key",
                suite_cloud_secret="secret",
            )
        )
        frappe.clear_document_cache("Suite Settings", "Suite Settings")
        frappe.local.request_cache.clear()

    def lose_the_secret(self):
        frappe.db.delete("__Auth", {"doctype": "Suite Settings", "fieldname": "suite_cloud_secret"})
        frappe.clear_document_cache("Suite Settings", "Suite Settings")
        frappe.local.request_cache.clear()

    def log_in(self, usr=None):
        frappe.form_dict.update(usr=usr or self.USER, pwd=self.PASSWORD)
        frappe.local.login_manager.login()

    def test_the_right_password_still_logs_in(self):
        self.lose_the_secret()

        self.log_in()

        self.assertEqual(frappe.session.user, self.USER)

    def test_a_business_address_logs_in_as_its_holder(self):
        self.lose_the_secret()
        address = "lost-secret@business.test"
        frappe.db.set_value("User Settings", {"user": self.USER}, "username", address)

        self.log_in(address)

        self.assertEqual(frappe.session.user, self.USER)

    def test_a_suspended_site_refuses_logins_and_requests(self):
        self.lose_the_secret()
        frappe.cache.set_value("suite:provider_suspended", True)

        with self.assertRaisesRegex(frappe.AuthenticationError, "suspended"):
            self.log_in()

        with self.assertRaisesRegex(frappe.PermissionError, "suspended"):
            require_access(self.USER)

    def test_a_user_who_must_change_their_password_stays_gated(self):
        self.lose_the_secret()
        write_account_state(
            self.USER, must_change_password=1, temporary_expires_at=add_to_date(now_datetime(), hours=1)
        )

        with self.assertRaises(PasswordChangeRequired):
            require_access(self.USER, method="suite.drive.http.routes.node_children")

    def test_an_expired_temporary_password_does_not_get_in(self):
        self.lose_the_secret()
        write_account_state(
            self.USER, must_change_password=1, temporary_expires_at=add_to_date(now_datetime(), hours=-1)
        )

        with self.assertRaisesRegex(frappe.AuthenticationError, "expired"):
            self.log_in()

    def test_disabling_a_user_fails_rather_than_leaving_the_mailbox_unlocked(self):
        self.lose_the_secret()
        frappe.set_user("Administrator")
        user = frappe.get_doc("User", self.USER)
        user.enabled = 0

        with (
            patch("suite.mail.events.is_jmap_configured", return_value=True),
            patch("suite.mail.directory.get_account_email", return_value=self.USER),
            self.assertRaises(SuiteCloudUnavailableError),
        ):
            user.save(ignore_permissions=True)

    def test_the_client_logs_and_tells_the_user(self):
        self.lose_the_secret()

        with self.assertRaises(SuiteCloudUnavailableError):
            get_client()

        self.log.assert_called_once()
        self.assertEqual(
            [entry["message"] for entry in frappe.get_message_log()],
            ["This site can't read its Suite Cloud secret."],
        )

    def test_the_health_ping_leaves_no_message_for_the_user(self):
        self.lose_the_secret()

        self.assertTrue(health.status(refresh=True)["stale"])

        self.log.assert_called_once()
        self.assertEqual(frappe.get_message_log(), [])
        self.assertFalse(frappe.flags.mute_messages)

    def test_a_bad_encryption_key_does_not_stop_a_login(self):
        for key in (Fernet.generate_key().decode(), "not-a-key"):
            with self.subTest(key=key), patch.dict(frappe.local.conf, {"encryption_key": key}):
                frappe.local.request_cache.clear()
                frappe.cache.delete_value("suite:provider_health_attempt")
                frappe.set_user("Guest")

                self.log_in()

                self.assertEqual(frappe.session.user, self.USER)
                self.assertEqual(frappe.get_message_log(), [])
