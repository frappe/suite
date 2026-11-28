# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""An action on a long thread reaches the messages the client never held, and Undo takes them back."""

from contextlib import contextmanager
from unittest.mock import patch
from uuid import uuid4

from frappe.tests import UnitTestCase

from suite.mail import long_threads

# A thread of 30 messages, of which the client holds the first and the last two.
THREAD = [f"m{at:02}" for at in range(30)]
NAMED = ["m00", "m28", "m29"]
REST = THREAD[1:28]


class Server:
    """The mail server as these calls see it: where each message is, and what was asked of it."""

    def __init__(self, thread: list[str] = THREAD):
        self.thread = thread
        self.boxes = {id: ["inbox"] for id in thread}
        # Already archived, so an Archive leaves it alone.
        self.boxes["m05"] = ["archive"]
        self.unseen = {"m03", "m04"}
        self.starred = {"m07"}
        self.queued: list[dict] = []
        # How many filings the mail server takes before it stops answering.
        self.filings_left: int | None = None

    def memberships(self, account: str, ids: list[str]) -> list[dict]:
        return [{"id": id, "mailbox_ids": list(self.boxes[id]), "junk": 0} for id in ids]

    def states(self, account: str, ids: list[str]) -> list[dict]:
        return [
            {
                **mail,
                "seen": mail["id"] not in self.unseen,
                "keywords": {"$flagged": True} if mail["id"] in self.starred else {},
            }
            for mail in self.memberships(account, ids)
        ]

    def file(self, account: str, ids: list[str], action: str, target: str | None = None) -> dict:
        if self.filings_left is not None:
            if not self.filings_left:
                raise ConnectionError("The mail server is not answering.")
            self.filings_left -= 1
        updated = [id for id in ids if self.boxes[id] != [action]]
        for id in updated:
            self.boxes[id] = [action]
        return {"updated": updated, "left_inbox": True}

    def restore(self, account: str, mails: list[dict]) -> None:
        for mail in mails:
            self.boxes[mail["id"]] = list(mail["mailbox_ids"])

    def set_seen(self, account: str, ids: list[str], seen: bool) -> None:
        self.unseen = (self.unseen - set(ids)) if seen else (self.unseen | set(ids))

    def run_queued(self) -> None:
        while self.queued:
            long_threads.work(**self.queued.pop(0))

    def file_thread(self, account: str, action: str, named: list[str] = NAMED, target: str | None = None):
        """A filing request: the messages named are filed, and the rest handed over. Returns where the
        named ones were, which is the client's Undo."""

        before = self.memberships(account, named)
        self.file(account, named, action, target)
        long_threads.file_rest(account, ["t"], named, action, target, before=before)
        return before

    def undo(self, account: str, snapshot: list[dict]) -> None:
        """The client's Undo: each message it holds put back as the snapshot says."""

        self.restore(account, snapshot)
        long_threads.restore_rest(account, snapshot)


@contextmanager
def server(thread: list[str] = THREAD):
    held = Server(thread)
    with (
        patch.object(long_threads, "get_user_for_jmap_account"),
        patch.object(long_threads, "get_thread_email_ids", return_value={"t": thread}),
        patch.object(long_threads, "get_messages_mailboxes", side_effect=held.memberships),
        patch.object(long_threads.filing, "file_messages", side_effect=held.file),
        patch.object(long_threads, "set_messages_mailboxes", side_effect=held.restore),
        patch.object(long_threads, "set_seen_status", side_effect=held.set_seen),
        patch.object(long_threads, "_states", side_effect=held.states),
        # A folder's id is its role here: "inbox", "trash".
        patch.object(long_threads, "get_mailbox_id_by_role", side_effect=lambda account, role: role),
        patch.object(long_threads.frappe, "publish_realtime"),
        patch.object(
            long_threads,
            "enqueue_job",
            side_effect=lambda method, queue, timeout, **job: held.queued.append(job),
        ),
    ):
        yield held


class TestLongThreadActions(UnitTestCase):
    def setUp(self):
        # What is kept for Undo is kept by account: each test has its own.
        self.account = f"account-{uuid4()}"

    def test_filing_reaches_the_messages_the_client_did_not_name(self):
        with server() as held:
            held.file_thread(self.account, "archive")
        self.assertTrue(all(held.boxes[id] == ["archive"] for id in THREAD))

    def test_undo_puts_the_rest_back_where_it_was(self):
        with server() as held:
            start = {id: list(boxes) for id, boxes in held.boxes.items()}
            held.undo(self.account, held.file_thread(self.account, "trash"))
        self.assertEqual(held.boxes, start)

    def test_restoring_one_message_of_the_thread_leaves_the_rest_filed(self):
        with server() as held:
            before = held.file_thread(self.account, "trash")
            held.undo(self.account, before[-1:])
        self.assertTrue(all(held.boxes[id] == ["trash"] for id in REST))

    def test_undoing_a_later_action_leaves_the_filed_rest_where_it_is(self):
        with server() as held:
            held.file_thread(self.account, "archive")
            # The messages the client holds are moved on from the Archive, and that move undone.
            snapshot = held.memberships(self.account, NAMED)
            held.file(self.account, NAMED, "folder")
            held.undo(self.account, snapshot)
        self.assertTrue(all(held.boxes[id] == ["archive"] for id in REST))

    def test_a_rest_too_long_for_the_request_is_filed_by_a_job(self):
        thread = [f"m{at:04}" for at in range(long_threads.INLINE_MAX + 5)]
        with server(thread) as held:
            held.boxes = {id: ["inbox"] for id in thread}
            held.file_thread(self.account, "archive", named=thread[:1])
            self.assertTrue(
                all(boxes == ["inbox"] for boxes in held.boxes.values() if boxes != held.boxes[thread[0]])
            )
            held.run_queued()
            self.assertTrue(all(held.boxes[id] == ["archive"] for id in thread))

    def test_an_undo_ahead_of_the_job_leaves_it_nothing_to_file(self):
        thread = [f"m{at:04}" for at in range(long_threads.INLINE_MAX + 5)]
        with server(thread) as held:
            held.boxes = {id: ["inbox"] for id in thread}
            held.undo(self.account, held.file_thread(self.account, "archive", named=thread[:1]))
            held.run_queued()
        self.assertTrue(all(boxes == ["inbox"] for boxes in held.boxes.values()))

    def test_undoing_a_second_filing_ahead_of_its_job_leaves_the_thread_where_the_first_put_it(self):
        thread = [f"m{at:04}" for at in range(long_threads.INLINE_MAX + 5)]
        with server(thread) as held:
            held.boxes = {id: ["inbox"] for id in thread}
            held.file_thread(self.account, "archive", named=thread[:1])
            held.run_queued()
            held.undo(self.account, held.file_thread(self.account, "trash", named=thread[:1]))
            held.run_queued()
        self.assertTrue(all(boxes == ["archive"] for boxes in held.boxes.values()))

    def test_a_filing_that_fails_part_way_puts_the_whole_thread_back(self):
        with server() as held, patch.object(long_threads, "SLICE", 10):
            start = {id: list(boxes) for id, boxes in held.boxes.items()}
            # The request files the messages it names, then hands over the rest, in three slices.
            before = held.memberships(self.account, NAMED)
            held.file(self.account, NAMED, "trash")
            held.filings_left = 1
            with self.assertRaises(ConnectionError):
                long_threads.file_rest(self.account, ["t"], NAMED, "trash", before=before)
        self.assertEqual(held.boxes, start)

    def test_a_job_that_fails_tells_the_reader_the_thread_was_put_back(self):
        thread = [f"m{at:04}" for at in range(long_threads.INLINE_MAX + 5)]
        with server(thread) as held, patch.object(long_threads.frappe, "publish_realtime") as publish:
            held.boxes = {id: ["inbox"] for id in thread}
            long_threads.file_rest(self.account, ["t"], thread[:1], "archive")
            held.filings_left = 0
            with self.assertRaises(ConnectionError):
                held.run_queued()
        publish.assert_any_call(
            "mail_thread_filing_failed",
            {"account": self.account, "thread_id": "t", "put_back": True},
            user="Administrator",
        )

    def test_filing_from_a_list_leaves_alone_the_mail_the_list_does_not_show(self):
        with server() as held:
            held.boxes["m10"] = ["trash"]
            before = held.memberships(self.account, NAMED)
            long_threads.file_rest(self.account, ["t"], NAMED, "archive", before=before)
        self.assertEqual((held.boxes["m10"], held.boxes["m11"]), (["trash"], ["archive"]))

    def test_filing_from_trash_reaches_only_the_trashed_mail(self):
        with server() as held:
            for id in (*NAMED, "m10"):
                held.boxes[id] = ["trash"]
            before = held.memberships(self.account, NAMED)
            long_threads.file_rest(self.account, ["t"], NAMED, "move", "inbox", before=before)
        self.assertEqual((held.boxes["m10"], held.boxes["m11"]), (["move"], ["inbox"]))

    def test_a_thread_a_job_is_filing_is_left_out_of_the_list_it_leaves_until_the_job_is_done(self):
        thread = [f"m{at:04}" for at in range(long_threads.INLINE_MAX + 5)]
        with server(thread) as held:
            held.boxes = {id: ["inbox"] for id in thread}
            before = held.memberships(self.account, thread[:1])
            held.file(self.account, thread[:1], "archive")
            long_threads.file_rest(self.account, ["t"], thread[:1], "archive", before=before)
            self.assertEqual(long_threads.leaving(self.account, "inbox"), {"t"})
            self.assertEqual(long_threads.leaving(self.account, "archive"), set())
            held.run_queued()
            self.assertEqual(long_threads.leaving(self.account, "inbox"), set())

    def test_an_undo_while_the_job_runs_shows_the_thread_where_it_is_going_back_to(self):
        thread = [f"m{at:04}" for at in range(long_threads.INLINE_MAX + 5)]
        with server(thread) as held:
            held.boxes = {id: ["inbox"] for id in thread}
            before = held.memberships(self.account, thread[:1])
            held.file(self.account, thread[:1], "archive")
            long_threads.file_rest(self.account, ["t"], thread[:1], "archive", before=before)
            # The client puts back the message it named, and the rest follows in a job of its own.
            held.restore(self.account, before)
            long_threads.restore_rest(self.account, before)
            self.assertEqual(long_threads.leaving(self.account, "inbox"), set())
            self.assertEqual(long_threads.leaving(self.account, "archive"), {"t"})
            held.run_queued()
            self.assertEqual(long_threads.leaving(self.account, "archive"), set())
        self.assertTrue(all(boxes == ["inbox"] for boxes in held.boxes.values()))

    def test_reading_marks_only_the_unread_messages_the_client_did_not_name(self):
        with server() as held:
            held.unseen = {"m03", "m04", "m29"}
            with patch.object(long_threads, "set_seen_status", side_effect=held.set_seen) as write:
                long_threads.set_rest_seen(self.account, ["t"], NAMED, True)
        self.assertEqual(sorted(write.call_args.args[1]), ["m03", "m04"])
        self.assertEqual(held.unseen, {"m29"})

    def test_deleting_from_trash_reaches_only_the_rest_that_is_trashed(self):
        with server() as held:
            for id in (*NAMED, "m10"):
                held.boxes[id] = ["trash"]
            rest = long_threads.rest_of(self.account, ["t"], NAMED)
        self.assertEqual(rest, ["m10"])

    def test_unstarring_reaches_only_the_rest_that_is_starred(self):
        with server() as held:
            held.starred |= {"m29"}
            rest = long_threads.rest_of(self.account, ["t"], NAMED, "$flagged")
        self.assertEqual(rest, ["m07"])
