# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from suite.mail.api.mail import get_tab_counts, get_threads, set_mails_seen
from suite.mail.doctype.mail_message.mail_message import fetch_messages
from suite.mail.jmap import get_mailbox_id_by_role
from suite.mail.tests.base import StalwartIntegrationTestCase


class TestMailClassification(StalwartIntegrationTestCase):
    """Mail fetched from a live server is given its category there, as a keyword."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sender = cls.create_member()
        cls.receiver = cls.create_member()
        cls.disable_screening(cls.receiver)

    def _server_keywords(self, member, role: str, subject: str) -> dict:
        """The keywords the server holds for the member's message titled `subject`."""

        account = self.personal_account(member)
        with self.set_user(member.email):
            mailbox = get_mailbox_id_by_role(account, role, raise_exception=True)

        client = self.get_user_jmap_client(member.email)
        with client.batch() as b:
            query = b.mail.email.query(filter={"inMailbox": mailbox, "subject": subject})
            emails = b.mail.email.get(ids=query.ref_ids(), properties=["keywords"])

        [email] = emails.result.items
        return email.to_wire()["keywords"]

    def test_received_mail_is_categorised_on_the_server(self):
        thread = self.deliver_mail(self.sender, self.receiver)

        # Reading the inbox is what fetched it. A colleague's mail has nothing bulk about it.
        self.assertTrue(
            self._server_keywords(self.receiver, "inbox", thread["subject"]).get("category_primary")
        )

    def test_mail_can_be_found_by_its_category(self):
        thread = self.deliver_mail(self.sender, self.receiver)
        account = self.personal_account(self.receiver)

        def subjects(keyword: str) -> list[str]:
            with self.set_user(self.receiver.email):
                messages, _total = fetch_messages(account, {"hasKeyword": keyword})
            return [message["subject"] for message in messages]

        self.wait_until(
            lambda: thread["subject"] in subjects("category_primary"),
            message="Classified mail is missing from a search for its category.",
        )
        self.assertNotIn(thread["subject"], subjects("category_promotions"))

    def test_the_inbox_can_be_filtered_to_a_category(self):
        thread = self.deliver_mail(self.sender, self.receiver)
        account = self.personal_account(self.receiver)

        def subjects(category: str) -> list[str]:
            with self.set_user(self.receiver.email):
                inbox = get_mailbox_id_by_role(account, "inbox", raise_exception=True)
                threads, _mailbox = get_threads(account, inbox, limit=20, filter_by=category)
            return [thread["subject"] for thread in threads]

        self.wait_until(
            lambda: thread["subject"] in subjects("category_primary"),
            message="Classified mail is missing from the inbox filtered to its category.",
        )
        self.assertNotIn(thread["subject"], subjects("category_promotions"))

    def test_sent_mail_is_not_categorised(self):
        thread = self.deliver_mail(self.sender, self.receiver)
        account = self.personal_account(self.sender)

        with self.set_user(self.sender.email):
            sent = get_mailbox_id_by_role(account, "sent", raise_exception=True)
            fetch_messages(account, {"inMailbox": sent})

        keywords = self._server_keywords(self.sender, "sent", thread["subject"])
        self.assertEqual([keyword for keyword in keywords if keyword.startswith("category_")], [])

    def test_mail_is_not_categorised_when_the_setting_is_off(self):
        with self.mail_settings(enable_email_classification=0):
            thread = self.deliver_mail(self.sender, self.receiver)

        keywords = self._server_keywords(self.receiver, "inbox", thread["subject"])
        self.assertEqual([keyword for keyword in keywords if keyword.startswith("category_")], [])


class TestInboxTabs(StalwartIntegrationTestCase):
    """The Inbox is split into tabs by category, each with its unread threads counted."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sender = cls.create_member()
        cls.receiver = cls.create_member()
        cls.disable_screening(cls.receiver)
        cls.account = cls.personal_account(cls.receiver)
        with cls.set_user(cls.receiver.email):
            cls.inbox = get_mailbox_id_by_role(cls.account, "inbox", raise_exception=True)

    def subjects(self, tab: str) -> list[str]:
        with self.set_user(self.receiver.email):
            threads = get_threads(self.account, self.inbox, limit=20, category=tab)["rows"]
        return [thread["subject"] for thread in threads]

    def unread(self) -> dict[str, int]:
        with self.set_user(self.receiver.email):
            return {
                tab["category"]: tab["unread_threads"] for tab in get_tab_counts(self.account, self.inbox)
            }

    def test_a_colleagues_mail_is_in_primary_and_no_other_tab(self):
        thread = self.deliver_mail(self.sender, self.receiver)

        self.wait_until(
            lambda: thread["subject"] in self.subjects("primary"),
            message="A colleague's mail is missing from the Primary tab.",
        )
        for tab in ("updates", "forums", "promotions", "social"):
            with self.subTest(tab=tab):
                self.assertNotIn(thread["subject"], self.subjects(tab))

    def test_a_tab_counts_its_unread_threads(self):
        thread = self.deliver_mail(self.sender, self.receiver)
        before = self.unread()
        self.assertEqual(list(before), ["primary", "updates", "forums", "promotions", "social"])

        with self.set_user(self.receiver.email):
            set_mails_seen(self.account, [thread["id"]], True)

        self.wait_until(
            lambda: self.unread()["primary"] == before["primary"] - 1,
            message="Reading a Primary thread did not take it off Primary's unread count.",
        )
        self.assertEqual(
            {tab: count for tab, count in self.unread().items() if tab != "primary"},
            {tab: count for tab, count in before.items() if tab != "primary"},
        )
