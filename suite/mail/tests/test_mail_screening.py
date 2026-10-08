# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.mail.api.mail import (
    _screening_message_ids,
    allow_screening_senders,
    get_mailboxes,
    get_screened_addresses,
    get_threads,
    screen_email_address,
    screen_email_addresses,
    screen_out_senders,
    unscreen_email_addresses,
)
from suite.mail.api.mail import get_global_screened_addresses as get_global_screened
from suite.mail.doctype.mail_message.mail_message import get_messages
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestMailScreening(StalwartIntegrationTestCase):
    """Screening (Hey-style) flows. The screener member keeps the default enable_screening=1."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.screener = cls.create_member()
        cls.account = cls.personal_account(cls.screener)

    def _screened(self) -> dict[str, str]:
        with self.set_user(self.screener.email):
            return {row["email"]: row["action"] for row in get_screened_addresses(self.account)}

    def _waiting_mail(self) -> list[dict]:
        """The mail marked unscreened — waiting on a decision about its sender."""

        with self.set_user(self.screener.email):
            return get_messages(self.account, _screening_message_ids(self.account))

    def _waiting_senders(self) -> set[str]:
        return {mail["from_email"] for mail in self._waiting_mail()}

    def _inbox_unscreened(self, subject: str) -> int | None:
        """The inbox row's unscreened flag for the thread with this subject; None while it is absent."""

        rows = {t["subject"]: t for t in self.get_inbox_threads(self.screener)}
        return rows[subject]["unscreened"] if subject in rows else None

    def test_screening_rules_crud(self):
        stranger = f"{unique_name('stranger')}@elsewhere.example.org"

        with self.set_user(self.screener.email):
            screen_email_address(self.account, stranger, "Accepted")
            self.assertEqual(self._screened()[stranger], "Accepted")

            # Automated flows must not clobber a manual decision.
            screen_email_addresses(self.account, [stranger], action="Spam", override=False)
            self.assertEqual(self._screened()[stranger], "Accepted")

            # Explicit actions do.
            screen_email_addresses(self.account, [stranger], action="Spam", override=True)
            self.assertEqual(self._screened()[stranger], "Spam")

            self.assertRaisesRegex(
                frappe.ValidationError,
                "Invalid screening action",
                screen_email_address,
                self.account,
                stranger,
                "Nuke",
            )
            self.assertRaises(
                frappe.ValidationError, screen_email_address, self.account, "not-an-email", "Spam"
            )

            unscreen_email_addresses(self.account, [stranger])
            self.assertNotIn(stranger, self._screened())

            self.assertIsInstance(get_global_screened(), list)

    def test_auto_accept_on_send(self):
        correspondent = self.create_member()
        self.send_mail(self.screener, correspondent.email)
        # Sending allowlists the recipient so their replies reach the inbox.
        self.assertEqual(self._screened().get(correspondent.email), "Accepted")

    def test_screening_flow(self):
        allowed = self.create_member()
        junked = self.create_member()

        subject_allowed = f"Screen me in {unique_name('subject')}"
        subject_junked = f"Screen me out {unique_name('subject')}"
        self.send_mail(allowed, self.screener.email, subject=subject_allowed)
        self.send_mail(junked, self.screener.email, subject=subject_junked)

        # Both unknown senders wait on a decision.
        def both_present():
            rows = self._waiting_mail()
            return rows if {allowed.email, junked.email} <= {r["from_email"] for r in rows} else None

        senders = self.wait_until(
            both_present, timeout=60, message="Unknown senders were not marked unscreened."
        )
        # They wait in the Inbox itself, marked — there is no folder of their own.
        self.assertEqual(self._inbox_unscreened(subject_allowed), 1)
        self.assertEqual(
            [m["subject"] for m in senders if m["from_email"] == allowed.email], [subject_allowed]
        )

        with self.set_user(self.screener.email):
            # Allow one sender in: rule + the mark comes off, the mail staying in the inbox.
            allow_screening_senders(self.account, [allowed.email])
        self.assertEqual(self._screened().get(allowed.email), "Accepted")
        self.wait_until(
            lambda: self._inbox_unscreened(subject_allowed) == 0,
            message="Allowed sender's mail was still marked unscreened.",
        )
        self.assertNotIn(allowed.email, self._waiting_senders())

        # Screen the other one out: rule Spam + mail to Junk.
        with self.set_user(self.screener.email):
            screen_out_senders(self.account, [junked.email])
        self.assertEqual(self._screened().get(junked.email), "Spam")
        with self.set_user(self.screener.email):
            junk_id = {(m["role"] or "").lower(): m["id"] for m in get_mailboxes(self.account)}["junk"]
        self.wait_until(
            lambda: (
                subject_junked in [t["subject"] for t in get_threads(self.account, junk_id, limit=20)["rows"]]
            ),
            message="Screened-out sender's mail did not move to Junk.",
        )

    def test_allow_sender_and_archive(self):
        """Allowing a sender can file their waiting mail straight into Archive instead of the Inbox —
        the sender is accepted either way."""

        sender = self.create_member()
        subject = f"Allow and archive {unique_name('subject')}"
        self.send_mail(sender, self.screener.email, subject=subject)
        self.wait_until(
            lambda: sender.email in self._waiting_senders(),
            timeout=60,
            message="Sender was not marked unscreened.",
        )

        with self.set_user(self.screener.email):
            self.assertRaisesRegex(
                frappe.ValidationError,
                "Invalid destination",
                allow_screening_senders,
                self.account,
                [sender.email],
                "junk",
            )

            allow_screening_senders(self.account, [sender.email], destination="archive")
            roles = {(m["role"] or "").lower(): m["id"] for m in get_mailboxes(self.account)}
            archive_id = roles["archive"]

        self.assertEqual(self._screened().get(sender.email), "Accepted")
        self.wait_until(
            lambda: (
                subject in [t["subject"] for t in get_threads(self.account, archive_id, limit=20)["rows"]]
            ),
            message="Allowed sender's mail did not move to Archive.",
        )
        self.assertNotIn(subject, [t["subject"] for t in self.get_inbox_threads(self.screener)])

    def test_blocked_sender_goes_to_junk(self):
        """Blocking a sender files their future mail into Junk, never discards it."""

        blocked = self.create_member()
        with self.set_user(self.screener.email):
            screen_email_address(self.account, blocked.email, "Spam")
            junk_id = {(m["role"] or "").lower(): m["id"] for m in get_mailboxes(self.account)}["junk"]

        subject = f"Blocked {unique_name('subject')}"
        self.send_mail(blocked, self.screener.email, subject=subject)
        self.wait_until(
            lambda: subject in [t["subject"] for t in get_threads(self.account, junk_id, limit=20)["rows"]],
            timeout=60,
            message="Blocked sender's mail did not reach Junk.",
        )

        self.assertNotIn(subject, [t["subject"] for t in self.get_inbox_threads(self.screener)])
        self.assertNotIn(blocked.email, self._waiting_senders())

    def test_reject_is_no_longer_an_action(self):
        with self.set_user(self.screener.email):
            self.assertRaisesRegex(
                frappe.ValidationError,
                "Invalid screening action",
                screen_email_address,
                self.account,
                f"{unique_name('someone')}@elsewhere.example.org",
                "Reject",
            )
