# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from suite.mail.api.mail import get_delivery_status, get_threads
from suite.mail.api.scheduled import get_scheduled_mail, get_submissions
from suite.mail.jmap import get_mailbox_id_by_role
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestBounces(StalwartIntegrationTestCase):
    """A send the server cannot deliver comes back as a bounce, and Suite reads it as one: in
    Primary, not waiting on the Screener, linked to the sent message, and failing its submission.

    Mail to an account that takes no mail is turned away, and the server mails the sender its
    report. The sender keeps screening on, as a personal account does by default.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sender = cls.create_member()
        cls.send_only = cls.create_member(disable_receiving=True)
        cls.account = cls.personal_account(cls.sender)

    def _bounce_row(self, recipient: str) -> dict | None:
        """The Inbox row of the bounce about mail to `recipient`, once it has arrived."""

        for row in self.get_inbox_threads(self.sender):
            for message in row["messages"]:
                if message["dsn_blob_id"] and recipient in (message["text_body"] or ""):
                    return row
        return None

    def _tab_subjects(self, category: str) -> list[str]:
        with self.set_user(self.sender.email):
            inbox = get_mailbox_id_by_role(self.account, "inbox", raise_exception=True)
            rows = get_threads(self.account, inbox, limit=20, category=category)["rows"]
        return [row["subject"] for row in rows]

    def test_a_send_turned_away_comes_back_as_a_bounce_on_the_sent_message(self):
        recipient = self.send_only.email
        subject = f"Undeliverable {unique_name('subject')}"
        sent = self.send_mail(self.sender, recipient, subject=subject)
        self.assertEqual(sent["status"], "Submitted", sent.get("error"))

        with self.mail_settings(enable_email_classification=1):
            row = self.wait_until(
                lambda: self._bounce_row(recipient), timeout=90, message="No bounce reached the sender."
            )
            primary, updates = self._tab_subjects("primary"), self._tab_subjects("updates")
        [bounce] = [message for message in row["messages"] if message["dsn_blob_id"]]

        # From MAILER-DAEMON, whom nobody accepted, yet not held for the Screener; and in Primary,
        # though the server marks it auto-generated.
        self.assertEqual(row["unscreened"], 0)
        self.assertIn(row["subject"], primary)
        self.assertNotIn(row["subject"], updates)

        # The report says why, and names the message it is about.
        with self.set_user(self.sender.email):
            report = get_delivery_status(self.account, bounce["id"])
        [failed] = report["recipients"]
        self.assertEqual((failed["email"].lower(), failed["action"]), (recipient.lower(), "failed"))
        self.assertTrue(failed["reason"])
        self.assertNotEqual(failed["reason"], failed["status"])
        self.assertEqual(report["submission_id"], sent["submission_id"])
        self.assertTrue(report["sent_thread_id"])
        self.assertNotEqual(report["sent_thread_id"], row["thread_id"])

        # The Outbox says the send failed, for the reason the report gives, and opens the report.
        with self.set_user(self.sender.email):
            [listed] = [r for r in get_submissions(self.account)["rows"] if r["id"] == sent["submission_id"]]
            details = get_scheduled_mail(self.account, sent["submission_id"])
        for submission in (listed, details):
            self.assertEqual(submission["status"], "failed")
            self.assertEqual(
                submission["delivery_errors"], [{"email": recipient, "reason": failed["reason"]}]
            )
        self.assertEqual(details["thread_id"], report["sent_thread_id"])
        self.assertEqual(details["dsn_count"], 1)
        self.assertEqual(details["dsn_thread_id"], row["thread_id"])
