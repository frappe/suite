import frappe
from frappe.tests import UnitTestCase
from unittest.mock import patch

from suite.composition.tests.http_conformance import HttpConformanceMixin
from suite.mail.http.framework import HTTP
from suite.mail.http import routes


def setUpModule():
    if not getattr(frappe.local, "initialised", False):
        frappe.init(site="")


class TestHttpConformance(HttpConformanceMixin, UnitTestCase):
    HTTP = HTTP


class TestHandlers(UnitTestCase):
    @patch.object(routes, "get_all_inbox_unread_count", return_value=9)
    def test_inbox_summary_adapts_the_existing_all_account_count(self, unread):
        self.assertEqual(routes.inbox_summary(), {"unread": 9})
        unread.assert_called_once_with()
