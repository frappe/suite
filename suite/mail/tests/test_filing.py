# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""What filing a conversation does to each message in it. Mail you received goes wherever it is filed;
your sent mail never leaves Sent but by Trash; a draft is never filed."""

from frappe.tests import UnitTestCase

from suite.mail.filing import left_inbox, plan

ROLES = {
    "inbox": "inbox",
    "archive": "archive",
    "sent": "sent",
    "drafts": "drafts",
    "junk": "junk",
    "trash": "trash",
}


def email(id: str, *boxes: str, **keywords: bool) -> dict:
    return {"id": id, "mailboxIds": dict.fromkeys(boxes, True), "keywords": keywords}


def apply(email: dict, update: dict) -> dict:
    """The message as an update of per-folder patches leaves it."""
    boxes = dict(email["mailboxIds"])
    for key, value in update.items():
        box = key.removeprefix("mailboxIds/")
        if value is None:
            boxes.pop(box, None)
        else:
            boxes[box] = value
    return {**email, "mailboxIds": boxes}


# A conversation: a question in the Inbox also filed in Projects, your reply, and a reply draft.
QUESTION = email("q", "inbox", "projects")
REPLY = email("r", "sent")
DRAFT = email("d", "drafts", **{"$draft": True})
CONVERSATION = [QUESTION, REPLY, DRAFT]


class TestArchive(UnitTestCase):
    def test_swaps_inbox_for_archive_and_keeps_other_folders(self):
        self.assertEqual(
            plan("archive", CONVERSATION, ROLES),
            {"q": {"mailboxIds/archive": True, "mailboxIds/inbox": None}},
        )

    def test_mail_not_in_inbox_just_gets_archive(self):
        filed = email("p", "projects", "clients")
        self.assertEqual(plan("archive", [filed], ROLES), {"p": {"mailboxIds/archive": True}})

    def test_mail_already_archived_is_left_alone(self):
        self.assertEqual(plan("archive", [email("a", "archive")], ROLES), {})

    def test_junked_or_trashed_mail_comes_out_into_archive(self):
        junked = email("j", "junk", **{"$junk": True})
        trashed = email("t", "trash")
        self.assertEqual(
            plan("archive", [junked, trashed], ROLES),
            {
                "j": {
                    "mailboxIds/archive": True,
                    "mailboxIds/junk": None,
                    "keywords/$junk": None,
                    "keywords/$notjunk": True,
                },
                "t": {"mailboxIds/archive": True, "mailboxIds/trash": None},
            },
        )

    def test_takes_your_reply_out_of_the_inbox_without_archiving_it(self):
        # Filed in the Inbox by an earlier move; Archive clears the Inbox of it all the same.
        self.assertEqual(
            plan("archive", [email("r", "sent", "inbox")], ROLES),
            {"r": {"mailboxIds/inbox": None}},
        )

    def test_archiving_out_of_junk_or_trash_counts_as_archived(self):
        junked = [email("j", "junk", **{"$junk": True})]
        self.assertTrue(left_inbox(plan("archive", junked, ROLES), junked, ROLES))

    def test_says_whether_the_conversation_left_the_inbox(self):
        from_inbox = plan("archive", CONVERSATION, ROLES)
        self.assertTrue(left_inbox(from_inbox, CONVERSATION, ROLES))
        filed = [email("p", "projects")]
        self.assertFalse(left_inbox(plan("archive", filed, ROLES), filed, ROLES))


class TestUnarchive(UnitTestCase):
    def test_brings_received_mail_back_to_the_inbox_and_keeps_its_folders(self):
        archived = [email("q", "archive", "projects"), email("r", "sent"), email("p", "projects")]
        self.assertEqual(
            plan("unarchive", archived, ROLES),
            {"q": {"mailboxIds/archive": None, "mailboxIds/inbox": True}},
        )

    def test_lets_your_own_mail_out_of_archive_without_putting_it_in_the_inbox(self):
        self.assertEqual(
            plan("unarchive", [email("r", "sent", "archive")], ROLES),
            {"r": {"mailboxIds/archive": None}},
        )

    def test_takes_an_archived_conversation_back_to_where_it_was(self):
        archived = apply(QUESTION, plan("archive", [QUESTION], ROLES)["q"])
        unarchived = apply(archived, plan("unarchive", [archived], ROLES)["q"])
        self.assertEqual(unarchived["mailboxIds"], QUESTION["mailboxIds"])


class TestMove(UnitTestCase):
    def test_received_mail_lives_only_in_the_target_and_sent_mail_keeps_sent(self):
        self.assertEqual(
            plan("move", CONVERSATION, ROLES, "clients"),
            {
                "q": {"mailboxIds": {"clients": True}},
                "r": {"mailboxIds": {"sent": True, "clients": True}},
            },
        )

    def test_your_sent_mail_never_goes_into_the_inbox(self):
        archived = [email("q", "archive"), email("r", "sent", "archive")]
        self.assertEqual(
            plan("move", archived, ROLES, "inbox"),
            {"q": {"mailboxIds": {"inbox": True}}, "r": {"mailboxIds": {"sent": True}}},
        )

    def test_refuses_to_move_mail_into_sent_or_drafts(self):
        for box in ("sent", "drafts"):
            with self.assertRaises(ValueError):
                plan("move", CONVERSATION, ROLES, box)

    def test_moving_junked_mail_out_clears_the_mark(self):
        junked = email("j", "junk", **{"$junk": True})
        self.assertEqual(
            plan("move", [junked], ROLES, "inbox"),
            {"j": {"mailboxIds": {"inbox": True}, "keywords/$junk": None, "keywords/$notjunk": True}},
        )

    def test_a_move_to_junk_or_trash_is_that_action(self):
        self.assertEqual(plan("move", CONVERSATION, ROLES, "junk"), plan("junk", CONVERSATION, ROLES))
        self.assertEqual(plan("move", CONVERSATION, ROLES, "trash"), plan("trash", CONVERSATION, ROLES))


class TestJunk(UnitTestCase):
    def test_junks_only_mail_you_received(self):
        self.assertEqual(
            plan("junk", CONVERSATION, ROLES),
            {"q": {"mailboxIds": {"junk": True}, "keywords/$junk": True, "keywords/$notjunk": None}},
        )

    def test_not_junk_puts_received_mail_back_in_the_inbox(self):
        junked = email("j", "junk", **{"$junk": True})
        self.assertEqual(
            plan("not_junk", [junked, REPLY], ROLES),
            {"j": {"mailboxIds": {"inbox": True}, "keywords/$junk": None, "keywords/$notjunk": True}},
        )


class TestTrash(UnitTestCase):
    def test_takes_your_sent_mail_too_but_not_a_draft(self):
        self.assertEqual(
            plan("trash", CONVERSATION, ROLES),
            {"q": {"mailboxIds": {"trash": True}}, "r": {"mailboxIds": {"trash": True}}},
        )

    def test_a_junked_message_is_not_hidden_in_trash(self):
        junked = email("j", "junk", **{"$junk": True})
        self.assertEqual(
            plan("trash", [junked], ROLES),
            {"j": {"mailboxIds": {"trash": True}, "keywords/$junk": None}},
        )
