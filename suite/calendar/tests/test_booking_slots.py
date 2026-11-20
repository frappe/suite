# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""The free slots a booking page offers (specs/calendar/003-booking-pages.md, §Settings and
§Free time), with busy time by the rules of specs/calendar/002-availability.md.

Pages are made as their host and read through `booking.public_page`, as the public page reads
them. The mail server is the faked boundary: each test says which events the host has.
"""

from datetime import UTC, datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

import frappe
from frappe.tests import IntegrationTestCase

from suite.calendar import booking
from suite.calendar.booking.busy import HostEvents
from suite.calendar.http import routes
from suite.tests.utils import ensure_user

HOST = "booking-host@example.com"
OTHER = "booking-other@example.com"
ACCOUNT = "booking-host-account"
CALENDAR = f"{ACCOUNT}|work"
ATTENDING = f"{ACCOUNT}|attending"
HOST_EMAIL = "host@mail.example"

# Monday 1 March 2027, before the working day.
MONDAY = datetime(2027, 3, 1, 6, 0, tzinfo=UTC)
WEEK = (datetime(2027, 3, 1, tzinfo=UTC), datetime(2027, 3, 8, tzinfo=UTC))


class MondayClock(datetime):
    """The clock the public page reads, stopped at MONDAY."""

    @classmethod
    def now(cls, tz=None):
        return MONDAY


def utc(day: int, hour: int, minute: int = 0, month: int = 3) -> datetime:
    return datetime(2027, month, day, hour, minute, tzinfo=UTC)


def event(start: str, duration: str = "PT1H", **fields) -> dict:
    """An event as the calendar read hands it over, on the host's own calendar."""

    return {
        "account": ACCOUNT,
        "title": "Dentist",
        "start": start,
        "duration": duration,
        "time_zone": "UTC",
        "show_without_time": 0,
        "status": "Confirmed",
        "free_busy_status": "Busy",
        "organizer": "",
        "participants": [],
        "calendars": [{"calendar": CALENDAR}],
        **fields,
    }


class TestBookingSlots(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for user in (HOST, OTHER):
            ensure_user(user)
            frappe.get_doc("User", user).add_roles("Suite User")
        frappe.db.set_value("User", HOST, "time_zone", "UTC")
        if not frappe.db.exists("JMAP Account", ACCOUNT):
            frappe.get_doc(
                {
                    "doctype": "JMAP Account",
                    "name": ACCOUNT,
                    "account_id": ACCOUNT,
                    "_name": HOST,
                    "is_personal": 1,
                }
            ).db_insert()
        if not frappe.db.exists("User Account", {"account": ACCOUNT, "user": HOST}):
            frappe.get_doc(
                {"doctype": "User Account", "name": ACCOUNT, "account": ACCOUNT, "user": HOST}
            ).db_insert()

    def setUp(self):
        self.events: list[dict] = []
        reader = patch("suite.calendar.booking.busy.read_host_events", side_effect=self.held)
        reader.start()
        self.addCleanup(reader.stop)

    def held(self, host, start, end) -> HostEvents:
        return HostEvents(
            account=ACCOUNT,
            events=self.events,
            include_in_availability={CALENDAR: "All", ATTENDING: "Attending"},
            own_emails=frozenset({HOST_EMAIL}),
        )

    def make_page(self, slug: str = "intro-call", hours=None, **settings) -> str:
        values = {
            "doctype": "Booking Page",
            "title": "Intro call",
            "slug": slug,
            "length": 60,
            "minimum_notice": 0,
            "time_zone": "UTC",
            "hosts": [{"user": HOST, "calendar": CALENDAR}],
            **settings,
        }
        if hours is not None:
            values["weekly_hours"] = [
                {"weekday": day, "start_time": start, "end_time": end} for day, start, end in hours
            ]
        with self.set_user(HOST):
            page = frappe.get_doc(values).insert()
        self.addCleanup(frappe.delete_doc, "Booking Page", page.name, force=True, ignore_permissions=True)
        return slug

    def slots(self, slug: str = "intro-call", window=WEEK, now: datetime = MONDAY) -> list[datetime]:
        return booking.public_slots(slug, *window, now=now)["slots"]

    # §Settings: hours and grid

    def test_a_new_page_offers_an_hour_long_slot_each_hour_monday_to_friday_nine_to_five(self):
        self.make_page()
        slots = self.slots()
        self.assertEqual(slots[:8], [utc(1, hour) for hour in range(9, 17)])
        self.assertEqual({slot.weekday() for slot in slots}, {0, 1, 2, 3, 4})
        self.assertEqual(len(slots), 5 * 8)

    def test_slots_start_on_the_grid_of_each_range_and_never_run_past_it(self):
        self.make_page(
            length=30,
            slot_interval="15",
            hours=[("Monday", "09:00", "10:00"), ("Monday", "14:00", "15:00")],
        )
        self.assertEqual(
            self.slots(),
            [utc(1, 9), utc(1, 9, 15), utc(1, 9, 30), utc(1, 14), utc(1, 14, 15), utc(1, 14, 30)],
        )

    # §Free time: busy time, the buffer, and events that only touch

    def test_events_that_only_touch_a_slot_leave_it_free(self):
        self.make_page(hours=[("Monday", "09:00", "12:00")])
        self.events = [event("2027-03-01T09:00:00"), event("2027-03-01T11:00:00")]
        self.assertEqual(self.slots(), [utc(1, 10)])

    def test_a_slot_needs_the_buffer_free_on_each_side(self):
        self.make_page(buffer=15, hours=[("Monday", "08:00", "14:00")])
        self.events = [event("2027-03-01T10:00:00")]
        self.assertEqual(self.slots(), [utc(1, 8), utc(1, 12), utc(1, 13)])

    def test_only_what_makes_the_host_busy_takes_a_slot(self):
        """002 §Your own conflicts. Stalwart's own lookup gets the declined and the nobody-on-it
        cases wrong, which is why Suite applies these itself."""

        declined = [{"email": HOST_EMAIL, "participation_status": "DECLINED"}]
        accepted = [{"email": HOST_EMAIL, "participation_status": "ACCEPTED"}]
        others = [{"email": "guest@elsewhere.example", "participation_status": "ACCEPTED"}]
        on_attending = [{"calendar": ATTENDING}]
        cases = {
            "a busy event": ({}, False),
            "an event marked free": ({"free_busy_status": "Free"}, True),
            "a cancelled event": ({"status": "Cancelled"}, True),
            "an event the host declined": ({"participants": declined}, True),
            "an event on an attending calendar the host is not on": (
                {"calendars": on_attending, "organizer": "boss@elsewhere.example", "participants": others},
                True,
            ),
            "an event on an attending calendar the host attends": (
                {"calendars": on_attending, "participants": accepted},
                False,
            ),
            "an event on an attending calendar with nobody on it": ({"calendars": on_attending}, False),
        }
        self.make_page(hours=[("Monday", "10:00", "11:00")])
        for case, (fields, offered) in cases.items():
            with self.subTest(case):
                self.events = [event("2027-03-01T10:00:00", **fields)]
                self.assertEqual(self.slots() == [utc(1, 10)], offered)

    def test_an_all_day_event_takes_the_hosts_whole_day_in_their_zone(self):
        frappe.db.set_value("User", HOST, "time_zone", "Asia/Kolkata")
        self.addCleanup(frappe.db.set_value, "User", HOST, "time_zone", "UTC")
        # Tuesday 2 March, 00:00-24:00 in Kolkata, is 18:30 on Monday to 18:30 on Tuesday in UTC.
        self.make_page(hours=[("Monday", "17:00", "20:00"), ("Tuesday", "17:00", "20:00")])
        self.events = [event("2027-03-02T00:00:00", "P1D", time_zone="", show_without_time=1)]
        self.assertEqual(self.slots(), [utc(1, 17), utc(2, 19)])

    def test_a_repeating_event_takes_each_occurrence(self):
        self.make_page(hours=[("Monday", "09:00", "11:00"), ("Tuesday", "09:00", "11:00")])
        # The read hands over every occurrence on its own, as the calendar grid gets them.
        self.events = [event("2027-03-01T09:00:00"), event("2027-03-02T09:00:00")]
        self.assertEqual(self.slots(), [utc(1, 10), utc(2, 10)])

    # §Settings: minimum notice and how far ahead

    def test_no_slot_starts_sooner_than_the_minimum_notice(self):
        self.make_page(minimum_notice=4 * 60, hours=[("Monday", "09:00", "17:00")])
        self.assertEqual(self.slots(now=utc(1, 8, 30)), [utc(1, hour) for hour in range(13, 17)])

    def test_days_ahead_count_whole_days_from_today_in_the_pages_zone(self):
        self.make_page(time_zone="Asia/Kolkata", days_ahead=2)
        # 20:00 on Monday in UTC is already Tuesday in Kolkata: Tuesday and Wednesday are offered.
        answer = booking.public_slots("intro-call", *WEEK, now=utc(1, 20))
        days = {slot.astimezone(ZoneInfo("Asia/Kolkata")).date().day for slot in answer["slots"]}
        self.assertEqual(days, {2, 3})
        self.assertEqual(answer["slots"][0], utc(2, 3, 30))
        # Thursday 4 March starts at 18:30 on Wednesday in UTC.
        self.assertEqual(answer["bookable_until"], utc(3, 18, 30))

    # §Settings: the zone of the weekly hours

    def test_slots_keep_their_wall_clock_time_across_a_daylight_saving_change(self):
        # New York moves its clocks from 2:00 to 3:00 on Sunday 14 March 2027.
        self.make_page(
            time_zone="America/New_York",
            days_ahead=60,
            hours=[("Friday", "09:00", "10:00"), ("Sunday", "01:00", "04:00"), ("Monday", "09:00", "10:00")],
        )
        window = (utc(12, 0), utc(16, 0))
        # 9:00 is 14:00 in UTC before the change and 13:00 after it. On the Sunday, 2:00 never
        # happens: 1:00 and 3:00 are offered, an hour apart.
        self.assertEqual(self.slots(window=window), [utc(12, 14), utc(14, 6), utc(14, 7), utc(15, 13)])

    # §The page and §The link

    def test_a_page_has_exactly_one_host(self):
        for hosts in ([], [{"user": HOST, "calendar": CALENDAR}, {"user": OTHER, "calendar": CALENDAR}]):
            with self.subTest(hosts=len(hosts)), self.set_user(HOST):
                page = frappe.get_doc(
                    {"doctype": "Booking Page", "title": "Team call", "slug": "team-call", "hosts": hosts}
                )
                self.assertRaises(frappe.ValidationError, page.insert)

    def test_only_a_host_can_change_the_page(self):
        slug = self.make_page()
        name = frappe.db.get_value("Booking Page", {"slug": slug})
        with self.set_user(OTHER):
            page = frappe.get_doc("Booking Page", name)
            page.title = "Taken over"
            self.assertRaises(frappe.PermissionError, page.save)

    def test_a_switched_off_page_answers_as_one_that_does_not_exist(self):
        self.make_page(slug="switched-off", enabled=0)
        for look_up in (booking.public_page, self.slots):
            with self.subTest(look_up.__name__):
                with self.assertRaises(frappe.DoesNotExistError) as off:
                    look_up("switched-off")
                with self.assertRaises(frappe.DoesNotExistError) as missing:
                    look_up("never-made")
                self.assertEqual(str(off.exception), str(missing.exception))

    def test_the_public_answers_carry_the_page_and_slot_times_and_nothing_of_the_hosts_events(self):
        self.make_page(hours=[("Monday", "09:00", "11:00")], description="Say hello.")
        self.events = [event("2027-03-01T09:00:00", title="Divorce lawyer")]
        with self.set_user("Guest"), patch.object(booking, "datetime", MondayClock):
            page = routes.booking_page_get(slug="intro-call")
            slots = routes.booking_page_slots(
                slug="intro-call", to="2027-03-08T00:00:00Z", **{"from": "2027-03-01T00:00:00Z"}
            )
        self.assertEqual(
            {key: page[key] for key in ("slug", "title", "description", "length_minutes")},
            {"slug": "intro-call", "title": "Intro call", "description": "Say hello.", "length_minutes": 60},
        )
        self.assertEqual(slots, {"slots": ["2027-03-01T10:00:00Z"], "bookable_until": "2027-03-31T00:00:00Z"})
        self.assertNotIn("Divorce", frappe.as_json([page, slots]))
