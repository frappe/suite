# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from datetime import date, datetime, timedelta
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.calendar import external
from suite.calendar.doctype.external_calendar.external_calendar import ExternalCalendar
from suite.calendar.external import _differs, _occurrences, yearly_occurrence

HOLIDAY = {
    "uid": "hr-holiday-India 2026-2026-10-02",
    "title": "Gandhi Jayanti",
    "starts_on": "2026-10-02 00:00:00",
    "ends_on": "2026-10-03 00:00:00",
    "all_day": True,
}
STORED = frappe._dict(
    uid=HOLIDAY["uid"],
    title="Gandhi Jayanti",
    description=None,
    starts_on=datetime(2026, 10, 2),
    ends_on=datetime(2026, 10, 3),
    all_day=1,
    repeats="",
)


class UnitTestEventDiffing(UnitTestCase):
    """A run rewrites an event only where the source no longer says what is stored: everything
    else is left alone, so a repeat run writes nothing."""

    def test_an_unchanged_event_is_left_alone(self):
        self.assertFalse(_differs(STORED, HOLIDAY))

    def test_a_renamed_or_moved_holiday_is_rewritten(self):
        self.assertTrue(_differs(STORED, {**HOLIDAY, "title": "Gandhi Jayanthi"}))
        self.assertTrue(_differs(STORED, {**HOLIDAY, "starts_on": "2026-10-03 00:00:00"}))
        self.assertTrue(_differs(STORED, {**HOLIDAY, "description": "Now with a note"}))

    def test_a_changed_repeat_is_rewritten(self):
        self.assertTrue(_differs(STORED, {**HOLIDAY, "repeats": "Yearly"}))
        self.assertTrue(_differs(frappe._dict({**STORED, "repeats": "Yearly"}), HOLIDAY))


class UnitTestOccurrences(UnitTestCase):
    """A yearly event is stored once and drawn in each year a window reaches."""

    def event(self, starts_on: datetime, repeats: str = "Yearly", month_day: str = "") -> frappe._dict:
        return frappe._dict(starts_on=starts_on, repeats=repeats, month_day=month_day)

    def test_a_birthday_falls_in_every_year_of_the_window(self):
        days = _occurrences(self.event(datetime(2026, 7, 9)), datetime(2026, 1, 1), datetime(2028, 12, 31))
        self.assertEqual(days, [date(2026, 7, 9), date(2027, 7, 9), date(2028, 7, 9)])

    def test_a_window_that_misses_the_day_has_no_occurrence(self):
        self.assertEqual(
            _occurrences(self.event(datetime(2026, 7, 9)), datetime(2026, 8, 1), datetime(2026, 8, 31)),
            [],
        )

    def test_nothing_before_the_series_began(self):
        # a work anniversary has no year nought: the first one is where it starts
        days = _occurrences(self.event(datetime(2027, 3, 1)), datetime(2025, 1, 1), datetime(2027, 12, 31))
        self.assertEqual(days, [date(2027, 3, 1)])

    def test_a_leap_day_lands_on_the_28th_in_a_year_without_one(self):
        self.assertEqual(yearly_occurrence("02-29", 2027), date(2027, 2, 28))
        self.assertEqual(yearly_occurrence("02-29", 2028), date(2028, 2, 29))

    def test_a_leap_day_anchored_on_the_28th_comes_back_on_the_29th(self):
        # anchored in 2027, which has no 29 February; 2028 has one, and it belongs there
        leap_day = self.event(datetime(2027, 2, 28), month_day="02-29")
        self.assertEqual(
            _occurrences(leap_day, datetime(2027, 1, 1), datetime(2028, 12, 31)),
            [date(2027, 2, 28), date(2028, 2, 29)],
        )

    def test_a_window_holding_the_28th_asks_for_the_29th_too(self):
        # 2027 has no 29 February, so a window over it never names that day — but the events
        # that fall back onto the 28th are stored against it
        days = external._days_between(datetime(2027, 2, 27), datetime(2027, 3, 1))
        self.assertEqual(days, ["02-27", "02-28", "02-29", "03-01"])

    def test_a_day_of_its_own_happens_once(self):
        days = _occurrences(
            self.event(datetime(2026, 10, 2), repeats=""), datetime(2026, 1, 1), datetime(2026, 12, 31)
        )
        self.assertEqual(days, [date(2026, 10, 2)])

    def test_a_window_a_view_asks_for_is_read_by_day(self):
        days = external._days_between(datetime(2026, 12, 30), datetime(2027, 1, 2))
        self.assertEqual(days, ["01-01", "01-02", "12-30", "12-31"])
        # a year is more days than are worth listing, and is read whole instead
        self.assertIsNone(external._days_between(datetime(2026, 1, 1), datetime(2026, 12, 31)))

    def test_a_day_off_lasts_a_day(self):
        self.assertEqual(external._duration(timedelta(days=1)), "P1D")
        self.assertEqual(external._duration(timedelta(hours=1, minutes=30)), "PT1H30M")
        self.assertEqual(external._duration(timedelta(0)), "P0D")


class UnitTestCelebrationsStartHidden(UnitTestCase):
    """A holiday calendar starts shown; a celebrations one starts unticked, for the reader to
    switch on. Which it is, is the calendar's own, and the reader's choice is kept in the app."""

    def test_the_calendar_says_whether_it_starts_hidden(self):
        calendars = [
            frappe._dict(name="c1", calendar_name="Celebrations", color=None, hidden_by_default=1),
            frappe._dict(name="c2", calendar_name="India 2026", color="#123456", hidden_by_default=0),
        ]
        with patch.object(external, "_calendars_for", return_value=calendars):
            rows = external.calendar_rows("akash@x.io")

        self.assertEqual([row["default_hidden"] for row in rows], [1, 0])
        self.assertEqual([row["name"] for row in rows], ["external|c1", "external|c2"])
        # nobody writes to these here: what they say is HR's to change
        self.assertTrue(all(not row["may_write_all"] and not row["may_delete"] for row in rows))

    def test_somebody_with_no_calendars_is_asked_nothing_more(self):
        with patch.object(external, "_calendars_for", return_value=[]) as calendars:
            self.assertEqual(external.events_in_window("nobody@x.io", "2026-09-01", "2026-09-30"), [])
        calendars.assert_called_once()


class IntegrationTestExternalCalendars(IntegrationTestCase):
    """The store itself: what a source writes is what the people it is for are shown."""

    def setUp(self) -> None:
        super().setUp()
        self.user = self.a_user("holiday-reader@calendar.test")
        self.stranger = self.a_user("stranger@calendar.test")
        self.calendar = external.upsert_calendar(
            "Test HR", "holidays:India 2026", "India 2026", color="#123456"
        )
        self.addCleanup(self.forget, self.calendar)

    def forget(self, calendar: str) -> None:
        if frappe.db.exists("External Calendar", calendar):
            external.remove_calendar(calendar)

    def a_user(self, email: str) -> str:
        frappe.delete_doc("User", email, force=True, ignore_permissions=True, ignore_missing=True)
        self.addCleanup(
            frappe.delete_doc, "User", email, force=True, ignore_permissions=True, ignore_missing=True
        )
        user = frappe.get_doc(
            {
                "doctype": "User",
                "email": email,
                "first_name": email.split("@")[0],
                "send_welcome_email": 0,
            }
        ).insert(ignore_permissions=True)
        return user.name

    holiday = HOLIDAY

    @property
    def birthday(self) -> dict:
        return {
            "uid": "hr-birthday-EMP-1",
            "title": "Akash Tom's birthday",
            "starts_on": "2026-07-09 00:00:00",
            "ends_on": "2026-07-10 00:00:00",
            "all_day": True,
            "repeats": "Yearly",
        }

    def test_a_calendar_is_drawn_for_its_audience_and_for_nobody_else(self):
        external.replace_events(self.calendar, [self.holiday])
        external.replace_audience(self.calendar, [self.user])

        [row] = external.calendar_rows(self.user)
        self.assertEqual(row["_name"], "India 2026")
        self.assertEqual(row["color"], "#123456")
        self.assertEqual(row["account"], external.NAMESPACE)
        self.assertEqual(external.calendar_rows(self.stranger), [])

        [event] = external.events_in_window(self.user, "2026-10-01", "2026-10-31")
        self.assertEqual(event["title"], "Gandhi Jayanti")
        self.assertEqual(event["start"], "2026-10-02T00:00:00")
        self.assertEqual(event["duration"], "P1D")
        self.assertEqual(event["show_without_time"], 1)
        self.assertEqual(event["free_busy_status"], "Free")
        self.assertEqual(event["calendars"][0]["calendar"], f"{external.NAMESPACE}|{self.calendar}")
        self.assertEqual(external.events_in_window(self.stranger, "2026-10-01", "2026-10-31"), [])

    def test_a_second_run_writes_nothing(self):
        first = external.replace_events(self.calendar, [self.holiday, self.birthday])
        self.assertEqual(first, {"created": 2, "updated": 0, "removed": 0})
        again = external.replace_events(self.calendar, [self.holiday, self.birthday])
        self.assertEqual(again, {"created": 0, "updated": 0, "removed": 0})

    def test_what_hr_changed_is_rewritten_and_what_it_dropped_is_removed(self):
        external.replace_events(self.calendar, [self.holiday, self.birthday])
        moved = {**self.holiday, "starts_on": "2026-10-03 00:00:00", "ends_on": "2026-10-04 00:00:00"}
        self.assertEqual(
            external.replace_events(self.calendar, [moved]),
            {"created": 0, "updated": 1, "removed": 1},
        )
        external.replace_audience(self.calendar, [self.user])
        [event] = external.events_in_window(self.user, "2026-10-01", "2026-10-31")
        self.assertEqual(event["start"], "2026-10-03T00:00:00")

    def test_a_yearly_event_is_drawn_in_every_year_it_reaches(self):
        external.replace_events(self.calendar, [self.birthday])
        external.replace_audience(self.calendar, [self.user])

        # stored once, anchored in 2026
        self.assertEqual(frappe.db.count("External Calendar Event", {"calendar": self.calendar}), 1)
        self.assertEqual(
            frappe.db.get_value("External Calendar Event", {"calendar": self.calendar}, "month_day"),
            "07-09",
        )
        [in_2028] = external.events_in_window(self.user, "2028-07-01", "2028-07-31")
        self.assertEqual(in_2028["start"], "2028-07-09T00:00:00")
        self.assertEqual(external.events_in_window(self.user, "2028-08-01", "2028-08-31"), [])

    def test_somebody_hr_no_longer_names_stops_seeing_it(self):
        external.replace_events(self.calendar, [self.holiday])
        external.replace_audience(self.calendar, [self.user, self.stranger])
        self.assertEqual(len(external.calendar_rows(self.stranger)), 1)

        self.assertEqual(external.replace_audience(self.calendar, [self.user]), 1)
        self.assertEqual(external.calendar_rows(self.stranger), [])
        self.assertEqual(len(external.calendar_rows(self.user)), 1)

    def test_a_calendar_the_source_drops_takes_its_events_and_audience_with_it(self):
        external.replace_events(self.calendar, [self.holiday])
        external.replace_audience(self.calendar, [self.user])

        external.remove_calendar(self.calendar)
        self.assertFalse(frappe.db.exists("External Calendar", self.calendar))
        self.assertEqual(frappe.db.count("External Calendar Event", {"calendar": self.calendar}), 0)
        self.assertEqual(frappe.db.count("External Calendar Audience", {"calendar": self.calendar}), 0)
        self.assertEqual(external.calendar_rows(self.user), [])

    def test_one_calendar_per_thing_the_source_has(self):
        again = external.upsert_calendar("Test HR", "holidays:India 2026", "India 2026 (renamed)")
        self.assertEqual(again, self.calendar)
        # the name and colour follow the source on every run, not only the day it was made
        self.assertEqual(
            frappe.db.get_value("External Calendar", self.calendar, "calendar_name"),
            "India 2026 (renamed)",
        )
        twin = frappe.new_doc("External Calendar")
        twin.update({"source": "Test HR", "source_key": "holidays:India 2026", "calendar_name": "Twin"})
        self.assertRaises(frappe.ValidationError, twin.insert)

    def test_the_table_refuses_a_second_calendar_for_one_key(self):
        """The check in validate is a message, not a guarantee: two runs in flight at once both
        look, both find nothing and both insert. The unique index is what stops the second."""

        twin = frappe.new_doc("External Calendar")
        twin.update({"source": "Test HR", "source_key": "holidays:India 2026", "calendar_name": "Twin"})
        twin.flags.ignore_validate = True  # as the loser of a race arrives: past the check
        self.assertRaises(frappe.UniqueValidationError, twin.insert, ignore_permissions=True)

    def test_the_loser_of_a_race_reads_back_the_calendar_it_lost_to(self):
        """A run that loses the insert carries on with the calendar the other one made, rather
        than failing over which of two identical calendars was written first."""

        # as a race arrives: the lookup finds nothing, and so does the check in validate —
        # the other writer's calendar lands between the two
        with (
            patch.object(external.frappe.db, "get_value", side_effect=[None, self.calendar]),
            patch.object(ExternalCalendar, "validate_one_per_source_key"),
        ):
            again = external.upsert_calendar("Test HR", "holidays:India 2026", "India 2026")

        self.assertEqual(again, self.calendar)
        # and the one that lost was not stored
        self.assertEqual(
            frappe.db.count("External Calendar", {"source": "Test HR", "source_key": "holidays:India 2026"}),
            1,
        )
