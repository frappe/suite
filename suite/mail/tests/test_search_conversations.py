# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""A search lists conversations, one row each, described by the newest message that matched."""

from unittest.mock import patch

from frappe.tests import UnitTestCase

from suite.mail.api import mail

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


def search(conversation: list[dict], match: str) -> dict:
    with (
        patch.object(mail, "query_threads", return_value=({"t": conversation}, {"t": match}, 1)),
        patch.object(mail, "get_cached_mailboxes", return_value=MAILBOXES),
        patch.object(mail, "add_user_images_to_emails"),
    ):
        rows, total = mail.search_threads("account", {"text": "numbers"}, 0, 20)
    assert total == 1
    [row] = rows
    return row


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
