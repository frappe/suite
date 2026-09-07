# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.mail.api.mail import (
    create_mailbox,
    delete_mailbox,
    empty_user_mailbox,
    get_mailboxes,
    get_threads,
    move_mails,
    update_mailbox,
)
from suite.mail.doctype.mailbox.mailbox import add_mailbox, delete_mailboxes, fetch_mailboxes
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestMailMailboxes(StalwartIntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.member = cls.create_member()
        cls.other = cls.create_member()
        cls.account = cls.personal_account(cls.member)
        cls.disable_screening(cls.member)

    def _mailboxes(self) -> list[dict]:
        with self.set_user(self.member.email):
            return get_mailboxes(self.account)

    def _mailbox_by_name(self, name: str) -> dict | None:
        return next((m for m in self._mailboxes() if m["_name"] == name), None)

    def test_default_mailboxes(self):
        roles = {(m["role"] or "").lower() for m in self._mailboxes()}
        self.assertTrue({"inbox", "sent", "drafts", "junk", "trash", "archive"} <= roles)

    def test_mailbox_lifecycle(self):
        name = unique_name("folder")
        with self.set_user(self.member.email):
            create_mailbox(
                self.account,
                name,
                color="#ff0000",
                automation_rules={
                    "emails_from": self.other.email,
                    "subject_contains": "",
                    "match_if": "any",
                    "mark_as_read": True,
                    "add_star": False,
                },
            )

        mailbox = self._mailbox_by_name(name)
        self.assertIsNotNone(mailbox)
        self.assertEqual(mailbox["color"], "#ff0000")
        self.assertEqual(mailbox["automation_rules"]["emails_from"], self.other.email)
        self.assertTrue(mailbox["automation_rules"]["mark_as_read"])

        # A nested mailbox under the new one.
        child_name = unique_name("subfolder")
        with self.set_user(self.member.email):
            create_mailbox(self.account, child_name, parent=mailbox["id"])
        self.assertIsNotNone(self._mailbox_by_name(child_name))

        # Rename + drop the automation rules.
        renamed = f"{name}-renamed"
        with self.set_user(self.member.email):
            update_mailbox(
                self.account,
                mailbox["id"],
                name=renamed,
                old_name=name,
                color="#00ff00",
                automation_rules=None,
            )
        updated = self._mailbox_by_name(renamed)
        self.assertIsNotNone(updated)
        self.assertEqual(updated["color"], "#00ff00")
        self.assertIsNone(updated.get("automation_rules"))

        # Delete (child first, then parent) - server mailbox and settings row both go.
        child = self._mailbox_by_name(child_name)
        with self.set_user(self.member.email):
            delete_mailbox(self.account, child["id"], child_name)
            delete_mailbox(self.account, updated["id"], renamed)
        self.assertIsNone(self._mailbox_by_name(renamed))
        self.assertFalse(
            frappe.db.exists("Mailbox Settings", {"account": self.account, "mailbox_id": updated["id"]})
        )

    def test_update_mailbox_position(self):
        from suite.mail.doctype.mailbox.mailbox import update_mailbox_position

        first = unique_name("pos-a")
        second = unique_name("pos-b")
        with self.set_user(self.member.email):
            create_mailbox(self.account, first)
            create_mailbox(self.account, second)
            first_id = self._mailbox_by_name(first)["id"]
            second_id = self._mailbox_by_name(second)["id"]

            # Move the first mailbox after the second; the listing still holds both.
            update_mailbox_position(self.account, first_id, prior_mailbox_id=second_id)
        self.assertIsNotNone(self._mailbox_by_name(first))
        self.assertIsNotNone(self._mailbox_by_name(second))

    def test_listing_holds_more_than_a_page_of_mailboxes(self):
        """Every folder reaches the client, however many the account has.

        Mailbox is a virtual doctype, so a list query is served by Mailbox.get_list, where frappe
        fixes the page length at twenty however loudly the caller asks for everything. An account
        with more folders than that used to lose the ones sorting last, silently.
        """

        # Two past the page whatever the account already holds, so the tail is always the part
        # a page would cut.
        existing = self._mailboxes()
        names = [unique_name("page") for _ in range(max(2, 22 - len(existing)))]

        ids = []
        with self.set_user(self.member.email):
            for name in names:
                ids.append(add_mailbox(self.account, name))

            try:
                listed = self._mailboxes()
                self.assertGreater(len(listed), 20)
                self.assertLessEqual(set(names), {m["_name"] for m in listed})

                # A caller that does ask for a page still gets one.
                self.assertEqual(len(fetch_mailboxes(self.account, limit=20)), 20)
            finally:
                delete_mailboxes(self.account, ids)

    def test_empty_trash(self):
        thread = self.deliver_mail(self.other, self.member)

        with self.set_user(self.member.email):
            mailboxes = {(m["role"] or "").lower(): m["id"] for m in get_mailboxes(self.account)}
            move_mails(self.account, [thread["id"]], mailboxes["trash"])
            self.wait_until(
                lambda: get_threads(self.account, mailboxes["trash"], limit=20)[0],
                message="Moved mail did not appear in Trash.",
            )

            empty_user_mailbox(self.account, mailboxes["trash"])
            self.wait_until(
                lambda: not get_threads(self.account, mailboxes["trash"], limit=20)[0],
                message="Trash still has threads after emptying.",
            )

    def test_foreign_account_denied(self):
        mailbox = self._mailboxes()[0]
        with self.set_user(self.other.email):
            self.assertRaises(
                frappe.ValidationError,
                update_mailbox,
                self.account,
                mailbox["id"],
                name="hijack",
                old_name=mailbox["_name"],
            )
