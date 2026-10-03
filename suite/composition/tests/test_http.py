import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase
from frappe.tests.test_api import make_request
from frappe.utils import get_test_client
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite.composition import http


def setUpModule():
    if not getattr(frappe.local, "initialised", False):
        frappe.init(site="")


class TestDispatcher(UnitTestCase):
    def test_selects_product_and_top_level_suite_resources(self):
        cases = (
            ("/api/suite/drive/nodes/n1", "suite.drive.http.routes.node_get"),
            ("/api/suite/mail/inbox-summary", "suite.mail.http.routes.inbox_summary"),
            ("/api/suite/account", "suite.api.routes.account_get"),
        )
        for path, target in cases:
            with self.subTest(path=path):
                request = Request(EnvironBuilder(path=path).get_environ())
                frappe.local.request = request
                frappe.local.form_dict = frappe._dict()
                try:
                    http.handle_before_request()
                    self.assertEqual(request.path, "/api/v2/method/" + target)
                finally:
                    frappe.local.request = None
                    frappe.local.form_dict = frappe._dict()

    def test_unknown_owner_is_left_to_the_framework(self):
        path = "/api/suite/unknown/resource"
        request = Request(EnvironBuilder(path=path).get_environ())
        frappe.local.request = request
        frappe.local.form_dict = frappe._dict(cmd="kept")
        try:
            http.handle_before_request()
            self.assertEqual(request.path, path)
            self.assertEqual(frappe.local.form_dict.cmd, "kept")
        finally:
            frappe.local.request = None
            frappe.local.form_dict = frappe._dict()


class TestV2Envelope(IntegrationTestCase):
    def test_guest_account_success_uses_the_v2_data_envelope(self):
        response = make_request(
            target=get_test_client().open,
            args=("/api/suite/account",),
            kwargs={"method": "GET"},
        )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.json, {"data": None})

    def test_unknown_owner_resource_uses_the_v2_error_envelope(self):
        response = make_request(
            target=get_test_client().open,
            args=("/api/suite/mail/not-a-resource",),
            kwargs={"method": "GET"},
        )
        self.assertEqual(response.status_code, 404, response.get_data(as_text=True))
        self.assertEqual(response.json["errors"][0]["type"], "DoesNotExistError")
