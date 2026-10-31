import frappe
from frappe.tests import IntegrationTestCase

from suite.tests.utils import ABSENT, restore_local, session_for


class TestSessionFor(IntegrationTestCase):
    def test_keeps_a_name_held_as_none(self):
        self.addCleanup(restore_local, "cookie_manager", getattr(frappe.local, "cookie_manager", ABSENT))
        frappe.local.cookie_manager = None

        session_for("Administrator")

        self.assertIsNone(frappe.local.cookie_manager)
