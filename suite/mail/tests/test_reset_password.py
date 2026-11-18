# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from unittest.mock import patch

import frappe
from frappe.app import handle_exception
from frappe.auth import CookieManager, LoginManager
from frappe.utils import set_request
from frappe.utils.password import check_password, update_password

from suite.mail import events
from suite.mail.api import admin
from suite.mail.api.account import send_reset_password_link, set_reset_password_key
from suite.mail.tests.test_suite_cloud_directory import DOMAIN, SuiteCloudTestCase

OLD_PASSWORD = "a-strong-password-9"
NEW_PASSWORD = "Another-strong-pw-9"


class TestResetPassword(SuiteCloudTestCase):
    def setUp(self) -> None:
        # Logging in commits, which would keep the Suite Cloud settings past the test's rollback.
        self.enterContext(patch.object(frappe.db, "commit"))
        super().setUp()
        throttle = patch("frappe.core.doctype.user.user.throttle_user_creation")
        throttle.start()
        self.addCleanup(throttle.stop)
        self.email = f"reset-member@{DOMAIN}"
        frappe.delete_doc("User", self.email, force=True, ignore_permissions=True, ignore_missing=True)
        frappe.db.delete("Mail Account Request", {"account": self.email})
        # Rate limiters key on the request IP once a request is set.
        frappe.local.request_ip = "127.0.0.1"
        admin.add_member(
            "reset-member",
            DOMAIN,
            is_admin=False,
            send_invite=False,
            backup_email="reset-member@backup.test",
            first_name="Reset",
            last_name="Member",
        )
        # A new member starts on a generated one-time password, on the site and on Mail
        update_password(self.email, OLD_PASSWORD)
        self.mail_password = self.fake.passwords[self.email]
        set_request(path="/random")
        frappe.local.response = frappe._dict()
        frappe.local.cookie_manager = CookieManager()
        frappe.local.login_manager = LoginManager()
        frappe.set_user("Guest")

    def test_a_reset_link_sets_the_new_password_on_the_site_and_the_mail_account(self) -> None:
        key = set_reset_password_key(self.email)

        self.assertNotEqual(
            events.update_password(NEW_PASSWORD, key=key),
            "The reset password link has either been used before or is invalid",
        )
        self.assertEqual(check_password(self.email, NEW_PASSWORD), self.email)
        self.assertEqual(self.fake.passwords[self.email], NEW_PASSWORD)

    def test_a_used_reset_link_changes_neither_password(self) -> None:
        key = set_reset_password_key(self.email)
        frappe.db.set_value("User", self.email, "reset_password_key", "")

        self.assertEqual(
            events.update_password(NEW_PASSWORD, key=key),
            "The reset password link has either been used before or is invalid",
        )
        self.assertEqual(check_password(self.email, OLD_PASSWORD), self.email)
        self.assertEqual(self.fake.passwords[self.email], self.mail_password)

    def test_an_expired_reset_link_leaves_the_mail_password_alone(self) -> None:
        expiry = frappe.db.get_single_value("System Settings", "reset_password_link_expiry_duration")
        self.addCleanup(
            frappe.db.set_single_value, "System Settings", "reset_password_link_expiry_duration", expiry
        )
        frappe.db.set_single_value("System Settings", "reset_password_link_expiry_duration", 60)
        key = set_reset_password_key(self.email)
        frappe.db.set_value("User", self.email, "last_reset_password_key_generated_on", "2000-01-01 00:00:00")

        self.assertEqual(
            events.update_password(NEW_PASSWORD, key=key), "The reset password link has been expired"
        )
        self.assertEqual(self.fake.passwords[self.email], self.mail_password)

    def test_a_wrong_current_password_is_refused_and_keeps_the_session(self) -> None:
        frappe.set_user(self.email)
        set_request(path="/api/method/frappe.core.doctype.user.user.update_password")
        logged_before = self.failed_logins()

        try:
            events.update_password(NEW_PASSWORD, old_password="not-my-password-9")
        except frappe.ValidationError as refused:
            # Frappe's request handler answers the error as it would for a real request.
            handle_exception(refused)
        else:
            self.fail("A wrong current password was accepted")

        self.assertEqual(frappe.local.cookie_manager.to_delete, [])
        self.assertEqual(frappe.session.user, self.email)
        self.assertEqual(check_password(self.email, OLD_PASSWORD), self.email)
        self.assertEqual(self.fake.passwords[self.email], self.mail_password)
        self.assertEqual(
            self.failed_logins(),
            logged_before + 1,
            "The wrong current password is missing from the Authentication Log",
        )

    def failed_logins(self) -> int:
        """The failed sign-ins the Authentication Log holds for the member."""
        return len(
            frappe.get_all(
                "Activity Log",
                filters={"user": self.email, "operation": "Login", "status": "Failed"},
                pluck="name",
            )
        )

    def test_a_reset_request_answers_the_same_for_an_unknown_address(self) -> None:
        # Only the answer is under test here, not the hourly limit on the endpoint.
        self.enterContext(patch("suite.utils.rate_limiter.get_rate_limits", return_value=[]))

        sent_before = len(self.fake.emails)

        known = send_reset_password_link(self.email)
        unknown = send_reset_password_link(f"nobody-here@{DOMAIN}")

        self.assertEqual(known, unknown)
        self.assertNotIn("backup.test", str(known))
        # The real account still gets its link, at the backup address; the unknown one gets nothing.
        self.assertEqual(
            [email["recipient"] for email in self.fake.emails[sent_before:]], ["reset-member@backup.test"]
        )
