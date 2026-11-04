"""Which products a failed Mail setup closes."""

from unittest.mock import patch

import frappe
from frappe.auth import CookieManager, LoginManager
from frappe.tests import IntegrationTestCase, UnitTestCase
from frappe.utils import set_request
from frappe.utils.password import update_password

from suite import mail
from suite.composition import access
from suite.composition.access import AccountSetupRequired, require_access
from suite.mail.suite_cloud import SuiteCloudClient
from suite.mail.tests.test_suite_cloud_client import _frappe_error
from suite.mail.tests.test_suite_cloud_directory import SuiteCloudTestCase

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


class TestLoginWithoutTheStoredSecret(IntegrationTestCase):
    def setUp(self):
        # Logging in commits, which would keep the lost secret past the test's rollback
        self.enterContext(patch.object(frappe.db, "commit"))
        super().setUp()
        frappe.db.savepoint("lost_secret_test")
        self.addCleanup(frappe.clear_document_cache, "Suite Settings", "Suite Settings")
        self.addCleanup(frappe.db.rollback, save_point="lost_secret_test")
        self.addCleanup(frappe.set_user, frappe.session.user)
        self.addCleanup(frappe.local.request_cache.clear)
        frappe.local.request_ip = "127.0.0.1"
        set_request(path="/random")
        frappe.local.response = frappe._dict()
        frappe.local.cookie_manager = CookieManager()
        frappe.local.login_manager = LoginManager()

    def test_the_right_password_still_logs_in(self):
        user = "lost-secret@example.test"
        frappe.get_doc(doctype="User", email=user, first_name="Lost", send_welcome_email=0).insert(
            ignore_permissions=True
        )
        update_password(user, "a-strong-password-9")
        self.enterContext(
            self.change_settings(
                "Suite Settings",
                suite_cloud_url="https://cloud.example.test",
                suite_cloud_tenant="key",
                suite_cloud_secret="secret",
            )
        )
        frappe.db.delete("__Auth", {"doctype": "Suite Settings", "fieldname": "suite_cloud_secret"})
        frappe.clear_document_cache("Suite Settings", "Suite Settings")
        frappe.local.request_cache.clear()
        frappe.form_dict.update(usr=user, pwd="a-strong-password-9")
        self.addCleanup(frappe.form_dict.pop, "usr", None)
        self.addCleanup(frappe.form_dict.pop, "pwd", None)

        with patch.dict(frappe.local.conf, {"suite_cloud_secret": None}):
            frappe.local.login_manager.login()

        self.assertEqual(frappe.session.user, user)
