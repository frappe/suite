# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.mail.api.mail import (
    allow_screening_senders,
    get_mailboxes,
    get_screened_addresses,
    get_screening_sender_mails,
    get_screening_senders,
    get_threads,
    move_screening_mails_to_inbox,
    screen_email_address,
    screen_email_addresses,
    screen_out_senders,
    unscreen_email_addresses,
)
from suite.mail.api.mail import get_global_screened_addresses as get_global_screened
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

    def _screening_senders(self) -> list[dict]:
        with self.set_user(self.screener.email):
            return get_screening_senders(self.account)

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
                frappe.ValidationError, screen_email_address, self.account, "not-an-email", "Reject"
            )

            unscreen_email_addresses(self.account, [stranger])
            self.assertNotIn(stranger, self._screened())

            self.assertIsInstance(get_global_screened(), list)

    def test_auto_accept_on_send(self):
        correspondent = self.create_member()
        self.send_mail(self.screener, correspondent.email)
        # Sending allowlists the recipient so their replies reach the inbox.
        self.assertEqual(self._screened().get(correspondent.email), "Accepted")

    def test_screener_folder_flow(self):
        allowed = self.create_member()
        junked = self.create_member()

        subject_allowed = f"Screen me in {unique_name('subject')}"
        subject_junked = f"Screen me out {unique_name('subject')}"
        self.send_mail(allowed, self.screener.email, subject=subject_allowed)
        self.send_mail(junked, self.screener.email, subject=subject_junked)

        # Both unknown senders land in the Screener, grouped by sender.
        def both_present():
            rows = self._screening_senders()
            return rows if {allowed.email, junked.email} <= {r["from_email"] for r in rows} else None

        senders = self.wait_until(
            both_present, timeout=60, message="Unknown senders did not land in the Screener."
        )
        allowed_row = next(r for r in senders if r["from_email"] == allowed.email)
        self.assertEqual(allowed_row["count"], 1)
        self.assertEqual(allowed_row["unread"], 1)

        with self.set_user(self.screener.email):
            mails = get_screening_sender_mails(self.account, allowed.email)
            self.assertEqual([m["subject"] for m in mails], [subject_allowed])

            # Allow one sender in: rule + mail moves to the inbox.
            allow_screening_senders(self.account, [allowed.email])
        self.assertEqual(self._screened().get(allowed.email), "Accepted")
        self.wait_until(
            lambda: subject_allowed in [t["subject"] for t in self.get_inbox_threads(self.screener)],
            message="Allowed sender's mail did not move to the inbox.",
        )

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

        # A third pending sender gets flushed to the inbox (the "screening turned off" path).
        pending = self.create_member()
        subject_pending = f"Pending {unique_name('subject')}"
        self.send_mail(pending, self.screener.email, subject=subject_pending)
        self.wait_until(
            lambda: pending.email in {r["from_email"] for r in self._screening_senders()},
            timeout=60,
            message="Third sender did not land in the Screener.",
        )
        with self.set_user(self.screener.email):
            move_screening_mails_to_inbox(self.account)
        self.wait_until(
            lambda: subject_pending in [t["subject"] for t in self.get_inbox_threads(self.screener)],
            message="Screener flush did not move pending mail to the inbox.",
        )

    def test_allow_sender_and_archive(self):
        """Allowing a sender can file their waiting mail straight into Archive instead of the Inbox —
        the sender is accepted either way."""

        sender = self.create_member()
        subject = f"Allow and archive {unique_name('subject')}"
        self.send_mail(sender, self.screener.email, subject=subject)
        self.wait_until(
            lambda: sender.email in {r["from_email"] for r in self._screening_senders()},
            timeout=60,
            message="Sender did not land in the Screener.",
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

    def test_rejected_sender_is_discarded(self):
        rejected = self.create_member()
        with self.set_user(self.screener.email):
            screen_email_address(self.account, rejected.email, "Reject")

        subject = f"Rejected {unique_name('subject')}"
        self.send_mail(rejected, self.screener.email, subject=subject)

        # Discarded outright: it must reach neither the inbox nor the Screener. Deliverability of
        # a control mail is the clock - once it arrives, the rejected one would have too.
        control = self.create_member()
        control_subject = f"Control {unique_name('subject')}"
        self.send_mail(control, self.screener.email, subject=control_subject)
        self.wait_until(
            lambda: control.email in {r["from_email"] for r in self._screening_senders()},
            timeout=60,
            message="Control mail never arrived.",
        )

        self.assertNotIn(subject, [t["subject"] for t in self.get_inbox_threads(self.screener)])
        self.assertNotIn(rejected.email, {r["from_email"] for r in self._screening_senders()})
