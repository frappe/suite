"""Which products a failed Mail setup closes."""

from unittest.mock import patch

import frappe
from frappe.auth import CookieManager, LoginManager
from frappe.tests import UnitTestCase
from frappe.utils import set_request

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
