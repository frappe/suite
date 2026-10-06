# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""What the calendar makes of a call the server refuses, and of a seeding it only half took.

A method error is an answer, not a crash: a listing comes back empty, a read of one thing
says why it failed, and an invite is still shown. Against jmaplib's fake server, so the
refusals are the server's own shape and nothing here needs a mail server.
"""

import unittest
from unittest import mock

import frappe
import httpx
from jmap.auth import BasicAuth
from jmap.core.retry import RetryPolicy
from jmap.testing.fake import FakeJMAPServer

from suite.calendar import api
from suite.calendar.api import invites
from suite.calendar.doctype.calendar import calendar
from suite.calendar.doctype.event_notification import event_notification
from suite.mail.doctype.participant_identity import participant_identity
from suite.mail.jmap import SuiteJMAPClient

CORE = "urn:ietf:params:jmap:core"
URNS = [CORE, "urn:ietf:params:jmap:calendars", "urn:ietf:params:jmap:calendars:parse"]
# No account a mail server hands out: the seeded mark and the list totals are cached under it.
ACCOUNT = "refused-reads"
USER = "user@example.test"
REASON = "The calendar store is offline."
MODULES = (api, invites, calendar, event_notification, participant_identity)

INVITE = {
    "uid": "uid-invite",
    "method": "request",
    "title": "Review",
    "start": "2026-10-05T09:00:00",
    "duration": "PT1H",
}


class RefusedReadsTestCase(unittest.TestCase):
    """The calendar's doctypes and API, talking to `self.server` instead of the user's server."""

    def setUp(self) -> None:
        self.serve(_server())

    def serve(self, server: FakeJMAPServer) -> None:
        self.server = server
        self.client = _client(server)
        for module in MODULES:
            patcher = mock.patch.object(module, "get_account_client", return_value=self.client)
            patcher.start()
            self.addCleanup(patcher.stop)

    def refuse(self, method: str) -> None:
        self.server.fail(method, "serverFail", description=REASON)

    def count_for_any_account(self, module) -> None:
        """Has `module`'s list count answer for ACCOUNT, which belongs to no user here, and
        forgets the total its listings cache once the test is over."""

        patcher = mock.patch.object(module, "get_user_for_jmap_account", return_value=USER)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(frappe.cache.delete_value, module._get_total_cache_key(ACCOUNT))

    def sent(self, method: str) -> list[dict]:
        """The arguments of every `method` call the server received, in order."""

        return [
            call[1]
            for request in self.server.requests
            for call in request["methodCalls"]
            if call[0] == method
        ]

    def assert_fails_with_the_reason(self, call, *args) -> None:
        with self.assertRaises(frappe.ValidationError) as raised:
            call(*args)

        self.assertIn(REASON, str(raised.exception))


class InviteDetails(RefusedReadsTestCase):
    def test_an_invite_whose_calendar_lookup_is_refused_is_shown_as_not_added(self):
        self.server.respond("CalendarEvent/parse", {"parsed": {"blob-1": [INVITE]}})
        self.refuse("CalendarEvent/query")

        with mock.patch.object(invites, "get_participant_identities", return_value=[{"email": USER}]):
            details = invites.get_invite_details(ACCOUNT, "blob-1")

        self.assertEqual((details["uid"], details["method"]), ("uid-invite", "request"))
        self.assertIs(details["exists"], False)
        self.assertEqual(details["event"]["title"], "Review")


class Calendars(RefusedReadsTestCase):
    def test_a_refused_listing_is_an_empty_one(self):
        self.refuse("Calendar/get")

        self.assertEqual(calendar.fetch_calendars(ACCOUNT), [])

    def test_a_refused_listing_leaves_the_count_of_the_last_one(self):
        self.count_for_any_account(calendar)
        calendars = [
            {
                "id": id,
                "name": id,
                "description": None,
                "isSubscribed": True,
                "color": None,
                "sortOrder": 0,
                "timeZone": None,
            }
            for id in ("cal-1", "cal-2")
        ]
        self.server.respond("Calendar/get", {"state": "s", "list": calendars, "notFound": []})
        calendar.fetch_calendars(ACCOUNT)

        self.refuse("Calendar/get")
        calendar.fetch_calendars(ACCOUNT)

        self.assertEqual(calendar.Calendar.get_count(filters=[["Calendar", "account", "=", ACCOUNT]]), 2)

    def test_a_refused_read_of_one_calendar_says_why(self):
        self.refuse("Calendar/get")

        self.assert_fails_with_the_reason(calendar.get_calendar, ACCOUNT, "cal-1")

    def test_a_refused_delete_says_why(self):
        self.server.respond(
            "Calendar/get", {"state": "s", "list": [{"id": "cal-1", "isDefault": False}], "notFound": []}
        )
        self.refuse("Calendar/set")

        self.assert_fails_with_the_reason(api.delete_calendar, ACCOUNT, "cal-1")

    def test_a_calendar_that_cannot_be_read_first_is_not_deleted(self):
        # The read is what tells the default calendar, which stays, from one that may go.
        self.refuse("Calendar/get")

        self.assert_fails_with_the_reason(api.delete_calendar, ACCOUNT, "cal-1")
        self.assertEqual(self.sent("Calendar/set"), [])


class EventSeries(RefusedReadsTestCase):
    def test_events_whose_series_lookup_is_refused_come_back_as_they_were(self):
        self.refuse("CalendarEvent/get")
        events = [{"id": "e1", "title": "Standup"}, {"id": "e2", "title": "Review"}]

        api.enrich_events_with_master_data(ACCOUNT, events)

        self.assertEqual(events, [{"id": "e1", "title": "Standup"}, {"id": "e2", "title": "Review"}])
        # Asked and refused, not a lookup that was never made.
        self.assertEqual([call["ids"] for call in self.sent("CalendarEvent/get")], [["e1", "e2"]])


class DefaultAlerts(RefusedReadsTestCase):
    """Seeding is marked done for a day, so the mark must only follow a seeding that was. One
    that failed is left alone for an hour instead, not asked for again on every load."""

    def setUp(self) -> None:
        super().setUp()
        self.server.respond(
            "Calendar/get", {"state": "s", "list": [{"id": "cal-1"}, {"id": "cal-2"}], "notFound": []}
        )
        calendar.forget_default_alerts_seeded(ACCOUNT)
        self.addCleanup(calendar.forget_default_alerts_seeded, ACCOUNT)

        patcher = mock.patch.object(calendar, "log_mail_error")
        self.logged = patcher.start()
        self.addCleanup(patcher.stop)

    def test_calendars_that_took_their_alerts_are_not_seeded_again(self):
        self.server.respond("Calendar/set", {"updated": {"cal-1": None, "cal-2": None}})

        calendar.ensure_default_alerts(ACCOUNT)
        calendar.ensure_default_alerts(ACCOUNT)

        self.assertEqual(len(self.sent("Calendar/set")), 1)
        self.logged.assert_not_called()

    def one_calendar_refuses_its_alerts(self) -> None:
        self.server.respond(
            "Calendar/set",
            {
                "updated": {"cal-1": None},
                "notUpdated": {"cal-2": {"type": "forbidden", "description": REASON}},
            },
        )

    def test_a_calendar_that_refused_its_alerts_is_not_asked_again_on_the_next_load(self):
        self.one_calendar_refuses_its_alerts()

        calendar.ensure_default_alerts(ACCOUNT)
        asked = len(self.server.requests)
        calendar.ensure_default_alerts(ACCOUNT)

        self.assertEqual(len(self.sent("Calendar/set")), 1)
        self.assertEqual(len(self.server.requests), asked)
        # On record once, with the calendar and the server's reason.
        self.logged.assert_called_once()
        self.assertIn(f"cal-2: {REASON}", self.logged.call_args.args[1])

    def test_creating_a_calendar_has_the_next_load_seed_despite_an_earlier_refusal(self):
        self.one_calendar_refuses_its_alerts()
        calendar.ensure_default_alerts(ACCOUNT)

        # What creating a calendar does, so the new one is not left waiting on the refusal.
        calendar.forget_default_alerts_seeded(ACCOUNT)
        calendar.ensure_default_alerts(ACCOUNT)

        self.assertEqual(len(self.sent("Calendar/set")), 2)

    def test_a_calendar_that_refused_its_alerts_is_asked_again_once_the_back_off_is_over(self):
        self.one_calendar_refuses_its_alerts()
        calendar.ensure_default_alerts(ACCOUNT)

        # The hour passes: the back-off mark expires, and nothing else stands in the way.
        frappe.cache.delete_value(calendar._default_alerts_back_off_key(ACCOUNT))
        calendar.ensure_default_alerts(ACCOUNT)

        self.assertEqual(len(self.sent("Calendar/set")), 2)

    def test_a_refused_seeding_is_left_alone_for_an_hour_not_for_good(self):
        self.one_calendar_refuses_its_alerts()

        calendar.ensure_default_alerts(ACCOUNT)

        back_off = frappe.cache.make_key(calendar._default_alerts_back_off_key(ACCOUNT))
        self.assertGreater(frappe.cache.ttl(back_off), 0)
        self.assertLessEqual(frappe.cache.ttl(back_off), 60 * 60)

    def test_a_seeding_the_server_refuses_outright_is_not_asked_again_on_the_next_load(self):
        self.refuse("Calendar/get")

        calendar.ensure_default_alerts(ACCOUNT)
        calendar.ensure_default_alerts(ACCOUNT)

        self.assertEqual(len(self.server.requests), 1)
        self.logged.assert_called_once()

    def test_a_caller_the_account_turns_away_does_not_hold_off_its_seeding(self):
        self.server.respond("Calendar/set", {"updated": {"cal-1": None, "cal-2": None}})

        not_theirs = frappe.ValidationError("JMAP account does not belong to the user.")
        with mock.patch.object(calendar, "get_account_client", side_effect=not_theirs):
            self.assertRaises(frappe.ValidationError, calendar.ensure_default_alerts, ACCOUNT)
        calendar.ensure_default_alerts(ACCOUNT)

        self.assertEqual(len(self.sent("Calendar/set")), 1)
        self.logged.assert_not_called()


class EventNotifications(RefusedReadsTestCase):
    def test_a_refused_query_lists_nothing(self):
        self.refuse("CalendarEventNotification/query")

        notifications, total = event_notification.fetch_event_notifications(ACCOUNT)

        self.assertEqual(notifications, [])
        # Not known, which is not the same as none.
        self.assertIsNone(total)

    def test_a_refused_listing_leaves_the_count_of_the_last_one(self):
        self.count_for_any_account(event_notification)
        filters = [["Event Notification", "account", "=", ACCOUNT]]
        self.server.handle("CalendarEventNotification/get", _notifications)
        self.server.respond(
            "CalendarEventNotification/query",
            {"ids": ["n1", "n2"], "total": 2, "queryState": "q", "position": 0},
        )
        event_notification.EventNotification.get_list(filters=filters)

        self.refuse("CalendarEventNotification/query")
        self.assertEqual(event_notification.EventNotification.get_list(filters=filters), [])

        self.assertEqual(event_notification.EventNotification.get_count(filters=filters), 2)

    def test_a_refused_page_keeps_what_the_pages_before_it_found(self):
        self.serve(_server(core={"maxObjectsInGet": 2}))
        self.server.handle("CalendarEventNotification/get", _notifications)

        def first_page_then_refused(_args: dict, server: FakeJMAPServer) -> dict:
            server.fail("CalendarEventNotification/query", "serverFail", description=REASON)
            return {"ids": ["n1", "n2"], "total": 6, "queryState": "q", "position": 0}

        self.server.handle("CalendarEventNotification/query", first_page_then_refused)

        notifications, _total = event_notification.fetch_event_notifications(ACCOUNT, limit=4)

        self.assertEqual([n["id"] for n in notifications], ["n1", "n2"])

    def test_a_refused_read_finds_nothing(self):
        self.refuse("CalendarEventNotification/get")

        self.assertEqual(event_notification.get_event_notifications(ACCOUNT, ["n1"]), [])

    def test_asking_for_no_ids_asks_the_server_nothing(self):
        # `ids: []` must not turn into "every notification".
        self.assertEqual(event_notification.fetch_notifications(self.client, []), [])
        self.assertEqual(self.server.requests, [])


class ParticipantIdentities(RefusedReadsTestCase):
    def test_a_refused_listing_is_an_empty_one(self):
        self.refuse("ParticipantIdentity/get")

        self.assertEqual(participant_identity.fetch_participant_identities(ACCOUNT), [])

    def test_a_refused_listing_leaves_the_count_of_the_last_one(self):
        self.count_for_any_account(participant_identity)
        identities = [
            {"id": id, "name": id, "isDefault": False, "calendarAddress": f"mailto:{id}@example.test"}
            for id in ("p1", "p2")
        ]
        self.server.respond("ParticipantIdentity/get", {"state": "s", "list": identities, "notFound": []})
        participant_identity.fetch_participant_identities(ACCOUNT)

        self.refuse("ParticipantIdentity/get")
        participant_identity.fetch_participant_identities(ACCOUNT)

        filters = [["Participant Identity", "account", "=", ACCOUNT]]
        self.assertEqual(participant_identity.ParticipantIdentity.get_count(filters=filters), 2)

    def test_a_refused_read_of_one_identity_says_why(self):
        self.refuse("ParticipantIdentity/get")

        self.assert_fails_with_the_reason(participant_identity.get_participant_identity, ACCOUNT, "p1")


def _server(core: dict | None = None) -> FakeJMAPServer:
    capabilities = {**{urn: {} for urn in URNS}, CORE: core or {}}
    return FakeJMAPServer(
        capabilities=capabilities,
        accounts={ACCOUNT: {"name": USER, "isPersonal": True, "accountCapabilities": capabilities}},
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


def _notifications(args: dict, _server: FakeJMAPServer) -> dict:
    """Answers a notification get with one row per id asked for."""

    rows = [{"id": id, "created": "2026-10-01T09:00:00Z"} for id in args["ids"]]
    return {"state": "s", "list": rows, "notFound": []}
