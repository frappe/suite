# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from datetime import date, datetime, timedelta
from unittest.mock import patch

import frappe
from frappe.database import get_db
from frappe.tests import IntegrationTestCase, UnitTestCase
from pydantic import TypeAdapter

from suite.calendar import api, external, external_store
from suite.calendar.doctype.external_calendar.external_calendar import ExternalCalendar
from suite.calendar.external import occurrences, yearly_occurrence
from suite.calendar.external_store import _differs
from suite.calendar.http import routes
from suite.calendar.tests.fixtures import BIRTHDAY, HOLIDAY
from suite.tests.utils import ensure_user

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
        days = occurrences(self.event(datetime(2026, 7, 9)), datetime(2026, 1, 1), datetime(2028, 12, 31))
        self.assertEqual(days, [date(2026, 7, 9), date(2027, 7, 9), date(2028, 7, 9)])

    def test_a_window_that_misses_the_day_has_no_occurrence(self):
        self.assertEqual(
            occurrences(self.event(datetime(2026, 7, 9)), datetime(2026, 8, 1), datetime(2026, 8, 31)),
            [],
        )

    def test_nothing_before_the_series_began(self):
        # a work anniversary has no year nought: the first one is where it starts
        days = occurrences(self.event(datetime(2027, 3, 1)), datetime(2025, 1, 1), datetime(2027, 12, 31))
        self.assertEqual(days, [date(2027, 3, 1)])

    def test_a_leap_day_lands_on_the_28th_in_a_year_without_one(self):
        self.assertEqual(yearly_occurrence("02-29", 2027), date(2027, 2, 28))
        self.assertEqual(yearly_occurrence("02-29", 2028), date(2028, 2, 29))

    def test_a_leap_day_anchored_on_the_28th_comes_back_on_the_29th(self):
        # anchored in 2027, which has no 29 February; 2028 has one, and it belongs there
        leap_day = self.event(datetime(2027, 2, 28), month_day="02-29")
        self.assertEqual(
            occurrences(leap_day, datetime(2027, 1, 1), datetime(2028, 12, 31)),
            [date(2027, 2, 28), date(2028, 2, 29)],
        )

    def test_a_window_holding_the_28th_asks_for_the_29th_too(self):
        # 2027 has no 29 February, so a window over it never names that day — but the events
        # that fall back onto the 28th are stored against it
        days = external._days_between(datetime(2027, 2, 27), datetime(2027, 3, 1))
        self.assertEqual(days, ["02-27", "02-28", "02-29", "03-01"])

    def test_a_day_of_its_own_happens_once(self):
        days = occurrences(
            self.event(datetime(2026, 10, 2), repeats=""), datetime(2026, 1, 1), datetime(2026, 12, 31)
        )
        self.assertEqual(days, [date(2026, 10, 2)])

    def test_a_window_is_read_by_the_days_it_holds(self):
        days = external._days_between(datetime(2026, 12, 30), datetime(2027, 1, 2))
        self.assertEqual(days, ["01-01", "01-02", "12-30", "12-31"])

    def test_a_window_of_any_length_is_every_day_there_is_at_most(self):
        # the calendar app asks for five months at a time; a year, or ten, is still one query
        # for the days the window holds, and there are only so many of those
        self.assertEqual(len(external._days_between(datetime(2026, 3, 1), datetime(2026, 7, 31))), 153)
        a_year = external._days_between(datetime(2025, 3, 1), datetime(2026, 3, 1))
        ten_years = external._days_between(datetime(2020, 1, 1), datetime(2029, 12, 31))
        self.assertEqual(len(a_year), 366)
        self.assertEqual(a_year, ten_years)

    def test_a_day_off_lasts_a_day(self):
        self.assertEqual(external._duration(timedelta(days=1)), "P1D")
        self.assertEqual(external._duration(timedelta(hours=1, minutes=30)), "PT1H30M")
        self.assertEqual(external._duration(timedelta(0)), "P0D")


class IntegrationTestExternalCalendars(IntegrationTestCase):
    """The store itself: what a source writes is what the people it is for are shown."""

    def setUp(self) -> None:
        super().setUp()
        self.user, self.stranger = "holiday-reader@calendar.test", "stranger@calendar.test"
        ensure_user(self.user)
        ensure_user(self.stranger)
        self.calendar = external_store.upsert_calendar(
            "Test Source", "holidays:India 2026", "India 2026", color="#123456"
        )
        self.addCleanup(self.forget, self.calendar)

    def forget(self, calendar: str) -> None:
        if frappe.db.exists("External Calendar", calendar):
            external_store.remove_calendar(calendar)

    def test_a_calendar_is_drawn_for_who_it_is_assigned_to_and_for_nobody_else(self):
        external_store.replace_events(self.calendar, [HOLIDAY])
        external_store.replace_assignments(self.calendar, [self.user])

        [row] = external.calendar_rows(self.user)
        self.assertEqual(row["_name"], "India 2026")
        self.assertEqual(row["color"], "#123456")
        # nobody writes to these here: what they say is the source's to change
        self.assertEqual((row["may_write_all"], row["may_delete"]), (0, 0))
        self.assertEqual(row["account"], external.EXTERNAL_ACCOUNT)
        self.assertEqual(external.calendar_rows(self.stranger), [])

        [event] = external.events_in_window(self.user, "2026-10-01", "2026-10-31")
        self.assertEqual(event["title"], "Gandhi Jayanti")
        self.assertEqual(event["start"], "2026-10-02T00:00:00")
        self.assertEqual(event["duration"], "P1D")
        self.assertEqual(event["show_without_time"], 1)
        self.assertEqual(event["free_busy_status"], "Free")
        self.assertEqual(event["calendars"][0]["calendar"], f"{external.EXTERNAL_ACCOUNT}|{self.calendar}")
        self.assertEqual(external.events_in_window(self.stranger, "2026-10-01", "2026-10-31"), [])

    def test_a_second_run_writes_nothing(self):
        first = external_store.replace_events(self.calendar, [HOLIDAY, BIRTHDAY])
        self.assertEqual(first, {"created": 2, "updated": 0, "removed": 0})
        again = external_store.replace_events(self.calendar, [HOLIDAY, BIRTHDAY])
        self.assertEqual(again, {"created": 0, "updated": 0, "removed": 0})

    def test_what_the_source_changed_is_rewritten_and_what_it_dropped_is_removed(self):
        external_store.replace_events(self.calendar, [HOLIDAY, BIRTHDAY])
        moved = {**HOLIDAY, "starts_on": "2026-10-03 00:00:00", "ends_on": "2026-10-04 00:00:00"}
        self.assertEqual(
            external_store.replace_events(self.calendar, [moved]),
            {"created": 0, "updated": 1, "removed": 1},
        )
        external_store.replace_assignments(self.calendar, [self.user])
        [event] = external.events_in_window(self.user, "2026-10-01", "2026-10-31")
        self.assertEqual(event["start"], "2026-10-03T00:00:00")

    def test_a_yearly_event_is_drawn_in_every_year_it_reaches(self):
        external_store.replace_events(self.calendar, [BIRTHDAY])
        external_store.replace_assignments(self.calendar, [self.user])

        # stored once, anchored in 2026
        self.assertEqual(frappe.db.count("External Calendar Event", {"calendar": self.calendar}), 1)
        self.assertEqual(
            frappe.db.get_value("External Calendar Event", {"calendar": self.calendar}, "month_day"),
            "07-09",
        )
        [in_2028] = external.events_in_window(self.user, "2028-07-01", "2028-07-31")
        self.assertEqual(in_2028["start"], "2028-07-09T00:00:00")
        self.assertEqual(external.events_in_window(self.user, "2028-08-01", "2028-08-31"), [])

    def test_a_yearly_event_entered_by_hand_is_drawn_on_the_day_it_says(self):
        external_store.replace_assignments(self.calendar, [self.user])
        founders_day = frappe.get_doc(
            {
                "doctype": "External Calendar Event",
                "calendar": self.calendar,
                "uid": "entered-by-hand",
                "title": "Founders' day",
                "starts_on": "2026-05-01 00:00:00",
                "ends_on": "2026-05-02 00:00:00",
                "all_day": 1,
                "repeats": "Yearly",
            }
        ).insert()

        [in_2029] = external.events_in_window(self.user, "2029-05-01", "2029-05-31")
        self.assertEqual(in_2029["start"], "2029-05-01T00:00:00")

        # moved by hand, it moves in every year, and leaves the day it was on
        founders_day.update({"starts_on": "2026-06-15 00:00:00", "ends_on": "2026-06-16 00:00:00"})
        founders_day.save()
        self.assertEqual(external.events_in_window(self.user, "2029-05-01", "2029-05-31"), [])
        [moved] = external.events_in_window(self.user, "2029-06-01", "2029-06-30")
        self.assertEqual(moved["start"], "2029-06-15T00:00:00")

    def test_a_leap_day_anchored_on_the_28th_stays_a_leap_day_when_edited(self):
        # born on 29 February, and the source's first year with them has no such day
        leap_day = {
            "uid": "birthday-EMP-29",
            "title": "Leap day birthday",
            "starts_on": "2027-02-28 00:00:00",
            "ends_on": "2027-03-01 00:00:00",
            "all_day": True,
            "repeats": "Yearly",
            "month_day": "02-29",
        }
        external_store.replace_events(self.calendar, [leap_day])
        external_store.replace_assignments(self.calendar, [self.user])

        stored = frappe.get_doc("External Calendar Event", {"calendar": self.calendar})
        stored.title = "Leap day birthday (renamed)"
        stored.save()

        [in_2028] = external.events_in_window(self.user, "2028-02-01", "2028-03-31")
        self.assertEqual(in_2028["start"], "2028-02-29T00:00:00")
        [in_2029] = external.events_in_window(self.user, "2029-02-01", "2029-03-31")
        self.assertEqual(in_2029["start"], "2029-02-28T00:00:00")

    def test_somebody_the_source_no_longer_names_stops_seeing_it(self):
        external_store.replace_events(self.calendar, [HOLIDAY])
        external_store.replace_assignments(self.calendar, [self.user, self.stranger])
        self.assertEqual(len(external.calendar_rows(self.stranger)), 1)

        self.assertEqual(external_store.replace_assignments(self.calendar, [self.user]), 1)
        self.assertEqual(external.calendar_rows(self.stranger), [])
        self.assertEqual(len(external.calendar_rows(self.user)), 1)

    def test_an_empty_list_assigns_the_calendar_to_nobody(self):
        external_store.replace_assignments(self.calendar, [self.user, self.stranger])

        self.assertEqual(external_store.replace_assignments(self.calendar, []), 0)
        self.assertEqual(external.calendar_rows(self.user), [])
        self.assertEqual(external.calendar_rows(self.stranger), [])

    def test_an_empty_list_removes_every_event(self):
        external_store.replace_events(self.calendar, [HOLIDAY, BIRTHDAY])
        external_store.replace_assignments(self.calendar, [self.user])

        self.assertEqual(
            external_store.replace_events(self.calendar, []), {"created": 0, "updated": 0, "removed": 2}
        )
        self.assertEqual(external.events_in_window(self.user, "2026-01-01", "2026-12-31"), [])

    def test_somebody_named_twice_is_assigned_once(self):
        external_store.replace_assignments(self.calendar, [self.user, self.user])

        self.assertEqual(frappe.db.count("External Calendar Assignment", {"calendar": self.calendar}), 1)

    def test_an_event_stated_twice_is_stored_once(self):
        renamed = {**HOLIDAY, "title": "Gandhi Jayanti (renamed)"}
        external_store.replace_events(self.calendar, [HOLIDAY, renamed])
        external_store.replace_assignments(self.calendar, [self.user])

        [event] = external.events_in_window(self.user, "2026-10-01", "2026-10-31")
        self.assertEqual(event["title"], "Gandhi Jayanti (renamed)")

    def test_the_table_refuses_a_second_assignment_for_one_person(self):
        external_store.replace_assignments(self.calendar, [self.user])

        twin = frappe.get_doc(
            {"doctype": "External Calendar Assignment", "calendar": self.calendar, "user": self.user}
        )
        self.assertRaises(frappe.UniqueValidationError, twin.insert, ignore_permissions=True)

    def test_the_table_refuses_a_second_event_for_one_uid(self):
        external_store.replace_events(self.calendar, [HOLIDAY])

        twin = frappe.get_doc(
            {
                "doctype": "External Calendar Event",
                "calendar": self.calendar,
                "uid": HOLIDAY["uid"],
                "title": "Twin",
                "starts_on": "2026-10-02 00:00:00",
            }
        )
        self.assertRaises(frappe.UniqueValidationError, twin.insert, ignore_permissions=True)

    def test_a_calendar_the_source_drops_takes_its_events_and_assignments_with_it(self):
        external_store.replace_events(self.calendar, [HOLIDAY])
        external_store.replace_assignments(self.calendar, [self.user])

        external_store.remove_calendar(self.calendar)
        self.assertFalse(frappe.db.exists("External Calendar", self.calendar))
        self.assertEqual(frappe.db.count("External Calendar Event", {"calendar": self.calendar}), 0)
        self.assertEqual(frappe.db.count("External Calendar Assignment", {"calendar": self.calendar}), 0)
        self.assertEqual(external.calendar_rows(self.user), [])

    def test_one_calendar_per_thing_the_source_has(self):
        again = external_store.upsert_calendar("Test Source", "holidays:India 2026", "India 2026 (renamed)")
        self.assertEqual(again, self.calendar)
        # the name and colour follow the source on every run, not only the day it was made
        self.assertEqual(
            frappe.db.get_value("External Calendar", self.calendar, "calendar_name"),
            "India 2026 (renamed)",
        )
        twin = frappe.new_doc("External Calendar")
        twin.update({"source": "Test Source", "source_key": "holidays:India 2026", "calendar_name": "Twin"})
        self.assertRaises(frappe.ValidationError, twin.insert)

    def test_the_table_refuses_a_second_calendar_for_one_key(self):
        """The check in validate is a message, not a guarantee: two runs in flight at once both
        look, both find nothing and both insert. The unique index is what stops the second."""

        twin = frappe.new_doc("External Calendar")
        twin.update({"source": "Test Source", "source_key": "holidays:India 2026", "calendar_name": "Twin"})
        twin.flags.ignore_validate = True  # as the loser of a race arrives: past the check
        self.assertRaises(frappe.UniqueValidationError, twin.insert, ignore_permissions=True)

    def test_the_loser_of_a_race_reads_back_the_calendar_it_lost_to(self):
        """A run that loses the insert carries on with the calendar the other one made, rather
        than failing over which of two identical calendars was written first."""

        key = "holidays:Kerala 2026"
        winner = self.second_connection()
        # what set-up wrote holds locks the other run would queue behind; this race is between
        # two runs that have each written nothing yet
        frappe.db.rollback()

        def the_other_run_wins(_calendar: ExternalCalendar) -> None:
            # the other run commits its calendar after this one looked and found none, and
            # while this transaction still reads from the snapshot it took before
            winner.sql(
                """insert into `tabExternal Calendar`
                (name, source, source_key, calendar_name, site_wide, creation, modified, owner,
                modified_by) values ('race-winner', 'Test Source', %s, 'Kerala 2026', 0, now(), now(),
                'Administrator', 'Administrator')""",
                key,
            )
            winner.sql("commit")

        with patch.object(ExternalCalendar, "validate_one_per_source_key", the_other_run_wins):
            try:
                again = external_store.upsert_calendar("Test Source", key, "Kerala 2026")
            except frappe.QueryDeadlockError:
                # a server keeping snapshot isolation (MariaDB 11.6 on) refuses to read a row
                # committed after the snapshot, as a deadlock; a background job is retried on
                # one, in a fresh transaction, as here
                frappe.db.rollback()
                again = external_store.upsert_calendar("Test Source", key, "Kerala 2026")

        self.assertEqual(again, "race-winner")
        # and the one that lost was not stored
        self.assertEqual(
            frappe.db.count("External Calendar", {"source": "Test Source", "source_key": key}), 1
        )

    def second_connection(self):
        """Another writer's own connection, whose commit is seen as a concurrent run's would be.
        What it committed is removed when the test ends, after this transaction lets go of it."""

        conf = frappe.conf
        other = get_db(
            socket=conf.db_socket,
            host=conf.db_host,
            port=conf.db_port,
            user=conf.db_user,
            password=conf.db_password,
            cur_db_name=conf.db_name,
        )

        def forget() -> None:
            frappe.db.rollback()
            other.sql("delete from `tabExternal Calendar` where name = 'race-winner'")
            other.sql("commit")
            other.close()

        self.addCleanup(forget)
        return other

    def test_a_site_wide_calendar_is_drawn_for_everyone_with_nothing_assigned(self):
        external_store.replace_events(self.calendar, [HOLIDAY])
        self.assertEqual(external.calendar_rows(self.stranger), [])

        external_store.upsert_calendar("Test Source", "holidays:India 2026", "India 2026", site_wide=True)

        self.assertEqual([row["_name"] for row in external.calendar_rows(self.stranger)], ["India 2026"])
        [event] = external.events_in_window(self.stranger, "2026-10-01", "2026-10-31")
        self.assertEqual(event["title"], "Gandhi Jayanti")

    def test_a_calendar_both_site_wide_and_assigned_is_drawn_once(self):
        external_store.upsert_calendar("Test Source", "holidays:India 2026", "India 2026", site_wide=True)
        external_store.replace_assignments(self.calendar, [self.user])

        self.assertEqual(len(external.calendar_rows(self.user)), 1)

    def test_a_calendar_no_longer_site_wide_goes_back_to_who_it_is_assigned_to(self):
        external_store.upsert_calendar("Test Source", "holidays:India 2026", "India 2026", site_wide=True)
        external_store.replace_assignments(self.calendar, [self.user])

        # the source states it on every run, and one that stops saying so is believed
        external_store.upsert_calendar("Test Source", "holidays:India 2026", "India 2026")

        self.assertEqual(external.calendar_rows(self.stranger), [])
        self.assertEqual(len(external.calendar_rows(self.user)), 1)

    def test_the_rows_are_what_the_client_is_told_to_expect(self):
        """The app validates every answer against the contract and refuses one that strays, so
        a row the store shapes wrongly is a calendar that fails to load."""

        external_store.replace_events(self.calendar, [HOLIDAY, BIRTHDAY])
        external_store.replace_assignments(self.calendar, [self.user])

        TypeAdapter(list[routes.CalendarRow]).validate_python(external.calendar_rows(self.user), strict=True)
        events = external.events_in_window(self.user, "2026-07-01", "2026-10-31")
        self.assertEqual(len(events), 2)
        TypeAdapter(list[routes.CalendarEvent]).validate_python(events, strict=True)


class IntegrationTestExternalCalendarsInTheApp(IntegrationTestCase):
    """What the calendar app's own endpoints answer with, asked as the reader. The mail server's
    half is stood in for: what is under test is what the site adds to it, and for whom."""

    def setUp(self) -> None:
        super().setUp()
        self.user, self.stranger = "holiday-reader@calendar.test", "stranger@calendar.test"
        ensure_user(self.user)
        ensure_user(self.stranger)
        self.calendar = external_store.upsert_calendar("Test Source", "holidays:India 2026", "India 2026")
        self.addCleanup(external_store.remove_calendar, self.calendar)
        external_store.replace_events(self.calendar, [HOLIDAY])
        external_store.replace_assignments(self.calendar, [self.user])

        # no mail server here: the account has no calendars, events or addresses of its own
        for name, answer in (("_with_shared", []), ("ensure_default_alerts", None), ("_own_emails", set())):
            patcher = patch.object(api, name, return_value=answer)
            patcher.start()
            self.addCleanup(patcher.stop)

    window = ("account", "2026-10-01T00:00:00", "2026-10-31T00:00:00", "UTC")

    def test_the_reader_is_listed_the_calendar_and_a_stranger_is_not(self):
        with self.set_user(self.user):
            rows = api.get_calendars_with_shared("account")
        self.assertEqual([row["name"] for row in rows], [f"external|{self.calendar}"])
        TypeAdapter(list[routes.CalendarRow]).validate_python(rows, strict=True)

        with self.set_user(self.stranger):
            self.assertEqual(api.get_calendars_with_shared("account"), [])

    def test_the_reader_is_drawn_its_events_and_a_stranger_is_not(self):
        with self.set_user(self.user):
            events = api.get_calendar_events_with_shared(*self.window)
        self.assertEqual([event["title"] for event in events], ["Gandhi Jayanti"])

        with self.set_user(self.stranger):
            self.assertEqual(api.get_calendar_events_with_shared(*self.window), [])

    def test_the_mini_month_ticks_its_days_for_the_reader_alone(self):
        with self.set_user(self.user):
            ticks = api.get_calendar_event_density_with_shared(*self.window)
        self.assertEqual(
            [(tick["start"], tick["calendars"], tick["is_declined"]) for tick in ticks],
            [("2026-10-02T00:00:00", [f"external|{self.calendar}"], False)],
        )
        TypeAdapter(list[routes.DensityRow]).validate_python(ticks, strict=True)

        with self.set_user(self.stranger):
            self.assertEqual(api.get_calendar_event_density_with_shared(*self.window), [])

    def test_a_suite_user_cannot_read_the_tables_themselves(self):
        """The rows hold names and birth dates. They reach a reader through the calendar, filtered
        by who each calendar is for, and by no other road."""

        frappe.get_doc("User", self.user).add_roles("Suite User")

        with self.set_user(self.user):
            for doctype in ("External Calendar", "External Calendar Event", "External Calendar Assignment"):
                self.assertFalse(frappe.has_permission(doctype, "read"), doctype)
                self.assertRaises(frappe.PermissionError, frappe.get_list, doctype)
