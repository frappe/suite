# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from datetime import date, datetime, timedelta
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.calendar import api as calendar_api
from suite.calendar import external
from suite.calendar.external import yearly_occurrence
from suite.calendar.external_search import search_events
from suite.calendar.tests.fixtures import HOLIDAY
from suite.tests.utils import ensure_user


class IntegrationTestExternalCalendarSearch(IntegrationTestCase):
    """A search of the calendars this site keeps: every word typed, within a range where one is
    given, for the people each calendar is drawn for."""

    def setUp(self) -> None:
        super().setUp()
        self.user, self.stranger = "holiday-reader@calendar.test", "stranger@calendar.test"
        ensure_user(self.user)
        ensure_user(self.stranger)
        self.calendar = external.upsert_calendar("Test Source", "holidays:India 2026", "India 2026")
        self.addCleanup(external.remove_calendar, self.calendar)

    holiday = HOLIDAY

    @property
    def birthday(self) -> dict:
        return {
            "uid": "birthday-EMP-1",
            "title": "Akash Tom's birthday",
            "starts_on": "2026-07-09 00:00:00",
            "ends_on": "2026-07-10 00:00:00",
            "all_day": True,
            "repeats": "Yearly",
        }

    def search(self, user: str, words: list[str], limit: int = 10, **narrowed) -> list[dict]:
        return search_events(user, words, limit, **narrowed)

    def titles(self, words: list[str], **narrowed) -> list[str]:
        return sorted({event["title"] for event in self.search(self.user, words, **narrowed)})

    def yearly(self, anchored: date, title: str = "Someone's birthday", uid: str = "birthday-EMP-2") -> dict:
        return {
            "uid": uid,
            "title": title,
            "starts_on": f"{anchored} 00:00:00",
            "ends_on": f"{anchored + timedelta(days=1)} 00:00:00",
            "all_day": True,
            "repeats": "Yearly",
        }

    def dated(self, uid: str, title: str, day: date) -> dict:
        return {
            "uid": uid,
            "title": title,
            "starts_on": f"{day} 00:00:00",
            "ends_on": f"{day + timedelta(days=1)} 00:00:00",
            "all_day": True,
        }

    def test_a_search_finds_what_carries_every_word(self):
        external.replace_events(self.calendar, [self.holiday, self.birthday])
        external.replace_assignments(self.calendar, [self.user])

        self.assertEqual(self.titles(["gandhi"]), ["Gandhi Jayanti"])
        self.assertEqual(self.titles(["jayanti", "GANDHI"]), ["Gandhi Jayanti"])
        self.assertEqual(self.titles(["gandhi", "birthday"]), [])
        # no words is every event on the calendar: the calendar itself was the question
        self.assertEqual(self.titles([]), ["Akash Tom's birthday", "Gandhi Jayanti"])
        # and nothing for somebody it is not drawn for, even naming the calendar
        self.assertEqual(self.search(self.stranger, ["gandhi"]), [])
        self.assertEqual(self.search(self.stranger, ["gandhi"], calendars=[self.calendar]), [])
        self.assertEqual(self.titles(["gandhi"], calendars=[self.calendar]), ["Gandhi Jayanti"])

    def test_the_notes_are_searched_unless_the_title_alone_is_asked(self):
        external.replace_events(self.calendar, [{**self.holiday, "description": "The office is closed"}])
        external.replace_assignments(self.calendar, [self.user])

        self.assertEqual(self.titles(["closed"]), ["Gandhi Jayanti"])
        self.assertEqual(self.titles(["closed"], title_only=True), [])

    def test_a_yearly_event_answers_as_its_occurrences_nearest_today(self):
        today = date.today()
        month_day = f"{today:%m-%d}"
        external.replace_events(self.calendar, [self.yearly(yearly_occurrence(month_day, today.year - 30))])
        external.replace_assignments(self.calendar, [self.user])

        found = self.search(self.user, ["birthday"])

        # last year's, this year's and next year's: nearest first is how they are read
        expected = sorted(yearly_occurrence(month_day, today.year + offset) for offset in (-1, 0, 1))
        self.assertEqual(
            sorted(event["start"][:10] for event in found), [day.isoformat() for day in expected]
        )
        # one event, three occurrences, named by the series and the occurrence within it — and
        # named the same way on the grid, so a link from a search hit opens the grid's row
        [series] = {event["master_id"] for event in found}
        self.assertEqual(len({event["id"] for event in found}), 3)
        self.assertEqual({event["recurrence_id"] for event in found}, {f"{day}T00:00:00" for day in expected})
        [drawn] = external.events_in_window(self.user, today.isoformat(), today.isoformat())
        self.assertEqual((drawn["master_id"], drawn["recurrence_id"]), (series, f"{today}T00:00:00"))

    def test_a_range_narrows_to_what_falls_in_it(self):
        today = date.today()
        month_day = f"{today:%m-%d}"
        external.replace_events(
            self.calendar, [self.yearly(yearly_occurrence(month_day, today.year - 30)), self.holiday]
        )
        external.replace_assignments(self.calendar, [self.user])
        next_year = datetime(today.year + 1, 1, 1)

        found = self.search(self.user, ["birthday"], start=next_year, end=datetime(today.year + 2, 1, 1))
        self.assertEqual(
            [event["start"][:10] for event in found],
            [yearly_occurrence(month_day, today.year + 1).isoformat()],
        )
        # a dated event answers inside a range and not outside it, and either bound alone holds
        self.assertEqual(
            len(self.search(self.user, ["gandhi"], start=datetime(2026, 10, 1), end=datetime(2026, 10, 3))), 1
        )
        self.assertEqual(
            self.search(self.user, ["gandhi"], start=datetime(2030, 1, 1), end=datetime(2031, 1, 1)), []
        )
        self.assertEqual(self.search(self.user, ["gandhi"], start=datetime(2030, 1, 1)), [])
        self.assertEqual(self.search(self.user, ["gandhi"], end=datetime(2026, 10, 1)), [])

    def test_an_event_with_no_repeat_recorded_happens_once_in_a_range(self):
        # a row written past the event's validate, with nothing in the column at all
        external.replace_events(self.calendar, [self.holiday])
        external.replace_assignments(self.calendar, [self.user])
        frappe.db.set_value("External Calendar Event", {"calendar": self.calendar}, "repeats", None)

        found = self.search(self.user, ["gandhi"], start=datetime(2026, 10, 1), end=datetime(2026, 10, 3))
        self.assertEqual([event["start"] for event in found], ["2026-10-02T00:00:00"])
        [drawn] = external.events_in_window(self.user, "2026-10-01", "2026-10-31")
        self.assertEqual(drawn["start"], "2026-10-02T00:00:00")

    def test_a_range_is_narrowed_on_before_the_count_is(self):
        # five birthdays rank as today and would fill any count; the one holiday inside the
        # range is the answer to a search of that range all the same
        today = date.today()
        elsewhere = yearly_occurrence(f"{today:%m-%d}", today.year - 30)
        crowd = [self.yearly(elsewhere, f"Person {n}'s birthday", uid=f"birthday-EMP-{n}") for n in range(5)]
        external.replace_events(self.calendar, [*crowd, self.holiday])
        external.replace_assignments(self.calendar, [self.user])

        found = self.search(
            self.user, [], limit=1, start=datetime(2026, 10, 2), end=datetime(2026, 10, 2, 23, 59, 59)
        )

        self.assertEqual([event["title"] for event in found], ["Gandhi Jayanti"])

    def test_only_the_nearest_few_events_are_expanded(self):
        today = date.today()
        external.replace_events(
            self.calendar,
            [
                self.dated("far", "Republic Day 2029", today + timedelta(days=3 * 365)),
                self.dated("near", "Republic Day", today + timedelta(days=3)),
            ],
        )
        external.replace_assignments(self.calendar, [self.user])

        self.assertEqual(
            [event["title"] for event in self.search(self.user, ["republic"], limit=1)], ["Republic Day"]
        )


class IntegrationTestSearchOfTheSitesOwnCalendars(IntegrationTestCase):
    """The calendars this site keeps answer a search beside the mail server's events, and one
    named in the filter answers alone.

    The mail server's half is patched to answer nothing: none is running here, and what it
    answers is the tests above's business. A named calendar is not patched at all — no mail
    account exists for these users, so had the mail server been asked, the search would have
    failed rather than answered.
    """

    def setUp(self) -> None:
        super().setUp()
        self.user, self.stranger = "holiday-searcher@calendar.test", "stranger-searcher@calendar.test"
        ensure_user(self.user)
        ensure_user(self.stranger)
        self.calendar = external.upsert_calendar("Test Source", "holidays:India 2026", "India 2026")
        self.addCleanup(external.remove_calendar, self.calendar)
        external.replace_events(self.calendar, [HOLIDAY])
        external.replace_assignments(self.calendar, [self.user])

    def search(self, user: str, text: str | None = None, time_zone: str = "UTC", **filters) -> list[dict]:
        with self.set_user(user):
            return calendar_api.search_calendar_events_with_shared(
                "nobody@calendar.test", text, time_zone=time_zone, filters=filters or None
            )

    def test_a_holiday_answers_beside_the_mail_servers_events(self):
        with patch.object(calendar_api, "_with_shared", return_value=[]):
            [found] = self.search(self.user, "gandhi")
            self.assertEqual(
                (found["title"], found["account"]), ("Gandhi Jayanti", external.EXTERNAL_ACCOUNT)
            )
            self.assertEqual(self.search(self.stranger, "gandhi"), [])

    def test_a_calendar_this_site_keeps_is_asked_alone(self):
        named = f"{external.EXTERNAL_ACCOUNT}|{self.calendar}"

        self.assertEqual(
            [e["title"] for e in self.search(self.user, "gandhi", calendar=named)], ["Gandhi Jayanti"]
        )
        # with nothing typed, the calendar itself is the question, and every day on it the answer
        self.assertEqual([e["title"] for e in self.search(self.user, calendar=named)], ["Gandhi Jayanti"])
        self.assertEqual(self.search(self.stranger, "gandhi", calendar=named), [])

    def test_a_range_is_the_readers_days_not_the_instants_that_bound_them(self):
        the_day_before = {**HOLIDAY, "uid": "holiday-India 2026-2026-10-01", "title": "Eve"}
        the_day_before.update(starts_on="2026-10-01 00:00:00", ends_on="2026-10-02 00:00:00")
        external.replace_events(self.calendar, [HOLIDAY, the_day_before])
        named = f"{external.EXTERNAL_ACCOUNT}|{self.calendar}"
        # 2 October, whole, in Kolkata — which is these instants
        one_day = {"after": "2026-10-01T18:30:00Z", "before": "2026-10-02T18:29:59Z"}

        in_kolkata = self.search(self.user, calendar=named, time_zone="Asia/Kolkata", **one_day)
        self.assertEqual([event["title"] for event in in_kolkata], ["Gandhi Jayanti"])
        # the same instants are the evening of the 1st and most of the 2nd to a reader in UTC
        in_utc = self.search(self.user, calendar=named, time_zone="UTC", **one_day)
        self.assertEqual(sorted(event["title"] for event in in_utc), ["Eve", "Gandhi Jayanti"])

    def test_nobody_is_on_a_holiday(self):
        with patch.object(calendar_api, "_with_shared", return_value=[]):
            self.assertEqual(self.search(self.user, "gandhi", attendee="someone@calendar.test"), [])
            self.assertEqual(self.search(self.user, "gandhi", organizer="someone@calendar.test"), [])
