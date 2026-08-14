# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Scheduled send via JMAP FUTURERELEASE (RFC 4865).

Scheduling submits immediately with a HOLDUNTIL envelope parameter, so the server holds
delivery; the Mail Queue row carries the schedule (``send_at``/``submission_id``, status
``Scheduled``). Reschedule/send-now cancel the held submission and create a new one
(undoStatus is the only mutable submission property); cancel reverts the message to Drafts.
Listing reconciles lazily through ``EmailSubmission/get`` — ``EmailSubmission/query`` returns
empty on Stalwart even for pending submissions and must not be used.

There is no undo-send window feature — only explicit scheduling is covered here.
"""

from datetime import datetime

import frappe
from frappe.utils import add_to_date, get_datetime, get_datetime_str, now, time_diff_in_seconds

from suite.mail.doctype.mail_queue.mail_queue import SUBMISSION_PROPERTIES
from suite.mail.jmap import get_account_client
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name
from suite.mail.utils.dt import to_utc_z
from suite.utils.dt import convert_to_utc


def _epoch(value: str) -> int:
    """Epoch seconds of an ISO UTC timestamp (either ``...Z`` or offset form)."""

    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())


class TestMailScheduledSend(StalwartIntegrationTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        cls.sender = cls.create_member()
        cls.recipient = cls.create_member()
        cls.disable_screening(cls.recipient)

    # --- helpers ------------------------------------------------------------

    def _schedule(self, minutes: int = 120, subject: str | None = None) -> frappe._dict:
        """Schedules a mail from the class sender and returns the Mail Queue row's details."""

        subject = subject or f"Scheduled {unique_name('subject')}"
        result = self.send_mail(
            self.sender,
            self.recipient.email,
            subject=subject,
            send_at=to_utc_z(add_to_date(now(), minutes=minutes)),
        )
        self.assertEqual(result["status"], "Scheduled", result.get("error"))

        with self.set_user("Administrator"):
            doc = frappe.get_last_doc("Mail Queue", {"id": result["id"]})

        return frappe._dict(name=doc.name, doc=doc, subject=subject, result=result)

    def _get_submission(self, account: str, submission_id: str) -> dict | None:
        with self.set_user(self.sender.email):
            client = get_account_client(account)
            with client.batch() as b:
                h = b.submission.email_submission.get(ids=[submission_id], properties=SUBMISSION_PROPERTIES)
            submissions = [s.to_wire() for s in h.result.items]
        return submissions[0] if submissions else None

    def _get_emails(self, account: str, ids: list[str], properties: list[str]) -> list[dict]:
        client = get_account_client(account)
        with client.batch() as b:
            h = b.mail.email.get(ids=ids, properties=properties)
        return [e.to_wire() for e in h.result.items]

    # --- tests --------------------------------------------------------------

    def test_schedule_holds_delivery(self):
        scheduled = self._schedule(minutes=120)
        doc = scheduled.doc

        self.assertEqual(doc.status, "Scheduled")
        self.assertTrue(doc.submission_id)
        self.assertTrue(doc.send_at)
        self.assertFalse(doc.submitted_at)

        account = self.personal_account(self.sender)

        # Trust EmailSubmission/get, not the create echo (which reports "final").
        submission = self._get_submission(account, doc.submission_id)
        self.assertIsNotNone(submission)
        self.assertEqual(submission["undoStatus"], "pending")

        # The server's sendAt reflects the HOLDUNTIL parameter.
        hold_until = int(convert_to_utc(get_datetime(doc.send_at)).timestamp())
        self.assertLessEqual(abs(_epoch(submission["sendAt"]) - hold_until), 5)

        # The message sits in Sent while held (moved there at submission time).
        with self.set_user(self.sender.email):
            sent_id = frappe.get_doc("Mail Queue", doc.name).mailbox_id
            emails = self._get_emails(account, [doc.id], properties=["mailboxIds"])
        self.assertTrue(emails and emails[0]["mailboxIds"].get(sent_id))

        # Held, so nothing has reached the recipient.
        threads = self.get_inbox_threads(self.recipient)
        self.assertNotIn(scheduled.subject, [t["subject"] for t in threads])

    def test_cancel_reverts_to_draft(self):
        scheduled = self._schedule(minutes=120)
        account = self.personal_account(self.sender)
        old_submission_id = scheduled.doc.submission_id

        from suite.mail.api.mail import cancel_scheduled_mail
        from suite.mail.doctype.mail_message.mail_message import _cache_messages, _get_cached_messages

        # Seed the data store with the (soon stale, Sent-labelled) cached copy; cancel
        # must evict it or Drafts keeps showing the old folder label until the next sync.
        _cache_messages(account, {scheduled.doc.id: {"id": scheduled.doc.id}})

        with self.set_user(self.sender.email):
            result = cancel_scheduled_mail(account, scheduled.name)
        self.assertEqual(result["status"], "Cancelled")
        self.assertIsNone(_get_cached_messages(account, [scheduled.doc.id])[scheduled.doc.id])

        with self.set_user("Administrator"):
            doc = frappe.get_doc("Mail Queue", scheduled.name)
        self.assertEqual(doc.status, "Cancelled")
        self.assertTrue(doc.cancelled_at)

        submission = self._get_submission(account, old_submission_id)
        self.assertEqual(submission["undoStatus"], "canceled")

        # Back in Drafts only (mailboxIds replaced, not patched) with $draft restored.
        with self.set_user(self.sender.email):
            from suite.mail.jmap import get_mailbox_id_by_role

            drafts_id = get_mailbox_id_by_role(account, "drafts", raise_exception=True)
            emails = self._get_emails(account, [doc.id], properties=["mailboxIds", "keywords"])

        self.assertEqual(list(emails[0]["mailboxIds"].keys()), [drafts_id])
        self.assertTrue(emails[0]["keywords"].get("$draft"))
        self.assertEqual(doc.mailbox_id, drafts_id)

    def test_cancel_refreshes_open_mailbox_views(self):
        # The composer that raises the undo toast is unmounted by the time Undo runs, so
        # the refresh rides the same realtime event the message actions use.
        from unittest.mock import patch

        from suite.mail.api.mail import cancel_scheduled_mail
        from suite.mail.jmap import get_mailbox_id_by_role

        scheduled = self._schedule(minutes=120)
        account = self.personal_account(self.sender)

        with self.set_user(self.sender.email):
            drafts_id = get_mailbox_id_by_role(account, "drafts", raise_exception=True)
            sent_id = get_mailbox_id_by_role(account, "sent", raise_exception=True)

            with patch("frappe.publish_realtime") as publish:
                cancel_scheduled_mail(account, scheduled.name)

        events = [c for c in publish.call_args_list if c.args and c.args[0] == "new_mail_created"]
        self.assertTrue(events, "cancel did not publish a mailbox refresh")

        # Both the folder it left and the one it landed in, so either open view updates.
        self.assertEqual(set(events[-1].args[1]), {drafts_id, sent_id})
        self.assertEqual(events[-1].kwargs["user"], self.sender.email)

    def test_reschedule_creates_new_submission(self):
        scheduled = self._schedule(minutes=120)
        account = self.personal_account(self.sender)
        old_submission_id = scheduled.doc.submission_id
        new_send_at = to_utc_z(add_to_date(now(), minutes=240))

        from suite.mail.api.mail import reschedule_mail

        with self.set_user(self.sender.email):
            result = reschedule_mail(account, scheduled.name, new_send_at)
        self.assertEqual(result["status"], "Scheduled")

        with self.set_user("Administrator"):
            doc = frappe.get_doc("Mail Queue", scheduled.name)
        self.assertEqual(doc.status, "Scheduled")
        self.assertNotEqual(doc.submission_id, old_submission_id)

        old_submission = self._get_submission(account, old_submission_id)
        self.assertEqual(old_submission["undoStatus"], "canceled")

        new_submission = self._get_submission(account, doc.submission_id)
        self.assertEqual(new_submission["undoStatus"], "pending")
        self.assertLessEqual(abs(_epoch(new_submission["sendAt"]) - _epoch(new_send_at)), 5)

    def test_send_now_delivers(self):
        scheduled = self._schedule(minutes=60 * 24)
        account = self.personal_account(self.sender)

        from suite.mail.api.mail import send_scheduled_mail_now

        with self.set_user(self.sender.email):
            result = send_scheduled_mail_now(account, scheduled.name)
        self.assertEqual(result["status"], "Submitted")

        with self.set_user("Administrator"):
            doc = frappe.get_doc("Mail Queue", scheduled.name)
        self.assertEqual(doc.status, "Submitted")
        self.assertTrue(doc.submitted_at)
        self.assertFalse(doc.send_at)

        def find_thread():
            threads = self.get_inbox_threads(self.recipient)
            return next((t for t in threads if t["subject"] == scheduled.subject), None)

        self.wait_until(
            find_thread,
            timeout=60,
            message=f"Send-now mail '{scheduled.subject}' did not reach {self.recipient.email}.",
        )

    def test_validation_errors(self):
        for kwargs in [
            {"send_at": to_utc_z(add_to_date(now(), minutes=-5))},  # in the past
            {"send_at": to_utc_z(add_to_date(now(), days=31))},  # beyond maxDelayedSend
            {"send_at": to_utc_z(add_to_date(now(), minutes=60)), "save_as_draft": True},
        ]:
            with self.assertRaises(frappe.ValidationError):
                self.send_mail(self.sender, self.recipient.email, **kwargs)

        # destroy_after_submit is not exposed by create_mail; exercise the queue factory.
        from suite.mail.doctype.mail_queue.mail_queue import MailQueue

        with self.set_user(self.sender.email), self.assertRaises(frappe.ValidationError):
            MailQueue._create(
                user=self.sender.email,
                account=self.personal_account(self.sender),
                from_email=self.sender.email,
                subject="Scheduled destroy",
                html_body="<p>Test</p>",
                recipients=[{"type": "To", "email": self.recipient.email, "display_name": None}],
                destroy_after_submit=True,
                send_at=get_datetime_str(add_to_date(now(), minutes=60)),
            )

    def test_lazy_reconciliation(self):
        # Held only briefly: once the hold elapses the submission goes final and the
        # listing must flip the row to Submitted and drop it.
        subject = f"Reconcile {unique_name('subject')}"
        result = self.send_mail(
            self.sender,
            self.recipient.email,
            subject=subject,
            send_at=to_utc_z(add_to_date(now(), seconds=15)),
        )
        self.assertEqual(result["status"], "Scheduled", result.get("error"))

        account = self.personal_account(self.sender)
        with self.set_user("Administrator"):
            doc = frappe.get_last_doc("Mail Queue", {"id": result["id"]})

        self.wait_until(
            lambda: (self._get_submission(account, doc.submission_id) or {}).get("undoStatus") == "final",
            timeout=90,
            message="The held submission never went final.",
        )

        from suite.mail.api.mail import get_scheduled_mails

        with self.set_user(self.sender.email):
            rows = get_scheduled_mails(account)
        self.assertNotIn(doc.name, [row.name for row in rows])

        with self.set_user("Administrator"):
            doc = frappe.get_doc("Mail Queue", doc.name)
        self.assertEqual(doc.status, "Submitted")
        self.assertTrue(doc.submitted_at)

    def test_cron_ignores_scheduled_rows(self):
        scheduled = self._schedule(minutes=120)

        from suite.mail.doctype.mail_queue.mail_queue import enqueue_process_pending_emails

        with self.set_user("Administrator"):
            enqueue_process_pending_emails(batch_size=10, max_batch_size=10)
            doc = frappe.get_doc("Mail Queue", scheduled.name)

        self.assertEqual(doc.status, "Scheduled")
        self.assertEqual(doc.submission_id, scheduled.doc.submission_id)

    def test_undo_send_holds_and_cancels(self):
        # The composer's default Send: the server computes a short hold so the sender
        # can cancel from the undo toast; Undo is just cancel_scheduled_mail.
        from suite.mail.api.mail import UNDO_SEND_HOLD_SECONDS, cancel_scheduled_mail

        result = self.send_mail(self.sender, self.recipient.email, undo_send=True)
        self.assertEqual(result["status"], "Scheduled", result.get("error"))
        self.assertTrue(result["name"])

        with self.set_user("Administrator"):
            doc = frappe.get_doc("Mail Queue", result["name"])
        self.assertTrue(doc.submission_id)

        hold = time_diff_in_seconds(doc.send_at, now())
        self.assertGreater(hold, 0)
        self.assertLessEqual(hold, UNDO_SEND_HOLD_SECONDS + 5)

        account = self.personal_account(self.sender)
        with self.set_user(self.sender.email):
            cancelled = cancel_scheduled_mail(account, result["name"])
        self.assertEqual(cancelled["status"], "Cancelled")

        submission = self._get_submission(account, doc.submission_id)
        self.assertEqual(submission["undoStatus"], "canceled")

    def test_stale_action_cannot_resurrect_a_cancelled_schedule(self):
        # Overlapping actions used to both pass validation on the same state: the loser
        # saw the winner's cancellation as "already canceled", fell through, and created
        # a live submission for a message that had just been moved back to Drafts.
        from suite.mail.api.mail import cancel_scheduled_mail

        account = self.personal_account(self.sender)

        for action in (
            lambda doc: doc.send_now(),
            lambda doc: doc.reschedule(get_datetime_str(add_to_date(now(), minutes=240))),
        ):
            scheduled = self._schedule(minutes=120)

            with self.set_user(self.sender.email):
                # Loaded while still Scheduled, i.e. before the cancellation below.
                stale = frappe.get_doc("Mail Queue", scheduled.name)
                cancel_scheduled_mail(account, scheduled.name)

                with self.assertRaises(frappe.ValidationError):
                    action(stale)

            with self.set_user("Administrator"):
                doc = frappe.get_doc("Mail Queue", scheduled.name)

            self.assertEqual(doc.status, "Cancelled")
            self.assertEqual(doc.submission_id, scheduled.doc.submission_id)
            self.assertEqual(self._get_submission(account, doc.submission_id)["undoStatus"], "canceled")

    def test_reconciliation_sweep(self):
        # The 5-minute cron flips rows whose hold elapsed: delivered submissions to
        # Submitted, out-of-band cancellations to Cancelled.
        from suite.mail.doctype.mail_queue.mail_queue import reconcile_scheduled_emails

        account = self.personal_account(self.sender)

        delivered = self.send_mail(
            self.sender,
            self.recipient.email,
            subject=f"Sweep {unique_name('subject')}",
            send_at=to_utc_z(add_to_date(now(), seconds=15)),
        )
        self.assertEqual(delivered["status"], "Scheduled", delivered.get("error"))

        out_of_band = self._schedule(minutes=120)
        with self.set_user(self.sender.email):
            client = get_account_client(account)
            with client.batch() as b:
                h = b.submission.email_submission.set(
                    update={out_of_band.doc.submission_id: {"undoStatus": "canceled"}}
                )
            self.assertIn(out_of_band.doc.submission_id, h.result.updated)

        with self.set_user("Administrator"):
            delivered_doc = frappe.get_doc("Mail Queue", delivered["name"])

        self.wait_until(
            lambda: (self._get_submission(account, delivered_doc.submission_id) or {}).get("undoStatus")
            == "final",
            timeout=90,
            message="The held submission never went final.",
        )

        with self.set_user("Administrator"):
            # Age both rows past the sweep's buffer.
            for name in (delivered["name"], out_of_band.name):
                frappe.db.set_value(
                    "Mail Queue", name, "send_at", add_to_date(now(), minutes=-2), update_modified=False
                )
            reconcile_scheduled_emails()

            self.assertEqual(frappe.db.get_value("Mail Queue", delivered["name"], "status"), "Submitted")
            self.assertTrue(frappe.db.get_value("Mail Queue", delivered["name"], "submitted_at"))
            self.assertEqual(frappe.db.get_value("Mail Queue", out_of_band.name, "status"), "Cancelled")
            self.assertTrue(frappe.db.get_value("Mail Queue", out_of_band.name, "cancelled_at"))

    def test_reconciliation_writes_are_batched(self):
        # Reconciliation runs on the Scheduled page's read path, so its write count must
        # stay flat as rows finalize rather than growing one UPDATE per row.
        from suite.mail.doctype.mail_queue.mail_queue import apply_reconciled_submissions

        rows = [self._schedule(minutes=120) for _ in range(3)]
        submitted = [rows[0].name, rows[1].name]
        cancelled = [rows[2].name]

        with self.set_user("Administrator"):
            with self.assertQueryCount(2):  # one per terminal state, not per row
                apply_reconciled_submissions(submitted, cancelled)

            for name in submitted:
                self.assertEqual(frappe.db.get_value("Mail Queue", name, "status"), "Submitted")
            self.assertEqual(frappe.db.get_value("Mail Queue", cancelled[0], "status"), "Cancelled")

    def test_clear_old_logs_purges_stale_scheduled(self):
        from suite.mail.doctype.mail_queue.mail_queue import MailQueue

        stale = self._schedule(minutes=120)
        fresh = self._schedule(minutes=120)

        with self.set_user("Administrator"):
            # A hold that elapsed days ago has long since delivered; the row is a log now.
            frappe.db.set_value(
                "Mail Queue",
                stale.name,
                "send_at",
                add_to_date(now(), days=-4),
                update_modified=False,
            )
            MailQueue.clear_old_logs()

        self.assertFalse(frappe.db.exists("Mail Queue", stale.name))
        self.assertTrue(frappe.db.exists("Mail Queue", fresh.name))
