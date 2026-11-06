# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import unittest
from unittest.mock import MagicMock, patch

import frappe

from suite.mail.api import mail


def compose_input(**kwargs) -> dict:
    return {
        "account": "account",
        "from_email": "maya@example.com",
        "to": [{"email": "dana@example.com"}],
        "cc": [],
        "bcc": [],
        "subject": "Subject",
        "html_body": "<p>Body</p>",
        **kwargs,
    }


def queue(id: str, status: str = "Drafted", error: str | None = None) -> MagicMock:
    return MagicMock(
        name="queue",
        id=id,
        status=status,
        error_message=error,
        thread_id="thread",
        submission_id=None,
        send_at=None,
        recipients=[],
    )


class TestDraftKey(unittest.TestCase):
    """A client that lost an answer retries with the same key, and must end up where it would have
    if the answer had arrived: no second draft, no second send, no false "the draft has gone"."""

    def setUp(self):
        cache: dict[str, dict] = {}
        self.cache = MagicMock()
        self.cache.get_value.side_effect = cache.get
        self.cache.set_value.side_effect = lambda key, value, **_: cache.__setitem__(key, value)
        self.messages: dict[str, MagicMock] = {}
        self.created: list[dict] = []

        def get_doc(_doctype, name):
            message = self.messages.get(name.split("|")[1])
            if not message:
                raise frappe.DoesNotExistError("Message not found")
            return message

        def create(**kwargs):
            self.created.append(kwargs)
            return queue(
                f"created-{len(self.created)}", "Drafted" if kwargs["save_as_draft"] else "Submitted"
            )

        for patcher in (
            patch.object(mail.frappe, "cache", self.cache),
            patch.object(mail.frappe, "session", MagicMock(user="maya@example.com")),
            patch.object(mail.frappe, "get_doc", get_doc),
            patch.object(mail.MailQueue, "_create", create),
            patch.object(mail, "get_user_for_jmap_account", lambda *_, **__: "maya@example.com"),
            patch.object(mail, "attachment_rows", lambda *_: []),
            patch.object(mail, "create_contacts_if_not_exists"),
            patch.object(mail, "auto_accept_recipients"),
            patch.object(mail, "from_utc_z", lambda value: value),
            patch.object(mail, "to_utc_z", lambda value: value),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def message(self, id: str, answer: MagicMock | None = None, draft: bool = True) -> MagicMock:
        message = MagicMock(draft=draft, attachments=[], recipients=[])
        message.save_draft.return_value = answer or queue(f"after-{id}")
        message.submit.return_value = answer or queue(f"after-{id}", "Submitted")
        self.messages[id] = message
        return message

    def test_create_retried_after_lost_answer_updates_rather_than_duplicates(self):
        first = mail.create_mail(**compose_input(save_as_draft=True, draft_key="k"))
        self.assertEqual(first["id"], "created-1")
        message = self.message("created-1")

        again = mail.create_mail(**compose_input(save_as_draft=True, draft_key="k"))

        self.assertEqual(len(self.created), 1)
        message.save_draft.assert_called_once()
        self.assertEqual(again["id"], "after-created-1")

    def test_update_retried_after_lost_answer_lands_on_the_new_id(self):
        replaced = self.message("x1", answer=queue("x2"))
        mail.update_draft_mail(**compose_input(id="x1", draft_key="k"))
        # The first save replaced x1 with x2, and its answer never arrived.
        del self.messages["x1"]
        latest = self.message("x2", answer=queue("x3"))

        answer = mail.update_draft_mail(**compose_input(id="x1", draft_key="k"))

        replaced.save_draft.assert_called_once()
        latest.save_draft.assert_called_once()
        self.assertEqual(answer["id"], "x3")

    def test_send_retried_after_lost_answer_does_not_send_twice(self):
        first = mail.create_mail(**compose_input(save_as_draft=False, draft_key="k"))
        self.assertEqual(first["status"], "Submitted")

        again = mail.create_mail(**compose_input(save_as_draft=False, draft_key="k"))

        self.assertEqual(len(self.created), 1)
        self.assertEqual(again, first)

    def test_update_of_a_send_retried_after_lost_answer_does_not_send_twice(self):
        message = self.message("x1", answer=queue("x2", "Submitted"))
        first = mail.update_draft_mail(**compose_input(id="x1", submit=True, draft_key="k"))

        again = mail.update_draft_mail(**compose_input(id="x1", submit=True, draft_key="k"))

        message.submit.assert_called_once()
        self.assertEqual(again, first)

    def test_a_refused_save_is_not_remembered(self):
        self.message("x1", answer=queue("x1", "Failed to Draft", "Refused"))
        mail.update_draft_mail(**compose_input(id="x1", draft_key="k"))
        self.cache.set_value.assert_not_called()

    def test_another_composition_of_a_replaced_draft_finds_it_gone(self):
        self.message("x1", answer=queue("x2"))
        mail.update_draft_mail(**compose_input(id="x1", draft_key="tab-a"))
        del self.messages["x1"]

        with self.assertRaises(frappe.DoesNotExistError):
            mail.update_draft_mail(**compose_input(id="x1", draft_key="tab-b"))

    def test_a_key_is_no_use_to_anyone_else(self):
        self.message("x1", answer=queue("x2"))
        mail.update_draft_mail(**compose_input(id="x1", draft_key="k"))
        keys = {call.args[0] for call in self.cache.set_value.call_args_list}
        self.assertTrue(all("maya@example.com" in key for key in keys))
        with patch.object(mail.frappe, "session", MagicMock(user="sam@example.com")):
            self.assertIsNone(mail._last_answer("account", "k"))

    def test_saving_a_message_that_is_no_longer_a_draft_finds_it_gone(self):
        message = self.message("x1", draft=False)

        with (
            patch.object(mail, "_", lambda text: text),
            patch.object(
                mail.frappe,
                "throw",
                side_effect=lambda message, exc: (_ for _ in ()).throw(exc(message)),
            ),
            self.assertRaises(frappe.DoesNotExistError),
        ):
            mail.update_draft_mail(**compose_input(id="x1", draft_key="k"))

        message.save_draft.assert_not_called()

    def test_without_a_key_nothing_is_kept(self):
        self.message("x1")
        mail.update_draft_mail(**compose_input(id="x1"))
        self.cache.set_value.assert_not_called()


class TestReplacedDraft(unittest.TestCase):
    """A save replaces a draft under a new id. A composer still holding the old one has to find it
    gone, so it can't be read back from the cache before the server's change notice arrives."""

    def replace(self, not_destroyed: dict) -> MagicMock:
        from suite.mail.doctype.mail_queue.mail_queue import MailQueue

        row = MailQueue.__new__(MailQueue)
        row.account, row.id = "account", "x1"
        client = MagicMock()
        batch = client.batch.return_value.__enter__.return_value
        batch.mail.email.set.return_value.result.not_destroyed = not_destroyed
        with (
            patch("suite.mail.doctype.mail_message.mail_message._remove_cached_messages") as remove,
            patch("suite.mail.doctype.mail_queue.mail_queue.log_mail_error"),
        ):
            row._destroy_replaced_draft(client)
        return remove

    def test_a_replaced_draft_leaves_the_cache(self):
        self.replace(not_destroyed={}).assert_called_once_with("account", ["x1"])

    def test_a_draft_the_server_kept_stays_readable(self):
        self.replace(not_destroyed={"x1": {"type": "forbidden"}}).assert_not_called()
