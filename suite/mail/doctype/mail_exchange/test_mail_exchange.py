# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

"""The import's server-facing steps, against jmap.testing.FakeJMAPServer.

An import stages every email in a throwaway mailbox and then moves it to its destination. What
can be known to fail must be refused before anything is staged, and a move that fails part-way
must say what it left in the account.
"""

import unittest
from datetime import UTC, datetime
from unittest import mock

import frappe
import httpx
from jmap import MethodError
from jmap.auth import BasicAuth
from jmap.core.retry import RetryPolicy
from jmap.testing.fake import FakeJMAPServer

from suite.mail.doctype.mail_exchange.mail_exchange import ImportEmailMeta, MailExchange
from suite.mail.jmap import MailServerUnavailableError, SuiteJMAPClient

CORE = "urn:ietf:params:jmap:core"
MAIL = "urn:ietf:params:jmap:mail"
ACCOUNT = "f7"
USER = "user@example.test"
EXCHANGE = "MEX-0001"
MAILBOXES = ("mb-inbox", "mb-work", "mb-archive")


def _server(core: dict | None = None, mail: dict | None = None) -> FakeJMAPServer:
    """A server whose account holds MAILBOXES; `core` and `mail` are what it advertises."""

    server = FakeJMAPServer(
        capabilities={CORE: core or {}, MAIL: {}},
        accounts={ACCOUNT: {"name": USER, "isPersonal": True, "accountCapabilities": {MAIL: mail or {}}}},
        primary_accounts={CORE: ACCOUNT, MAIL: ACCOUNT},
    )
    server.respond("Mailbox/get", {"state": "m1", "list": [{"id": id} for id in MAILBOXES], "notFound": []})
    return server


def _client(server: FakeJMAPServer) -> SuiteJMAPClient:
    http = httpx.Client(auth=BasicAuth(USER, "pw"), **server.client_kwargs())
    return SuiteJMAPClient.connect(
        "https://jmap.example.com/.well-known/jmap",
        auth=BasicAuth(USER, "pw"),
        http=http,
        experimental=True,
        retry_policy=RetryPolicy(max_attempts=1),
    )


def _email(*mailbox_ids: str) -> ImportEmailMeta:
    return ImportEmailMeta(
        blob_path="blobs/b1",
        mailbox_ids=set(mailbox_ids),
        keywords=set(),
        received_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def _methods(server: FakeJMAPServer) -> list[str]:
    """Every method the server was asked to run, in order."""

    return [call[0] for request in server.requests for call in request["methodCalls"]]


class _Import(unittest.TestCase):
    def setUp(self) -> None:
        self.doc = frappe.new_doc("Mail Exchange")
        self.doc.update({"name": EXCHANGE, "user": USER, "account": ACCOUNT, "operation": "Import"})
        self.logger = mock.Mock()

        # The progress lines land on the document's `output` instead of the database.
        patcher = mock.patch.object(MailExchange, "_db_set")
        patcher.start()
        self.addCleanup(patcher.stop)


class DestinationMailboxes(_Import):
    """`_validate_destination_mailboxes` runs before the staging mailbox is created."""

    def validate(self, server: FakeJMAPServer, *emails: ImportEmailMeta) -> None:
        self.doc._validate_destination_mailboxes(_client(server), list(emails))

    def test_mailboxes_the_account_holds_are_accepted(self):
        server = _server(mail={"maxMailboxesPerEmail": 2})

        self.validate(server, _email("mb-inbox"), _email("mb-inbox", "mb-work"))

    def test_an_unknown_mailbox_is_refused_before_anything_is_staged(self):
        server = _server()

        with self.assertRaisesRegex(frappe.ValidationError, "mb-elsewhere") as refused:
            self.validate(server, _email("mb-inbox"), _email("mb-inbox", "mb-elsewhere"))

        self.assertIn("1 destination mailbox id(s) that do not exist", str(refused.exception))
        # Only read from: no staging mailbox, no import, no move.
        self.assertEqual(_methods(server), ["Mailbox/get"])

    def test_an_email_in_too_many_mailboxes_is_refused_before_anything_is_staged(self):
        server = _server(mail={"maxMailboxesPerEmail": 2})

        with self.assertRaisesRegex(
            frappe.ValidationError, "more folders than this account allows"
        ) as refused:
            self.validate(server, _email("mb-inbox"), _email(*MAILBOXES))

        self.assertIn("1 email(s)", str(refused.exception))
        self.assertIn("(2)", str(refused.exception))
        self.assertEqual(_methods(server), ["Mailbox/get"])

    def test_a_server_that_names_no_limit_takes_any_number_of_mailboxes(self):
        self.validate(_server(), _email(*MAILBOXES))

    def test_an_email_with_no_destination_is_refused(self):
        with self.assertRaisesRegex(frappe.ValidationError, "no destination mailbox"):
            self.validate(_server(), _email())


class MoveToTargetMailboxes(_Import):
    def move(self, server: FakeJMAPServer, imported: dict[str, dict[str, bool]]) -> None:
        self.doc._move_to_target_mailboxes(_client(server), imported, self.logger)

    def lose_the_answer_after(self, server: FakeJMAPServer, sets: int) -> None:
        """Makes the server apply `sets` Email/set calls, then stop answering."""

        answered = []

        def move(arguments: dict, server: FakeJMAPServer) -> dict:
            answered.append(arguments)
            return {"updated": dict.fromkeys(arguments["update"])}

        def time_out(request: httpx.Request) -> None:
            if b"Email/set" in request.content and len(answered) >= sets:
                raise httpx.ReadTimeout("timed out")

        server.handle("Email/set", move)
        server.intercept = time_out

    def test_an_email_the_server_refuses_to_move_says_why(self):
        server = _server()
        server.respond(
            "Email/set",
            {
                "updated": {"e1": None},
                "notUpdated": {"e2": {"type": "invalidProperties", "description": "Mailbox is read-only."}},
            },
        )

        with self.assertRaises(frappe.ValidationError) as refused:
            self.move(server, {"e1": {"mb-inbox": True}, "e2": {"mb-work": True}})

        self.assertIn("Failed to move 1 email(s)", str(refused.exception))
        self.assertIn("Mailbox is read-only.", str(refused.exception))

    def test_a_refusal_without_a_description_is_named_by_its_type(self):
        server = _server()
        server.respond("Email/set", {"notUpdated": {"e1": {"type": "notFound"}}})

        with self.assertRaisesRegex(frappe.ValidationError, "notFound"):
            self.move(server, {"e1": {"mb-inbox": True}})

        self.assertNotIn("moved", self.doc.output)

    def test_emails_moved_beside_a_refused_one_are_said_to_stay(self):
        server = _server()
        server.respond(
            "Email/set",
            {
                "updated": {"e1": None, "e2": None},
                "notUpdated": {"e3": {"type": "invalidProperties", "description": "Mailbox is read-only."}},
            },
        )

        with self.assertRaises(frappe.ValidationError) as refused:
            self.move(server, {id: {"mb-inbox": True} for id in ("e1", "e2", "e3")})

        stays = "2 of 3 email(s) were already moved into the destination folder(s) and remain there"
        self.assertIn(stays, str(refused.exception))
        self.assertIn(stays, self.doc.output)

    def test_a_move_that_fails_part_way_says_what_was_already_moved(self):
        # Two emails to a set: the first set is applied, the server refuses the second outright.
        server = _server(core={"maxObjectsInSet": 2})

        def move_then_fail(arguments: dict, server: FakeJMAPServer) -> dict:
            server.fail("Email/set", "serverFail", description="out of space")
            return {"updated": dict.fromkeys(arguments["update"])}

        server.handle("Email/set", move_then_fail)

        with self.assertRaises(MethodError):
            self.move(server, {id: {"mb-inbox": True} for id in ("e1", "e2", "e3")})

        self.assertIn("2 of 3 email(s) were already moved", self.doc.output)

    def test_a_move_that_fails_at_once_reports_nothing_moved(self):
        server = _server()
        server.fail("Email/set", "serverFail")

        with self.assertRaises(MethodError):
            self.move(server, {"e1": {"mb-inbox": True}})

        self.assertNotIn("already moved", self.doc.output)

    def test_a_failure_of_our_own_part_way_is_not_laid_at_the_mail_servers_door(self):
        server = _server(core={"maxObjectsInSet": 2})
        answered = []

        def move(arguments: dict, server: FakeJMAPServer) -> dict:
            if answered:
                raise KeyError("a bug on this side")
            answered.append(arguments)
            return {"updated": dict.fromkeys(arguments["update"])}

        server.handle("Email/set", move)

        with self.assertRaises(KeyError):
            self.move(server, {id: {"mb-inbox": True} for id in ("e1", "e2", "e3")})

        self.assertIn("At least 2 of 3 email(s) were moved", self.doc.output)
        self.assertNotIn("mail server", self.doc.output)

    def test_a_lost_answer_part_way_leaves_the_rest_in_doubt(self):
        # Two emails to a set: the first set is applied, the second gets no answer.
        server = _server(core={"maxObjectsInSet": 2})
        self.lose_the_answer_after(server, sets=1)

        with self.assertRaises(MailServerUnavailableError):
            self.move(server, {id: {"mb-inbox": True} for id in ("e1", "e2", "e3")})

        self.assertIn("2 of 3 email(s) are known to have been moved", self.doc.output)
        self.assertIn("some of the rest may have been moved as well", self.doc.output)
        self.assertNotIn("the rest were not imported", self.doc.output)

    def test_a_lost_answer_at_once_leaves_every_email_in_doubt(self):
        server = _server()
        self.lose_the_answer_after(server, sets=0)

        with self.assertRaises(MailServerUnavailableError):
            self.move(server, {"e1": {"mb-inbox": True}})

        self.assertIn("0 of 1 email(s) are known to have been moved", self.doc.output)
        self.assertIn("some of the rest may have been moved as well", self.doc.output)

    def test_a_set_the_server_only_partly_made_leaves_the_rest_in_doubt(self):
        server = _server()
        server.fail("Email/set", "serverPartialFail")

        with self.assertRaises(MethodError):
            self.move(server, {"e1": {"mb-inbox": True}, "e2": {"mb-work": True}})

        self.assertIn("some of the rest may have been moved as well", self.doc.output)


class StagingMailboxCleanup(_Import):
    def events(self) -> list[tuple[str, str]]:
        """(level, event) of every record the cleanup logged."""

        return [(call[0], call.args[0]) for call in self.logger.method_calls]

    def test_a_removed_staging_mailbox_is_logged_as_removed(self):
        server = _server()
        server.respond("Mailbox/set", {"destroyed": ["mb-stage"]})

        self.doc._discard_staging_mailbox(_client(server), "mb-stage", self.logger)

        self.assertEqual(self.events(), [("info", "import-staging-mailbox-removed")])

    def test_a_staging_mailbox_the_server_keeps_is_logged_with_the_reason(self):
        server = _server()
        server.respond(
            "Mailbox/set",
            {
                "notDestroyed": {
                    "mb-stage": {"type": "mailboxHasEmail", "description": "Mailbox is not empty."}
                }
            },
        )

        self.doc._discard_staging_mailbox(_client(server), "mb-stage", self.logger)

        self.assertEqual(self.events(), [("warning", "import-staging-mailbox-remove-failed")])
        self.assertEqual(self.logger.warning.call_args.kwargs["reason"], "Mailbox is not empty.")

    def test_a_rollback_the_server_refuses_is_not_logged_as_rolled_back(self):
        server = _server()
        server.respond("Mailbox/set", {"notDestroyed": {"mb-stage": {"type": "forbidden"}}})

        self.doc._rollback_staging_mailbox(_client(server), "mb-stage", self.logger)

        self.assertEqual(self.events(), [("error", "import-rollback-failed")])
        self.assertEqual(self.logger.error.call_args.kwargs["reason"], "forbidden")
