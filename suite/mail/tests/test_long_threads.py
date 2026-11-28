# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""A long thread is read in part, and says where the rest is and how much of it there is."""

from unittest.mock import MagicMock, patch

from frappe.tests import UnitTestCase

from suite.mail.api import mail
from suite.mail.doctype.mail_message import mail_message
from suite.mail.tests.test_search_conversations import MAILBOXES, message

# A thread of 200 messages, m000 the oldest.
IDS = [f"m{at:03}" for at in range(200)]


def read(ids: list[str]) -> list[dict]:
    return [message(id, f"2026-10-01T09:00:{int(id[1:]) % 60:02}Z", "inbox") for id in ids]


def fetch(call, *args, ids: list[str] = IDS, **kwargs) -> tuple[list[dict], list[str]]:
    """What `call` returns, and the ids it asked the server for."""

    asked: list[str] = []

    def get_messages(account: str, ids: list[str]) -> list[dict]:
        asked.extend(ids)
        return read(ids)

    with (
        patch.object(mail_message, "get_thread_email_ids", return_value={"t": ids}),
        patch.object(mail_message, "get_messages", side_effect=get_messages),
    ):
        return call("account", "t", *args, **kwargs), asked


def wire(value: dict) -> MagicMock:
    return MagicMock(to_wire=MagicMock(return_value=value))


class TestLongThreads(UnitTestCase):
    def test_a_list_reads_a_long_thread_in_part_with_the_message_that_listed_it(self):
        # A page of two threads: the long one, listed by a message in its middle, and a short one.
        client = MagicMock()
        batch = client.batch.return_value.__enter__.return_value
        batch.mail.email.get.return_value.result.items = [
            wire({"id": "m090", "threadId": "t"}),
            wire({"id": "s1", "threadId": "short"}),
        ]
        batch.mail.thread.get.return_value.result.items = [
            wire({"id": "t", "emailIds": IDS}),
            wire({"id": "short", "emailIds": ["s0", "s1"]}),
        ]
        asked: list[str] = []

        def get_messages(account: str, ids: list[str]) -> list[dict]:
            asked.extend(ids)
            return [
                message(id, "2026-10-01T09:00:00Z", "inbox", thread_id="t" if id in IDS else "short")
                for id in ids
            ]

        with (
            patch.object(mail_message, "get_account_client", return_value=client),
            patch.object(mail_message, "get_messages", side_effect=get_messages),
        ):
            conversations = mail_message.fetch_threads("account")

        # A list reads less of a long thread than the thread's own read does: every message is a body.
        self.assertEqual(asked, ["m000", "m090", "m198", "m199", "s0", "s1"])
        unloaded = {m["id"]: m.get("earlier_unloaded", 0) for m in conversations["t"]}
        self.assertEqual((unloaded["m090"], unloaded["m198"]), (89, 107))
        self.assertFalse(any("earlier_unloaded" in m for m in conversations["short"]))

    def test_a_long_thread_is_read_as_its_first_message_and_its_newest(self):
        messages, asked = fetch(mail_message.fetch_thread)
        self.assertEqual(asked, ["m000", *IDS[-20:]])
        # The message after the gap says how many were left out ahead of it.
        unloaded = {m["id"]: m["earlier_unloaded"] for m in messages if m.get("earlier_unloaded")}
        self.assertEqual(unloaded, {"m180": 179})

    def test_the_message_a_long_thread_is_opened_on_is_read_with_it(self):
        messages, asked = fetch(mail_message.fetch_thread, keep=["m090"])
        self.assertEqual(asked, ["m000", "m090", *IDS[-20:]])
        unloaded = {m["id"]: m["earlier_unloaded"] for m in messages if m.get("earlier_unloaded")}
        self.assertEqual(unloaded, {"m090": 89, "m180": 89})

    def test_a_thread_that_is_not_long_is_read_whole(self):
        messages, asked = fetch(mail_message.fetch_thread, ids=IDS[:50])
        self.assertEqual(asked, IDS[:50])
        self.assertFalse(any("earlier_unloaded" in m for m in messages))

    def test_earlier_messages_are_the_page_just_ahead_and_say_what_is_left(self):
        messages, asked = fetch(mail_message.fetch_earlier_messages, "m180", "m000", 50)
        self.assertEqual(asked, IDS[130:180])
        self.assertEqual(messages[0]["earlier_unloaded"], 129)

    def test_earlier_messages_stop_at_the_message_already_read(self):
        messages, asked = fetch(mail_message.fetch_earlier_messages, "m180", "m170", 50)
        self.assertEqual(asked, IDS[171:180])
        self.assertFalse(any("earlier_unloaded" in m for m in messages))

    def test_a_gap_before_mail_a_view_leaves_out_passes_to_the_next_message_shown(self):
        first, trashed, last = read(["m000", "m180", "m181"])
        trashed = {**trashed, "mailboxes": [{"mailbox_id": "trash"}], "earlier_unloaded": 179}
        with (
            patch.object(
                mail, "query_threads", return_value=({"t": [first, trashed, last]}, {"t": "m181"}, 1)
            ),
            patch.object(mail, "get_cached_mailboxes", return_value=MAILBOXES),
            patch.object(mail, "add_user_images_to_emails"),
        ):
            [row], _total = mail.search_threads("account", {"text": "numbers"}, 0, 20)
        self.assertEqual(
            [(m["id"], m.get("earlier_unloaded", 0)) for m in row["messages"]],
            [("m000", 0), ("m181", 179)],
        )

    def test_a_gap_before_mail_a_view_leaves_out_at_the_end_is_still_counted(self):
        first, middle, newer, newest = read(["m000", "m100", "m198", "m199"])
        middle = {**middle, "earlier_unloaded": 99}
        trash = [{"mailbox_id": "trash"}]
        newer = {**newer, "mailboxes": trash, "earlier_unloaded": 97}
        newest = {**newest, "mailboxes": trash}
        with (
            patch.object(
                mail,
                "query_threads",
                return_value=({"t": [first, middle, newer, newest]}, {"t": "m100"}, 1),
            ),
            patch.object(mail, "get_cached_mailboxes", return_value=MAILBOXES),
            patch.object(mail, "add_user_images_to_emails"),
        ):
            [row], _total = mail.search_threads("account", {"text": "numbers"}, 0, 20)
        self.assertEqual(
            [(m["id"], m.get("earlier_unloaded", 0), m.get("later_unloaded", 0)) for m in row["messages"]],
            [("m000", 0, 0), ("m100", 99, 97)],
        )
