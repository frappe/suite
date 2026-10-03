# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Scheduled send via JMAP FUTURERELEASE (RFC 4865).

Scheduling submits immediately with a HOLDUNTIL envelope parameter, so the server holds
delivery; the Mail Queue row is only a log (status ``Submitted``, ``send_at`` recording the
hold). The server's EmailSubmission objects are the source of truth: the Outbox browses all
of them via ``EmailSubmission/query`` with the RFC 8621 §7.3 filters (undoStatus, identity,
email, thread, sendAt window), newest sends first, so submissions created by other clients
appear too, and every action is keyed on the submission id. Reschedule and
send-now cancel the held submission and create a new one (undoStatus is the only mutable
submission property); cancel reverts the message to Drafts. An Email deleted after scheduling
leaves a dangling emailId — such a delivery can only be cancelled.

Delivery state is computed from the submission's deliveryStatus (delivered, displayed,
smtpReply), refined by the MTA queue (correlated via the envelope's ENVID): the listing and
the details endpoint report a status (scheduled, queued, retrying, failed, delivered,
displayed, sent) plus retry counts. A real delivery failure can't be
provoked reliably against the test server, so the failure sieve is covered at the helper level
and retry/dismiss against delivered (final) submissions.
"""

from datetime import datetime
from unittest import mock

import frappe
import httpx
from frappe.exceptions import FrappeTypeError
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, get_datetime, get_datetime_str, now, time_diff_in_seconds
from jmap.auth import BasicAuth
from jmap.core.retry import RetryPolicy
from jmap.testing.fake import FakeJMAPServer

from suite.mail.api.scheduled import (
    SUBMISSION_PROPERTIES,
    _query_submissions,
    cancel_scheduled_mail,
    dismiss_failed_mail,
    get_scheduled_mail,
    get_submissions,
    reschedule_mail,
    retry_failed_mail,
    send_scheduled_mail_now,
)
from suite.mail.jmap import SuiteJMAPClient, get_account_client, get_cached_identities
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
        """Schedules a mail from the class sender and returns the send result's details."""

        subject = subject or f"Scheduled {unique_name('subject')}"
        result = self.send_mail(
            self.sender,
            self.recipient.email,
            subject=subject,
            send_at=to_utc_z(add_to_date(now(), minutes=minutes)),
        )
        self.assertEqual(result["status"], "Submitted", result.get("error"))
        self.assertTrue(result["submission_id"])

        return frappe._dict(
            name=result["name"],
            id=result["id"],
            submission_id=result["submission_id"],
            subject=subject,
            result=result,
        )

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

    def _outbox_rows(self, account: str, **filters) -> list[dict]:
        with self.set_user(self.sender.email):
            return get_submissions(account, **filters)["rows"]

    def _get_details(self, account: str, submission_id: str) -> dict:
        with self.set_user(self.sender.email):
            return get_scheduled_mail(account, submission_id)

    # --- tests --------------------------------------------------------------

    def test_schedule_holds_delivery(self):
        scheduled = self._schedule(minutes=120)

        # The queue row is just a log now: submitted, with send_at recording the hold.
        with self.set_user("Administrator"):
            doc = frappe.get_doc("Mail Queue", scheduled.name)
        self.assertEqual(doc.status, "Submitted")
        self.assertTrue(doc.submission_id)
        self.assertTrue(doc.send_at)
        self.assertTrue(doc.submitted_at)

        account = self.personal_account(self.sender)

        # Trust EmailSubmission/get, not the create echo (which reports "final").
        submission = self._get_submission(account, scheduled.submission_id)
        self.assertIsNotNone(submission)
        self.assertEqual(submission["undoStatus"], "pending")

        # The server's sendAt reflects the HOLDUNTIL parameter.
        hold_until = int(convert_to_utc(get_datetime(doc.send_at)).timestamp())
        self.assertLessEqual(abs(_epoch(submission["sendAt"]) - hold_until), 5)

        # The message sits in Sent while held (moved there at submission time).
        with self.set_user(self.sender.email):
            sent_id = frappe.get_doc("Mail Queue", scheduled.name).mailbox_id
            emails = self._get_emails(account, [scheduled.id], properties=["mailboxIds"])
        self.assertTrue(emails and emails[0]["mailboxIds"].get(sent_id))

        # Held, so nothing has reached the recipient.
        threads = self.get_inbox_threads(self.recipient)
        self.assertNotIn(scheduled.subject, [t["subject"] for t in threads])

    def test_listing_reads_submissions(self):
        scheduled = self._schedule(minutes=120)
        account = self.personal_account(self.sender)

        rows = self._outbox_rows(account)
        row = next((r for r in rows if r["id"] == scheduled.submission_id), None)

        self.assertIsNotNone(row, "The held submission is missing from the Outbox listing.")
        self.assertEqual(row["email_id"], scheduled.id)
        self.assertEqual(row["subject"], scheduled.subject)
        self.assertFalse(row["email_deleted"])
        self.assertIn(self.recipient.email, [r["email"] for r in row["recipients"]])
        self.assertTrue(row["send_at"])

        # The merged delivery state: a held submission is "scheduled", with no attempts yet
        # (retries comes off the MTA queue message, correlated via ENVID) and no errors.
        self.assertEqual(row["status"], "scheduled")
        self.assertFalse(row["retries"])
        self.assertEqual(row["delivery_errors"], [])
        recipient_states = {r["email"]: r["status"] for r in row["recipients_status"]}
        self.assertEqual(recipient_states.get(self.recipient.email), "scheduled")

        # Newest sends first (sentAt desc).
        send_ats = [r["send_at"] for r in rows]
        self.assertEqual(send_ats, sorted(send_ats, reverse=True))

    def test_delivered_submission_goes_final_in_listing(self):
        # Held only briefly: once the hold elapses and the delivery concludes, the row leaves
        # the pending filter but stays browsable — the Outbox is a log of every submission,
        # narrowed only by the filters. Between release and conclusion the submission may
        # legitimately linger as pending, so the check waits on the filtered listing itself.
        subject = f"Delivered {unique_name('subject')}"
        result = self.send_mail(
            self.sender,
            self.recipient.email,
            subject=subject,
            send_at=to_utc_z(add_to_date(now(), seconds=15)),
        )
        self.assertEqual(result["status"], "Submitted", result.get("error"))

        account = self.personal_account(self.sender)
        self.wait_until(
            lambda: result["submission_id"]
            not in [row["id"] for row in self._outbox_rows(account, undo_status="pending")],
            timeout=90,
            message="The delivered submission never left the pending filter.",
        )

        row = next((r for r in self._outbox_rows(account) if r["id"] == result["submission_id"]), None)
        self.assertIsNotNone(row, "The delivered submission is missing from the Outbox listing.")
        self.assertEqual(row["undo_status"], "final")

        details = self._get_details(account, result["submission_id"])
        self.assertIn(details["status"], ("delivered", "sent"))
        self.assertEqual(details["undo_status"], "final")

    def test_listing_filters(self):
        scheduled = self._schedule(minutes=120)
        account = self.personal_account(self.sender)

        row = next(r for r in self._outbox_rows(account) if r["id"] == scheduled.submission_id)

        # Each RFC 8621 §7.3 filter matches the held submission...
        for filters in [
            {"undo_status": "pending"},
            {"email_id": row["email_id"]},
            {"thread_id": row["thread_id"]},
            {
                "after": to_utc_z(add_to_date(now(), minutes=60)),
                "before": to_utc_z(add_to_date(now(), minutes=180)),
            },
        ]:
            ids = [r["id"] for r in self._outbox_rows(account, **filters)]
            self.assertIn(scheduled.submission_id, ids, filters)

        # ...and excludes it when it doesn't.
        for filters in [
            {"undo_status": "canceled"},
            {"before": to_utc_z(add_to_date(now(), minutes=30))},
            {"after": to_utc_z(add_to_date(now(), minutes=180))},
        ]:
            ids = [r["id"] for r in self._outbox_rows(account, **filters)]
            self.assertNotIn(scheduled.submission_id, ids, filters)

        # The identity filter keys on the JMAP Identity id.
        with self.set_user(self.sender.email):
            identities = get_cached_identities(account)
        identity_id = next(i["id"] for i in identities if i["email"] == self.sender.email)
        ids = [r["id"] for r in self._outbox_rows(account, identity_id=identity_id)]
        self.assertIn(scheduled.submission_id, ids)

        # A cancelled submission stays browsable, under its own undoStatus.
        with self.set_user(self.sender.email):
            cancel_scheduled_mail(account, scheduled.submission_id)
        canceled_ids = [r["id"] for r in self._outbox_rows(account, undo_status="canceled")]
        self.assertIn(scheduled.submission_id, canceled_ids)
        pending_ids = [r["id"] for r in self._outbox_rows(account, undo_status="pending")]
        self.assertNotIn(scheduled.submission_id, pending_ids)

        with self.set_user(self.sender.email), self.assertRaises(frappe.ValidationError):
            get_submissions(account, undo_status="bogus")

    def test_listing_pagination(self):
        # The server caps a single query at maxObjectsInGet, so the listing pages: every
        # submission must stay reachable through page/page_length, without overlap.
        account = self.personal_account(self.sender)
        first = self._schedule(minutes=120)
        second = self._schedule(minutes=180)

        with self.set_user(self.sender.email):
            result = get_submissions(account, undo_status="pending", page=1, page_length=1)
        self.assertEqual(len(result["rows"]), 1)
        self.assertGreaterEqual(result["total"], 2)

        seen = []
        for page in range(1, result["total"] + 1):
            with self.set_user(self.sender.email):
                rows = get_submissions(account, undo_status="pending", page=page, page_length=1)["rows"]
            seen.extend(row["id"] for row in rows)

        self.assertEqual(len(seen), len(set(seen)), "Pages overlap.")
        for submission_id in (first.submission_id, second.submission_id):
            self.assertIn(submission_id, seen)

    def test_cancel_reverts_to_draft(self):
        scheduled = self._schedule(minutes=120)
        account = self.personal_account(self.sender)

        from suite.mail.doctype.mail_message.mail_message import _cache_messages, _get_cached_messages

        # Seed the data store with the (soon stale, Sent-labelled) cached copy; cancel
        # must evict it or Drafts keeps showing the old folder label until the next sync.
        _cache_messages(account, {scheduled.id: {"id": scheduled.id}})

        with self.set_user(self.sender.email):
            result = cancel_scheduled_mail(account, scheduled.submission_id)
        self.assertEqual(result["id"], scheduled.id)
        self.assertIsNone(_get_cached_messages(account, [scheduled.id])[scheduled.id])

        submission = self._get_submission(account, scheduled.submission_id)
        self.assertEqual(submission["undoStatus"], "canceled")

        # Back in Drafts only (mailboxIds replaced, not patched) with $draft restored.
        with self.set_user(self.sender.email):
            from suite.mail.jmap import get_mailbox_id_by_role

            drafts_id = get_mailbox_id_by_role(account, "drafts", raise_exception=True)
            emails = self._get_emails(account, [scheduled.id], properties=["mailboxIds", "keywords"])

        self.assertEqual(list(emails[0]["mailboxIds"].keys()), [drafts_id])
        self.assertTrue(emails[0]["keywords"].get("$draft"))

    def test_cancel_refreshes_open_mailbox_views(self):
        # The composer that raises the undo toast is unmounted by the time Undo runs, so
        # the refresh rides the same realtime event the message actions use.
        from unittest.mock import patch

        from suite.mail.jmap import get_mailbox_id_by_role

        scheduled = self._schedule(minutes=120)
        account = self.personal_account(self.sender)

        with self.set_user(self.sender.email):
            drafts_id = get_mailbox_id_by_role(account, "drafts", raise_exception=True)
            sent_id = get_mailbox_id_by_role(account, "sent", raise_exception=True)

            with patch("frappe.publish_realtime") as publish:
                cancel_scheduled_mail(account, scheduled.submission_id)

        events = [c for c in publish.call_args_list if c.args and c.args[0] == "new_mail_created"]
        self.assertTrue(events, "cancel did not publish a mailbox refresh")

        # Both the folder it left and the one it landed in, so either open view updates.
        self.assertEqual(set(events[-1].args[1]), {drafts_id, sent_id})
        self.assertEqual(events[-1].kwargs["user"], self.sender.email)

    def test_reschedule_creates_new_submission(self):
        scheduled = self._schedule(minutes=120)
        account = self.personal_account(self.sender)
        new_send_at = to_utc_z(add_to_date(now(), minutes=240))

        with self.set_user(self.sender.email):
            result = reschedule_mail(account, scheduled.submission_id, new_send_at)
        self.assertTrue(result["id"])
        self.assertNotEqual(result["id"], scheduled.submission_id)

        old_submission = self._get_submission(account, scheduled.submission_id)
        self.assertEqual(old_submission["undoStatus"], "canceled")

        new_submission = self._get_submission(account, result["id"])
        self.assertEqual(new_submission["undoStatus"], "pending")
        self.assertLessEqual(abs(_epoch(new_submission["sendAt"]) - _epoch(new_send_at)), 5)

    def test_send_now_delivers(self):
        scheduled = self._schedule(minutes=60 * 24)
        account = self.personal_account(self.sender)

        with self.set_user(self.sender.email):
            result = send_scheduled_mail_now(account, scheduled.submission_id)
        self.assertTrue(result["id"])

        def find_thread():
            threads = self.get_inbox_threads(self.recipient)
            return next((t for t in threads if t["subject"] == scheduled.subject), None)

        self.wait_until(
            find_thread,
            timeout=60,
            message=f"Send-now mail '{scheduled.subject}' did not reach {self.recipient.email}.",
        )

    def test_dangling_email_is_cancel_only(self):
        # The Email may be deleted after scheduling; the submission then carries a dangling
        # emailId. The listing must still show the row (recipients off the envelope), the
        # resubmitting actions must refuse it, and cancel must work without a move.
        scheduled = self._schedule(minutes=120)
        account = self.personal_account(self.sender)

        with self.set_user(self.sender.email):
            client = get_account_client(account)
            with client.batch() as b:
                h = b.mail.email.set(destroy=[scheduled.id])
            self.assertIn(scheduled.id, h.result.destroyed)

        rows = self._outbox_rows(account)
        row = next((r for r in rows if r["id"] == scheduled.submission_id), None)
        self.assertIsNotNone(row, "A dangling submission is missing from the Outbox listing.")
        self.assertTrue(row["email_deleted"])
        self.assertIn(self.recipient.email, [r["email"] for r in row["recipients"]])

        with self.set_user(self.sender.email):
            for action in (
                lambda: send_scheduled_mail_now(account, scheduled.submission_id),
                lambda: reschedule_mail(
                    account, scheduled.submission_id, to_utc_z(add_to_date(now(), minutes=240))
                ),
            ):
                with self.assertRaises(frappe.ValidationError):
                    action()

            # Refusing to resubmit must leave the hold untouched.
            self.assertEqual(self._get_submission(account, scheduled.submission_id)["undoStatus"], "pending")

            result = cancel_scheduled_mail(account, scheduled.submission_id)

        self.assertIsNone(result["id"])  # nothing left to move to Drafts
        submission = self._get_submission(account, scheduled.submission_id)
        self.assertEqual(submission["undoStatus"], "canceled")

    def test_validation_errors(self):
        for kwargs in [
            {"send_at": to_utc_z(add_to_date(now(), minutes=-5))},  # in the past
            {"send_at": to_utc_z(add_to_date(now(), days=31))},  # beyond maxDelayedSend
            {"send_at": to_utc_z(add_to_date(now(), minutes=60)), "save_as_draft": True},
        ]:
            with self.assertRaises(frappe.ValidationError):
                self.send_mail(self.sender, self.recipient.email, **kwargs)

        # The same window applies to a reschedule.
        scheduled = self._schedule(minutes=120)
        account = self.personal_account(self.sender)
        with self.set_user(self.sender.email):
            for send_at in (
                to_utc_z(add_to_date(now(), minutes=-5)),
                to_utc_z(add_to_date(now(), days=31)),
            ):
                with self.assertRaises(frappe.ValidationError):
                    reschedule_mail(account, scheduled.submission_id, send_at)

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

    def _undo_send(self) -> tuple[dict, float]:
        """Sends a plain (undo-send) mail from the class sender; returns the result and its remaining hold in seconds."""

        result = self.send_mail(self.sender, self.recipient.email, undo_send=True)
        self.assertEqual(result["status"], "Submitted", result.get("error"))
        self.assertTrue(result["submission_id"])
        self.assertTrue(result["send_at"])

        hold = time_diff_in_seconds(frappe.db.get_value("Mail Queue", result["name"], "send_at"), now())
        return result, hold

    def test_undo_send_holds_and_cancels(self):
        # The composer's default Send: the server computes a short hold so the sender
        # can cancel from the undo toast; Undo is just cancel_scheduled_mail.
        from suite.mail.api.mail import UNDO_SEND_GRACE_SECONDS
        from suite.mail.utils.user import get_undo_send_period

        result, hold = self._undo_send()
        period = get_undo_send_period(self.sender.email)
        self.assertGreater(hold, 0)
        self.assertLessEqual(hold, period + UNDO_SEND_GRACE_SECONDS + 5)
        # The composer times its Undo toast from the period the server applied.
        self.assertEqual(result["undo_send_period"], period)

        account = self.personal_account(self.sender)
        with self.set_user(self.sender.email):
            cancelled = cancel_scheduled_mail(account, result["submission_id"])
        self.assertEqual(cancelled["id"], result["id"])

        submission = self._get_submission(account, result["submission_id"])
        self.assertEqual(submission["undoStatus"], "canceled")

    def test_undo_send_hold_follows_user_settings(self):
        # The hold is the sender's own Undo Send period (User Settings) plus the grace, so a
        # longer period keeps the message recallable for longer.
        from suite.mail.api.mail import UNDO_SEND_GRACE_SECONDS
        from suite.mail.utils.user import DEFAULT_UNDO_SEND_PERIOD

        settings = frappe.db.get_value("User Settings", {"user": self.sender.email})
        frappe.db.set_value("User Settings", settings, "undo_send_period", "30")
        self.addCleanup(
            frappe.db.set_value, "User Settings", settings, "undo_send_period", str(DEFAULT_UNDO_SEND_PERIOD)
        )

        result, hold = self._undo_send()
        self.assertEqual(result["undo_send_period"], 30)
        self.assertGreater(hold, DEFAULT_UNDO_SEND_PERIOD + UNDO_SEND_GRACE_SECONDS)
        self.assertLessEqual(hold, 30 + UNDO_SEND_GRACE_SECONDS + 5)

    def test_submission_details(self):
        scheduled = self._schedule(minutes=120)
        account = self.personal_account(self.sender)

        details = self._get_details(account, scheduled.submission_id)

        self.assertEqual(details["id"], scheduled.submission_id)
        self.assertEqual(details["subject"], scheduled.subject)
        self.assertEqual(details["status"], "scheduled")
        self.assertEqual(details["undo_status"], "pending")
        self.assertFalse(details["email_deleted"])

        # The envelope this app submitted with, echoed back by the server.
        self.assertEqual(details["envelope_from"], self.sender.email)
        self.assertIn(self.recipient.email, details["envelope_recipients"])
        self.assertIsInstance(details["priority"], int)
        self.assertEqual(details["identity_email"], self.sender.email)

        recipient_states = {r["email"]: r for r in details["recipients_status"]}
        state = recipient_states[self.recipient.email]
        self.assertEqual(state["status"], "scheduled")
        # The raw DeliveryStatus rides along for the details page.
        for key in ("smtp_reply", "delivered", "displayed"):
            self.assertIn(key, state)

        self.assertEqual(details["dsn_count"], 0)
        self.assertEqual(details["mdn_count"], 0)

    def test_status_helpers(self):
        # The merged delivery state every row reports is computed by these helpers.
        from suite.mail.api.scheduled import _hold_active, _recipient_status

        # A hold is active only while pending AND before sendAt: Stalwart keeps a released
        # message pending for as long as it can still be cancelled from the queue.
        future = to_utc_z(add_to_date(now(), minutes=60))
        past = to_utc_z(add_to_date(now(), minutes=-60))
        self.assertTrue(_hold_active({"undoStatus": "pending", "sendAt": future}))
        self.assertFalse(_hold_active({"undoStatus": "pending", "sendAt": past}))
        self.assertFalse(_hold_active({"undoStatus": "final", "sendAt": future}))
        self.assertFalse(_hold_active({"undoStatus": "pending"}))

        # (hold active, DeliveryStatus, queue status, retries) → status. DeliveryStatus drives
        # the state; the queue tells a first attempt apart from one awaiting a retry.
        for expected, args in [
            ("scheduled", (True, {}, None, 0)),
            ("displayed", (False, {"delivered": "yes", "displayed": "yes"}, None, 0)),
            ("failed", (False, {"delivered": "no", "smtpReply": "550 5.1.1"}, None, 0)),
            ("delivered", (False, {"delivered": "yes", "displayed": "unknown"}, None, 0)),
            ("retrying", (False, {"delivered": "queued"}, "TemporaryFailure", 0)),
            ("retrying", (False, {"delivered": "queued"}, "Scheduled", 1)),
            ("queued", (False, {"delivered": "queued"}, None, 0)),
            ("queued", (False, {"delivered": "queued"}, "Scheduled", 0)),
            ("queued", (False, {}, "Scheduled", 0)),
            ("sent", (False, {"delivered": "unknown"}, None, 0)),
            ("sent", (False, {}, None, 0)),
        ]:
            self.assertEqual(_recipient_status(*args), expected, args)

    def test_retry_and_dismiss_finalized_submissions(self):
        account = self.personal_account(self.sender)

        # Both refuse a submission whose delivery is still pending.
        pending = self._schedule(minutes=120)
        with self.set_user(self.sender.email):
            for action in (retry_failed_mail, dismiss_failed_mail):
                with self.assertRaises(frappe.ValidationError):
                    action(account, pending.submission_id)

        subject = f"Retry {unique_name('subject')}"
        result = self.send_mail(
            self.sender,
            self.recipient.email,
            subject=subject,
            send_at=to_utc_z(add_to_date(now(), seconds=15)),
        )
        self.assertEqual(result["status"], "Submitted", result.get("error"))
        self.wait_until(
            lambda: (self._get_submission(account, result["submission_id"]) or {}).get("undoStatus")
            == "final",
            timeout=90,
            message="The held submission never went final.",
        )

        self.wait_until(
            lambda: self._get_details(account, result["submission_id"])["status"] in ("delivered", "sent"),
            timeout=90,
            message="The released delivery never concluded.",
        )
        # Retry replaces the finalized record with a fresh immediate submission.
        with self.set_user(self.sender.email):
            retried = retry_failed_mail(account, result["submission_id"])
        self.assertTrue(retried["id"])
        self.assertIsNone(self._get_submission(account, result["submission_id"]))

        # Dismiss destroys the record outright.
        self.wait_until(
            lambda: (self._get_submission(account, retried["id"]) or {}).get("undoStatus") == "final",
            timeout=90,
            message="The retried submission never went final.",
        )
        with self.set_user(self.sender.email):
            dismiss_failed_mail(account, retried["id"])
        self.assertIsNone(self._get_submission(account, retried["id"]))

    def test_stale_action_cannot_resurrect_a_cancelled_schedule(self):
        # Reschedule/send-now on a submission that was cancelled in the meantime must not
        # create a live replacement for a message already moved back to Drafts.
        account = self.personal_account(self.sender)

        for action in (
            lambda submission_id: send_scheduled_mail_now(account, submission_id),
            lambda submission_id: reschedule_mail(
                account, submission_id, to_utc_z(add_to_date(now(), minutes=240))
            ),
        ):
            scheduled = self._schedule(minutes=120)

            with self.set_user(self.sender.email):
                cancel_scheduled_mail(account, scheduled.submission_id)

                with self.assertRaises(frappe.ValidationError):
                    action(scheduled.submission_id)

            self.assertEqual(self._get_submission(account, scheduled.submission_id)["undoStatus"], "canceled")


class TestOutboxRequestBoundary(IntegrationTestCase):
    """The Outbox endpoints' request boundary, exercised without Stalwart.

    ``frappe.whitelist`` wraps every endpoint in ``validate_argument_types`` (active in requests
    and tests alike), so a client-supplied complex value — a dict or list where a scalar is
    annotated — is rejected before the endpoint body runs, i.e. before anything can reach JMAP
    or the database; the endpoints' own explicit checks then refuse malformed scalars.
    """

    def test_complex_values_are_rejected_before_the_body_runs(self):
        for call in (
            lambda: get_submissions(account={"account": "x"}),
            lambda: get_submissions("acc", undo_status={"operator": "OR", "conditions": []}),
            lambda: get_submissions("acc", identity_id=["id-1", "id-2"]),
            lambda: get_submissions("acc", email_id={"$ne": ""}),
            lambda: get_submissions("acc", before={"utcDate": "2026-01-01T00:00:00Z"}),
            lambda: get_submissions("acc", page={"gt": 1}),
            lambda: get_submissions("acc", page_length=[100]),
            lambda: get_scheduled_mail("acc", id=["sub-1"]),
            lambda: reschedule_mail("acc", "sub", send_at=["2026-01-01T00:00:00Z"]),
            lambda: send_scheduled_mail_now("acc", id=None),
            lambda: cancel_scheduled_mail("acc", id={"id": "sub"}),
            lambda: retry_failed_mail(["acc"], "sub"),
            lambda: dismiss_failed_mail("acc", id=42),
        ):
            self.assertRaises(FrappeTypeError, call)

    def test_malformed_filter_scalars_are_rejected(self):
        # Well-typed strings that aren't valid filter values; the endpoint's own explicit
        # checks refuse them before any account lookup or server contact (asserted on the
        # message so a later failure — e.g. the unknown account — can't pass for it).
        for bad in ("yesterday", "31-01-2026", "2026-13-45T99:00:00Z"):
            for bound in ("before", "after"):
                with self.assertRaisesRegex(frappe.ValidationError, "must be a UTC timestamp"):
                    get_submissions("acc", **{bound: bad})

        with self.assertRaisesRegex(frappe.ValidationError, "undo_status: Input should be 'pending'"):
            get_submissions("acc", undo_status="bogus")

        # An empty filter is no filter: it must not be read as a malformed id or timestamp.
        with self.assertRaises(frappe.ValidationError) as caught:
            get_submissions("acc", identity_id="", before="")
        self.assertNotRegex(str(caught.exception), "identity_id|before")

    def test_malformed_identifiers_are_rejected(self):
        # RFC 8620 §1.2 confines a JMAP Id to 1 to 255 characters of [A-Za-z0-9_-]: any other
        # string is refused before it can reach a JMAP operation.
        for call in (
            lambda: get_submissions("not an account id"),
            lambda: get_submissions("acc", identity_id="id with spaces"),
            lambda: get_submissions("acc", email_id="a/../b"),
            lambda: get_submissions("acc", thread_id='T{"x":1}'),
            lambda: get_scheduled_mail("acc", id="sub;drop"),
            lambda: cancel_scheduled_mail("acc", id="x" * 256),
            lambda: retry_failed_mail("acc", id="sub\nid"),
        ):
            with self.assertRaisesRegex(frappe.ValidationError, "not a valid JMAP identifier"):
                call()


class TestSubmissionQueryTotal(IntegrationTestCase):
    """The submission query, exercised against a fake (possibly clamping) server: the pager
    must keep advancing even when the server omits total (RFC 8620 §5.5 allows it), a genuine
    total of 0 must not be mistaken for an omitted one, and a server-enforced limit below the
    page length must not shrink the page — the pager advances in strides of the full page, so
    the rows behind the clamp would be stranded."""

    def _query_page(
        self,
        all_ids: list[str],
        position: int = 0,
        limit: int = 2,
        server_limit: int | None = None,
        server_total: int | None = None,
    ) -> tuple[list[str], int, int]:
        """Runs query() against a fake server holding `all_ids`, which clamps every request to
        `server_limit` ids (echoing the limit it used, per RFC 8620 §5.5) and reports
        `server_total` as total when given. Returns (ids, total, request_count)."""

        def respond(client, filter, position, limit, sort):
            served = limit if server_limit is None else min(server_limit, limit)
            body = {"ids": all_ids[position : position + served]}
            if server_total is not None:
                body["total"] = server_total
            if served < limit:
                body["limit"] = served
            return body

        with mock.patch("suite.mail.api.scheduled._query_page", side_effect=respond) as query:
            ids, total = _query_submissions(mock.Mock(), position=position, limit=limit)

        # The look-ahead: one id past the page is requested, never returned.
        self.assertEqual(query.call_args_list[0].args[3], limit + 1)
        return ids, total, query.call_count

    def test_omitted_total_keeps_the_pager_advancing(self):
        # A full page plus the look-ahead id: the floor sits one past the page, so the
        # pager's page count stays ahead of the current page.
        ids, total, _ = self._query_page(["a", "b", "c", "d", "e"], position=2)
        self.assertEqual(ids, ["c", "d"])
        self.assertEqual(total, 5)

        # A full page with nothing behind it: the floor is exact and Next disables.
        ids, total, _ = self._query_page(["a", "b", "c", "d"], position=2)
        self.assertEqual(ids, ["c", "d"])
        self.assertEqual(total, 4)

    def test_server_total_is_trusted_even_when_zero(self):
        # total 0 is falsy but real — an out-of-range page must not report phantom pages.
        ids, total, _ = self._query_page([], position=2, server_total=0)
        self.assertEqual((ids, total), ([], 0))

        ids, total, _ = self._query_page(["a", "b", "c", "d", "e"], server_total=7)
        self.assertEqual((ids, total), (["a", "b"], 7))

    def test_clamped_server_still_fills_the_page(self):
        # The server clamps every query below the page length: the page is filled across
        # follow-up queries, so no rows are stranded between the pager's strides — and the
        # look-ahead still lands, keeping the floor one past the page.
        ids, total, requests = self._query_page(["a", "b", "c", "d", "e", "f"], limit=4, server_limit=1)
        self.assertEqual(ids, ["a", "b", "c", "d"])
        self.assertEqual(total, 5)
        self.assertEqual(requests, 5)

        # A clamp exactly at the page length behaves the same — the look-ahead alone spills
        # into a follow-up query.
        ids, total, _ = self._query_page(["a", "b", "c", "d", "e", "f"], position=2, server_limit=2)
        self.assertEqual(ids, ["c", "d"])
        self.assertEqual(total, 5)

        # A clamped server that runs dry mid-fill: the results end, exactly.
        ids, total, _ = self._query_page(["a", "b", "c"], limit=4, server_limit=1)
        self.assertEqual(ids, ["a", "b", "c"])
        self.assertEqual(total, 3)

        # The fill respects a total the server did provide — it stops there and never
        # overrides it.
        ids, total, requests = self._query_page(["a", "b", "c", "d"], limit=4, server_limit=2, server_total=4)
        self.assertEqual((ids, total), (["a", "b", "c", "d"], 4))
        self.assertEqual(requests, 2)


CORE = "urn:ietf:params:jmap:core"
MAIL = "urn:ietf:params:jmap:mail"
SUBMISSION = "urn:ietf:params:jmap:submission"
URNS = (CORE, MAIL, SUBMISSION)
ACCOUNT = "f7"
USER = "user@example.test"


class _FakeServerCase(IntegrationTestCase):
    """The Outbox endpoints against a fake server, which every test sets up through `serve`."""

    def serve(self, submission: dict | None = None) -> FakeJMAPServer:
        """Routes the endpoints' account client to a fake server; `submission` is what the
        account advertises for the submission capability."""

        server = FakeJMAPServer(
            capabilities={urn: {} for urn in URNS},
            accounts={
                ACCOUNT: {
                    "name": USER,
                    "isPersonal": True,
                    "accountCapabilities": {CORE: {}, MAIL: {}, SUBMISSION: submission or {}},
                }
            },
            primary_accounts=dict.fromkeys(URNS, ACCOUNT),
        )
        http = httpx.Client(auth=BasicAuth(USER, "pw"), **server.client_kwargs())
        self.client = SuiteJMAPClient.connect(
            "https://jmap.example.com/.well-known/jmap",
            auth=BasicAuth(USER, "pw"),
            http=http,
            experimental=True,
            retry_policy=RetryPolicy(max_attempts=1),
        )
        for target in ("suite.mail.api.scheduled.get_account_client", "suite.mail.jmap.get_account_client"):
            patcher = mock.patch(target, return_value=self.client)
            patcher.start()
            self.addCleanup(patcher.stop)

        return server

    def hold(self, server: FakeJMAPServer, undo_status: str = "pending", **properties) -> None:
        """Makes the server hold submission "sub1", of email "e1"."""

        submission = {
            "id": "sub1",
            "emailId": "e1",
            "threadId": "t1",
            "undoStatus": undo_status,
            "sendAt": to_utc_z(add_to_date(now(), hours=1)),
            **properties,
        }
        server.respond("EmailSubmission/get", {"state": "s1", "list": [submission], "notFound": []})

    def methods(self, server: FakeJMAPServer) -> list[str]:
        """Every method the server was asked to run, in order."""

        return [call[0] for request in server.requests for call in request["methodCalls"]]


class TestSendAtWindow(_FakeServerCase):
    """A reschedule is checked against how long the server says it can hold a message
    (maxDelayedSend), and the refusal names that limit in a unit the user can read."""

    def refusal(self, submission: dict | None, **ahead) -> str:
        """What rescheduling "sub1" to `ahead` of now is refused with."""

        server = self.serve(submission)
        self.hold(server)

        with self.assertRaises(frappe.ValidationError) as refused:
            reschedule_mail(ACCOUNT, "sub1", to_utc_z(add_to_date(now(), **ahead)))

        # Refused before the held submission is touched.
        self.assertEqual(self.methods(server), ["EmailSubmission/get"])
        return str(refused.exception)

    def test_a_server_that_holds_nothing_says_scheduling_is_unsupported(self):
        self.assertEqual(
            self.refusal({"maxDelayedSend": 0}, hours=2),
            "This mail server doesn't support scheduled sending.",
        )

    def test_a_limit_under_a_day_is_said_in_hours(self):
        self.assertEqual(
            self.refusal({"maxDelayedSend": 6 * 3600}, hours=7),
            "Send At cannot be more than 6 hours in the future.",
        )

    def test_a_limit_under_an_hour_is_said_in_minutes(self):
        self.assertEqual(
            self.refusal({"maxDelayedSend": 45 * 60}, hours=2),
            "Send At cannot be more than 45 minutes in the future.",
        )

    def test_a_limit_of_days_is_said_in_days(self):
        self.assertEqual(
            self.refusal({"maxDelayedSend": 2 * 86400}, days=3),
            "Send At cannot be more than 2 days in the future.",
        )

    def test_a_server_that_names_no_limit_holds_for_thirty_days(self):
        self.assertEqual(self.refusal(None, days=31), "Send At cannot be more than 30 days in the future.")

    def test_a_time_in_the_past_is_refused_as_such_whatever_the_limit(self):
        self.assertEqual(self.refusal({"maxDelayedSend": 0}, minutes=-5), "Send At must be in the future.")

    def test_a_time_within_a_limit_under_a_day_is_accepted(self):
        from suite.mail.api.scheduled import _validate_send_at

        self.serve({"maxDelayedSend": 6 * 3600})
        send_at = get_datetime_str(add_to_date(now(), hours=5))

        self.assertEqual(_validate_send_at(self.client, ACCOUNT, send_at), send_at)


class TestRefusedOutboxCalls(_FakeServerCase):
    """What the Outbox answers when the server refuses a whole call (a method error) rather
    than one object in it."""

    def actions(self) -> list:
        """Every action on submission "sub1"."""

        send_at = to_utc_z(add_to_date(now(), hours=2))
        return [
            lambda: cancel_scheduled_mail(ACCOUNT, "sub1"),
            lambda: send_scheduled_mail_now(ACCOUNT, "sub1"),
            lambda: reschedule_mail(ACCOUNT, "sub1", send_at),
            lambda: retry_failed_mail(ACCOUNT, "sub1"),
            lambda: dismiss_failed_mail(ACCOUNT, "sub1"),
        ]

    def list_one(self, server: FakeJMAPServer) -> None:
        """Makes the server's query find submission "sub1"."""

        server.respond("EmailSubmission/query", {"ids": ["sub1"], "total": 1})

    def test_a_lookup_refused_for_a_missing_account_reads_as_a_submission_that_is_gone(self):
        server = self.serve()
        server.fail("EmailSubmission/get", "accountNotFound")

        for action in self.actions():
            with self.assertRaisesRegex(frappe.ValidationError, "This scheduled email no longer exists."):
                action()

        with self.assertRaisesRegex(frappe.ValidationError, "This submission no longer exists."):
            get_scheduled_mail(ACCOUNT, "sub1")

        # Nothing was changed on the strength of a lookup that failed.
        self.assertEqual(set(self.methods(server)), {"EmailSubmission/get"})

    def test_a_lookup_the_server_failed_fails_with_the_servers_reason(self):
        # A server that could not answer has not said the submission is gone.
        server = self.serve()
        server.fail("EmailSubmission/get", "serverFail", description="Try again later.")

        for call in (*self.actions(), lambda: get_scheduled_mail(ACCOUNT, "sub1")):
            with self.assertRaises(frappe.ValidationError) as refused:
                call()
            self.assertEqual(str(refused.exception), "Try again later.")

        self.assertEqual(set(self.methods(server)), {"EmailSubmission/get"})

    def test_a_refused_query_lists_an_empty_outbox(self):
        server = self.serve()
        server.fail("EmailSubmission/query", "serverFail", description="Try again later.")

        self.assertEqual(get_submissions(ACCOUNT), {"rows": [], "total": 0})
        self.assertEqual(self.methods(server), ["EmailSubmission/query"])

    def test_a_listing_whose_submissions_are_refused_is_an_empty_page(self):
        server = self.serve()
        self.list_one(server)
        server.fail("EmailSubmission/get", "serverFail", description="Try again later.")

        self.assertEqual(get_submissions(ACCOUNT), {"rows": [], "total": 1})

    def test_a_listing_keeps_its_rows_when_their_messages_are_refused(self):
        server = self.serve()
        self.list_one(server)
        self.hold(server)
        server.fail("Email/get", "serverFail", description="Try again later.")

        listing = get_submissions(ACCOUNT)

        self.assertEqual(listing["total"], 1)
        self.assertEqual([(row["id"], row["status"]) for row in listing["rows"]], [("sub1", "scheduled")])
        self.assertIsNone(listing["rows"][0]["subject"])

    def test_a_message_lookup_the_server_failed_fails_with_the_servers_reason(self):
        # Not "the message was deleted": the server never said so.
        for undo_status, call in (
            ("pending", lambda: get_scheduled_mail(ACCOUNT, "sub1")),
            ("pending", lambda: send_scheduled_mail_now(ACCOUNT, "sub1")),
            ("final", lambda: retry_failed_mail(ACCOUNT, "sub1")),
        ):
            server = self.serve()
            self.hold(server, undo_status=undo_status)
            server.fail("Email/get", "serverFail", description="Try again later.")

            with self.assertRaises(frappe.ValidationError) as refused:
                call()

            self.assertEqual(str(refused.exception), "Try again later.")
            # The submission is left as it was: neither cancelled nor resubmitted.
            self.assertEqual(self.methods(server), ["EmailSubmission/get", "Email/get"])

    def test_a_message_lookup_refused_for_a_missing_account_reads_as_a_message_that_is_gone(self):
        server = self.serve()
        self.hold(server, undo_status="final")
        server.fail("Email/get", "accountNotFound")

        self.assertTrue(get_scheduled_mail(ACCOUNT, "sub1")["email_deleted"])

        with self.assertRaisesRegex(frappe.ValidationError, "The original message no longer exists"):
            retry_failed_mail(ACCOUNT, "sub1")

        self.assertNotIn("EmailSubmission/set", self.methods(server))

    def test_a_cancel_whose_message_lookup_is_refused_does_not_answer_as_moved(self):
        # Answering without a message id reads as "nothing left to move"; a refused lookup
        # says no such thing, whatever the error — the message may still sit in Sent.
        for error in ("serverFail", "accountNotFound"):
            server = self.serve()
            self.hold(server)
            server.respond("EmailSubmission/set", {"updated": {"sub1": None}})
            server.fail("Email/get", error, description="Try again later.")

            with self.assertRaises(frappe.ValidationError) as refused:
                cancel_scheduled_mail(ACCOUNT, "sub1")

            self.assertEqual(str(refused.exception), "Try again later.")
            self.assertEqual(
                self.methods(server), ["EmailSubmission/get", "EmailSubmission/set", "Email/get"]
            )

    def test_a_refused_cancel_fails_with_the_servers_reason(self):
        server = self.serve()
        self.hold(server)
        server.fail("EmailSubmission/set", "serverFail", description="The queue is locked.")

        with self.assertRaisesRegex(ValueError, "The queue is locked."):
            cancel_scheduled_mail(ACCOUNT, "sub1")

        # The delivery was not cancelled, so the message stays where it is.
        self.assertNotIn("Email/set", self.methods(server))

    def test_a_refused_move_to_drafts_fails_with_the_servers_reason(self):
        # Already cancelled: the action goes straight to moving the message back.
        server = self.serve()
        self.hold(server, undo_status="canceled")
        server.respond(
            "Email/get",
            {"state": "e1", "list": [{"id": "e1", "mailboxIds": {"mb-sent": True}}], "notFound": []},
        )
        server.fail("Email/set", "accountReadOnly", description="The account is read-only.")

        with (
            mock.patch("suite.mail.api.scheduled.get_mailbox_id_by_role", return_value="mb-drafts"),
            self.assertRaisesRegex(frappe.ValidationError, "The account is read-only."),
        ):
            cancel_scheduled_mail(ACCOUNT, "sub1")

    def test_details_survive_a_refused_identity_lookup(self):
        server = self.serve()
        self.hold(server, identityId="i1")
        email = {"id": "e1", "threadId": "t1", "subject": "Quarterly report"}
        server.respond("Email/get", {"state": "e1", "list": [email], "notFound": []})
        server.fail("Identity/get", "forbidden")

        details = get_scheduled_mail(ACCOUNT, "sub1")

        self.assertEqual(details["id"], "sub1")
        self.assertEqual(details["subject"], "Quarterly report")
        self.assertEqual(details["status"], "scheduled")
        self.assertIsNone(details["identity_email"])


class TestRetryFailedMail(_FakeServerCase):
    """A retry resubmits the email and then drops the failed record. Once the email is
    resubmitted the retry has succeeded, whatever becomes of the old record: an error there
    would have the user retry again, and the email sent twice - as would a record left behind
    that could be retried once more, or two retries of one record at the same time."""

    def setUp(self) -> None:
        super().setUp()
        self.server = self.serve()
        # What the server holds: failed submission "sub1" of email "e1" to begin with. It takes
        # each new submission as "sub2", "sub3", ... and keeps it, failed in its turn.
        self.held = [self.submission("sub1", envid="0199c3f0-7a10-7c7e-9d3b-5b1f0a2c4d6e")]
        self.refuse_destroy = None
        self.on_create = None

        def get(arguments: dict, server: FakeJMAPServer) -> dict:
            found = [s for s in self.held if s["id"] in arguments["ids"]]
            return {"state": "s1", "list": found, "notFound": []}

        def query(arguments: dict, server: FakeJMAPServer) -> dict:
            email_ids = arguments["filter"]["emailIds"]
            return {"queryState": "q1", "ids": [s["id"] for s in self.held if s["emailId"] in email_ids]}

        def set_(arguments: dict, server: FakeJMAPServer) -> dict:
            if create := arguments.get("create"):
                if self.on_create:
                    self.on_create()
                created = {}
                for ref, submission in create.items():
                    created[ref] = {"id": f"sub{len(self.held) + 1}"}
                    self.held.append(self.submission(created[ref]["id"]) | submission)
                return {"created": created}
            if self.refuse_destroy and (refusal := self.refuse_destroy(arguments["destroy"])):
                return refusal
            self.held = [s for s in self.held if s["id"] not in arguments["destroy"]]
            return {"destroyed": arguments["destroy"]}

        self.server.handle("EmailSubmission/get", get)
        self.server.handle("EmailSubmission/query", query)
        self.server.handle("EmailSubmission/set", set_)
        self.server.respond("Email/get", {"state": "e1", "list": [{"id": "e1"}], "notFound": []})

        patcher = mock.patch("suite.mail.api.scheduled.get_identity_id_by_email", return_value="i1")
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = mock.patch("suite.mail.api.scheduled.log_mail_error")
        self.logged = patcher.start()
        self.addCleanup(patcher.stop)

    def submission(self, id: str, envid: str | None = None, **properties) -> dict:
        """A concluded submission of email "e1". `envid` is the ENVID this app wrote into its
        envelope; None is a submission another client made."""

        mail_from = {"email": USER, "parameters": {"ENVID": envid} if envid else None}
        return {
            "id": id,
            "emailId": "e1",
            "threadId": "t1",
            "undoStatus": "final",
            "sendAt": to_utc_z(add_to_date(now(), hours=-1)),
            "envelope": {"mailFrom": mail_from, "rcptTo": [{"email": "to@example.test"}]},
            **properties,
        }

    def sets(self, kind: str) -> list:
        """The `kind` ("create" or "destroy") argument of every EmailSubmission/set sent
        with one, in order."""

        return [
            call[1][kind]
            for request in self.server.requests
            for call in request["methodCalls"]
            if call[0] == "EmailSubmission/set" and call[1].get(kind)
        ]

    def test_a_retry_resubmits_then_drops_the_failed_record(self):
        answer = retry_failed_mail(ACCOUNT, "sub1")

        self.assertEqual(answer, {"id": "sub2"})
        (create,) = self.sets("create")
        self.assertEqual([submission["emailId"] for submission in create.values()], ["e1"])
        self.assertEqual(self.sets("destroy"), [["sub1"]])
        self.logged.assert_not_called()

    def test_a_refused_destroy_does_not_fail_a_retry_that_was_sent(self):
        refusal = {"type": "forbidden", "description": "The record is locked."}
        self.refuse_destroy = lambda ids: {"notDestroyed": dict.fromkeys(ids, refusal)}

        answer = retry_failed_mail(ACCOUNT, "sub1")

        self.assertEqual(answer, {"id": "sub2"})
        # Sent once, and the destroy was attempted.
        self.assertEqual(len(self.sets("create")), 1)
        self.assertEqual(self.sets("destroy"), [["sub1"]])
        self.logged.assert_called_once()
        self.assertIn("The record is locked.", str(self.logged.call_args))

    def test_a_destroy_that_never_lands_does_not_fail_a_retry_that_was_sent(self):
        def drop_connection(ids: list[str]) -> dict:
            raise httpx.ConnectError("connection reset")

        self.refuse_destroy = drop_connection

        answer = retry_failed_mail(ACCOUNT, "sub1")

        self.assertEqual(answer, {"id": "sub2"})
        self.assertEqual(len(self.sets("create")), 1)
        self.logged.assert_called_once()

    def test_a_record_its_retry_could_not_remove_is_not_sent_again(self):
        refusal = {"type": "forbidden", "description": "The record is locked."}
        self.refuse_destroy = lambda ids: {"notDestroyed": dict.fromkeys(ids, refusal)}
        retry_failed_mail(ACCOUNT, "sub1")

        # "sub1" is still listed, with its Send Again action.
        answer = retry_failed_mail(ACCOUNT, "sub1")

        self.assertEqual(answer, {"id": "sub2"})
        self.assertEqual(len(self.sets("create")), 1)
        self.assertEqual(self.sets("destroy"), [["sub1"], ["sub1"]])

    def test_a_retry_that_failed_in_its_turn_can_be_retried(self):
        # "sub1" stays behind, older than its retry "sub2", which is the record retried now.
        self.refuse_destroy = (
            lambda ids: {"notDestroyed": {"sub1": {"type": "forbidden"}}} if "sub1" in ids else None
        )
        retry_failed_mail(ACCOUNT, "sub1")

        answer = retry_failed_mail(ACCOUNT, "sub2")

        self.assertEqual(answer, {"id": "sub3"})
        self.assertEqual(len(self.sets("create")), 2)
        self.assertEqual([s["id"] for s in self.held], ["sub1", "sub3"])

    def test_another_submission_of_the_same_email_is_not_this_records_retry(self):
        # Made after "sub1" failed and due later: by another client, and by this app for some
        # other reason than retrying "sub1".
        later = to_utc_z(add_to_date(now(), hours=2))
        self.held += [
            self.submission("sub2", undoStatus="pending", sendAt=later),
            self.submission("sub3", envid="0199c3f1-1b2c-7d3e-8f40-6a7b8c9d0e1f", sendAt=later),
        ]

        answer = retry_failed_mail(ACCOUNT, "sub1")

        self.assertEqual(answer, {"id": "sub4"})
        self.assertEqual(len(self.sets("create")), 1)
        self.assertEqual(self.sets("destroy"), [["sub1"]])

    def test_a_retry_arriving_while_another_is_under_way_sends_nothing(self):
        second = []

        def retry_again_meanwhile() -> None:
            # The first retry has looked for a replacement, found none, and is creating one.
            with self.assertRaises(frappe.ValidationError) as refused:
                retry_failed_mail(ACCOUNT, "sub1")
            second.append(str(refused.exception))

        self.on_create = retry_again_meanwhile

        with mock.patch("suite.mail.api.scheduled.RETRY_LOCK_WAIT", 0.2):
            answer = retry_failed_mail(ACCOUNT, "sub1")

        self.assertEqual(answer, {"id": "sub2"})
        self.assertEqual(second, ["This email is already being sent again."])
        self.assertEqual(len(self.sets("create")), 1)

    def test_a_retry_is_not_sent_when_the_server_will_not_say_what_else_it_holds(self):
        self.server.fail("EmailSubmission/query", "serverFail", description="Try again later.")

        with self.assertRaisesRegex(frappe.ValidationError, "Try again later."):
            retry_failed_mail(ACCOUNT, "sub1")

        self.assertNotIn("EmailSubmission/set", self.methods(self.server))
