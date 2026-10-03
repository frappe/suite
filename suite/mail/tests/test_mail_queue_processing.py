# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""What a Mail Queue row records when drafting or submitting it does not go through.

The pending-mail worker retries only rows marked failed with a retry time, so a refusal the row
does not record that way is a mail that is never sent - and a call that may have been applied,
or a request that got no answer, recorded that way, is a mail sent twice.
"""

import json
import unittest
from unittest import mock

import frappe
import httpx
from jmap.auth import BasicAuth
from jmap.core.retry import RetryPolicy
from jmap.testing.fake import FakeJMAPServer

from suite.mail.doctype.mail_queue import mail_queue
from suite.mail.jmap import SuiteHTTPClient, SuiteJMAPClient

CORE = "urn:ietf:params:jmap:core"
MAIL = "urn:ietf:params:jmap:mail"
SUBMISSION = "urn:ietf:params:jmap:submission"
URNS = (CORE, MAIL, SUBMISSION)
ACCOUNT = "f7"
USER = "user@example.test"
QUEUE = "q1"
DRAFTED = {"created": {f"draft-{QUEUE}": {"id": "e1", "blobId": "B1", "threadId": "t1", "size": 42}}}
SUBMITTED = {"created": {f"submit-{QUEUE}": {"id": "s1"}}}


def _server() -> FakeJMAPServer:
    return FakeJMAPServer(
        capabilities={urn: {} for urn in URNS},
        accounts={
            ACCOUNT: {"name": USER, "isPersonal": True, "accountCapabilities": {urn: {} for urn in URNS}}
        },
        primary_accounts=dict.fromkeys(URNS, ACCOUNT),
    )


def _client(server: FakeJMAPServer) -> SuiteJMAPClient:
    http = SuiteHTTPClient(auth=BasicAuth(USER, "pw"), **server.client_kwargs())
    return SuiteJMAPClient.connect(
        "https://jmap.example.com/.well-known/jmap",
        auth=BasicAuth(USER, "pw"),
        http=http,
        experimental=True,
        retry_policy=RetryPolicy(max_attempts=1),
    )


class _Processing(unittest.TestCase):
    def setUp(self) -> None:
        self.server = _server()
        mailboxes = {"drafts": "mb-drafts", "sent": "mb-sent"}
        for patcher in (
            mock.patch.object(mail_queue, "get_account_client", return_value=_client(self.server)),
            mock.patch.object(
                mail_queue, "get_mailbox_id_by_role", side_effect=lambda a, role, **kw: mailboxes[role]
            ),
            mock.patch.object(mail_queue, "get_identity_id_by_email", return_value="i1"),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

        # The outcome lands on the document instead of the database.
        self.addCleanup(frappe.flags.update, {"read_only": frappe.flags.read_only})
        frappe.flags.read_only = True

    def process(self, **fields) -> mail_queue.MailQueue:
        doc = frappe.new_doc("Mail Queue")
        doc.update(
            {
                "name": QUEUE,
                "account": ACCOUNT,
                "user": USER,
                "from_email": USER,
                "subject": "Hello",
                "text_body": "Hello there",
                "recipients": json.dumps([{"type": "To", "email": "rcpt@example.test"}]),
                **fields,
            }
        )
        doc._process()
        return doc

    def assert_retried(self, doc: mail_queue.MailQueue, status: str) -> None:
        self.assertEqual(doc.status, status)
        self.assertEqual(doc.retries, 1)
        self.assertTrue(doc.next_retry_after)

    def submissions_sent(self) -> int:
        return sum(
            call[0] == "EmailSubmission/set"
            for request in self.server.requests
            for call in request["methodCalls"]
        )


class RefusedMail(_Processing):
    def test_a_submission_the_server_refuses_outright_is_retried(self):
        self.server.respond("Email/set", DRAFTED)
        self.server.fail("EmailSubmission/set", "serverFail", description="try again later")

        doc = self.process()

        self.assert_retried(doc, "Failed to Submit")
        # The draft exists, and the retry replaces it rather than leaving a second copy.
        self.assertEqual(doc.id, "e1")
        self.assertEqual(doc.error_message, "serverFail: try again later")

    def test_a_draft_the_server_refuses_outright_is_retried(self):
        self.server.fail("Email/set", "accountReadOnly")

        doc = self.process(save_as_draft=1)

        self.assert_retried(doc, "Failed to Draft")
        self.assertEqual(doc.error_message, "accountReadOnly")

    def test_a_refused_object_says_why_even_without_a_description(self):
        refusal = {"type": "invalidProperties", "properties": ["to"]}
        self.server.respond("Email/set", {"notCreated": {f"draft-{QUEUE}": refusal}})

        doc = self.process(save_as_draft=1)

        self.assert_retried(doc, "Failed to Draft")
        self.assertEqual(doc.error_message, "invalidProperties (to)")

    def test_a_refused_draft_stays_the_cause_when_its_submission_fails_with_it(self):
        refusal = {"type": "tooLarge", "description": "The message is too large."}
        self.server.respond("Email/set", {"notCreated": {f"draft-{QUEUE}": refusal}})
        # The submission names a draft that was never created, so the server refuses it too.
        self.server.respond(
            "EmailSubmission/set",
            {"notCreated": {f"submit-{QUEUE}": {"type": "invalidProperties", "properties": ["emailId"]}}},
        )

        doc = self.process()

        self.assert_retried(doc, "Failed to Draft")
        self.assertEqual(doc.error_message, "tooLarge: The message is too large.")

    def test_a_mail_the_server_takes_is_submitted(self):
        self.server.respond("Email/set", DRAFTED)
        self.server.respond("EmailSubmission/set", SUBMITTED)

        doc = self.process()

        self.assertEqual((doc.status, doc.submission_id, doc.id), ("Submitted", "s1", "e1"))
        self.assertFalse(doc.retries)


class MaybeAppliedMail(_Processing):
    """An error after which the submission may have happened all the same: sending it again
    could send the mail twice, so the row waits for a person instead of the retry worker."""

    def process_a_mail_already_retried_once(self) -> mail_queue.MailQueue:
        return self.process(retries=1, next_retry_after="2026-01-01 00:00:00")

    def assert_left_for_a_person(self, doc: mail_queue.MailQueue) -> None:
        self.assertEqual(doc.status, "Failed")
        # Neither a retry of its own nor the one an earlier attempt had scheduled.
        self.assertIsNone(doc.next_retry_after)
        self.assertEqual(doc.retries, 1)
        self.assertEqual(self.submissions_sent(), 1)

    def test_a_partial_failure_is_not_sent_again(self):
        self.server.respond("Email/set", DRAFTED)
        self.server.fail("EmailSubmission/set", "serverPartialFail", description="some of it happened")

        doc = self.process_a_mail_already_retried_once()

        self.assert_left_for_a_person(doc)
        self.assertEqual(doc.error_message, "serverPartialFail: some of it happened")

    def test_an_answer_that_cannot_be_read_is_not_sent_again(self):
        self.server.respond("Email/set", DRAFTED)
        self.server.respond("EmailSubmission/set", {"created": "not a map of created objects"})

        doc = self.process_a_mail_already_retried_once()

        self.assert_left_for_a_person(doc)
        self.assertIn("malformedResult", doc.error_message)

    def test_a_call_the_server_left_unanswered_is_not_sent_again(self):
        def answer_the_draft_only(request: httpx.Request) -> httpx.Response | None:
            if b"EmailSubmission/set" not in request.content:
                return None
            body = json.loads(request.content)
            self.server.requests.append(body)
            call_id = next(call[2] for call in body["methodCalls"] if call[0] == "Email/set")
            return httpx.Response(
                200,
                json={
                    "methodResponses": [["Email/set", {"accountId": ACCOUNT, **DRAFTED}, call_id]],
                    "sessionState": self.server.session_state,
                },
            )

        self.server.intercept = answer_the_draft_only

        doc = self.process_a_mail_already_retried_once()

        self.assert_left_for_a_person(doc)
        self.assertIn("missingResponse", doc.error_message)

    def test_a_submission_the_server_confirms_is_sent_whatever_became_of_the_drafts_answer(self):
        self.server.respond("Email/set", {"created": "not a map of created objects"})
        self.server.respond("EmailSubmission/set", SUBMITTED)

        doc = self.process()

        self.assertEqual((doc.status, doc.submission_id), ("Submitted", "s1"))
        self.assertFalse(doc.retries)
        self.assertFalse(doc.next_retry_after)


class AnsweredMail(_Processing):
    """The server answered: what is made of the answer here does not change what it says."""

    def test_a_draft_answered_without_its_server_set_properties_is_still_submitted(self):
        self.server.respond("Email/set", {"created": {f"draft-{QUEUE}": {"id": "e1"}}})
        self.server.respond("EmailSubmission/set", SUBMITTED)

        doc = self.process()

        self.assertEqual((doc.status, doc.submission_id, doc.id), ("Submitted", "s1", "e1"))
        self.assertIsNone(doc.size)
        self.assertFalse(doc.error_log)

    def test_a_confirmed_submission_is_sent_though_working_through_the_answer_fails(self):
        self.server.respond("Email/set", DRAFTED)
        self.server.respond("EmailSubmission/set", SUBMITTED)

        with (
            mock.patch.object(mail_queue, "now", side_effect=[RuntimeError("clock"), "2026-10-02 10:00:00"]),
            mock.patch.object(mail_queue, "log_mail_error") as logged,
        ):
            doc = self.process(retries=1, next_retry_after="2026-01-01 00:00:00")

        self.assertEqual((doc.status, doc.submission_id), ("Submitted", "s1"))
        self.assertIsNone(doc.next_retry_after)
        self.assertEqual(doc.retries, 1)
        self.assertIn("clock", doc.error_log)
        logged.assert_called_once()

    def test_an_answer_that_confirms_no_submission_and_cannot_be_worked_through_is_not_sent_again(self):
        self.server.respond("Email/set", DRAFTED)
        self.server.fail("EmailSubmission/set", "serverFail", description="try again later")

        with (
            mock.patch.object(mail_queue, "now", side_effect=RuntimeError("clock")),
            mock.patch.object(mail_queue, "log_mail_error"),
        ):
            doc = self.process(retries=1, next_retry_after="2026-01-01 00:00:00")

        self.assertEqual(doc.status, "Failed")
        self.assertIsNone(doc.next_retry_after)
        self.assertEqual(doc.retries, 1)
        self.assertIn("could not be processed", doc.error_message)
        # Not the server failing to confirm: it answered.
        self.assertNotIn("did not confirm", doc.error_message)


class UnansweredMail(_Processing):
    """A request that fails as a whole says nothing of the mail it carried. Unless the failure
    proves the request did nothing, the mail may be sent - and is not sent a second time."""

    EARLIER_ANSWER = json.dumps({"submit": {"error": {"type": "serverFail", "description": "earlier"}}})

    def setUp(self) -> None:
        super().setUp()
        self.server.respond("Email/set", DRAFTED)
        self.server.respond("EmailSubmission/set", SUBMITTED)
        self.sends = 0

    def fail_the_send_with(self, failure: Exception | httpx.Response) -> None:
        """The request carrying the mail fails; every other request is answered."""

        def intercept(request: httpx.Request) -> httpx.Response | None:
            if b"Email/set" not in request.content:
                return None
            self.sends += 1
            if isinstance(failure, Exception):
                raise failure
            return failure

        self.server.intercept = intercept

    def process_a_mail_already_retried_once(self, **fields) -> mail_queue.MailQueue:
        return self.process(
            retries=1, next_retry_after="2026-01-01 00:00:00", _response=self.EARLIER_ANSWER, **fields
        )

    def test_a_send_that_may_have_reached_the_server_is_not_sent_again(self):
        failures = {
            "no answer in time": httpx.ReadTimeout("timed out"),
            "connection dropped": httpx.RemoteProtocolError("server disconnected"),
            "bad gateway": httpx.Response(502),
            "service unavailable": httpx.Response(503),
            "gateway timeout": httpx.Response(504),
            "server error": httpx.Response(500),
        }
        for name, failure in failures.items():
            with self.subTest(name):
                self.sends = 0
                self.fail_the_send_with(failure)

                doc = self.process_a_mail_already_retried_once()

                self.assertEqual(doc.status, "Failed")
                self.assertIsNone(doc.next_retry_after)
                self.assertEqual(doc.retries, 1)
                self.assertEqual(self.sends, 1)
                # What the row says is about this attempt, not the one before it.
                self.assertIn("may have been saved or sent", doc.error_message)
                self.assertTrue(doc.error_log)

    def test_a_send_that_cannot_have_reached_the_server_is_retried(self):
        failures = {
            "connection refused": httpx.ConnectError("connection refused"),
            "connection timed out": httpx.ConnectTimeout("timed out"),
            "proxy refused the tunnel": httpx.ProxyError("403 Forbidden"),
            "rate limited": httpx.Response(429),
        }
        for name, failure in failures.items():
            with self.subTest(name):
                self.fail_the_send_with(failure)

                doc = self.process(_response=self.EARLIER_ANSWER)

                self.assert_retried(doc, "Failed")
                self.assertIsNone(doc.error_message)

    def test_a_failure_before_the_send_is_retried(self):
        # The message is uploaded first; the request carrying the mail never goes out.
        failures = {
            "no answer in time": httpx.ReadTimeout("timed out"),
            "bad gateway": httpx.Response(502),
        }
        for name, failure in failures.items():
            with self.subTest(name):

                def fail_the_upload(request: httpx.Request, failure=failure) -> httpx.Response:
                    if "/upload/" not in request.url.path:
                        return None
                    if isinstance(failure, Exception):
                        raise failure
                    return failure

                self.server.intercept = fail_the_upload

                doc = self.process(
                    raw_message="Subject: Hello\r\n\r\nHello there", _response=self.EARLIER_ANSWER
                )

                self.assert_retried(doc, "Failed")
                self.assertIsNone(doc.error_message)
                self.assertEqual(self.server.requests, [])


class SentMail(_Processing):
    def test_a_session_refresh_that_fails_afterwards_does_not_undo_it(self):
        self.server.respond("Email/set", DRAFTED)
        self.server.respond("EmailSubmission/set", SUBMITTED)
        # The answer announces a session change, and fetching the new session fails.
        self.server.session_state = "changed"

        def refuse_the_session(request: httpx.Request) -> httpx.Response | None:
            if request.method == "GET":
                raise httpx.ConnectError("connection refused")

        self.server.intercept = refuse_the_session

        with mock.patch("suite.mail.jmap.log_mail_error") as logged:
            doc = self.process()

        self.assertEqual((doc.status, doc.submission_id), ("Submitted", "s1"))
        self.assertFalse(doc.retries)
        logged.assert_called_once()
