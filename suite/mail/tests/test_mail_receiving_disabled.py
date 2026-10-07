# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.mail.api.admin import set_member_receiving_enabled
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestAccountWithReceivingDisabled(StalwartIntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.send_only = cls.create_member(disable_receiving=True)
        cls.member = cls.create_member()
        cls.colleague = cls.create_member()
        # On all: mail that did get through must show in the inbox, not sit unseen in Screening.
        for member in (cls.send_only, cls.member, cls.colleague):
            cls.disable_screening(member)

    def test_it_sends_like_any_other_account(self):
        self.deliver_mail(self.send_only, self.colleague)

    def test_mail_addressed_to_it_bounces_back_to_the_sender(self):
        self.assert_mail_bounces(self.send_only)

    def test_an_admin_stops_and_restores_an_accounts_receiving(self):
        self.deliver_mail(self.colleague, self.member)

        self.set_receiving(self.member, False)
        self.assert_mail_bounces(self.member)

        self.set_receiving(self.member, True)
        self.deliver_mail(self.colleague, self.member)

    def set_receiving(self, member: frappe._dict, enabled: bool) -> None:
        with self.set_user("Administrator"):
            set_member_receiving_enabled(member.email, enabled)

    def assert_mail_bounces(self, recipient: frappe._dict) -> None:
        """The colleague's mail to ``recipient`` comes back as a delivery failure and never arrives."""

        subject = f"Unwanted {unique_name('subject')}"
        result = self.send_mail(self.colleague, recipient.email, subject=subject)
        self.assertEqual(result["status"], "Submitted", result.get("error"))

        # The failure notice is what tells mail that was turned away from mail that is only slow.
        self.wait_until(
            lambda: any(
                t["from_email"].lower().startswith("mailer-daemon@") and recipient.email in t["preview"]
                for t in self.get_inbox_threads(self.colleague)
            ),
            timeout=60,
            message=f"No delivery failure came back for mail sent to {recipient.email}.",
        )
        self.assertNotIn(subject, [t["subject"] for t in self.get_inbox_threads(recipient)])
