"""Which products a failed Mail setup closes."""

from unittest.mock import patch

import frappe
from frappe.tests import UnitTestCase

from suite import mail
from suite.composition import access
from suite.composition.access import AccountSetupRequired, require_access

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
