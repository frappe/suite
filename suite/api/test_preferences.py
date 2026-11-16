import frappe
from frappe.tests import IntegrationTestCase

from suite.api import preferences
from suite.utils.user import generate_user_keys


class TestPreferences(IntegrationTestCase):
    def setUp(self):
        self.user = "prefs-website-user@example.com"
        if not frappe.db.exists("User", self.user):
            frappe.get_doc(
                {"doctype": "User", "email": self.user, "first_name": "Prefs", "user_type": "Website User"}
            ).insert(ignore_permissions=True)

    def test_a_website_user_reads_and_changes_their_own_preferences(self):
        with self.set_user(self.user):
            self.assertEqual(preferences.get_preferences()["email"], self.user)
            changed = preferences.update_preferences(first_name="Renamed")
        self.assertEqual(changed["first_name"], "Renamed")
        self.assertEqual(frappe.db.get_value("User", self.user, "first_name"), "Renamed")

    def test_the_read_shows_the_api_key_once_made_and_never_the_secret(self):
        frappe.db.set_value("User", self.user, {"api_key": None, "api_secret": None})
        with self.set_user(self.user):
            self.assertIsNone(preferences.get_preferences()["api_key"])
            keys = generate_user_keys(self.user)
            read = preferences.get_preferences()
        self.assertEqual(read["api_key"], keys["api_key"])
        self.assertNotIn(keys["api_secret"], read.values())
