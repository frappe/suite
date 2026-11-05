# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Pinning: a conversation held at the top of the Inbox, by a keyword that only the Inbox reads."""

import unittest
from unittest import mock

import frappe

from suite.mail.api import mail as mail_api
from suite.mail.classification import Category
from suite.mail.classification.category import tab_filter
from suite.mail.doctype.mail_message import mail_message
from suite.mail.pins import is_pinned

from .test_email_classification import lists

ACCOUNT = "c9"
MAILBOXES = [
    {"id": "inbox", "name": "Inbox", "role": "inbox", "isSubscribed": True},
    {"id": "archive", "name": "Archive", "role": "archive", "isSubscribed": True},
]


def message(id: str, mailbox: str, *keywords: str) -> dict:
    return {
        "id": id,
        "mailboxIds": {mailbox: True},
        "keywords": dict.fromkeys(keywords, True),
        "received_at": "2026-11-01 10:00:00",
    }


class PinnedList(unittest.TestCase):
    def listing(self, mailbox: str, *messages: dict) -> tuple[list[dict], mock.Mock]:
        """The rows of `mailbox`, holding one conversation of `messages`, and the query behind them."""

        with (
            mock.patch.object(mail_api, "fetch_threads", return_value={"t1": list(messages)}) as fetch,
            mock.patch.object(mail_api, "get_cached_mailboxes", return_value=MAILBOXES),
            mock.patch.object(mail_api, "add_user_images_to_emails"),
            mock.patch.object(mail_api, "serialize_thread", return_value={"messages": []}),
            mock.patch.object(mail_api, "add_reaction_refusals"),
            mock.patch.object(mail_api, "visible_in_mailbox", side_effect=lambda c, *_: c),
            mock.patch.object(mail_api, "written_messages", side_effect=lambda c: c),
            mock.patch.object(mail_api, "in_mailbox_view", side_effect=lambda m, box: box in m["mailboxIds"]),
        ):
            return mail_api.get_threads(ACCOUNT, mailbox, limit=20)["rows"], fetch

    def test_the_inbox_lists_pinned_then_returned_conversations_first_then_by_date(self):
        _rows, fetch = self.listing("inbox")

        self.assertEqual(
            fetch.call_args.kwargs["sort"],
            [
                {"property": "hasKeyword", "keyword": "pinned", "isAscending": False},
                {"property": "hasKeyword", "keyword": "returned", "isAscending": False},
                {"property": "receivedAt", "isAscending": False},
            ],
        )

    def test_no_other_folder_lists_by_the_pin(self):
        _rows, fetch = self.listing("archive")

        self.assertIsNone(fetch.call_args.kwargs["sort"])

    def test_a_row_is_pinned_by_the_mail_it_holds_in_the_inbox(self):
        rows, _ = self.listing("inbox", message("a", "inbox", "pinned"))

        self.assertEqual(rows[0]["pinned"], 1)

    def test_archived_pinned_mail_does_not_pin_a_reply_that_came_in_after_it(self):
        rows, _ = self.listing("inbox", message("a", "archive", "pinned"), message("b", "inbox"))

        self.assertEqual(rows[0]["pinned"], 0)

    def test_a_folder_shows_no_pin_on_mail_that_keeps_one_for_its_return(self):
        rows, _ = self.listing("archive", message("a", "archive", "pinned"))

        self.assertEqual(rows[0]["pinned"], 0)

    def test_all_inboxes_lists_every_account_pins_first_then_by_date(self):
        rows = {
            "a1": [
                {
                    "thread_id": "old-pin",
                    "pinned": 1,
                    "returned": 0,
                    "received_at": "2026-01-01",
                    "reaction_only": 0,
                },
                {
                    "thread_id": "a-new",
                    "pinned": 0,
                    "returned": 0,
                    "received_at": "2026-11-03",
                    "reaction_only": 0,
                },
            ],
            "a2": [
                {
                    "thread_id": "b-pin",
                    "pinned": 1,
                    "returned": 0,
                    "received_at": "2026-06-01",
                    "reaction_only": 0,
                },
                {
                    "thread_id": "b-new",
                    "pinned": 0,
                    "returned": 0,
                    "received_at": "2026-11-04",
                    "reaction_only": 0,
                },
            ],
        }
        with (
            mock.patch.object(
                mail_api, "get_user_jmap_accounts", return_value=[{"name": a, "_name": a} for a in rows]
            ),
            mock.patch.object(mail_api, "get_cached_mailboxes", return_value=MAILBOXES),
            mock.patch.object(mail_api, "get_threads", side_effect=lambda a, *_: {"rows": rows[a]}),
        ):
            merged = mail_api.get_unified_threads("inbox", limit=10)["rows"]

        self.assertEqual([thread["thread_id"] for thread in merged], ["b-pin", "old-pin", "b-new", "a-new"])


class PinnedTabs(unittest.TestCase):
    def test_pinned_mail_shows_in_primary_whichever_category_it_is_in(self):
        primary = tab_filter(Category.PRIMARY)

        self.assertTrue(lists(primary, {"category_promotions", "pinned"}))
        self.assertFalse(lists(primary, {"category_promotions"}))


class PinnedClearing(unittest.TestCase):
    def clearing(self, read: bool) -> dict:
        inbox, *rest = mail_api.clearing_filter("inbox", None, read, None)["conditions"]
        self.assertEqual(inbox, {"inMailbox": "inbox"})
        return {"operator": "AND", "conditions": rest}

    def test_clearing_a_list_away_skips_what_is_pinned(self):
        self.assertFalse(lists(self.clearing(read=False), {"pinned"}))
        self.assertTrue(lists(self.clearing(read=False), set()))

    def test_marking_a_list_read_includes_what_is_pinned(self):
        self.assertTrue(lists(self.clearing(read=True), {"pinned"}))


class SetPinned(unittest.TestCase):
    def pin(self, ids: list[str], pinned: bool, mailboxes: dict[str, str]) -> tuple[list[str], list[dict]]:
        with (
            mock.patch.object(mail_message, "get_mailbox_id_by_role", return_value="inbox"),
            mock.patch.object(
                mail_message,
                "get_messages_mailboxes",
                return_value=[{"id": id, "mailbox_ids": [mailboxes[id]]} for id in ids],
            ),
            mock.patch.object(mail_message, "_update_emails") as update,
            mock.patch.object(mail_message, "_remove_cached_messages"),
        ):
            done = mail_message.set_pinned_status(ACCOUNT, ids, pinned)
        return done, update.call_args.args[1] if update.called else []

    def test_pinning_marks_only_what_is_in_the_inbox(self):
        done, patches = self.pin(["a", "b"], True, {"a": "inbox", "b": "archive"})

        self.assertEqual(done, ["a"])
        self.assertEqual(patches, [{"id": "a", "keywords": {"pinned": True}}])

    def test_nothing_in_the_inbox_cannot_be_pinned(self):
        with self.assertRaises(frappe.ValidationError):
            self.pin(["a"], True, {"a": "archive"})

    def test_unpinning_clears_every_message_wherever_it_is(self):
        done, patches = self.pin(["a", "b"], False, {"a": "inbox", "b": "archive"})

        self.assertEqual(done, ["a", "b"])
        self.assertEqual(
            patches,
            [{"id": "a", "keywords": {"pinned": None}}, {"id": "b", "keywords": {"pinned": None}}],
        )


class IsPinned(unittest.TestCase):
    def test_reads_keywords_as_fetched_and_as_cached(self):
        self.assertTrue(is_pinned({"keywords": {"pinned": True}}))
        self.assertTrue(is_pinned({"keywords": '{"pinned": true}'}))
        self.assertFalse(is_pinned({"keywords": {"$seen": True}}))
        self.assertFalse(is_pinned({}))
