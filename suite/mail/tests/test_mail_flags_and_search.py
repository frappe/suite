# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.mail.api.mail import (
    add_mails_to_mailbox,
    get_avatar,
    get_email_suggestions,
    get_mailboxes,
    get_threads,
    move_mails,
    remove_mails_from_mailbox,
    search_email_addresses,
    search_mails,
    set_flagged,
    set_mails_mailboxes,
    set_mails_seen,
    set_mails_spam_status,
)
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestMailFlagsAndSearch(StalwartIntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sender = cls.create_member()
        cls.receiver = cls.create_member()
        cls.disable_screening(cls.receiver)
        cls.account = cls.personal_account(cls.receiver)

    def setUp(self):
        super().setUp()
        self.thread = self.deliver_mail(self.sender, self.receiver)
        self.mail_id = self.thread["id"]
        with self.set_user(self.receiver.email):
            self.mailboxes = {(m["role"] or "").lower(): m["id"] for m in get_mailboxes(self.account)}
            self.inbox = self.mailboxes["inbox"]

    def _threads(self, mailbox: str, filter_by: str | None = None) -> list[dict]:
        with self.set_user(self.receiver.email):
            threads, _ = get_threads(self.account, mailbox, limit=20, filter_by=filter_by)
            return threads

    def test_flagged_and_seen(self):
        with self.set_user(self.receiver.email):
            result = set_flagged(self.account, [self.mail_id], True)
            self.assertTrue(result["flagged"])

        starred = self.wait_until(
            lambda: [t for t in self._threads("starred") if t["subject"] == self.thread["subject"]],
            message="Flagged thread is missing from the starred view.",
        )
        self.assertTrue(starred[0]["flagged"])

        # Unread filter shows it until it is marked seen.
        unread_subjects = [t["subject"] for t in self._threads(self.inbox, filter_by="unread")]
        self.assertIn(self.thread["subject"], unread_subjects)

        with self.set_user(self.receiver.email):
            set_mails_seen(self.account, [self.mail_id], True)
        self.wait_until(
            lambda: self.thread["subject"]
            not in [t["subject"] for t in self._threads(self.inbox, filter_by="unread")],
            message="Seen thread still shows in the unread filter.",
        )

        with self.set_user(self.receiver.email):
            set_flagged(self.account, [self.mail_id], False)

    def test_move_and_multi_mailbox_labels(self):
        subject = self.thread["subject"]
        archive = self.mailboxes["archive"]

        with self.set_user(self.receiver.email):
            move_mails(self.account, [self.mail_id], archive)
        self.wait_until(
            lambda: subject in [t["subject"] for t in self._threads(archive)]
            and subject not in [t["subject"] for t in self._threads(self.inbox)],
            message="Mail did not move from Inbox to Archive.",
        )

        # Label it back into the inbox without leaving the archive.
        with self.set_user(self.receiver.email):
            add_mails_to_mailbox(self.account, [self.mail_id], self.inbox)
        self.wait_until(
            lambda: subject in [t["subject"] for t in self._threads(self.inbox)]
            and subject in [t["subject"] for t in self._threads(archive)],
            message="Mail is not visible in both mailboxes after labeling.",
        )

        with self.set_user(self.receiver.email):
            remove_mails_from_mailbox(self.account, [self.mail_id], archive)
        self.wait_until(
            lambda: subject not in [t["subject"] for t in self._threads(archive)],
            message="Mail is still in Archive after removing the label.",
        )

        # Exact restore (the undo path).
        with self.set_user(self.receiver.email):
            set_mails_mailboxes(self.account, [{"id": self.mail_id, "mailbox_ids": [archive], "junk": False}])
        self.wait_until(
            lambda: subject in [t["subject"] for t in self._threads(archive)]
            and subject not in [t["subject"] for t in self._threads(self.inbox)],
            message="set_mails_mailboxes did not restore the exact membership.",
        )

    def test_spam_status_with_screening(self):
        subject = self.thread["subject"]

        with self.set_user(self.receiver.email):
            set_mails_spam_status(self.account, [self.mail_id], spam=True, screen_action="Spam")

        self.wait_until(
            lambda: subject in [t["subject"] for t in self._threads(self.mailboxes["junk"])]
            and subject not in [t["subject"] for t in self._threads(self.inbox)],
            message="Junked mail is not confined to the Junk view.",
        )
        # The sender got a Spam screening rule in the same call.
        self.assertEqual(
            frappe.db.get_value(
                "Screened Email Address", {"account": self.account, "email": self.sender.email}, "action"
            ),
            "Spam",
        )

        # Undo: not junk + re-accept the sender.
        with self.set_user(self.receiver.email):
            set_mails_spam_status(self.account, [self.mail_id], spam=False, screen_action="Accepted")
            move_mails(self.account, [self.mail_id], self.inbox)
        self.wait_until(
            lambda: subject in [t["subject"] for t in self._threads(self.inbox)],
            message="Mail did not return to the inbox after un-junking.",
        )
        self.assertEqual(
            frappe.db.get_value(
                "Screened Email Address", {"account": self.account, "email": self.sender.email}, "action"
            ),
            "Accepted",
        )

    def test_search(self):
        subject = self.thread["subject"]

        def search(filter, **kwargs):
            with self.set_user(self.receiver.email):
                mails, _total = search_mails(self.account, filter=filter, limit=10, **kwargs)
                return mails if any(m["subject"] == subject for m in mails) else None

        found = self.wait_until(
            lambda: search({"text": subject}), timeout=60, message="Text search never found the mail."
        )
        self.assertEqual(found[0]["account"], self.account)

        self.wait_until(
            lambda: search({"from": self.sender.email, "hasAttachment": "false"}),
            message="Sender + attachment filter search failed.",
        )
        self.wait_until(
            lambda: search({"text": subject}, all_accounts=True),
            message="all_accounts search failed.",
        )

        with self.set_user(self.receiver.email):
            self.assertEqual(search_mails(self.account, filter=None), ([], 0))

    def test_email_suggestions_and_avatar(self):
        with self.set_user(self.receiver.email):
            suggestions = self.wait_until(
                lambda: [
                    s
                    for s in get_email_suggestions(self.account, self.sender.username)
                    if s.get("email") == self.sender.email
                ]
                or None,
                message="Sender did not show up in email suggestions.",
            )
            self.assertTrue(suggestions)
            addresses = search_email_addresses(self.account, self.sender.username)
            self.assertIn(self.sender.email, [a.get("email") for a in addresses])

            # Gravatar stays disabled, so the identicon branch renders a PNG.
            get_avatar(f"{unique_name('ghost')}@nowhere.example.test")
            self.assertEqual(frappe.local.response.mimetype, "image/png")
            self.assertTrue(frappe.local.response.filecontent.startswith(b"\x89PNG"))
