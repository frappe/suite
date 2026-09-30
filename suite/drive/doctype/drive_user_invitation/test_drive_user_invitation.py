# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

"""Accepting a legacy Drive invitation, before and after the files flip (§14.6)."""

from unittest.mock import MagicMock, patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.drive.tests.fixtures import drop_personal_root
from suite.tests.utils import ensure_user

NEWCOMER = "drive-invite-newcomer@example.com"
MEMBER = "drive-invite-member@example.com"


class TestDriveUserInvitation(IntegrationTestCase):
    def setUp(self):
        self.addCleanup(self.remove_rows)
        kept = getattr(frappe.local, "login_manager", None)
        frappe.local.login_manager = self.login_manager = MagicMock()
        self.addCleanup(setattr, frappe.local, "login_manager", kept)
        frappe.local.response = frappe._dict()

    def remove_rows(self):
        frappe.db.rollback()
        for email in (NEWCOMER, MEMBER):
            frappe.db.delete("Drive User Invitation", {"email": email})
            frappe.db.delete("Account Request", {"email": email})
            if frappe.db.exists("User", email):
                drop_personal_root(email)
                frappe.delete_doc("User", email, force=True, ignore_permissions=True)
        frappe.db.commit()

    def invite(self, email: str):
        invitation = frappe.get_doc({"doctype": "Drive User Invitation", "email": email, "status": "Pending"})
        invitation.db_insert()
        return frappe.get_doc("Drive User Invitation", invitation.name)

    def accept(self, email: str, *, flipped: bool) -> str:
        with patch.dict(frappe.conf, {"suite_flip_files": 1 if flipped else 0}):
            self.invite(email).accept()
        self.assertEqual(frappe.local.response["type"], "redirect")
        return frappe.local.response["location"]

    def test_with_the_key_off_a_newcomer_still_goes_to_the_drive_signup_page(self):
        location = self.accept(NEWCOMER, flipped=False)
        self.assertTrue(location.startswith(f"/drive/signup?e={NEWCOMER}&r="), location)
        self.assertFalse(frappe.db.exists("User", NEWCOMER))

    def test_with_the_key_on_a_newcomer_becomes_a_suite_user_and_sets_a_password(self):
        location = self.accept(NEWCOMER, flipped=True)
        user = frappe.get_doc("User", NEWCOMER)
        self.assertEqual(user.user_type, "System User")
        self.assertIn("Suite User", frappe.get_roles(NEWCOMER))
        self.assertTrue(location.startswith(frappe.utils.get_url("/update-password?key=")), location)
        self.assertTrue(location.endswith("&redirect_to=/suite"), location)
        self.assertEqual(
            frappe.db.get_value("Drive User Invitation", {"email": NEWCOMER}, "status"), "Accepted"
        )
        self.login_manager.login_as.assert_not_called()

    def test_with_the_key_on_a_member_with_a_password_is_signed_in_and_lands_on_suite(self):
        ensure_user(MEMBER)
        frappe.db.set_value("User", MEMBER, "last_password_reset_date", frappe.utils.today())
        location = self.accept(MEMBER, flipped=True)
        self.assertEqual(location, frappe.utils.get_url("/suite"))
        self.assertIn("Suite User", frappe.get_roles(MEMBER))
        self.login_manager.login_as.assert_called_once_with(MEMBER)
