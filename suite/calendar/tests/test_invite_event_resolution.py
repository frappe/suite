# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Which calendar event an invite attachment resolves to.

The thread view shows, and the reader answers, the first event in the file. Whatever else the
file carries and however the server's search index lags, adding the invite must hand back that
event's id - the RSVP is recorded on it.
"""

import unittest
from unittest import mock

import frappe
import httpx
from jmap.auth import BasicAuth
from jmap.core.retry import RetryPolicy
from jmap.testing.fake import FakeJMAPServer

from suite.calendar.api import invites
from suite.mail.jmap import SuiteJMAPClient

CORE = "urn:ietf:params:jmap:core"
CALENDARS = "urn:ietf:params:jmap:calendars"
URNS = (CORE, CALENDARS)
ACCOUNT = "f7"
USER = "user@example.test"
DUPLICATE = {"type": "invalidProperties", "description": "An event with this uid already exists."}

INVITE = {"uid": "uid-invite", "title": "Review", "start": "2026-10-05T09:00:00", "duration": "PT1H"}
OTHER = {"uid": "uid-other", "title": "Lunch", "start": "2026-10-06T12:00:00", "duration": "PT1H"}
UIDS = {"id-invite": "uid-invite", "id-other": "uid-other"}


def _client(server: FakeJMAPServer) -> SuiteJMAPClient:
    http = httpx.Client(auth=BasicAuth(USER, "pw"), **server.client_kwargs())
    return SuiteJMAPClient.connect(
        "https://jmap.example.com/.well-known/jmap",
        auth=BasicAuth(USER, "pw"),
        http=http,
        experimental=True,
        retry_policy=RetryPolicy(max_attempts=1),
    )


class InviteEventResolution(unittest.TestCase):
    def setUp(self) -> None:
        self.server = FakeJMAPServer(
            capabilities={urn: {} for urn in URNS},
            accounts={
                ACCOUNT: {"name": USER, "isPersonal": True, "accountCapabilities": {urn: {} for urn in URNS}}
            },
            primary_accounts=dict.fromkeys(URNS, ACCOUNT),
        )
        self.server.handle(
            "CalendarEvent/get",
            lambda args, _server: {
                "state": "s1",
                "list": [{"id": id, "uid": UIDS[id]} for id in args["ids"]],
                "notFound": [],
            },
        )
        self.client = _client(self.server)

        for patcher in (
            mock.patch.object(invites, "get_default_calendar_id", return_value="cal-1"),
            mock.patch.object(invites.time, "sleep"),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

        # Refusals of events other than the invite's are logged, not raised.
        patcher = mock.patch.object(invites, "log_error")
        self.logged = patcher.start()
        self.addCleanup(patcher.stop)

    def searchable(self, *answers: list[str]) -> None:
        """What the uid lookup finds, one answer per query; the last one stands from then on."""

        remaining = list(answers)

        def answer(_args, _server) -> dict:
            ids = remaining.pop(0) if len(remaining) > 1 else remaining[0]
            return {"ids": ids, "total": len(ids), "queryState": "q1", "position": 0}

        self.server.handle("CalendarEvent/query", answer)

    def created(self, **ids_by_uid: str) -> None:
        """The server creates the events named (by uid, underscores for dashes), each once, and
        refuses the rest: a uid it was not told to take, and a second event under one it took."""

        wanted = {uid.replace("_", "-"): id for uid, id in ids_by_uid.items()}

        def answer(args, _server) -> dict:
            created, refused, taken = {}, {}, set()
            for creation_id, event in args["create"].items():
                if event["uid"] in wanted and event["uid"] not in taken:
                    created[creation_id] = {"id": wanted[event["uid"]]}
                    taken.add(event["uid"])
                else:
                    refused[creation_id] = DUPLICATE
            return {"created": created, "notCreated": refused}

        self.server.handle("CalendarEvent/set", answer)

    def ensure(self, *events: dict) -> str:
        return invites._ensure_on_calendar(self.client, ACCOUNT, list(events))

    def test_a_new_invite_resolves_to_the_event_it_created(self):
        self.searchable([])
        self.created(uid_invite="id-invite")

        self.assertEqual(self.ensure(INVITE), "id-invite")

    def test_an_invite_already_on_the_calendar_wins_over_another_event_just_created(self):
        self.searchable(["id-invite"])
        self.created(uid_other="id-other")

        self.assertEqual(self.ensure(INVITE, OTHER), "id-invite")

    def test_a_repeated_add_waits_for_the_invites_own_event_to_become_searchable(self):
        # Both were added a moment ago, so the index knows neither and the server refuses both as
        # duplicates; the other event then becomes searchable before the invite's does.
        self.searchable([], ["id-other"], ["id-invite", "id-other"])
        self.created()

        self.assertEqual(self.ensure(INVITE, OTHER), "id-invite")

    def test_another_event_being_refused_does_not_keep_the_reader_from_the_invite(self):
        # The invite's own event is on the calendar; the file's other event is refused for good.
        self.searchable(["id-invite"])
        self.created()

        self.assertEqual(self.ensure(INVITE, OTHER), "id-invite")

        # Left out, not silently: the refusal is on record with the server's reason.
        self.assertIn(DUPLICATE["description"], self.logged.call_args.kwargs["message"])

    def test_an_invite_just_created_is_returned_though_another_event_was_refused(self):
        self.searchable([])
        self.created(uid_invite="id-invite")

        self.assertEqual(self.ensure(INVITE, OTHER), "id-invite")

    def test_a_refusal_that_is_no_duplicate_fails_with_the_servers_reason(self):
        self.searchable([])
        self.created()

        with (
            mock.patch.object(invites, "SETTLE_TIMEOUT", 0),
            self.assertRaises(frappe.ValidationError) as raised,
        ):
            self.ensure(INVITE)

        self.assertIn(DUPLICATE["description"], str(raised.exception))

    def test_an_invite_the_file_carries_twice_resolves_to_the_copy_that_was_created(self):
        # One uid, two events: the server takes the first and refuses the second as its duplicate.
        self.searchable([])
        self.created(uid_invite="id-invite")

        with mock.patch.object(invites, "SETTLE_TIMEOUT", 0):
            self.assertEqual(self.ensure(INVITE, dict(INVITE)), "id-invite")

    def test_an_invite_the_server_answers_for_neither_way_fails_readably(self):
        self.searchable([])
        self.server.respond("CalendarEvent/set", {"created": {}, "notCreated": {}})

        with self.assertRaises(frappe.ValidationError) as raised:
            self.ensure(INVITE)

        self.assertIn("Could not add the event to the calendar", str(raised.exception))
