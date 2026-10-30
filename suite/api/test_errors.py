"""`POST /api/suite/errors` records a browser error in the Error Log."""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.tests.test_api import make_request
from frappe.utils import get_test_client

from suite.api.test_people import make_user, token_for

USER = "reporter@qzerrors.example.com"
MARK = "Qzerrors"


class TestBrowserErrors(IntegrationTestCase):
    CLIENT = get_test_client(use_cookies=False)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        make_user(USER, f"{MARK} Reporter")
        cls.user = token_for(USER)
        frappe.db.commit()
        cls.addClassCleanup(cls.remove_fixtures)

    @classmethod
    def remove_fixtures(cls):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        # Error Log lives in the SQLite log database, so frappe.db.delete does not reach it.
        for log in frappe.get_all(
            "Error Log",
            or_filters={"method": ["like", f"%{MARK}%"], "error": ["like", f"%{MARK}%"]},
            pluck="name",
        ):
            frappe.delete_doc("Error Log", log, ignore_permissions=True)
        frappe.delete_doc("User", USER, force=True, ignore_permissions=True)
        frappe.db.commit()

    def post(self, body: dict, *, auth: str | None = None):
        headers = {"Authorization": auth} if auth else {}
        return make_request(
            target=self.CLIENT.open,
            args=("/api/suite/errors",),
            kwargs={"method": "POST", "headers": {**headers, "User-Agent": "QzBrowser/1"}, "json": body},
        )

    def report(self, title: str) -> dict:
        return {"source": "component", "title": title, "stack": "at render (Page.vue:12)", "route": "/drive"}

    def test_a_signed_in_users_error_is_recorded_with_its_route_and_browser(self):
        response = self.post(self.report(f"TypeError: {MARK} render failed"), auth=self.user)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

        log = frappe.get_last_doc("Error Log", filters={"method": ["like", f"%{MARK} render failed"]})
        self.assertEqual(log.method, f"Browser: TypeError: {MARK} render failed")
        self.assertIn("Source: component", log.error)
        self.assertIn("Route: /drive", log.error)
        self.assertIn("User agent: QzBrowser/1", log.error)
        self.assertIn("at render (Page.vue:12)", log.error)

    def test_a_long_title_is_cut_to_fit_the_error_log(self):
        response = self.post(self.report(f"{MARK} " + "x" * 500), auth=self.user)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        log = frappe.get_last_doc("Error Log", filters={"method": ["like", f"Browser: {MARK} x%"]})
        self.assertEqual(len(log.method), 140)

    def test_a_multi_line_title_is_recorded_on_one_line(self):
        response = self.post(self.report(f"Error: {MARK} parse failed\n  at line 3"), auth=self.user)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        log = frappe.get_last_doc("Error Log", filters={"method": ["like", f"%{MARK} parse failed%"]})
        self.assertEqual(log.method, f"Browser: Error: {MARK} parse failed at line 3")

    def test_a_guest_cannot_write_to_the_error_log(self):
        response = self.post(self.report(f"{MARK} guest"))
        self.assertEqual(response.status_code, 403)
        self.assertFalse(frappe.db.exists("Error Log", {"method": ["like", f"%{MARK} guest"]}))

    def test_an_unknown_source_is_refused(self):
        response = self.post({**self.report(f"{MARK} unknown"), "source": "server"}, auth=self.user)
        self.assertGreaterEqual(response.status_code, 400)
        self.assertLess(response.status_code, 500)
