import frappe
from frappe.tests import IntegrationTestCase
from frappe.website.path_resolver import resolve_path
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request


class SuiteRoutes(IntegrationTestCase):
    def test_every_area_loads_the_suite_page_on_a_cold_load(self):
        # A bookmark, a reload or a link from mail lands on the server first.
        for path in (
            "home",
            "drive",
            "drive/recent",
            "mail",
            "calendar",
            "people",
            "people/alice@example.com",
            "admin",
            "admin/users",
            "admin/mail/domains",
        ):
            with self.subTest(path=path):
                frappe.local.request = Request(EnvironBuilder(path="/" + path).get_environ())
                try:
                    self.assertEqual(resolve_path(path), "suite")
                finally:
                    frappe.local.request = None
