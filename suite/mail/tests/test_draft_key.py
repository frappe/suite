# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""A composer names its composition with a `draft_key` on every save and send. A client that lost an
answer retries with the same key, and must end up where it would have if the answer had arrived: no
second draft, no second send, and no false "the draft has gone"."""

from unittest import mock
from uuid import uuid4

import frappe
from frappe.tests import UnitTestCase

from suite.mail.api import mail
from suite.mail.api.mail import create_mail, get_mailboxes, get_thread, get_threads, update_draft_mail
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestDraftKey(StalwartIntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sender = cls.create_member()
        cls.receiver = cls.create_member()
        cls.disable_screening(cls.receiver)
        cls.account = cls.personal_account(cls.sender)

    def setUp(self):
        self.subject = f"Draft key {unique_name('subject')}"
        self.key = str(uuid4())

    def compose(self, **kwargs) -> dict:
        return {
            "account": self.account,
            "from_email": self.sender.email,
            "to": [{"email": self.receiver.email}],
            "cc": [],
            "bcc": [],
            "subject": self.subject,
            "html_body": "<p>Body</p>",
            **kwargs,
        }

    def drafts(self) -> list[dict]:
        """The sender's drafts under this test's subject."""

        drafts_id = {(m["role"] or "").lower(): m["id"] for m in get_mailboxes(self.account)}["drafts"]
        rows = get_threads(self.account, drafts_id, limit=50)["rows"]
        return [row for row in rows if row["subject"] == self.subject]

    def received(self) -> list[dict]:
        return [t for t in self.get_inbox_threads(self.receiver) if t["subject"] == self.subject]

    def test_a_create_retried_after_its_answer_was_lost_leaves_one_draft(self):
        with self.set_user(self.sender.email):
            first = create_mail(**self.compose(save_as_draft=True, draft_key=self.key))
            again = create_mail(**self.compose(save_as_draft=True, draft_key=self.key))

            self.assertEqual(again["status"], "Drafted")
            self.assertNotEqual(again["id"], first["id"])
            self.assertEqual(len(self.wait_until(self.drafts, message="The draft is not in Drafts.")), 1)

    def test_without_a_key_each_create_is_a_draft_of_its_own(self):
        with self.set_user(self.sender.email):
            create_mail(**self.compose(save_as_draft=True))
            create_mail(**self.compose(save_as_draft=True))

            self.wait_until(lambda: len(self.drafts()) == 2, message="Two drafts did not appear.")

    def test_a_save_retried_from_the_id_it_started_with_lands_on_the_newest_draft(self):
        with self.set_user(self.sender.email):
            start = create_mail(**self.compose(save_as_draft=True, draft_key=self.key))
            # Saved over `start`, and the answer naming the new id never arrived.
            update_draft_mail(**self.compose(id=start["id"], html_body="<p>One</p>", draft_key=self.key))

            again = update_draft_mail(
                **self.compose(id=start["id"], html_body="<p>Two</p>", draft_key=self.key)
            )

            self.assertEqual(again["status"], "Drafted")
            drafts = self.wait_until(self.drafts, message="The draft is not in Drafts.")
            self.assertEqual([row["messages"][-1]["id"] for row in drafts], [again["id"]])

    def test_a_send_retried_after_its_answer_was_lost_sends_once(self):
        with self.set_user(self.sender.email):
            sent = create_mail(**self.compose(draft_key=self.key))
            again = create_mail(**self.compose(draft_key=self.key))

        self.assertEqual(sent["status"], "Submitted", sent.get("error"))
        self.assertEqual(again, sent)
        self.wait_until(self.received, timeout=60, message="The mail did not arrive.")
        self.assertEqual(len(self.received()), 1)

    def test_a_save_after_a_send_whose_answer_was_lost_finds_the_draft_gone(self):
        with self.set_user(self.sender.email):
            draft = create_mail(**self.compose(save_as_draft=True, draft_key=self.key))
            sent = update_draft_mail(**self.compose(id=draft["id"], submit=True, draft_key=self.key))
            self.assertEqual(sent["status"], "Submitted", sent.get("error"))

            # The composer never heard that it was sent, and goes on saving what is on screen.
            with self.assertRaises(frappe.DoesNotExistError):
                update_draft_mail(**self.compose(id=draft["id"], draft_key=self.key))
            with self.assertRaises(frappe.DoesNotExistError):
                create_mail(**self.compose(save_as_draft=True, draft_key=self.key))

            self.assertEqual(self.drafts(), [])

    def test_another_composition_of_a_replaced_draft_finds_it_gone(self):
        with self.set_user(self.sender.email):
            draft = create_mail(**self.compose(save_as_draft=True, draft_key="tab-a" + self.key))
            # Read, as a second tab opening it would, before the first tab saves over it.
            get_thread(self.account, draft["thread_id"])
            update_draft_mail(**self.compose(id=draft["id"], draft_key="tab-a" + self.key))

            with self.assertRaises(frappe.DoesNotExistError):
                update_draft_mail(**self.compose(id=draft["id"], draft_key="tab-b" + self.key))

    def test_a_sent_message_cannot_be_saved_as_a_draft(self):
        with self.set_user(self.sender.email):
            sent = create_mail(**self.compose())
            self.assertEqual(sent["status"], "Submitted", sent.get("error"))

            with self.assertRaises(frappe.DoesNotExistError):
                update_draft_mail(**self.compose(id=sent["id"]))


class TestOneRequestPerComposition(UnitTestCase):
    """A retry that arrives while the try it repeats is still running waits for it, and is turned
    away for another go if it waits too long. Other compositions don't wait at all."""

    def setUp(self):
        patcher = mock.patch.object(mail, "DRAFT_KEY_LOCK_WAIT", 0.2)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.key = str(uuid4())

    def test_a_second_request_for_a_composition_still_running_is_turned_away_to_retry(self):
        with mail._one_request_per_composition("account", self.key):
            with self.assertRaises(frappe.TooManyRequestsError):
                with mail._one_request_per_composition("account", self.key):
                    pass

    def test_another_composition_goes_ahead(self):
        with mail._one_request_per_composition("account", self.key):
            with mail._one_request_per_composition("account", str(uuid4())):
                pass

    def test_the_composition_is_free_again_once_the_request_ends(self):
        with mail._one_request_per_composition("account", self.key):
            pass
        with mail._one_request_per_composition("account", self.key):
            pass
