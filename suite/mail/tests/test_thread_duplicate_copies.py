# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""What a thread does with the two copies one message can leave in an account.

Mail to yourself is delivered as well as saved: the account ends up holding the copy in Sent and the
copy delivery filed, one Message-ID between them. The conversation shows it once — and shows the
*same* one of the two wherever it is opened from — while keeping the copy it stands in for within
reach, because an action on the message has to land on both."""

import unittest

from suite.mail.api.mail import collapse_duplicate_copies

SENT = "mailbox-sent"
INBOX = "mailbox-inbox"


def mail(id: str, message_id: str, mailboxes: list[str], **overrides) -> dict:
    return {
        "name": f"message-{id}",
        "id": id,
        "message_id": message_id,
        "thread_id": "thread-1",
        "from_name": "Vibhav",
        "from_email": "vibhav@example.com",
        "subject": "Note to self",
        "html_body": "<p>Note to self</p>",
        "received_at": "2026-09-01 12:00:00",
        "mailboxes": [{"mailbox_id": mailbox} for mailbox in mailboxes],
        "seen": 0,
        "junk": 0,
        "flagged": 0,
        "draft": 0,
    } | overrides


class MailToYourself(unittest.TestCase):
    """The pair reads as one message, and the one it reads as does not move."""

    def setUp(self):
        self.sent = mail("s1", "<1@example.com>", [SENT], received_at="2026-09-01 11:59:59")
        self.delivered = mail("d1", "<1@example.com>", [INBOX])
        self.conversation = [self.sent, self.delivered]

    def test_shows_once(self):
        collapsed = collapse_duplicate_copies(self.conversation, SENT)
        self.assertEqual([m["id"] for m in collapsed], ["d1"])

    def test_keeps_the_delivered_copy(self):
        """The message as it arrived — its headers, its unread state — is the one kept."""

        collapsed = collapse_duplicate_copies(self.conversation, SENT)
        self.assertEqual(collapsed[0]["mailboxes"], [{"mailbox_id": INBOX}])

    def test_same_copy_survives_whatever_order_it_arrives_in(self):
        forwards = collapse_duplicate_copies(self.conversation, SENT)
        backwards = collapse_duplicate_copies(list(reversed(self.conversation)), SENT)
        self.assertEqual([m["id"] for m in forwards], [m["id"] for m in backwards])

    def test_the_sent_copy_rides_along(self):
        """Collapsed away, not dropped: trashing the message has to reach it in Sent."""

        [collapsed] = collapse_duplicate_copies(self.conversation, SENT)
        self.assertEqual([copy["id"] for copy in collapsed["duplicates"]], ["s1"])

    def test_a_copy_carries_its_own_mailboxes(self):
        """Undo restores each copy to where it was, so Sent stays Sent."""

        [collapsed] = collapse_duplicate_copies(self.conversation, SENT)
        self.assertEqual(collapsed["duplicates"][0]["mailboxes"], [{"mailbox_id": SENT}])

    def test_a_copy_carries_no_body(self):
        """The same message twice on the wire is only weight."""

        [collapsed] = collapse_duplicate_copies(self.conversation, SENT)
        self.assertNotIn("html_body", collapsed["duplicates"][0])

    def test_more_than_two_copies_still_leave_one(self):
        archived = mail("a1", "<1@example.com>", ["mailbox-archive"])
        collapsed = collapse_duplicate_copies([*self.conversation, archived], SENT)
        self.assertEqual(len(collapsed), 1)
        self.assertEqual(len(collapsed[0]["duplicates"]), 2)


class EverythingElse(unittest.TestCase):
    """Mail with one copy is left exactly as it was."""

    def test_ordinary_conversation_is_untouched(self):
        conversation = [
            mail("m1", "<1@example.com>", [INBOX]),
            mail("m2", "<2@example.com>", [SENT]),
        ]
        self.assertIs(collapse_duplicate_copies(conversation, SENT), conversation)

    def test_drafts_are_not_copies(self):
        """A draft has no delivered twin, whatever Message-ID it is carrying."""

        draft = mail("draft-1", "<1@example.com>", ["mailbox-drafts"], draft=1)
        collapsed = collapse_duplicate_copies([mail("d1", "<1@example.com>", [INBOX]), draft], SENT)
        self.assertEqual([m["id"] for m in collapsed], ["d1", "draft-1"])

    def test_a_missing_message_id_is_not_an_identity(self):
        conversation = [mail("m1", "", [INBOX]), mail("m2", "", [INBOX])]
        self.assertEqual([m["id"] for m in collapse_duplicate_copies(conversation, SENT)], ["m1", "m2"])

    def test_copies_are_still_collapsed_without_a_sent_mailbox(self):
        """Nothing about the account should decide whether a duplicate is shown twice."""

        conversation = [
            mail("s1", "<1@example.com>", [SENT], received_at="2026-09-01 11:59:59"),
            mail("d1", "<1@example.com>", [INBOX]),
        ]
        self.assertEqual(len(collapse_duplicate_copies(conversation, None)), 1)
