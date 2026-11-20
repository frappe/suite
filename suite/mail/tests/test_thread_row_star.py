# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Whether a list row shows its thread starred. The Starred folder lists a thread while any of its
messages is starred, so the row has to say the same, whichever message it is dated by."""

from frappe.tests import UnitTestCase

from suite.mail.api.mail import serialize_thread


def message(id: str, flagged: int = 0) -> dict:
    return {
        "name": f"acct|{id}",
        "message_id": f"<{id}@example.com>",
        "id": id,
        "thread_id": "t",
        "from_name": "Ann",
        "from_email": "ann@example.com",
        "subject": "Plans",
        "html_body": "",
        "text_body": "",
        "preview": "",
        "received_at": "2026-10-01T10:00:00Z",
        "draft": 0,
        "seen": 1,
        "junk": 0,
        "flagged": flagged,
        "mailboxes": [{"mailbox_id": "inbox"}],
        "recipients": [],
        "reply_to": [],
        "attachments": [],
    }


class TestThreadRowStar(UnitTestCase):
    def test_a_thread_starred_by_an_older_message_shows_starred(self):
        thread = [message("a", flagged=1), message("b")]
        self.assertEqual(serialize_thread(thread, thread)["flagged"], 1)

    def test_a_thread_with_no_starred_message_shows_unstarred(self):
        thread = [message("a"), message("b")]
        self.assertEqual(serialize_thread(thread, thread)["flagged"], 0)
