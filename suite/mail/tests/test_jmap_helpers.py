# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""The bulk, blob and capability helpers of suite.mail.jmap, against jmap.testing.FakeJMAPServer."""

import threading
import unittest

import frappe
from jmap import MethodError
from jmap.testing.fake import FakeJMAPServer

from suite.mail.jmap import (
    account_view,
    check_delayed_send,
    chunked_set,
    download_blobs,
    get_across_accounts,
    get_email_state,
    get_max_delayed_send,
    upload_blobs,
)
from suite.mail.tests.test_jmap_client import API, CORE, PERSONAL, SHARED, _client, _server, _watch

SUBMISSION = "urn:ietf:params:jmap:submission"
REFUSED = {"type": "forbidden"}


def _apply_set(arguments: dict, _server: FakeJMAPServer) -> dict:
    """Answers a /set: an object whose key starts with "bad" is refused, any other is applied."""

    def keys(argument: str, refused: bool) -> list[str]:
        return [key for key in arguments.get(argument) or [] if key.startswith("bad") is refused]

    return {
        "oldState": "s1",
        "newState": "s2",
        "created": {key: {"id": f"id-{key}"} for key in keys("create", False)},
        "updated": dict.fromkeys(keys("update", False)),
        "destroyed": keys("destroy", False),
        "notCreated": dict.fromkeys(keys("create", True), REFUSED),
        "notUpdated": dict.fromkeys(keys("update", True), REFUSED),
        "notDestroyed": dict.fromkeys(keys("destroy", True), REFUSED),
    }


def _sent(server: FakeJMAPServer, argument: str) -> list:
    """What each request carried under `argument` of its only call."""

    return [request["methodCalls"][0][1][argument] for request in server.requests]


class ChunkedSet(unittest.TestCase):
    """chunked_set sends a /set chunk by chunk and merges what the server did with each."""

    def setUp(self):
        self.server = _server()
        self.server.handle("Mailbox/set", _apply_set)

    def test_five_objects_in_chunks_of_two_go_out_as_three_requests(self):
        client = _client(self.server)

        result = chunked_set(
            client, lambda b, chunk: b.mail.mailbox.set(destroy=chunk), ["m1", "m2", "m3", "m4", "m5"], 2
        )

        self.assertEqual(_sent(self.server, "destroy"), [["m1", "m2"], ["m3", "m4"], ["m5"]])
        self.assertEqual(result.destroyed, ["m1", "m2", "m3", "m4", "m5"])

    def test_without_a_chunk_size_the_servers_max_objects_in_set_is_the_chunk(self):
        self.server.capabilities[CORE] = {"maxObjectsInSet": 2}
        client = _client(self.server)

        chunked_set(client, lambda b, chunk: b.mail.mailbox.set(destroy=chunk), ["m1", "m2", "m3"])

        self.assertEqual(_sent(self.server, "destroy"), [["m1", "m2"], ["m3"]])

    def test_what_every_chunk_created_and_failed_to_create_is_merged(self):
        client = _client(self.server)
        mailboxes = {key: {"name": key} for key in ("c1", "bad2", "c3", "c4", "bad5")}

        result = chunked_set(client, lambda b, chunk: b.mail.mailbox.set(create=chunk), mailboxes, 2)

        self.assertEqual(
            [list(chunk) for chunk in _sent(self.server, "create")], [["c1", "bad2"], ["c3", "c4"], ["bad5"]]
        )
        self.assertEqual(
            {key: mailbox.id for key, mailbox in result.created.items()},
            {"c1": "id-c1", "c3": "id-c3", "c4": "id-c4"},
        )
        self.assertEqual(result.not_created, {"bad2": REFUSED, "bad5": REFUSED})

    def test_what_every_chunk_updated_and_failed_to_update_is_merged(self):
        client = _client(self.server)
        patches = {key: {"name": "renamed"} for key in ("m1", "m2", "bad3", "m4", "m5")}

        result = chunked_set(client, lambda b, chunk: b.mail.mailbox.set(update=chunk), patches, 2)

        self.assertEqual(result.updated, {"m1": None, "m2": None, "m4": None, "m5": None})
        self.assertEqual(result.not_updated, {"bad3": REFUSED})

    def test_what_every_chunk_destroyed_and_failed_to_destroy_is_merged(self):
        client = _client(self.server)

        result = chunked_set(
            client, lambda b, chunk: b.mail.mailbox.set(destroy=chunk), ["bad1", "m2", "m3", "bad4", "m5"], 2
        )

        self.assertEqual(result.destroyed, ["m2", "m3", "m5"])
        self.assertEqual(result.not_destroyed, {"bad1": REFUSED, "bad4": REFUSED})

    def test_a_refused_middle_chunk_stops_the_run_and_reports_what_the_first_one_did(self):
        def apply_then_refuse_the_next(arguments: dict, server: FakeJMAPServer) -> dict:
            server.fail("Mailbox/set", "serverFail")
            return _apply_set(arguments, server)

        self.server.handle("Mailbox/set", apply_then_refuse_the_next)
        client = _client(self.server)

        with self.assertRaises(MethodError) as raised:
            chunked_set(
                client,
                lambda b, chunk: b.mail.mailbox.set(destroy=chunk),
                ["m1", "bad2", "m3", "m4", "m5"],
                2,
            )

        self.assertEqual(raised.exception.type, "serverFail")
        self.assertEqual(_sent(self.server, "destroy"), [["m1", "bad2"], ["m3", "m4"]])
        applied = raised.exception.applied
        self.assertEqual(applied.destroyed, ["m1"])
        self.assertEqual(applied.not_destroyed, {"bad2": REFUSED})
        self.assertEqual((applied.created, applied.updated), ({}, {}))


class Blobs(unittest.TestCase):
    """upload_blobs and download_blobs move several blobs at once."""

    def setUp(self):
        self.server = _server()
        self.client = _client(self.server)
        self.threads: list[int] = []
        self.server.intercept = lambda request: self.threads.append(threading.get_ident())

    def test_uploads_come_back_in_input_order_whatever_order_they_finish_in(self):
        # The fake numbers blobs as they arrive: the first blob is held until the last is stored.
        store, storing, last_stored = self.server.store_blob, threading.Lock(), threading.Event()

        def store_first_blob_last(content: bytes, content_type: str) -> str:
            if content == b"first":
                last_stored.wait(timeout=5)
            with storing:
                blob_id = store(content, content_type)
            if content == b"third":
                last_stored.set()
            return blob_id

        self.server.store_blob = store_first_blob_last
        blobs = [(b"first", "text/plain"), (b"second", "image/png"), (b"third", None)]

        results = upload_blobs(self.client, blobs)

        stored = [self.server.blobs[result.blob_id] for result in results]
        self.assertEqual(
            stored,
            [(b"first", "text/plain"), (b"second", "image/png"), (b"third", "application/octet-stream")],
        )
        self.assertEqual([result.size for result in results], [5, 6, 5])
        self.assertGreater(results[0].blob_id, results[2].blob_id)

    def test_uploads_go_to_the_named_account_else_to_the_clients_own(self):
        http = _watch(self.server)

        upload_blobs(self.client, [(b"a", None), (b"b", None)])
        upload_blobs(self.client, [(b"c", None), (b"d", None)], account_id=SHARED)

        self.assertEqual(
            http, [("POST", f"/jmap/upload/{PERSONAL}/")] * 2 + [("POST", f"/jmap/upload/{SHARED}/")] * 2
        )

    def test_a_single_upload_is_made_on_the_callers_thread(self):
        results = upload_blobs(self.client, [(b"only", "text/plain")])

        self.assertEqual(self.server.blobs[results[0].blob_id], (b"only", "text/plain"))
        self.assertEqual(self.threads, [threading.get_ident()])

    def test_no_blobs_to_upload_makes_no_request(self):
        self.assertEqual(upload_blobs(self.client, []), [])
        self.assertEqual(self.threads, [])

    def test_downloads_come_back_keyed_by_blob_id(self):
        report, photo = self.server.store_blob(b"report"), self.server.store_blob(b"photo")
        http = _watch(self.server)

        contents = download_blobs(self.client, [(report, "report.pdf"), (photo, None)])

        self.assertEqual(contents, {report: b"report", photo: b"photo"})
        self.assertCountEqual(
            http,
            [
                ("GET", f"/jmap/download/{PERSONAL}/{report}/report.pdf"),
                ("GET", f"/jmap/download/{PERSONAL}/{photo}/blob"),
            ],
        )

    def test_a_single_download_is_made_on_the_callers_thread(self):
        report = self.server.store_blob(b"report")

        contents = download_blobs(self.client, [(report, "report.pdf")], account_id=SHARED)

        self.assertEqual(contents, {report: b"report"})
        self.assertEqual(self.threads, [threading.get_ident()])


class DelayedSend(unittest.TestCase):
    """How long the server holds a submission, and what a Send At past that is told."""

    def max_delayed_send(self, submission: dict, account: str = PERSONAL) -> int:
        server = _server()
        server.capabilities[SUBMISSION] = {}
        server.accounts[account]["accountCapabilities"][SUBMISSION] = submission
        return get_max_delayed_send(_client(server), account)

    def test_a_server_that_cannot_hold_a_submission_allows_no_delay(self):
        self.assertEqual(self.max_delayed_send({"maxDelayedSend": 0}), 0)

    def test_the_advertised_limit_is_the_limit(self):
        self.assertEqual(self.max_delayed_send({"maxDelayedSend": 86_400}), 86_400)

    def test_a_server_that_does_not_say_allows_thirty_days(self):
        self.assertEqual(self.max_delayed_send({}), 30 * 24 * 60 * 60)

    def test_the_limit_is_the_one_of_the_account_asked_about(self):
        self.assertEqual(self.max_delayed_send({"maxDelayedSend": 3_600}, account=SHARED), 3_600)

    def test_a_delay_up_to_the_limit_passes(self):
        check_delayed_send(0, 0)
        check_delayed_send(3_599, 3_600)
        check_delayed_send(3_600, 3_600)

    def test_any_delay_is_refused_when_the_server_cannot_hold_a_submission(self):
        with self.assertRaisesRegex(frappe.ValidationError, "doesn't support scheduled sending"):
            check_delayed_send(60, 0)

    def test_a_delay_past_the_limit_is_told_the_limit_in_the_largest_unit_that_says_it_exactly(self):
        limits = {
            30 * 24 * 60 * 60: "30 days",
            24 * 60 * 60: "1 day",
            25 * 60 * 60: "25 hours",
            6 * 60 * 60: "6 hours",
            60 * 60: "1 hour",
            90 * 60: "90 minutes",
            45 * 60: "45 minutes",
            30: "30 seconds",
        }
        for limit, spoken in limits.items():
            with (
                self.subTest(spoken),
                self.assertRaisesRegex(frappe.ValidationError, f"cannot be more than {spoken} in the future"),
            ):
                check_delayed_send(limit + 1, limit)


class AcrossAccounts(unittest.TestCase):
    """get_across_accounts reads several accounts in one request."""

    def setUp(self):
        self.server = _server()
        self.server.handle("Mailbox/get", self.inbox_of_the_account)
        self.client = _client(self.server)
        self.http = _watch(self.server)

    @staticmethod
    def inbox_of_the_account(arguments: dict, _server: FakeJMAPServer) -> dict:
        inbox = {"id": f"inbox-of-{arguments['accountId']}", "name": "Inbox"}
        return {"accountId": arguments["accountId"], "state": "m1", "list": [inbox], "notFound": []}

    def mailboxes_across(self, accounts: list[str]) -> dict:
        return get_across_accounts(
            self.client, accounts, lambda b, account: b.mail.mailbox.get(accountId=account)
        )

    def test_several_accounts_cost_one_request_with_a_call_addressed_to_each(self):
        mailboxes = self.mailboxes_across([PERSONAL, SHARED])

        self.assertEqual(self.http, [API])
        calls = self.server.requests[0]["methodCalls"]
        self.assertEqual(
            [(name, arguments["accountId"]) for name, arguments, _ in calls],
            [("Mailbox/get", PERSONAL), ("Mailbox/get", SHARED)],
        )
        self.assertEqual(
            {account: [m["id"] for m in items] for account, items in mailboxes.items()},
            {PERSONAL: [f"inbox-of-{PERSONAL}"], SHARED: [f"inbox-of-{SHARED}"]},
        )

    def test_an_account_whose_call_the_server_refuses_reads_as_none(self):
        def answer_then_refuse_the_next(arguments: dict, server: FakeJMAPServer) -> dict:
            server.fail("Mailbox/get", "accountNotFound")
            return self.inbox_of_the_account(arguments, server)

        self.server.handle("Mailbox/get", answer_then_refuse_the_next)

        mailboxes = self.mailboxes_across([PERSONAL, SHARED])

        self.assertEqual([m["id"] for m in mailboxes[PERSONAL]], [f"inbox-of-{PERSONAL}"])
        self.assertIsNone(mailboxes[SHARED])
        self.assertEqual(self.server.requests[0]["methodCalls"][1][1]["accountId"], SHARED)


class EmailState(unittest.TestCase):
    """get_email_state reads the Email state without reading any email."""

    def test_the_state_comes_from_a_get_of_no_ids_for_the_clients_account(self):
        server = _server()
        server.respond("Email/get", {"state": "e42", "list": [], "notFound": []})
        shared = account_view(_client(server), SHARED)

        self.assertEqual(get_email_state(shared), "e42")
        name, arguments, _ = server.requests[-1]["methodCalls"][0]
        self.assertEqual((name, arguments["accountId"], arguments["ids"]), ("Email/get", SHARED, []))

    def test_a_refused_call_yields_no_state(self):
        server = _server()
        server.fail("Email/get", "accountNotFound")

        self.assertIsNone(get_email_state(_client(server)))
