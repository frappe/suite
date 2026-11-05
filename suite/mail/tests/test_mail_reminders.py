# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Snooze: a conversation hidden until a chosen time, and what brings it back. The rows are real; the
mail server is a small stand-in holding each message's folders and keywords."""

from datetime import timedelta
from unittest import mock

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, now_datetime

from suite.mail import filing, reminders
from suite.mail.doctype.mail_reminder.mail_reminder import reminder_name

ACCOUNT = "reminder-test-account"
USER = "Administrator"
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

    def add(self, id, thread_id, box, **keywords):
        self.emails[id] = {
            "id": id,
            "threadId": thread_id,
            "mailboxIds": {box: True},
            "keywords": dict(keywords),
            "receivedAt": f"2026-11-01T10:{len(self.emails):02d}:00Z",
            "subject": f"About {thread_id}",
        }

    def apply(self, id, patch):
        email = self.emails[id]
        for path, value in patch.items():
            field, key = path.split("/", 1)
            if value is None:
                email[field].pop(key, None)
            else:
                email[field][key] = value

    def get(self, _account, ids):
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
            self.apply(patch["id"], {f"keywords/{k}": v for k, v in patch["keywords"].items()})

    def boxes(self, thread_id):
        return {box for e in self.emails.values() if e["threadId"] == thread_id for box in e["mailboxIds"]}

    def marked(self, thread_id):
        return any("returned" in e["keywords"] for e in self.emails.values() if e["threadId"] == thread_id)

    def unread(self):
        return [id for id, e in self.emails.items() if "$seen" not in e["keywords"]]


class TestSnooze(IntegrationTestCase):
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

    def snooze(self, thread_id="t1", hours=2):
        until = add_to_date(now_datetime(), hours=hours).astimezone(tz=None)
        ids = [id for id, e in self.server.emails.items() if e["threadId"] == thread_id]
        return reminders.snooze(ACCOUNT, ids, until.strftime("%Y-%m-%dT%H:%M:%S%z"))

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

    def test_its_mark_comes_off_after_a_day_and_the_row_goes(self):
        self.snooze()
        self.come_due()
        row = self.row()
        self.assertEqual(row.status, "Returned")
        self.assertGreater(row.due_at, now_datetime() + timedelta(hours=23))

        self.come_due()

        self.assertFalse(self.server.marked("t1"))
        self.assertIsNone(self.row())
        self.assertEqual(len(self.told), 1)

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

    def test_bringing_it_back_by_hand_tops_the_list_with_no_alert_and_as_read_as_it_was(self):
        self.snooze()
        ids = list(self.server.emails)

        reminders.unsnooze(ACCOUNT, ids)

        self.assertEqual(self.server.boxes("t1"), {"inbox"})
        self.assertTrue(self.server.marked("t1"))
        self.assertEqual(self.server.unread(), [])
        self.assertEqual(self.row().status, "Returned")
        self.assertEqual(self.told, [])

    def test_a_snoozed_list_row_says_when(self):
        self.snooze()
        threads = [{"thread_id": "t1"}, {"thread_id": "unheld"}]

        reminders.add_snooze_times(ACCOUNT, threads)

        self.assertTrue(threads[0]["snoozed_until"].endswith("Z"))
        self.assertIsNone(threads[1]["snoozed_until"])

    def test_the_sweep_returns_snoozed_mail_with_no_row(self):
        self.snooze()
        frappe.db.delete("Mail Reminder", {"account": ACCOUNT})

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

        self.assertEqual(self.server.boxes("t1"), {"inbox"})

    def test_the_sweep_leaves_mail_that_has_a_row(self):
        self.snooze()

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

        self.assertEqual(self.server.boxes("t1"), {"snoozed"})
