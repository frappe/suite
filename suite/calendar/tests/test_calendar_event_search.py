# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
from datetime import UTC, datetime, timedelta

import frappe
from frappe.tests import UnitTestCase

from suite.calendar.api import (
    EVENT_SEARCH_LIMIT,
    MAX_EVENT_SEARCH_LIMIT,
    _distance,
    _first_events,
    _per_period,
    _period,
    _rank_distance,
    _search_limit,
    _utc_start,
    search_calendar_events_with_shared,
)
from suite.calendar.doctype.calendar_event.calendar_event import add_calendar_event
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestCalendarEventSearch(StalwartIntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.member = cls.create_member()
        cls.account = cls.personal_account(cls.member)

    def _search(self, text: str | None = None, limit: int | None = None, **filters) -> list[dict]:
        with self.set_user(self.member.email):
            kwargs = {"limit": limit} if limit is not None else {}
            if filters:
                kwargs["filters"] = filters
            return search_calendar_events_with_shared(self.account, text, time_zone="UTC", **kwargs)

    def _wait_for_search(self, text: str, count: int, limit: int | None = None) -> list[dict]:
        # Stalwart indexes asynchronously, so a search run the moment an event is written
        # can answer before the event is in the index it searches.
        return self.wait_until(
            lambda: ((found := self._search(text, limit)) and len(found) >= count and found) or None,
            timeout=60,
            message=f"Search for '{text}' did not find {count} event(s).",
        )

    def _add(self, title: str, start: str) -> str:
        with self.set_user(self.member.email):
            return add_calendar_event(
                self.account, title=title, start=start, duration="PT1H", time_zone="UTC"
            )

    @staticmethod
    def _days_from_now(days: int) -> str:
        return (datetime.now(UTC) + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")

    def test_finds_an_event_by_a_word_in_its_title(self):
        word = unique_name("kickoff")
        event_id = self._add(f"Project {word} with the team", "2026-05-04T10:00:00")

        found = self._wait_for_search(word, 1)

        self.assertEqual([event["id"] for event in found], [event_id])
        self.assertEqual(found[0]["account"], self.account)

    def test_answers_nearest_today_first_whichever_side_of_it_they_fall(self):
        word = unique_name("review")
        # Written out of order, so an answer in order is the search's doing and not the order
        # they happened to be created in — and on both sides of today, so date order in either
        # direction would get it wrong.
        self._add(f"Far {word}", self._days_from_now(60))
        self._add(f"Near {word}", self._days_from_now(-3))
        self._add(f"Mid {word}", self._days_from_now(30))

        found = self._wait_for_search(word, 3)

        self.assertEqual([event["title"].split()[0] for event in found], ["Near", "Mid", "Far"])

    def test_a_limit_keeps_the_nearest_of_the_matches(self):
        word = unique_name("sprint")
        self._add(f"Far {word}", self._days_from_now(40))
        self._add(f"Near {word}", self._days_from_now(2))
        self._add(f"Mid {word}", self._days_from_now(-9))

        self._wait_for_search(word, 3)
        found = self._search(word, limit=2)

        self.assertEqual([event["title"].split()[0] for event in found], ["Near", "Mid"])

    def test_a_search_with_nothing_asked_answers_with_nothing(self):
        # Not "everything": the palette asks on every keystroke, and a blank line is a reader
        # who has not asked yet rather than one asking for their whole calendar.
        self.assertEqual(self._search(), [])
        self.assertEqual(self._search(""), [])

    def test_a_word_in_the_notes_is_found_only_when_the_notes_are_searched(self):
        word = unique_name("parking")
        with self.set_user(self.member.email):
            add_calendar_event(
                self.account,
                title=f"Offsite {unique_name('trip')}",
                start="2026-08-04T10:00:00",
                duration="PT1H",
                time_zone="UTC",
                description=f"Bring the {word} pass",
            )

        found = self.wait_until(
            lambda: self._search(word, scope="text") or None,
            timeout=60,
            message=f"'{word}' was never indexed.",
        )

        self.assertEqual(len(found), 1)
        self.assertEqual(self._search(word, scope="title"), [])

    def test_a_filter_narrows_a_search_that_has_no_words_in_it(self):
        word = unique_name("summit")
        event_id = self._add(f"Annual {word}", "2026-09-15T09:00:00")
        self._wait_for_search(word, 1)

        with self.set_user(self.member.email):
            calendar = search_calendar_events_with_shared(self.account, word, time_zone="UTC")[0][
                "calendars"
            ][0]["calendar"]

        found = self._search(calendar=calendar)

        self.assertIn(event_id, [event["id"] for event in found])

    def test_a_recurring_event_answers_as_its_next_few_occurrences(self):
        # A weekly series starting next week: with no range asked, a search does not hand back
        # the master dated the week it was entered, but the next three times it runs — each a
        # row of its own, each pointing back at the series it belongs to.
        word = unique_name("standup")
        start = (frappe.utils.now_datetime() + timedelta(days=7)).replace(microsecond=0)
        with self.set_user(self.member.email):
            series_id = add_calendar_event(
                self.account,
                title=f"Weekly {word}",
                start=start.strftime("%Y-%m-%dT%H:%M:%S"),
                duration="PT30M",
                time_zone="UTC",
                recurrence_rule={"frequency": "weekly"},
            )

        found = self.wait_until(
            lambda: ((rows := self._search(word)) and len(rows) >= 3 and rows) or None,
            timeout=60,
            message=f"Series '{word}' did not expand.",
        )

        self.assertEqual(len(found), 3)
        self.assertEqual({row["master_id"] for row in found}, {series_id})
        self.assertEqual(len({row["start"] for row in found}), 3, "three distinct occurrences")
        self.assertTrue(all(row["recurrence_rule"] not in ("", "{}") for row in found))
        # In order, and none of them behind us: these are the times it will run, not has.
        starts = [row["start"] for row in found]
        self.assertEqual(starts, sorted(starts))
        self.assertGreaterEqual(starts[0], frappe.utils.now_datetime().strftime("%Y-%m-%dT%H:%M:%S"))

    def test_a_running_series_answers_as_the_occurrences_around_today(self):
        # Begun three weeks ago, weekly: the three nearest today are last week's, today's — its
        # start has passed by the time the search runs — and next week's, not the next three.
        word = unique_name("standup")
        with self.set_user(self.member.email):
            add_calendar_event(
                self.account,
                title=f"Weekly {word}",
                start=self._days_from_now(-21),
                duration="PT30M",
                time_zone="UTC",
                recurrence_rule={"frequency": "weekly"},
            )

        found = self.wait_until(
            lambda: ((rows := self._search(word)) and len(rows) >= 3 and rows) or None,
            timeout=60,
            message=f"Series '{word}' did not expand.",
        )

        today = datetime.now(UTC).replace(tzinfo=None)
        days = sorted(
            round((datetime.fromisoformat(row["start"][:19]) - today).total_seconds() / 86400)
            for row in found
        )
        self.assertEqual(days, [-7, 0, 7])

    def test_a_one_off_event_is_still_one_row(self):
        word = unique_name("offsite")
        event_id = self._add(f"Team {word}", "2026-11-05T10:00:00")

        found = self._wait_for_search(word, 1)

        self.assertEqual([row["id"] for row in found], [event_id])
        self.assertIsNone(found[0].get("master_id"))


class TestCalendarSearchBoundary(UnitTestCase):
    """What the whitelisted search accepts. Nothing here reaches Stalwart: a search is refused,
    or sized, before any account is asked."""

    def test_a_count_is_answered_within_the_ceiling(self):
        # The service walks the server batch by batch until it has the number it was handed, so
        # the ceiling is what stops one request reading a whole event store.
        self.assertEqual(_search_limit(10), 10)
        self.assertEqual(_search_limit(10_000), MAX_EVENT_SEARCH_LIMIT)
        self.assertEqual(_search_limit("10000"), MAX_EVENT_SEARCH_LIMIT)

    def test_a_count_that_is_no_count_falls_back_to_the_default(self):
        for asked in (None, 0, "", "not a number"):
            with self.subTest(limit=asked):
                self.assertEqual(_search_limit(asked), EVENT_SEARCH_LIMIT)

    def test_a_negative_count_is_not_a_negative_slice(self):
        # `events[:-5]` would drop the last five matches rather than answer with five.
        self.assertEqual(_search_limit(-5), 1)

    def test_filters_of_the_wrong_shape_are_refused_before_the_account_is_asked(self):
        # An account that does not exist: reaching the server at all would fail differently.
        # A string is refused by the whitelist's own type check, ahead of the parse — which is
        # the same boundary, a step earlier.
        for filters in ('["text"]', {"attendee": ["a@example.com"]}, {"calendar": 7}):
            with (
                self.subTest(filters=filters),
                self.assertRaises((frappe.ValidationError, frappe.exceptions.FrappeTypeError)),
            ):
                search_calendar_events_with_shared("no-such-account", "standup", filters=filters)

    def test_a_search_scope_the_server_does_not_index_is_refused(self):
        # Silently searching `text` when `participants` was asked would widen the search while
        # reading as though it had narrowed it.
        with self.assertRaisesRegex(frappe.ValidationError, "scope: Input should be"):
            search_calendar_events_with_shared(
                "no-such-account", "standup", filters={"scope": "participants"}
            )


def _row(id: str, start: str, master: str | None = None, account: str = "acc") -> dict:
    return {"account": account, "id": id, "start": start, "master_id": master}


def _master(id: str, start: str, recurs: bool = False) -> dict:
    return {
        "account": "acc",
        "id": id,
        "start": start,
        "recurrence_rule": json.dumps({"frequency": "weekly"} if recurs else {}),
    }


class TestSearchCandidateRanking(UnitTestCase):
    """Which matches are worth expanding, decided while they are still masters. Expansion is a
    query per series, so a search pays for this ordering being roughly right."""

    NOW = "2026-09-24T12:00:00"

    def test_a_series_ranks_from_today_however_long_ago_it_began(self):
        # Its own date is the week it was first entered; a standup that has run since 2019 is
        # still on next week, which is the date its row will carry.
        self.assertEqual(
            _rank_distance(_master("s", "2019-01-06T09:00:00", recurs=True), self.NOW), timedelta(0)
        )

    def test_a_series_that_has_not_begun_ranks_from_when_it_will(self):
        starts = "2027-03-01T09:00:00"
        self.assertEqual(
            _rank_distance(_master("s", starts, recurs=True), self.NOW), timedelta(days=157, hours=21)
        )

    def test_a_one_off_ranks_from_its_own_date_wherever_that_falls(self):
        for start in ("2020-05-01T09:00:00", "2026-10-01T09:00:00"):
            with self.subTest(start=start):
                self.assertEqual(
                    _rank_distance(_master("o", start), self.NOW), _distance(_master("o", start), self.NOW)
                )

    def test_a_long_running_series_outranks_an_event_that_has_passed(self):
        # The bug this ordering exists for: ranked on its own date, the 2019 series would fall
        # behind a one-off from last year and be the one dropped, though it runs again next week
        # and the one-off never will.
        running = _master("running", "2019-01-06T09:00:00", recurs=True)
        passed = _master("passed", "2025-05-01T09:00:00")

        ordered = sorted(
            [passed, running],
            key=lambda event: _rank_distance(event, self.NOW),
        )

        self.assertEqual([event["id"] for event in ordered], ["running", "passed"])

    def test_a_start_is_measured_as_the_instant_it_names_wherever_it_was_written(self):
        # Half past nine in Auckland and half past two the day before in Los Angeles are the same
        # moment, so they rank the same distance from any now.
        auckland = {"start": "2026-09-25T09:30:00", "time_zone": "Pacific/Auckland"}
        los_angeles = {"start": "2026-09-24T14:30:00", "time_zone": "America/Los_Angeles"}
        self.assertEqual(_utc_start(auckland), _utc_start(los_angeles))
        self.assertEqual(_utc_start(auckland), "2026-09-24T21:30:00")

    def test_a_start_without_a_zone_is_read_as_it_stands(self):
        self.assertEqual(_utc_start({"start": "2026-09-25", "time_zone": None}), "2026-09-25")
        self.assertEqual(_utc_start({"start": "2026-09-25T09:30:00"}), "2026-09-25T09:30:00")
        self.assertEqual(
            _utc_start({"start": "2026-09-25T09:30:00", "time_zone": "Mars/Olympus"}),
            "2026-09-25T09:30:00",
        )
        self.assertEqual(_utc_start({"start": ""}), "")

    def test_distance_from_today_reads_the_same_on_either_side_of_it(self):
        self.assertEqual(
            _distance({"start": "2026-09-20T12:00:00"}, self.NOW),
            _distance({"start": "2026-09-28T12:00:00"}, self.NOW),
        )
        self.assertLess(
            _distance({"start": "2026-09-28T12:00:00"}, self.NOW),
            _distance({"start": "2026-09-19T12:00:00"}, self.NOW),
        )
        self.assertEqual(_distance({"start": ""}, self.NOW), timedelta.max)


class TestSeriesPeriod(UnitTestCase):
    """How far back a series is asked from, so that its previous occurrence is in the window."""

    def test_one_step_of_the_rule_and_a_day_over(self):
        for rule, days in (
            ({"frequency": "daily"}, 2),
            ({"frequency": "weekly", "byDay": [{"day": "th"}]}, 8),
            ({"frequency": "weekly", "interval": 2}, 15),
            ({"frequency": "monthly"}, 32),
            ({"frequency": "yearly"}, 367),
        ):
            with self.subTest(rule=rule):
                self.assertEqual(_period({"recurrence_rule": json.dumps(rule)}), timedelta(days=days))

    def test_a_rule_naming_several_days_runs_that_many_times_a_period(self):
        for rule, times in (
            ({"frequency": "weekly"}, 1),
            ({"frequency": "weekly", "byDay": [{"day": "mo"}, {"day": "we"}, {"day": "fr"}]}, 3),
            ({"frequency": "monthly", "byMonthDay": [1, 15]}, 2),
            ({"frequency": "yearly", "byMonth": [1, 4, 7, 10]}, 4),
            ("not json", 1),
        ):
            with self.subTest(rule=rule):
                rule = rule if isinstance(rule, str) else json.dumps(rule)
                self.assertEqual(_per_period({"recurrence_rule": rule}), times)

    def test_a_rule_without_a_readable_frequency_is_taken_as_weekly(self):
        for rule in ("", "{}", "not json", json.dumps({"frequency": "hourly"})):
            with self.subTest(rule=rule):
                self.assertEqual(_period({"recurrence_rule": rule}), timedelta(days=8))


class TestSearchResultCut(UnitTestCase):
    """How a search cuts its answer down to the asked-for count, once a recurring event has
    been replaced by the several rows it is about to run as."""

    def test_the_count_is_of_events_not_of_the_rows_they_expand_to(self):
        rows = [
            _row("x1", "2026-09-25T09:00:00", master="s1"),
            _row("x2", "2026-10-02T09:00:00", master="s1"),
            _row("x3", "2026-10-09T09:00:00", master="s1"),
            _row("o1", "2026-10-10T09:00:00"),
        ]

        # A series is one answer to the search, not three, so both events fit in a count of two.
        self.assertEqual([row["id"] for row in _first_events(rows, 2)], ["x1", "x2", "x3", "o1"])

    def test_an_event_past_the_count_is_dropped_with_all_of_its_rows(self):
        rows = [
            _row("o1", "2026-09-25T09:00:00"),
            _row("x1", "2026-10-02T09:00:00", master="s1"),
            _row("x2", "2026-10-09T09:00:00", master="s1"),
        ]

        self.assertEqual([row["id"] for row in _first_events(rows, 1)], ["o1"])

    def test_an_event_is_kept_or_dropped_by_the_row_that_falls_nearest(self):
        # Rows arrive nearest first, so the series running next week takes its place ahead of
        # the one-off in December — whatever date the series' own master carries.
        rows = [
            _row("x1", "2026-10-02T09:00:00", master="s1"),
            _row("later", "2026-12-01T09:00:00"),
            _row("x2", "2026-12-04T09:00:00", master="s1"),
        ]

        self.assertEqual([row["id"] for row in _first_events(rows, 1)], ["x1", "x2"])

    def test_two_accounts_naming_an_event_alike_are_two_events(self):
        # Ids are unique within an account and no further, and a shared calendar puts another
        # account's events in the same answer.
        rows = [
            _row("eaaaalw", "2026-10-02T09:00:00", account="mine"),
            _row("eaaaalw", "2026-10-03T09:00:00", account="theirs"),
        ]

        self.assertEqual(len(_first_events(rows, 2)), 2)
        self.assertEqual([row["account"] for row in _first_events(rows, 1)], ["mine"])
