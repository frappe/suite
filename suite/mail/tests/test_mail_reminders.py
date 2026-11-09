# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Snooze, and reminders if nobody replies: mail due back in the Inbox at a chosen time. The rows are
real; the mail server is a small stand-in holding each message's folders and keywords."""

from datetime import timedelta
from unittest import mock

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, now_datetime

from suite.mail import filing, reminders
from suite.mail.doctype.mail_reminder.mail_reminder import reminder_name
from suite.mail.utils.dt import to_utc_z

ACCOUNT = "reminder-test-account"
USER = "Administrator"
READER = "reminder-reader@example.test"
SITE = "https://mail.example.test"
# The thread's page, as the app's own route for an account's mailbox spells it.
THREAD_PATH = f"/mail/account/{ACCOUNT}/mailbox/inbox/t1"
REAL_TELL = reminders._tell
ROLES = {
    "inbox": "inbox",
    "archive": "archive",
    "sent": "sent",
    "drafts": "drafts",
    "junk": "junk",
    "trash": "trash",
    "snoozed": "snoozed",
}


class Server:
    """Holds the mail, and files and marks it by the real rules."""

    def __init__(self, **threads):
        self.emails = {}
        self.at = 0
        for thread_id, boxes in threads.items():
            for box in boxes:
                self.at += 1
                self.add(f"{thread_id}-{self.at}", thread_id, box)

    def add(self, id, thread_id, box, sender="them@example.test", headers=None, **keywords):
        self.emails[id] = {
            "id": id,
            "threadId": thread_id,
            "mailboxIds": {box: True},
            "keywords": dict(keywords),
            "receivedAt": f"2026-11-01T10:{len(self.emails):02d}:00Z",
            "subject": f"About {thread_id}",
            "from": [{"email": sender}],
            **(headers or {}),
        }

    def apply(self, id, patch):
        email = self.emails[id]
        for path, value in patch.items():
            field, key = path.split("/", 1)
            if value is None:
                email[field].pop(key, None)
            else:
                email[field][key] = value

    def get(self, _account, ids, _properties=None):
        return [{**self.emails[id]} for id in ids if id in self.emails]

    def thread_ids(self, _account, thread_ids):
        return {t: [id for id, e in self.emails.items() if e["threadId"] == t] for t in thread_ids}

    def file(self, _account, ids, action, target=None):
        updates = filing.plan(action, self.get(None, ids), ROLES, target)
        for id, patch in updates.items():
            self.apply(id, patch)
        return {"updated": list(updates), "left_inbox": False}

    def update(self, _account, patches):
        for patch in patches:
            self.apply(patch["id"], {f"keywords/{k}": v for k, v in patch.get("keywords", {}).items()})
            self.apply(patch["id"], {f"mailboxIds/{k}": v for k, v in patch.get("mailbox_ids", {}).items()})

    def boxes(self, thread_id):
        return {box for e in self.emails.values() if e["threadId"] == thread_id for box in e["mailboxIds"]}

    def marked(self, thread_id):
        return any("returned" in e["keywords"] for e in self.emails.values() if e["threadId"] == thread_id)

    def unread(self):
        return [id for id, e in self.emails.items() if "$seen" not in e["keywords"]]


class ReminderTestCase(IntegrationTestCase):
    def setUp(self):
        if not frappe.db.exists("JMAP Account", ACCOUNT):
            frappe.get_doc({"doctype": "JMAP Account", "name": ACCOUNT}).db_insert()
        if not frappe.db.exists("User Account", {"account": ACCOUNT, "user": USER}):
            frappe.get_doc(
                {"doctype": "User Account", "name": ACCOUNT, "account": ACCOUNT, "user": USER}
            ).db_insert()
        frappe.db.delete("Mail Reminder", {"account": ACCOUNT})
        self.server = Server(t1=["inbox", "inbox"])
        for email in self.server.emails.values():
            email["keywords"]["$seen"] = True
        self.told = []

        for target, stand_in in {
            "_emails": self.server.get,
            "get_thread_email_ids": self.server.thread_ids,
            "file_messages": self.server.file,
            "_update_emails": self.server.update,
            "_remove_cached_messages": lambda *_: None,
            "account_roles": lambda *_a, **_k: ROLES,
            "get_account_emails": lambda _: ["me@example.test"],
            "_tell": lambda **alert: self.told.append(alert),
        }.items():
            patch = mock.patch.object(reminders, target, side_effect=stand_in)
            patch.start()
            self.addCleanup(patch.stop)
        patch = mock.patch.object(reminders.frappe, "publish_realtime")
        patch.start()
        self.addCleanup(patch.stop)

    def alert_for_real(self, kind, relay_on=True):
        """Sends this reminder's alert through `_tell`, to a reader other than whoever the run works as,
        with only the push relay and the realtime channel stood in for."""
        if not frappe.db.exists("User", READER):
            frappe.get_doc(
                {"doctype": "User", "email": READER, "first_name": "Reader", "send_welcome_email": 0}
            ).insert(ignore_permissions=True)
        if not frappe.db.exists("User Account", {"account": ACCOUNT, "user": READER}):
            frappe.get_doc(
                {"doctype": "User Account", "name": READER, "account": ACCOUNT, "user": READER}
            ).db_insert()
        frappe.db.set_value("Mail Reminder", reminder_name(ACCOUNT, "t1", kind), "user", READER)
        reminders._tell.side_effect = REAL_TELL
        relay = mock.patch.object(reminders, "notify", autospec=True, return_value=relay_on)
        self.pushed = relay.start()
        self.addCleanup(relay.stop)
        site = mock.patch.object(frappe.utils, "get_url", return_value=SITE)
        site.start()
        self.addCleanup(site.stop)

    def in_open_tabs(self):
        return [
            call
            for call in reminders.frappe.publish_realtime.call_args_list
            if call.args[:1] == ("mail_reminder",)
        ]

    def assert_alerted(self, title):
        self.pushed.assert_called_once_with(READER, "mail", title, "About t1", SITE + THREAD_PATH, mock.ANY)
        self.assertEqual(
            self.in_open_tabs(),
            [
                mock.call(
                    "mail_reminder", {"title": title, "body": "About t1", "path": THREAD_PATH}, user=READER
                )
            ],
        )


class TestSnooze(ReminderTestCase):
    def snooze(self, thread_id="t1", hours=2):
        until = to_utc_z(add_to_date(now_datetime(), hours=hours))
        ids = [id for id, e in self.server.emails.items() if e["threadId"] == thread_id]
        return reminders.snooze(ACCOUNT, ids, until)

    def row(self, thread_id="t1"):
        return frappe.db.get_value(
            "Mail Reminder",
            reminder_name(ACCOUNT, thread_id, reminders.SNOOZE),
            ["status", "due_at"],
            as_dict=True,
        )

    def come_due(self, thread_id="t1", ago=timedelta(minutes=1)):
        frappe.db.set_value(
            "Mail Reminder",
            reminder_name(ACCOUNT, thread_id, reminders.SNOOZE),
            "due_at",
            now_datetime() - ago,
        )
        with (
            mock.patch.object(reminders.frappe.db, "commit"),
            mock.patch.object(reminders.frappe.db, "rollback"),
        ):
            reminders.run_due()

    def test_snoozing_hides_it_and_says_when_it_is_due(self):
        self.snooze()

        self.assertEqual(self.server.boxes("t1"), {"snoozed"})
        self.assertEqual(self.row().status, "Waiting")

    def test_a_time_in_the_past_is_refused_and_nothing_moves(self):
        with self.assertRaises(frappe.ValidationError):
            self.snooze(hours=-1)

        self.assertEqual(self.server.boxes("t1"), {"inbox"})
        self.assertIsNone(self.row())

    def test_snoozing_again_changes_the_time(self):
        self.snooze(hours=2)
        first = self.row().due_at
        self.snooze(hours=5)

        self.assertGreater(self.row().due_at, first)
        self.assertEqual(frappe.db.count("Mail Reminder", {"account": ACCOUNT}), 1)

    def test_someone_without_the_account_cannot_snooze_it(self):
        stranger = "reminder-stranger@example.test"
        if not frappe.db.exists("User", stranger):
            frappe.get_doc(
                {"doctype": "User", "email": stranger, "first_name": "Stranger", "send_welcome_email": 0}
            ).insert(ignore_permissions=True)
        frappe.set_user(stranger)
        self.addCleanup(frappe.set_user, USER)
        with self.assertRaises(frappe.ValidationError):
            self.snooze()

        frappe.set_user(USER)
        self.assertEqual(self.server.boxes("t1"), {"inbox"})
        self.assertIsNone(self.row())

    def test_it_comes_back_unread_marked_and_alerts_once(self):
        self.snooze()
        self.come_due()

        self.assertEqual(self.server.boxes("t1"), {"inbox"})
        self.assertTrue(self.server.marked("t1"))
        self.assertEqual(self.server.unread(), ["t1-2"])
        self.assertEqual([alert["title"] for alert in self.told], ["Back from snooze"])
        self.assertEqual(self.told[0]["body"], "About t1")
        self.assertEqual(self.told[0]["user"], USER)

        # Later runs find nothing more to say.
        reminders.run_due()
        self.assertEqual(len(self.told), 1)

    def many_due(self, count):
        """Snoozes `count` conversations, come due oldest first."""
        threads = [f"m{i}" for i in range(count)]
        for index, thread_id in enumerate(threads):
            self.server.add(f"{thread_id}-1", thread_id, "inbox")
            self.snooze(thread_id)
            frappe.db.set_value(
                "Mail Reminder",
                reminder_name(ACCOUNT, thread_id, reminders.SNOOZE),
                "due_at",
                now_datetime() - timedelta(minutes=count - index),
            )
        return threads

    def test_one_run_works_more_rows_than_it_fetches_at_a_time(self):
        threads = self.many_due(5)

        with (
            mock.patch.object(reminders, "BATCH", 2),
            mock.patch.object(reminders.frappe.db, "commit"),
            mock.patch.object(reminders.frappe.db, "rollback"),
        ):
            reminders.run_due()

        for thread_id in threads:
            self.assertEqual(self.server.boxes(thread_id), {"inbox"})

    def test_a_row_that_fails_is_tried_once_and_the_rows_behind_it_are_still_worked(self):
        bad, *rest = self.many_due(3)
        bad_name = reminder_name(ACCOUNT, bad, reminders.SNOOZE)
        real_work = reminders._work
        tried = []

        def work(name):
            tried.append(name)
            if name == bad_name:
                raise ConnectionError
            return real_work(name)

        with (
            mock.patch.object(reminders, "BATCH", 1),
            mock.patch.object(reminders, "_work", side_effect=work),
            mock.patch.object(reminders, "_log_failure"),
            mock.patch.object(reminders.frappe.db, "commit"),
            mock.patch.object(reminders.frappe.db, "rollback"),
        ):
            reminders.run_due()

        self.assertEqual(tried.count(bad_name), 1)
        self.assertEqual(self.row(bad).status, "Waiting")
        for thread_id in rest:
            self.assertEqual(self.server.boxes(thread_id), {"inbox"})

    def test_a_run_out_of_time_stops_and_the_next_takes_what_is_left(self):
        first, *rest = self.many_due(3)
        real_work = reminders._work
        clock = [0.0]

        def work(name):
            clock[0] = reminders.RUN_SECONDS
            return real_work(name)

        with (
            mock.patch.object(reminders.time, "monotonic", side_effect=lambda: clock[0]),
            mock.patch.object(reminders, "_work", side_effect=work),
            mock.patch.object(reminders.frappe.db, "commit"),
            mock.patch.object(reminders.frappe.db, "rollback"),
        ):
            reminders.run_due()

        self.assertEqual(self.server.boxes(first), {"inbox"})
        for thread_id in rest:
            self.assertEqual(self.server.boxes(thread_id), {"snoozed"})
            self.assertEqual(self.row(thread_id).status, "Waiting")

        with (
            mock.patch.object(reminders.frappe.db, "commit"),
            mock.patch.object(reminders.frappe.db, "rollback"),
        ):
            reminders.run_due()
        for thread_id in rest:
            self.assertEqual(self.server.boxes(thread_id), {"inbox"})

    def test_a_run_days_late_still_brings_it_back(self):
        self.snooze()
        self.come_due(ago=timedelta(days=3))

        self.assertEqual(self.server.boxes("t1"), {"inbox"})
        self.assertEqual(len(self.told), 1)

    def test_a_failed_run_keeps_it_due_and_a_later_run_returns_it(self):
        self.snooze()
        with (
            mock.patch.object(reminders, "_log_failure"),
            mock.patch.object(reminders, "_mark_returned", side_effect=ConnectionError),
            mock.patch.object(reminders.frappe.db, "rollback"),
        ):
            self.come_due()
        self.assertEqual(self.told, [])
        self.assertEqual(self.row().status, "Waiting")

        self.come_due()
        self.assertEqual(self.server.boxes("t1"), {"inbox"})
        self.assertEqual(len(self.told), 1)

    def test_once_back_its_row_is_kept_not_worked_again_and_the_mark_stays_until_cleared(self):
        self.snooze()
        self.come_due()

        self.assertEqual(self.row().status, reminders.RETURNED)
        reminders.run_due()
        self.assertEqual(self.row().status, reminders.RETURNED)
        self.assertTrue(self.server.marked("t1"))
        self.assertEqual(len(self.told), 1)

    def test_a_kept_row_says_when_it_was_snoozed_and_when_it_came_back(self):
        self.snooze()
        self.come_due()
        threads = [{"thread_id": "t1"}, {"thread_id": "never-snoozed"}]

        reminders.add_return_times(ACCOUNT, threads)

        self.assertTrue(threads[0]["snoozed_at"].endswith("Z"))
        self.assertTrue(threads[0]["returned_at"].endswith("Z"))
        self.assertNotIn("snoozed_at", threads[1])

    def test_coming_back_it_tells_its_reader_it_is_back_from_snooze(self):
        self.snooze()
        self.alert_for_real(reminders.SNOOZE)

        self.come_due()

        self.assert_alerted("Back from snooze")

    def test_with_the_relay_off_it_still_comes_back_and_tells_any_open_tab(self):
        self.snooze()
        self.alert_for_real(reminders.SNOOZE, relay_on=False)

        self.come_due()

        self.assertEqual(self.server.boxes("t1"), {"inbox"})
        self.assertTrue(self.server.marked("t1"))
        self.assertEqual(len(self.in_open_tabs()), 1)

    def test_snoozed_again_once_back_it_starts_afresh(self):
        self.snooze()
        self.come_due()
        name = reminder_name(ACCOUNT, "t1", reminders.SNOOZE)
        long_ago = now_datetime() - timedelta(days=3)
        frappe.db.set_value("Mail Reminder", name, "creation", long_ago, update_modified=False)

        self.snooze()

        self.assertEqual(self.row().status, "Waiting")
        self.assertGreater(frappe.db.get_value("Mail Reminder", name, "creation"), long_ago)

    def test_a_kept_row_is_forgotten_once_old_and_not_before(self):
        self.snooze()
        self.come_due()

        reminders._forget_old_returned()
        self.assertEqual(self.row().status, reminders.RETURNED)

        frappe.db.set_value(
            "Mail Reminder",
            reminder_name(ACCOUNT, "t1", reminders.SNOOZE),
            "due_at",
            now_datetime() - timedelta(days=reminders.KEEP_RETURNED_DAYS + 1),
        )
        reminders._forget_old_returned()
        self.assertIsNone(self.row())

    def test_cleared_its_mark_comes_off_and_undone_it_comes_back(self):
        self.snooze()
        self.come_due()

        marks = reminders.dismiss_returned(ACCOUNT, ["t1"])

        self.assertFalse(self.server.marked("t1"))
        self.assertEqual(self.server.boxes("t1"), {"inbox"})

        reminders.restore_returned(ACCOUNT, marks["ids"], marks["no_reply_ids"])

        self.assertTrue(self.server.marked("t1"))
        self.assertEqual(len(self.told), 1)

    def test_cleared_and_undone_it_still_says_when_it_was_snoozed_and_when_it_came_back(self):
        self.snooze()
        self.come_due()
        before = [{"thread_id": "t1"}]
        reminders.add_return_times(ACCOUNT, before)
        self.assertIn("snoozed_at", before[0])
        self.assertIn("returned_at", before[0])

        marks = reminders.dismiss_returned(ACCOUNT, ["t1"])
        reminders.restore_returned(ACCOUNT, marks["ids"], marks["no_reply_ids"])

        after = [{"thread_id": "t1"}]
        reminders.add_return_times(ACCOUNT, after)
        self.assertEqual(after, before)

    def test_undone_or_filed_away_it_goes_quietly(self):
        for box in ("inbox", "archive", "trash"):
            with self.subTest(box=box):
                self.snooze()
                for email in self.server.emails.values():
                    email["mailboxIds"] = {box: True}
                self.come_due()

                self.assertEqual(self.server.boxes("t1"), {box})
                self.assertFalse(self.server.marked("t1"))
                self.assertIsNone(self.row())
                self.assertEqual(self.told, [])
                for email in self.server.emails.values():
                    email["mailboxIds"] = {"inbox": True}

    def test_a_row_for_an_account_that_is_gone_goes_too(self):
        self.snooze()
        with mock.patch.object(reminders, "_acting_user", return_value=None):
            self.come_due()

        self.assertIsNone(self.row())
        self.assertEqual(self.told, [])

    def message(self, thread_id="t1", box="inbox", **overrides):
        return {
            "thread_id": thread_id,
            "draft": 0,
            "from_email": "them@example.test",
            "mailboxes": [{"mailbox_id": box}],
            "keywords": {},
            "reactions": [],
            **overrides,
        }

    def test_a_reply_in_the_inbox_wakes_it_with_no_mark_and_no_alert_of_its_own(self):
        self.snooze()
        self.server.add("reply", "t1", "inbox")

        with (
            mock.patch.object(reminders, "read_reactions", return_value=None),
            mock.patch.object(reminders, "is_unscreened_message", return_value=False),
        ):
            reminders.wake_on_reply(ACCOUNT, [self.message()])

        self.assertEqual(self.server.boxes("t1"), {"inbox"})
        self.assertFalse(self.server.marked("t1"))
        self.assertIsNone(self.row())
        self.assertEqual(self.told, [])

    def test_what_does_not_wake_it(self):
        self.snooze()
        not_replies = {
            "filed elsewhere": (self.message(box="projects"), None, False),
            "in junk": (self.message(box="junk"), None, False),
            "your own": (self.message(from_email="me@example.test"), None, False),
            "a draft": (self.message(draft=1), None, False),
            "a reaction": (self.message(), [{"emoji": "x"}], False),
            "unscreened": (self.message(), None, True),
        }
        for label, (message, reaction, unscreened) in not_replies.items():
            with (
                self.subTest(label),
                mock.patch.object(reminders, "read_reactions", return_value=reaction),
                mock.patch.object(reminders, "is_unscreened_message", return_value=unscreened),
            ):
                reminders.wake_on_reply(ACCOUNT, [message])
                self.assertEqual(self.server.boxes("t1"), {"snoozed"})
                self.assertEqual(self.row().status, "Waiting")

    def test_mail_in_no_snoozed_conversation_asks_the_mail_server_nothing(self):
        with mock.patch.object(reminders, "account_roles", side_effect=ConnectionError):
            reminders.wake_on_reply(ACCOUNT, [self.message(thread_id="never-snoozed")])

    def test_bringing_it_back_by_hand_files_it_unmarked_with_no_alert_and_as_read_as_it_was(self):
        self.snooze()
        ids = list(self.server.emails)

        reminders.unsnooze(ACCOUNT, ids)

        self.assertEqual(self.server.boxes("t1"), {"inbox"})
        self.assertFalse(self.server.marked("t1"))
        self.assertEqual(self.server.unread(), [])
        self.assertIsNone(self.row())
        self.assertEqual(self.told, [])

    def test_undoing_it_with_what_it_said_puts_it_back_waiting_for_the_same_time(self):
        self.snooze()
        due = self.row().due_at
        ids = list(self.server.emails)

        waited = reminders.unsnooze(ACCOUNT, ids)["waited"]
        self.assertEqual([sorted(group["ids"]) for group in waited], [sorted(ids)])

        reminders.snooze(ACCOUNT, waited[0]["ids"], waited[0]["until"])

        self.assertEqual(self.server.boxes("t1"), {"snoozed"})
        self.assertEqual(self.row().status, "Waiting")
        self.assertEqual(self.row().due_at, due)

    def test_a_snoozed_list_row_says_when(self):
        self.snooze()
        threads = [{"thread_id": "t1"}, {"thread_id": "unheld"}]

        reminders.add_snooze_times(ACCOUNT, threads)

        self.assertTrue(threads[0]["snoozed_until"].endswith("Z"))
        self.assertIsNone(threads[1]["snoozed_until"])

    def sweep(self):
        client = mock.MagicMock()
        batch = client.batch.return_value.__enter__.return_value
        batch.mail.email.query.return_value.result.ids = list(self.server.emails)
        with (
            mock.patch.object(reminders, "get_account_client", return_value=client),
            mock.patch.object(
                reminders,
                "get_cached_mailboxes",
                return_value=[{"id": "snoozed", "role": "snoozed", "totalEmails": 2}],
            ),
        ):
            reminders._return_unheld(ACCOUNT)

    def test_the_sweep_returns_snoozed_mail_held_only_by_a_kept_row(self):
        self.snooze()
        frappe.db.set_value(
            "Mail Reminder", reminder_name(ACCOUNT, "t1", reminders.SNOOZE), "status", reminders.RETURNED
        )

        self.sweep()

        self.assertEqual(self.server.boxes("t1"), {"inbox"})

    def test_the_sweep_returns_snoozed_mail_with_no_row(self):
        self.snooze()
        frappe.db.delete("Mail Reminder", {"account": ACCOUNT})

        self.sweep()

        self.assertEqual(self.server.boxes("t1"), {"inbox"})

    def test_the_sweep_leaves_mail_that_has_a_row(self):
        self.snooze()

        self.sweep()

        self.assertEqual(self.server.boxes("t1"), {"snoozed"})


class TestNoReply(ReminderTestCase):
    """Mail you sent, back in your Inbox at a chosen time if nobody has answered it."""

    def setUp(self):
        super().setUp()
        # A conversation they started, and your answer to it, which the reminder is about.
        self.server = Server()
        self.server.add("theirs", "t1", "inbox", **{"$seen": True})
        self.server.add("mine", "t1", "sent", sender="me@example.test", **{"$seen": True})
        for target, stand_in in {
            "_emails": self.server.get,
            "get_thread_email_ids": self.server.thread_ids,
            "file_messages": self.server.file,
            "_update_emails": self.server.update,
        }.items():
            patch = mock.patch.object(reminders, target, side_effect=stand_in)
            patch.start()
            self.addCleanup(patch.stop)

    def remind(self, hours=2):
        return reminders.remind_no_reply(ACCOUNT, list(self.server.emails), self.at(hours))

    def at(self, hours):
        return to_utc_z(add_to_date(now_datetime(), hours=hours))

    def row(self):
        return frappe.db.get_value(
            "Mail Reminder",
            reminder_name(ACCOUNT, "t1", reminders.NO_REPLY),
            ["status", "email_id", "due_at"],
            as_dict=True,
        )

    def come_due(self, kind=reminders.NO_REPLY):
        frappe.db.set_value(
            "Mail Reminder",
            reminder_name(ACCOUNT, "t1", kind),
            "due_at",
            now_datetime() - timedelta(minutes=1),
        )
        with (
            mock.patch.object(reminders.frappe.db, "commit"),
            mock.patch.object(reminders.frappe.db, "rollback"),
        ):
            reminders.run_due()

    def mine(self):
        return self.server.emails["mine"]

    def test_unanswered_it_comes_back_to_the_inbox_unread_and_alerts_once(self):
        self.remind()
        self.come_due()

        self.assertEqual(set(self.mine()["mailboxIds"]), {"sent", "inbox"})
        self.assertNotIn("$seen", self.mine()["keywords"])
        self.assertTrue(self.mine()["keywords"].get("noreply"))
        self.assertEqual([(a["title"], a["body"]) for a in self.told], [("No reply yet", "About t1")])

        reminders.run_due()
        self.assertEqual(len(self.told), 1)

    def test_unanswered_it_tells_its_reader_nobody_has_replied(self):
        self.remind()
        self.alert_for_real(reminders.NO_REPLY)

        self.come_due()

        self.assert_alerted("No reply yet")

    def test_with_the_relay_off_it_still_comes_back_and_tells_any_open_tab(self):
        self.remind()
        self.alert_for_real(reminders.NO_REPLY, relay_on=False)

        self.come_due()

        self.assertIn("inbox", self.mine()["mailboxIds"])
        self.assertTrue(self.mine()["keywords"].get("returned"))
        self.assertEqual(len(self.in_open_tabs()), 1)

    def test_what_counts_as_an_answer(self):
        answers = {
            "a reply": {},
            "a reaction": {"subject": "Reacted"},
            "a reply someone else wrote by hand": {"header:Auto-Submitted:asText": "no"},
        }
        for label, fields in answers.items():
            with self.subTest(label):
                self.remind()
                self.server.add("answer", "t1", "inbox", headers=fields)
                self.come_due()

                self.assertEqual(set(self.mine()["mailboxIds"]), {"sent"})
                self.assertIsNone(self.row())
                self.assertEqual(self.told, [])
                del self.server.emails["answer"]

    def test_what_does_not_count_as_an_answer(self):
        not_answers = {
            "your own follow-up": {"sender": "me@example.test", "box": "sent"},
            "an out-of-office": {"headers": {"header:Auto-Submitted:asText": "auto-replied"}},
            "a bounce": {"sender": "MAILER-DAEMON@mx.example.test"},
            "junk": {"box": "junk"},
            "a draft of theirs": {"box": "drafts", "$draft": True},
        }
        for label, extra in not_answers.items():
            with self.subTest(label):
                self.remind()
                extra = dict(extra)
                box = extra.pop("box", "inbox")
                self.server.add("other", "t1", box, **extra)
                self.come_due()

                self.assertIn("inbox", self.mine()["mailboxIds"])
                self.assertEqual(len(self.told), 1)
                del self.server.emails["other"]
                self.mine()["mailboxIds"] = {"sent": True}
                self.told.clear()
                frappe.db.delete("Mail Reminder", {"account": ACCOUNT})

    def test_mail_no_longer_sent_lets_the_reminder_go(self):
        states = {
            "sending undone": {"mailboxIds": {"drafts": True}, "keywords": {"$draft": True}},
            "trashed": {"mailboxIds": {"trash": True}, "keywords": {}},
        }
        for label, state in states.items():
            with self.subTest(label):
                self.remind()
                self.mine().update(state)
                self.come_due()

                self.assertNotIn("inbox", self.mine()["mailboxIds"])
                self.assertIsNone(self.row())
                self.assertEqual(self.told, [])
                self.mine().update({"mailboxIds": {"sent": True}, "keywords": {"$seen": True}})

        self.remind()
        del self.server.emails["mine"]
        self.come_due()
        self.assertIsNone(self.row())
        self.assertEqual(self.told, [])

    def test_once_back_it_stays_marked_in_the_inbox_until_cleared(self):
        self.remind()
        self.come_due()
        reminders.run_due()

        self.assertTrue(self.mine()["keywords"].get("noreply"))
        self.assertTrue(self.mine()["keywords"].get("returned"))
        self.assertIn("inbox", self.mine()["mailboxIds"])
        self.assertIsNone(self.row())

    def test_snoozed_once_back_it_waits_and_returns_like_any_snoozed_mail(self):
        self.remind()
        self.come_due()
        reminders.snooze(ACCOUNT, list(self.server.emails), self.at(2))

        self.assertEqual(set(self.mine()["mailboxIds"]), {"sent", "snoozed"})
        self.assertIsNone(self.row())

        self.come_due(reminders.SNOOZE)
        self.assertEqual(set(self.mine()["mailboxIds"]), {"sent", "inbox"})
        self.assertTrue(self.mine()["keywords"].get("returned"))
        self.assertEqual([a["title"] for a in self.told], ["No reply yet", "Back from snooze"])

    def test_set_again_once_back_its_mark_comes_off_until_the_new_date(self):
        self.remind()
        self.come_due()
        self.remind(hours=48)

        self.assertFalse(self.mine()["keywords"].get("noreply"))
        self.assertEqual(self.row().status, "Waiting")

        self.come_due()
        self.assertTrue(self.mine()["keywords"].get("noreply"))
        self.assertEqual(len(self.told), 2)

    def test_cleared_its_mark_comes_off_it_stays_in_the_inbox_and_undone_it_is_unanswered_again(self):
        self.remind()
        self.come_due()

        marks = reminders.dismiss_returned(ACCOUNT, ["t1"])

        self.assertFalse(self.mine()["keywords"].get("noreply"))
        self.assertFalse(self.mine()["keywords"].get("returned"))
        self.assertIn("inbox", self.mine()["mailboxIds"])

        reminders.restore_returned(ACCOUNT, marks["ids"], marks["no_reply_ids"])

        self.assertTrue(self.mine()["keywords"].get("noreply"))
        self.assertTrue(self.mine()["keywords"].get("returned"))

    def test_clearing_a_conversation_not_back_yet_changes_nothing(self):
        self.remind()

        reminders.dismiss_returned(ACCOUNT, ["t1"])

        self.assertEqual(self.row().status, "Waiting")
        self.assertEqual(set(self.mine()["mailboxIds"]), {"sent"})

    def test_asked_from_the_conversation_it_follows_your_latest_sent_mail(self):
        self.server.add("draft", "t1", "drafts", sender="me@example.test", **{"$draft": True})
        self.server.add("later", "t1", "sent", sender="me@example.test")

        self.remind()

        self.assertEqual(self.row().email_id, "later")

    def test_a_conversation_with_nothing_you_sent_cannot_be_followed_up(self):
        del self.server.emails["mine"]
        with self.assertRaises(frappe.ValidationError):
            self.remind()
        self.assertIsNone(self.row())

    def test_the_time_must_be_after_the_mail_goes_out(self):
        with self.assertRaises(frappe.ValidationError):
            reminders.check_reminder_time(self.at(-1))
        send_at = reminders.from_utc_z(self.at(5))
        with self.assertRaises(frappe.ValidationError):
            reminders.check_reminder_time(self.at(3), send_at)
        self.assertIsNotNone(reminders.check_reminder_time(self.at(6), send_at))

    def test_the_sent_list_says_when_and_cancelling_ends_it(self):
        self.remind()
        threads = [{"thread_id": "t1"}, {"thread_id": "other"}]
        reminders.add_reply_reminders(ACCOUNT, threads)
        self.assertTrue(threads[0]["remind_at"].endswith("Z"))
        self.assertIsNone(threads[1]["remind_at"])
        self.assertEqual(reminders.get_no_reply(ACCOUNT, "t1"), threads[0]["remind_at"])

        reminders.cancel_no_reply(ACCOUNT, "t1")

        self.assertIsNone(self.row())
        self.assertIsNone(reminders.get_no_reply(ACCOUNT, "t1"))

    def test_someone_without_the_account_cannot_set_or_read_one(self):
        stranger = "reminder-stranger@example.test"
        if not frappe.db.exists("User", stranger):
            frappe.get_doc(
                {"doctype": "User", "email": stranger, "first_name": "Stranger", "send_welcome_email": 0}
            ).insert(ignore_permissions=True)
        self.remind()
        frappe.set_user(stranger)
        # Whose account it is is kept for the request, and here the request goes on as someone else.
        frappe.local.request_cache.clear()
        self.addCleanup(frappe.set_user, USER)
        for label, attempt in {
            "set": self.remind,
            "read": lambda: reminders.get_no_reply(ACCOUNT, "t1"),
            "cancel": lambda: reminders.cancel_no_reply(ACCOUNT, "t1"),
            "clear": lambda: reminders.dismiss_returned(ACCOUNT, ["t1"]),
            "undo a clear": lambda: reminders.restore_returned(ACCOUNT, ["mine"], ["mine"]),
        }.items():
            with self.subTest(label), self.assertRaises(frappe.ValidationError):
                attempt()
