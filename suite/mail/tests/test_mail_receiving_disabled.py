# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestAccountWithReceivingDisabled(StalwartIntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.send_only = cls.create_member(disable_receiving=True)
        cls.colleague = cls.create_member()
        # On both: mail that did get through must show in the inbox, not sit unseen in Screening.
        cls.disable_screening(cls.send_only)
        cls.disable_screening(cls.colleague)

    def test_it_sends_like_any_other_account(self):
        self.deliver_mail(self.send_only, self.colleague)

    def test_mail_addressed_to_it_bounces_back_to_the_sender(self):
        subject = f"Unwanted {unique_name('subject')}"
        result = self.send_mail(self.colleague, self.send_only.email, subject=subject)
        self.assertEqual(result["status"], "Submitted", result.get("error"))

        # The failure notice is what tells mail that was turned away from mail that is only slow.
        self.wait_until(
            lambda: next(
                (
                    t
                    for t in self.get_inbox_threads(self.colleague)
                    if t["from_email"].lower().startswith("mailer-daemon@")
                ),
                None,
            ),
            timeout=60,
            message="No delivery failure came back for mail sent to the send-only account.",
        )
        self.assertNotIn(subject, [t["subject"] for t in self.get_inbox_threads(self.send_only)])
