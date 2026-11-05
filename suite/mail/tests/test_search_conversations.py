# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""A search lists conversations, one row each, described by the newest message that matched."""

from unittest.mock import patch

import frappe
from frappe.tests import UnitTestCase

from suite.mail.api import mail
from suite.mail.jmap import MailServerUnavailableError

MAILBOXES = [
    {"id": "inbox", "role": "inbox"},
    {"id": "sent", "role": "sent"},
    {"id": "trash", "role": "trash"},
    {"id": "junk", "role": "junk"},
]


def message(id: str, at: str, *boxes: str, sender: str = "ana@example.com", **fields) -> dict:
    return {
        "name": f"name-{id}",
        "message_id": f"<{id}@example.com>",
        "id": id,
        "thread_id": "t",
        "from_name": sender.split("@")[0].title(),
        "from_email": sender,
        "subject": "Quarterly numbers",
        "html_body": f"<p>{id}</p>",
        "text_body": "",
        "preview": f"preview of {id}",
        "received_at": at,
        "draft": 0,
        "seen": 1,
        "junk": 0,
        "flagged": 0,
        "mailboxes": [{"mailbox_id": box} for box in boxes],
        "recipients": [],
        "reply_to": [],
        "attachments": [],
        **fields,
    }


# A question, your reply, and a newer message that doesn't hold the words searched for.
QUESTION = message("q", "2026-10-01T09:00:00Z", "inbox")
REPLY = message("r", "2026-10-02T09:00:00Z", "sent", sender="me@example.com")
LATER = message("l", "2026-10-05T09:00:00Z", "inbox", sender="bo@example.com")


def search(conversation: list[dict], match: str, matched: list[str] | None = None) -> dict:
    """The row for a conversation whose newest match is `match` and whose matches are `matched`."""

    with (
        patch.object(mail, "query_threads", return_value=({"t": conversation}, {"t": match}, 1)),
        patch.object(
            mail, "matching_messages", return_value=({"t": matched} if matched else {}, matched is not None)
        ),
        patch.object(mail, "get_cached_mailboxes", return_value=MAILBOXES),
        patch.object(mail, "add_user_images_to_emails"),
    ):
        rows, total = mail.search_threads("account", {"text": "numbers"}, 0, 20)
    assert total == 1
    [row] = rows
    return row


def reaction(id: str, at: str, *boxes: str, to: str, sender: str = "dee@example.com") -> dict:
    return message(id, at, *boxes, sender=sender, reactions=[], in_reply_to=to, text_body="\U0001f44d")


def is_reaction(mail: dict) -> list[str]:
    return ["\U0001f44d"] if mail.get("text_body") == "\U0001f44d" else []


class TestSearchConversations(UnitTestCase):
    def test_a_row_is_the_conversation_described_by_its_newest_match(self):
        row = search([QUESTION, REPLY, LATER], "r")
        self.assertEqual(row["match_id"], "r")
        self.assertEqual(row["from_email"], "me@example.com")
        self.assertEqual(row["preview"], "preview of r")
        # Dated when the match happened, not by the newer message after it.
        self.assertEqual(row["received_at"], REPLY["received_at"])
        self.assertEqual([m["id"] for m in row["messages"]], ["q", "r", "l"])

    def test_a_match_outside_trash_leaves_the_trashed_mail_out(self):
        trashed = message("x", "2026-10-03T09:00:00Z", "trash")
        row = search([QUESTION, trashed, LATER], "q")
        self.assertEqual([m["id"] for m in row["messages"]], ["q", "l"])

    def test_a_match_in_trash_shows_the_conversation_as_trash_does(self):
        trashed = message("x", "2026-10-03T09:00:00Z", "trash")
        row = search([QUESTION, trashed, LATER], "x")
        self.assertEqual(row["match_id"], "x")
        self.assertEqual([m["id"] for m in row["messages"]], ["x"])

    def test_a_row_lists_the_messages_that_matched_newest_first(self):
        row = search([QUESTION, REPLY, LATER], "r", matched=["r", "q"])
        self.assertEqual([m["id"] for m in row["matches"]], ["r", "q"])
        self.assertEqual(row["matches"][0]["from_email"], "me@example.com")

    def test_a_message_and_its_copy_are_one_match(self):
        twin = message("q2", "2026-10-01T09:00:01Z", "sent", message_id=QUESTION["message_id"])
        row = search([QUESTION, twin], "q2", matched=["q2", "q"])
        self.assertEqual(len(row["matches"]), 1)


class TestReactionsInSearch(UnitTestCase):
    """A reaction is an email to the server, and its "Re:" subject and sender match like any other."""

    def setUp(self):
        patcher = patch("suite.mail.api.mail.read_reactions", side_effect=is_reaction)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_reaction_found_with_the_mail_it_answers_doesnt_describe_the_row(self):
        thumbs = reaction("t", "2026-10-06T09:00:00Z", "inbox", to=QUESTION["message_id"])
        row = search([QUESTION, LATER, thumbs], "t", matched=["t", "q"])
        self.assertEqual(row["match_id"], "q")
        self.assertEqual(row["from_email"], QUESTION["from_email"])
        self.assertEqual(row["received_at"], QUESTION["received_at"])
        self.assertEqual([m["id"] for m in row["matches"]], ["q"])
        self.assertFalse(row["reaction_only"])

    def test_a_conversation_found_by_nothing_but_a_reaction_is_marked_to_leave_out(self):
        thumbs = reaction("t", "2026-10-06T09:00:00Z", "inbox", to=QUESTION["message_id"])
        row = search([QUESTION, thumbs], "t", matched=["t"])
        self.assertTrue(row["reaction_only"])

    def test_a_conversation_isnt_ruled_out_on_a_partial_view_of_its_matches(self):
        thumbs = reaction("t", "2026-10-06T09:00:00Z", "inbox", to=QUESTION["message_id"])
        # The uncollapsed query failed, so only the newest match is known.
        row = search([QUESTION, thumbs], "t")
        self.assertFalse(row["reaction_only"])
        self.assertEqual(row["match_id"], "q")

    def test_a_reaction_to_mail_this_account_doesnt_hold_is_a_message_like_any_other(self):
        stray = reaction("t", "2026-10-06T09:00:00Z", "inbox", to="<elsewhere@example.com>")
        row = search([stray], "t", matched=["t"])
        self.assertFalse(row["reaction_only"])
        self.assertEqual(row["match_id"], "t")


class TestPageOrder(UnitTestCase):
    def test_rows_read_newest_first_by_the_date_they_show(self):
        older = {**QUESTION, "thread_id": "a"}
        newer = {**LATER, "thread_id": "b"}
        with (
            patch.object(
                mail,
                "query_threads",
                return_value=({"a": [older], "b": [newer]}, {"a": "q", "b": "l"}, 2),
            ),
            patch.object(mail, "matching_messages", return_value=({}, False)),
            patch.object(mail, "get_cached_mailboxes", return_value=MAILBOXES),
            patch.object(mail, "add_user_images_to_emails"),
        ):
            rows, _ = mail.search_threads("account", {"text": "numbers"}, 0, 20)
        self.assertEqual([row["thread_id"] for row in rows], ["b", "a"])


class TestSearchMails(UnitTestCase):
    def test_a_search_of_nothing_but_its_scope_is_no_search(self):
        with patch.object(mail, "search_threads") as search_threads:
            page = mail.search_mails("account", {"all_accounts": "1"}, all_accounts=True)
        self.assertEqual(page, {"rows": [], "total": 0})
        search_threads.assert_not_called()


def row_in(account: str, at: str) -> dict:
    return {"thread_id": f"{account}-{at}", "received_at": at, "matches": [], "messages": []}


ACCOUNTS = [{"name": "work", "_name": "work@x"}, {"name": "home", "_name": "home@x"}]


class TestSearchAcrossAccounts(UnitTestCase):
    def across(self, search_threads, start=0, limit=20):
        with (
            patch.object(mail, "get_user_jmap_accounts", return_value=ACCOUNTS),
            patch.object(mail, "search_threads", side_effect=search_threads),
            patch.object(mail, "get_snippets", return_value={}),
            patch.object(mail, "get_mailbox_id_by_role", return_value=None),
        ):
            return mail._search_all_accounts({"text": "numbers"}, limit=limit, start=start)

    def test_an_account_that_cant_be_reached_doesnt_cost_the_others_their_results(self):
        def search_threads(account, *_):
            if account == "home":
                raise MailServerUnavailableError()
            return [row_in("work", "2026-10-01T09:00:00Z")], 1

        with patch.object(frappe, "log_error"), patch.object(frappe, "get_traceback", return_value=""):
            page = self.across(search_threads)
        self.assertEqual([row["account"] for row in page["rows"]], ["work"])
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["unavailable_accounts"], ["home@x"])

    def test_results_merge_newest_first(self):
        def search_threads(account, *_):
            at = "2026-10-02T09:00:00Z" if account == "home" else "2026-10-01T09:00:00Z"
            return [row_in(account, at)], 1

        page = self.across(search_threads)
        self.assertEqual([row["account"] for row in page["rows"]], ["home", "work"])
