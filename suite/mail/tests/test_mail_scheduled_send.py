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
from frappe.exceptions import FrappeTypeError
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, get_datetime, get_datetime_str, now, time_diff_in_seconds

from suite.mail.api.scheduled import (
    SUBMISSION_PROPERTIES,
    _query_submissions,
    cancel_scheduled_mail,
    dismiss_failed_mail,
    get_scheduled_mail,
    get_submissions,
    reschedule_mail,
    retry_delivery_now,
    retry_failed_mail,
    send_scheduled_mail_now,
)
from suite.mail.jmap import get_account_client, get_cached_identities
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

        # The queue log mirrors the cancellation via cancelled_at; the row stays Submitted.
        with self.set_user("Administrator"):
            doc = frappe.get_doc("Mail Queue", scheduled.name)
        self.assertEqual(doc.status, "Submitted")
        self.assertTrue(doc.cancelled_at)

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

        # The queue log follows the replacement submission.
        with self.set_user("Administrator"):
            doc = frappe.get_doc("Mail Queue", scheduled.name)
        self.assertEqual(doc.submission_id, result["id"])
        self.assertLessEqual(abs(_epoch(to_utc_z(doc.send_at)) - _epoch(new_send_at)), 5)

    def test_send_now_delivers(self):
        scheduled = self._schedule(minutes=60 * 24)
        account = self.personal_account(self.sender)

        with self.set_user(self.sender.email):
            result = send_scheduled_mail_now(account, scheduled.submission_id)
        self.assertTrue(result["id"])

        with self.set_user("Administrator"):
            doc = frappe.get_doc("Mail Queue", scheduled.name)
        self.assertEqual(doc.submission_id, result["id"])
        self.assertFalse(doc.send_at)

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

    def test_undo_send_holds_and_cancels(self):
        # The composer's default Send: the server computes a short hold so the sender
        # can cancel from the undo toast; Undo is just cancel_scheduled_mail.
        from suite.mail.api.mail import UNDO_SEND_HOLD_SECONDS

        result = self.send_mail(self.sender, self.recipient.email, undo_send=True)
        self.assertEqual(result["status"], "Submitted", result.get("error"))
        self.assertTrue(result["submission_id"])
        self.assertTrue(result["send_at"])

        hold = time_diff_in_seconds(frappe.db.get_value("Mail Queue", result["name"], "send_at"), now())
        self.assertGreater(hold, 0)
        self.assertLessEqual(hold, UNDO_SEND_HOLD_SECONDS + 5)

        account = self.personal_account(self.sender)
        with self.set_user(self.sender.email):
            cancelled = cancel_scheduled_mail(account, result["submission_id"])
        self.assertEqual(cancelled["id"], result["id"])

        submission = self._get_submission(account, result["submission_id"])
        self.assertEqual(submission["undoStatus"], "canceled")

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

        # All three refuse a submission whose delivery is still pending.
        pending = self._schedule(minutes=120)
        with self.set_user(self.sender.email):
            for action in (retry_failed_mail, retry_delivery_now, dismiss_failed_mail):
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

        # A concluded delivery has left the MTA queue — nothing there to poke.
        self.wait_until(
            lambda: self._get_details(account, result["submission_id"])["status"] in ("delivered", "sent"),
            timeout=90,
            message="The released delivery never concluded.",
        )
        with self.set_user(self.sender.email):
            with self.assertRaises(frappe.ValidationError):
                retry_delivery_now(account, result["submission_id"])

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
            lambda: retry_delivery_now("acc", id={}),
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

        with self.assertRaisesRegex(frappe.ValidationError, "undoStatus must be one of"):
            get_submissions("acc", undo_status="bogus")

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
