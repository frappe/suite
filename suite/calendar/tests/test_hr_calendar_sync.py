# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from datetime import date

from frappe.tests import UnitTestCase

from suite.calendar.hr.mapping import anniversary_events, birthday_events, holiday_events, strip_html
from suite.calendar.hr.sync import _differs

TODAY = date(2026, 9, 18)


def employee(name: str, **fields) -> dict:
    return {"name": name, "employee_name": "Akash Tom", **fields}


class UnitTestHolidayEvents(UnitTestCase):
    def test_a_day_off_for_each_holiday(self):
        events = holiday_events(
            "India 2026", [{"holiday_date": "2026-10-02", "description": "Gandhi Jayanti"}]
        )
        self.assertEqual(
            events,
            [
                {
                    "uid": "hr-holiday-India 2026-2026-10-02",
                    "title": "Gandhi Jayanti",
                    "start": "2026-10-02T00:00:00",
                    "duration": "P1D",
                    "show_without_time": True,
                }
            ],
        )

    def test_weekly_offs_are_not_holidays(self):
        holidays = [
            {"holiday_date": "2026-10-04", "description": "Sunday", "weekly_off": 1},
            {"holiday_date": "2026-10-02", "description": "Gandhi Jayanti"},
        ]
        self.assertEqual(
            [event["title"] for event in holiday_events("India 2026", holidays)], ["Gandhi Jayanti"]
        )

    def test_rich_text_reads_as_plain_text(self):
        self.assertEqual(strip_html('<div class="ql-editor"><p>Diwali</p></div>'), "Diwali")
        self.assertEqual(strip_html(None), "")

    def test_a_holiday_with_no_name_is_still_a_holiday(self):
        [event] = holiday_events("India 2026", [{"holiday_date": "2026-10-02", "description": ""}])
        self.assertEqual(event["title"], "Holiday")


class UnitTestMilestoneEvents(UnitTestCase):
    def test_a_birthday_repeats_yearly_without_its_year(self):
        [event] = birthday_events([employee("EMP-1", date_of_birth="1990-07-09")], TODAY)
        self.assertEqual(event["uid"], "hr-birthday-EMP-1")
        self.assertEqual(event["title"], "Akash Tom's birthday")
        self.assertEqual(event["start"], "2026-07-09T00:00:00")
        self.assertEqual(event["recurrence_rule"]["frequency"], "yearly")

    def test_a_leap_day_birthday_lands_on_the_28th_in_other_years(self):
        [event] = birthday_events([employee("EMP-1", date_of_birth="1992-02-29")], TODAY)
        self.assertEqual(event["start"], "2026-02-28T00:00:00")
        [leap] = birthday_events([employee("EMP-1", date_of_birth="1992-02-29")], date(2028, 1, 1))
        self.assertEqual(leap["start"], "2028-02-29T00:00:00")

    def test_an_employee_without_a_birth_date_has_no_birthday(self):
        self.assertEqual(birthday_events([employee("EMP-1")], TODAY), [])

    def test_an_anniversary_starts_at_the_first_one(self):
        [event] = anniversary_events([employee("EMP-1", date_of_joining="2026-03-01")], TODAY)
        self.assertEqual(event["start"], "2027-03-01T00:00:00")
        self.assertEqual(event["description"], "Joined on 2026-03-01")

    def test_a_longer_serving_employee_has_the_current_years(self):
        [event] = anniversary_events([employee("EMP-1", date_of_joining="2020-03-01")], TODAY)
        self.assertEqual(event["start"], "2026-03-01T00:00:00")
        self.assertEqual(event["title"], "Akash Tom's work anniversary")


STORED = {
    "uid": "hr-holiday-India 2026-2026-10-02",
    "title": "Gandhi Jayanti",
    "start": "2026-10-02T00:00:00",
    "duration": "P1D",
    "showWithoutTime": True,
    "recurrenceRule": {"frequency": "yearly"},
}
WANTED = {
    "uid": "hr-holiday-India 2026-2026-10-02",
    "title": "Gandhi Jayanti",
    "start": "2026-10-02T00:00:00",
    "duration": "P1D",
    "show_without_time": True,
    "recurrence_rule": {"@type": "RecurrenceRule", "frequency": "yearly"},
}


class UnitTestEventDiffing(UnitTestCase):
    def test_an_unchanged_event_is_left_alone(self):
        self.assertFalse(_differs(STORED, WANTED))

    def test_a_renamed_or_moved_holiday_is_rewritten(self):
        self.assertTrue(_differs(STORED, {**WANTED, "title": "Gandhi Jayanthi"}))
        self.assertTrue(_differs(STORED, {**WANTED, "start": "2026-10-03T00:00:00"}))

    def test_a_changed_repeat_is_rewritten(self):
        self.assertTrue(_differs(STORED, {**WANTED, "recurrence_rule": {"frequency": "monthly"}}))
        self.assertTrue(_differs({k: v for k, v in STORED.items() if k != "recurrenceRule"}, WANTED))
