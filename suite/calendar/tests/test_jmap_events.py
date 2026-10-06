# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""What the calendar's JMAP helpers put on the wire, and what they make of the answers.

Against jmaplib's fake server, which records every request body: the shapes pinned here are
ones a server reads differently when they drift - a null it rejects, a patch whose parent is
not there, a query split in two - while the call itself still looks fine from the caller.
"""

import json
import unittest
from collections.abc import Callable

import httpx
from jmap.auth import BasicAuth
from jmap.core.retry import RetryPolicy
from jmap.testing.fake import FakeJMAPServer

from suite.calendar import jmap_events
from suite.mail.jmap import SuiteJMAPClient

CORE = "urn:ietf:params:jmap:core"
CALENDARS = "urn:ietf:params:jmap:calendars"
URNS = (CORE, CALENDARS)
ACCOUNT = "f7"
USER = "user@example.test"

NOW = "2026-10-02T10:00:00Z"
EVENT = "id-series"
OCCURRENCE = "2026-10-05T09:00:00"
OTHER_OCCURRENCE = "2026-10-12T09:00:00"
ANSWER = "participants/p1/participationStatus"
# Where each series' window opens: a period back from now, so further back the rarer it runs.
WINDOWS = {"uid-daily": "2026-10-01T10:00:00Z", "uid-weekly": "2026-09-24T10:00:00Z"}
HORIZON = "2028-10-02T10:00:00Z"


class JMAPEventsTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.server = FakeJMAPServer(
            capabilities={urn: {} for urn in URNS},
            accounts={
                ACCOUNT: {"name": USER, "isPersonal": True, "accountCapabilities": {urn: {} for urn in URNS}}
            },
            primary_accounts=dict.fromkeys(URNS, ACCOUNT),
        )
        self.client = _client(self.server)

    def sent(self, method: str) -> list[dict]:
        """The arguments of every `method` call the server received, in order."""

        return [
            call[1]
            for request in self.server.requests
            for call in request["methodCalls"]
            if call[0] == method
        ]

    def found(self, answer: Callable[[dict], list[str]]) -> None:
        """Has each `CalendarEvent/query` answer with the ids `answer` picks for its arguments."""

        self.server.handle(
            "CalendarEvent/query",
            lambda args, _server: {"ids": answer(args), "queryState": "q1", "position": 0},
        )


class QueryAround(JMAPEventsTestCase):
    """Both sides of now, asked for together."""

    def setUp(self) -> None:
        super().setUp()
        # "e2" is under way: it answers as still to come and as already begun.
        self.found(lambda args: ["e2", "e3"] if _edge(args) == {"after": NOW} else ["e2", "e1"])

    def test_both_halves_travel_in_one_request(self):
        jmap_events.query_around(self.client, [{"text": "standup"}], NOW, limit=10)

        self.assertEqual(len(self.server.requests), 1)
        self.assertEqual(
            [call[0] for call in self.server.requests[0]["methodCalls"]],
            ["CalendarEvent/query", "CalendarEvent/query"],
        )

    def test_each_half_is_the_conditions_and_its_side_of_now(self):
        conditions = [{"text": "standup"}, {"inCalendar": "cal-1"}]
        jmap_events.query_around(self.client, conditions, NOW, limit=10)

        upcoming, passed = self.sent("CalendarEvent/query")
        self.assertEqual(upcoming["filter"], {"operator": "AND", "conditions": [*conditions, {"after": NOW}]})
        self.assertEqual(passed["filter"], {"operator": "AND", "conditions": [*conditions, {"before": NOW}]})

    def test_what_is_to_come_is_asked_soonest_first_and_what_has_passed_latest_first(self):
        jmap_events.query_around(self.client, [], NOW, limit=10)

        upcoming, passed = self.sent("CalendarEvent/query")
        self.assertEqual(upcoming["sort"], [{"property": "start", "isAscending": True}])
        self.assertEqual(passed["sort"], [{"property": "start", "isAscending": False}])

    def test_each_half_is_cut_at_the_limit_on_its_own(self):
        jmap_events.query_around(self.client, [], NOW, limit=7)

        self.assertEqual([call["limit"] for call in self.sent("CalendarEvent/query")], [7, 7])

    def test_an_event_on_both_sides_is_listed_once_where_it_came_first(self):
        ids = jmap_events.query_around(self.client, [], NOW, limit=10)

        self.assertEqual(ids, ["e2", "e3", "e1"])


class OccurrencesFrom(JMAPEventsTestCase):
    """The next occurrences of several series, one query each."""

    def setUp(self) -> None:
        super().setUp()
        self.found(lambda args: [f"{_uid(args)}-1", f"{_uid(args)}-2"])

    def occurrences(self, after_by_uid: dict[str, str] | None = None) -> dict[str, list[str]]:
        return jmap_events.occurrences_from(
            self.client, after_by_uid or WINDOWS, before=HORIZON, per_series=4
        )

    def test_each_series_is_asked_in_a_call_of_its_own_over_its_own_window(self):
        self.occurrences()

        self.assertEqual(
            [call["filter"] for call in self.sent("CalendarEvent/query")],
            [
                {
                    "operator": "AND",
                    "conditions": [{"uid": uid}, {"after": after}, {"before": HORIZON}],
                }
                for uid, after in WINDOWS.items()
            ],
        )

    def test_each_call_expands_its_series_from_the_earliest_up_to_the_count(self):
        self.occurrences()

        for call in self.sent("CalendarEvent/query"):
            self.assertIs(call["expandRecurrences"], True)
            self.assertEqual(call["limit"], 4)
            self.assertEqual(call["sort"], [{"property": "start", "isAscending": True}])

    def test_the_calls_share_a_request(self):
        self.occurrences()

        self.assertEqual(len(self.server.requests), 1)

    def test_occurrences_are_keyed_by_their_series(self):
        self.assertEqual(
            self.occurrences(),
            {
                "uid-daily": ["uid-daily-1", "uid-daily-2"],
                "uid-weekly": ["uid-weekly-1", "uid-weekly-2"],
            },
        )

    def test_a_series_whose_query_the_server_refuses_is_left_out(self):
        self.client = _client(
            self.server,
            _refusing(self.server, lambda name, args: _uid(args) == "uid-weekly"),
        )

        occurrences = self.occurrences({**WINDOWS, "uid-yearly": "2025-10-01T10:00:00Z"})

        # The series asked before the refused one, and the one asked after it, both answer.
        self.assertEqual(
            occurrences,
            {
                "uid-daily": ["uid-daily-1", "uid-daily-2"],
                "uid-yearly": ["uid-yearly-1", "uid-yearly-2"],
            },
        )


class QueryArguments(JMAPEventsTestCase):
    """An argument with no value is left off the wire: Stalwart answers an explicit null for
    one - a `filter`, a `timeZone` - with `notRequest`, failing the whole request."""

    def setUp(self) -> None:
        super().setUp()
        self.found(lambda args: [])

    def test_a_query_with_no_filter_and_no_time_zone_names_neither(self):
        jmap_events.query_events(self.client)

        (call,) = self.sent("CalendarEvent/query")
        self.assertNotIn("filter", call)
        self.assertNotIn("timeZone", call)

    def test_a_query_given_them_sends_them(self):
        jmap_events.query_events(self.client, {"uid": "uid-1"}, time_zone="Asia/Kolkata")

        (call,) = self.sent("CalendarEvent/query")
        self.assertEqual(call["filter"], {"uid": "uid-1"})
        self.assertEqual(call["timeZone"], "Asia/Kolkata")

    def test_false_is_a_value_and_stays(self):
        jmap_events.query_around(self.client, [], NOW, limit=10)

        for call in self.sent("CalendarEvent/query"):
            self.assertNotIn("timeZone", call)
            self.assertIs(call["calculateTotal"], False)
            self.assertIs(call["expandRecurrences"], False)


class GetEvents(JMAPEventsTestCase):
    def test_asking_for_no_ids_asks_the_server_nothing(self):
        # `ids: []` must not turn into "every event", nor cost a round trip to learn nothing.
        self.assertEqual(jmap_events.get_events(self.client, []), [])
        self.assertEqual(self.server.requests, [])


class OverridePatches(JMAPEventsTestCase):
    """Writes to one occurrence of a series, as patches on the series' `recurrenceOverrides`."""

    def setUp(self) -> None:
        super().setUp()
        self.server.handle(
            "CalendarEvent/set",
            lambda args, _server: {"updated": dict.fromkeys(args["update"]), "notUpdated": {}},
        )

    def stored(self, overrides: dict | None) -> None:
        """The series as the server holds it, with these overrides (None for a series with none)."""

        event = {"id": EVENT} if overrides is None else {"id": EVENT, "recurrenceOverrides": overrides}
        self.server.respond("CalendarEvent/get", {"state": "s1", "list": [event], "notFound": []})

    def patch(self) -> dict:
        """What the one `CalendarEvent/set` sent changes on the series, its timestamp aside."""

        (call,) = self.sent("CalendarEvent/set")
        self.assertEqual(list(call["update"]), [EVENT])
        return {path: value for path, value in call["update"][EVENT].items() if path != "updated"}

    def answer(self) -> None:
        jmap_events.set_instance_participation_status(self.client, EVENT, OCCURRENCE, "p1", "ACCEPTED")

    def test_removing_overrides_sends_a_null_for_each_occurrence(self):
        jmap_events.remove_overrides(self.client, EVENT, [OCCURRENCE, OTHER_OCCURRENCE])

        # The key present and null is what removes it; a key left out would remove nothing.
        self.assertEqual(
            self.patch(),
            {f"recurrenceOverrides/{OCCURRENCE}": None, f"recurrenceOverrides/{OTHER_OCCURRENCE}": None},
        )

    def test_answering_on_a_series_with_no_overrides_writes_the_whole_map(self):
        self.stored(None)
        self.answer()

        self.assertEqual(self.patch(), {"recurrenceOverrides": {OCCURRENCE: {ANSWER: "accepted"}}})

    def test_answering_an_occurrence_already_overridden_writes_the_answer_alone(self):
        self.stored({OCCURRENCE: {"title": "Moved"}})
        self.answer()

        self.assertEqual(self.patch(), {f"recurrenceOverrides/{OCCURRENCE}/{ANSWER}": "accepted"})

    def test_answering_beside_other_overrides_adds_this_occurrence_and_leaves_them(self):
        self.stored({OTHER_OCCURRENCE: {"title": "Moved"}})
        self.answer()

        self.assertEqual(self.patch(), {f"recurrenceOverrides/{OCCURRENCE}": {ANSWER: "accepted"}})


def _client(server: FakeJMAPServer, transport: httpx.MockTransport | None = None) -> SuiteJMAPClient:
    kwargs = server.client_kwargs()
    if transport:
        kwargs["transport"] = transport

    http = httpx.Client(auth=BasicAuth(USER, "pw"), **kwargs)
    return SuiteJMAPClient.connect(
        "https://jmap.example.com/.well-known/jmap",
        auth=BasicAuth(USER, "pw"),
        http=http,
        experimental=True,
        retry_policy=RetryPolicy(max_attempts=1),
    )


def _refusing(server: FakeJMAPServer, refuse: Callable[[str, dict], bool]) -> httpx.MockTransport:
    """The server's transport, answering each call `refuse(name, arguments)` picks with a method
    error. The fake fails a method by name, every call of it; a server refuses them one by one."""

    def route(request: httpx.Request) -> httpx.Response:
        response = server.route(request)
        if request.method != "POST" or not request.url.path.rstrip("/").endswith("/jmap"):
            return response

        refused = {
            call_id
            for name, args, call_id in json.loads(request.content)["methodCalls"]
            if refuse(name, args)
        }
        body = response.json()
        body["methodResponses"] = [
            ["error", {"type": "invalidArguments"}, call_id] if call_id in refused else [name, args, call_id]
            for name, args, call_id in body["methodResponses"]
        ]
        return httpx.Response(200, json=body)

    return httpx.MockTransport(route)


def _edge(args: dict) -> dict:
    """The side of now a `query_around` call asks for: the last of its ANDed conditions."""

    return args["filter"]["conditions"][-1]


def _uid(args: dict) -> str:
    """The series an `occurrences_from` call asks about."""

    return args["filter"]["conditions"][0]["uid"]
