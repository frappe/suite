"""A split Inbox ends with an All mail tab, every category in one list, until its owner turns it off."""

import frappe
from frappe.tests import IntegrationTestCase

from suite.mail.api.account import get_user_info
from suite.mail.http.preferences import update_preferences


class TestAllMailTab(IntegrationTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        get_user_info()  # Makes the user's settings when they have none yet.
        name = frappe.db.get_value("User Settings", {"user": "Administrator"}, "name")
        before = frappe.db.get_value("User Settings", name, ["all_mail_tab", "inbox_tabs"], as_dict=True)
        self.addCleanup(frappe.db.set_value, "User Settings", name, before)

    def test_someone_who_never_chose_has_the_tab(self):
        self.assertEqual(frappe.new_doc("User Settings").all_mail_tab, 1)

    def test_the_tab_turns_off_and_on_again(self):
        update_preferences(all_mail_tab=0)
        self.assertEqual(get_user_info().all_mail_tab, 0)

        update_preferences(all_mail_tab=1)
        self.assertEqual(get_user_info().all_mail_tab, 1)

    def test_turning_it_off_keeps_the_categories(self):
        update_preferences(inbox_tabs=["updates", "social"])
        update_preferences(all_mail_tab=0)

        self.assertEqual(get_user_info().inbox_tabs, ["primary", "updates", "social"])
