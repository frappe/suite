# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

"""The import's server-facing steps, against jmap.testing.FakeJMAPServer."""

import json
import unittest
from unittest import mock

import frappe
import httpx
from jmap import MethodError
from jmap.auth import BasicAuth
from jmap.core.retry import RetryPolicy
from jmap.testing.fake import FakeJMAPServer

from suite.mail.doctype.contacts_exchange.contacts_exchange import ContactsExchange, parse_contact_blobs
from suite.mail.jmap import MailServerUnavailableError, SuiteJMAPClient

CORE = "urn:ietf:params:jmap:core"
CONTACTS = "urn:ietf:params:jmap:contacts"
# Stalwart's extension: ContactCard/parse is only offered where the server advertises it.
CONTACTS_PARSE = "urn:ietf:params:jmap:contacts:parse"
URNS = (CORE, CONTACTS, CONTACTS_PARSE)
ACCOUNT = "f7"
USER = "user@example.test"
EXCHANGE = "CEX-0001"


def _server(core: dict | None = None) -> FakeJMAPServer:
    return FakeJMAPServer(
        capabilities={**{urn: {} for urn in URNS}, CORE: core or {}},
        accounts={
            ACCOUNT: {
                "name": USER,
                "isPersonal": True,
                "accountCapabilities": {CONTACTS: {}, CONTACTS_PARSE: {}},
            }
        },
        primary_accounts=dict.fromkeys(URNS, ACCOUNT),
    )


def _client(server: FakeJMAPServer) -> SuiteJMAPClient:
    http = httpx.Client(auth=BasicAuth(USER, "pw"), **server.client_kwargs())
    return SuiteJMAPClient.connect(
        "https://jmap.example.com/.well-known/jmap",
        auth=BasicAuth(USER, "pw"),
        http=http,
        experimental=True,
        retry_policy=RetryPolicy(max_attempts=1),
    )


class _Import(unittest.TestCase):
    def setUp(self) -> None:
        self.doc = frappe.new_doc("Contacts Exchange")
        self.doc.update({"name": EXCHANGE, "user": USER, "account": ACCOUNT, "operation": "Import"})
        self.logger = mock.Mock()

        # The progress lines land on the document's `output` instead of the database.
        patcher = mock.patch.object(ContactsExchange, "_db_set")
        patcher.start()
        self.addCleanup(patcher.stop)


class MoveToTargetAddressBooks(_Import):
    def move(self, server: FakeJMAPServer, targets: dict[str, dict[str, bool]]) -> None:
        self.doc._move_to_target_address_books(_client(server), targets, self.logger)

    def test_a_card_the_server_refuses_to_move_says_why(self):
        server = _server()
        server.respond(
            "ContactCard/set",
            {
                "updated": {"c1": None},
                "notUpdated": {"c2": {"type": "forbidden", "description": "Address book is read-only."}},
            },
        )

        with self.assertRaises(frappe.ValidationError) as refused:
            self.move(server, {"c1": {"ab-personal": True}, "c2": {"ab-shared": True}})

        self.assertIn("Failed to move 1 contact(s)", str(refused.exception))
        self.assertIn("Address book is read-only.", str(refused.exception))

    def test_a_refusal_without_a_description_is_named_by_its_type(self):
        server = _server()
        server.respond("ContactCard/set", {"notUpdated": {"c1": {"type": "notFound"}}})

        with self.assertRaisesRegex(frappe.ValidationError, "notFound"):
            self.move(server, {"c1": {"ab-personal": True}})

        self.assertNotIn("moved", self.doc.output)

    def test_cards_moved_beside_a_refused_one_are_said_to_stay(self):
        server = _server()
        server.respond(
            "ContactCard/set",
            {
                "updated": {"c1": None, "c2": None},
                "notUpdated": {"c3": {"type": "forbidden", "description": "Address book is read-only."}},
            },
        )

        with self.assertRaises(frappe.ValidationError) as refused:
            self.move(server, {id: {"ab-personal": True} for id in ("c1", "c2", "c3")})

        stays = "2 of 3 contact(s) were already moved into the destination address book(s) and remain there"
        self.assertIn(stays, str(refused.exception))
        self.assertIn(stays, self.doc.output)

    def test_a_move_that_fails_part_way_says_what_was_already_moved(self):
        # Two cards to a set: the first set is applied, the server refuses the second outright.
        server = _server(core={"maxObjectsInSet": 2})

        def move_then_fail(arguments: dict, server: FakeJMAPServer) -> dict:
            server.fail("ContactCard/set", "serverFail", description="out of space")
            return {"updated": dict.fromkeys(arguments["update"])}

        server.handle("ContactCard/set", move_then_fail)

        with self.assertRaises(MethodError):
            self.move(server, {id: {"ab-personal": True} for id in ("c1", "c2", "c3")})

        self.assertIn("2 of 3 contact(s) were already moved", self.doc.output)

    def test_a_failure_of_our_own_part_way_is_not_laid_at_the_mail_servers_door(self):
        server = _server(core={"maxObjectsInSet": 2})
        answered = []

        def move(arguments: dict, server: FakeJMAPServer) -> dict:
            if answered:
                raise KeyError("a bug on this side")
            answered.append(arguments)
            return {"updated": dict.fromkeys(arguments["update"])}

        server.handle("ContactCard/set", move)

        with self.assertRaises(KeyError):
            self.move(server, {id: {"ab-personal": True} for id in ("c1", "c2", "c3")})

        self.assertIn("At least 2 of 3 contact(s) were moved", self.doc.output)
        self.assertNotIn("mail server", self.doc.output)

    def test_a_lost_answer_part_way_leaves_the_rest_in_doubt(self):
        # Two cards to a set: the first set is applied, the second gets no answer.
        server = _server(core={"maxObjectsInSet": 2})
        answered = []

        def move(arguments: dict, server: FakeJMAPServer) -> dict:
            answered.append(arguments)
            return {"updated": dict.fromkeys(arguments["update"])}

        def time_out_after_the_first_set(request: httpx.Request) -> None:
            if b"ContactCard/set" in request.content and answered:
                raise httpx.ReadTimeout("timed out")

        server.handle("ContactCard/set", move)
        server.intercept = time_out_after_the_first_set

        with self.assertRaises(MailServerUnavailableError):
            self.move(server, {id: {"ab-personal": True} for id in ("c1", "c2", "c3")})

        self.assertIn("2 of 3 contact(s) are known to have been moved", self.doc.output)
        self.assertIn("some of the rest may have been moved as well", self.doc.output)
        self.assertNotIn("the rest were not imported", self.doc.output)


class StagingAddressBookCleanup(_Import):
    def events(self) -> list[tuple[str, str]]:
        """(level, event) of every record the cleanup logged."""

        return [(call[0], call.args[0]) for call in self.logger.method_calls]

    def test_a_removed_staging_address_book_is_logged_as_removed(self):
        server = _server()
        server.respond("AddressBook/set", {"destroyed": ["ab-stage"]})

        self.doc._discard_staging_address_book(_client(server), "ab-stage", self.logger)

        self.assertEqual(self.events(), [("info", "import-staging-address-book-removed")])

    def test_a_staging_address_book_the_server_keeps_is_logged_with_the_reason(self):
        server = _server()
        refusal = {"type": "addressBookHasContents", "description": "Address book is not empty."}
        server.respond("AddressBook/set", {"notDestroyed": {"ab-stage": refusal}})

        self.doc._discard_staging_address_book(_client(server), "ab-stage", self.logger)

        self.assertEqual(self.events(), [("warning", "import-staging-address-book-remove-failed")])
        self.assertEqual(self.logger.warning.call_args.kwargs["reason"], "Address book is not empty.")

    def test_a_rollback_the_server_refuses_is_not_logged_as_rolled_back(self):
        server = _server()
        server.respond("AddressBook/set", {"notDestroyed": {"ab-stage": {"type": "forbidden"}}})

        self.doc._rollback_staging_address_book(_client(server), "ab-stage", self.logger)

        self.assertEqual(self.events(), [("error", "import-rollback-failed")])
        self.assertEqual(self.logger.error.call_args.kwargs["reason"], "forbidden")


class ParseContactBlobs(unittest.TestCase):
    """`ContactCard/parse` takes fewer blobs per call than the server says anywhere."""

    def serve_parse(self, server: FakeJMAPServer, most: int) -> None:
        """Makes the server parse up to `most` blobs a call, and refuse a larger call whole."""

        def parse(arguments: dict, server: FakeJMAPServer) -> dict:
            return {
                "parsed": {id: {"@type": "Card", "version": "1.0", "uid": id} for id in arguments["blobIds"]},
                "notFound": [],
                "notParsable": [],
            }

        def refuse_a_large_call(request: httpx.Request) -> httpx.Response | None:
            if b"ContactCard/parse" not in request.content:
                return None
            body = json.loads(request.content)
            _name, arguments, call_id = body["methodCalls"][0]
            if len(arguments["blobIds"]) <= most:
                return None
            server.requests.append(body)
            return httpx.Response(
                200,
                json={
                    "methodResponses": [["error", {"type": "requestTooLarge"}, call_id]],
                    "sessionState": server.session_state,
                },
            )

        server.handle("ContactCard/parse", parse)
        server.intercept = refuse_a_large_call

    def batch_sizes(self, server: FakeJMAPServer) -> list[int]:
        """How many blobs each ContactCard/parse call carried, in the order they were sent."""

        return [
            len(call[1]["blobIds"])
            for request in server.requests
            for call in request["methodCalls"]
            if call[0] == "ContactCard/parse"
        ]

    def test_a_batch_the_server_finds_too_large_is_halved_until_it_fits(self):
        server = _server()
        self.serve_parse(server, most=3)
        blob_ids = [f"B{i}" for i in range(10)]

        result = parse_contact_blobs(_client(server), blob_ids)

        # 10 and 5 are refused; 2 fits, and stays the size for the rest.
        self.assertEqual(self.batch_sizes(server), [10, 5, 2, 2, 2, 2, 2])
        self.assertEqual(list(result["parsed"]), blob_ids)
        self.assertEqual(result["parsed"]["B7"]["uid"], "B7")
        self.assertEqual((result["notFound"], result["notParsable"]), ({}, {}))

    def test_a_batch_that_fits_goes_out_once(self):
        server = _server()
        self.serve_parse(server, most=50)
        blob_ids = [f"B{i}" for i in range(10)]

        result = parse_contact_blobs(_client(server), blob_ids)

        self.assertEqual(self.batch_sizes(server), [10])
        self.assertEqual(list(result["parsed"]), blob_ids)

    def test_blobs_the_server_cannot_read_are_reported_by_id(self):
        server = _server()
        server.respond(
            "ContactCard/parse",
            {
                "parsed": {"B0": {"@type": "Card", "version": "1.0", "uid": "u0"}},
                "notFound": ["B1"],
                "notParsable": ["B2"],
            },
        )

        result = parse_contact_blobs(_client(server), ["B0", "B1", "B2"])

        self.assertEqual(list(result["parsed"]), ["B0"])
        self.assertEqual(list(result["notFound"]), ["B1"])
        self.assertEqual(list(result["notParsable"]), ["B2"])

    def test_a_single_blob_the_server_finds_too_large_is_an_error(self):
        server = _server()
        self.serve_parse(server, most=0)

        with self.assertRaisesRegex(RuntimeError, "requestTooLarge"):
            parse_contact_blobs(_client(server), ["B0", "B1"])

        self.assertEqual(self.batch_sizes(server), [2, 1])

    def test_any_other_refusal_is_an_error_at_once(self):
        server = _server()
        server.fail("ContactCard/parse", "unknownMethod")

        with self.assertRaisesRegex(RuntimeError, "unknownMethod"):
            parse_contact_blobs(_client(server), ["B0", "B1"])

        self.assertEqual(self.batch_sizes(server), [2])
