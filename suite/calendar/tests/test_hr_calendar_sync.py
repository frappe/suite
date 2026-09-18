# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from datetime import date
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests import UnitTestCase

from suite.calendar.hr import sync as hr_sync
from suite.calendar.hr.mapping import anniversary_events, birthday_events, holiday_events, strip_html
from suite.calendar.hr.source import HRSource, validate_site_url
from suite.calendar.hr.sync import _by_company, _differs, _principals

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


def credentials() -> str:
    # Its own function, away from the lines that fail: a traceback prints the source of each line
    # in it, and a secret spelled out on one of those would be found there, not in a variable.
    return "token KEY-12345:SECRET-abcdef"


def logged_traceback(fn) -> str:
    """What Frappe would write to the Error Log if `fn` failed inside a background job: the
    traceback with the contents of every frame in it."""

    try:
        fn()
    except Exception:
        return frappe.get_traceback(with_context=True)
    return ""


class UnitTestNothingPrivateIsLogged(UnitTestCase):
    """A failing job's variables are written where every administrator can read them."""

    def test_a_refused_source_does_not_log_the_credentials(self):
        logged = logged_traceback(lambda: HRSource("ftp://hr.example.com", credentials))
        self.assertNotIn("KEY-12345", logged)
        self.assertNotIn("SECRET-abcdef", logged)

    def test_an_unreachable_site_does_not_log_the_credentials(self):
        source = HRSource("https://hr.invalid", credentials)
        with patch("suite.calendar.hr.source.requests.get", side_effect=ConnectionError("no route")):
            logged = logged_traceback(source.employees)
        self.assertIn("could not be reached", logged)
        self.assertNotIn("KEY-12345", logged)
        self.assertNotIn("SECRET-abcdef", logged)
        self.assertNotIn("SECRET-abcdef", repr(source))

    def test_a_failed_sync_does_not_log_the_employees(self):
        settings = MagicMock(
            enabled=1, account="acc", sync_holidays=0, sync_birthdays=1, sync_anniversaries=0
        )
        settings.birthdays_calendar = "Birthdays"
        settings.hr_source.return_value.employees.return_value = [
            {
                "name": "EMP-1",
                "employee_name": "Priya Private",
                "date_of_birth": "1990-01-02",
                "user_id": "p@x.io",
            }
        ]
        with (
            patch.object(hr_sync, "acquire_lock", return_value="held"),
            patch.object(hr_sync, "release_lock"),
            patch.object(hr_sync, "_record_failure"),
            patch.object(hr_sync.frappe, "get_doc", return_value=settings),
            patch.object(hr_sync, "_sync_calendar", side_effect=RuntimeError("mail server down")),
        ):
            logged = logged_traceback(hr_sync.sync_hr_calendars)

        self.assertIn("The HR calendar sync failed", logged)
        self.assertNotIn("Priya Private", logged)
        self.assertNotIn("1990-01-02", logged)

    def test_a_second_run_stands_aside(self):
        with patch.object(hr_sync, "acquire_lock", return_value=None), patch.object(hr_sync, "_run") as run:
            self.assertEqual(hr_sync.sync_hr_calendars(), {})
        run.assert_not_called()


class UnitTestSiteUrl(UnitTestCase):
    def test_a_plain_https_site_is_accepted(self):
        self.assertEqual(validate_site_url(" https://hr.example.com/ "), "https://hr.example.com")
        self.assertEqual(validate_site_url("http://localhost:8000"), "http://localhost:8000")
        self.assertEqual(validate_site_url(None), "")

    def test_anything_else_is_refused(self):
        for url in (
            "file:///etc/passwd",
            "ftp://hr.example.com",
            "http://hr.example.com",
            "https://user:pw@hr.example.com",
            "https://hr.example.com/api/resource/Employee",
            "https://hr.example.com?next=1",
            "https://hr.example.com#frag",
            "hr.example.com",
        ):
            with self.subTest(url=url):
                self.assertRaises(frappe.ValidationError, validate_site_url, url)

    def test_redirects_are_not_followed(self):
        source = HRSource("https://hr.example.com", lambda: "token a:b")
        response = MagicMock(status_code=302)
        response.raw.read.return_value = b""
        with patch("suite.calendar.hr.source.requests.get", return_value=response) as get:
            self.assertRaises(frappe.ValidationError, source.employees)
        self.assertFalse(get.call_args.kwargs["allow_redirects"])


class UnitTestWhatHRSendsIsNotTrusted(UnitTestCase):
    def test_a_date_that_is_not_one_is_skipped(self):
        holidays = [{"holiday_date": "2026-13-45", "description": "Nope"}, {"holiday_date": None}]
        self.assertEqual(holiday_events("India 2026", holidays), [])
        self.assertEqual(birthday_events([employee("EMP-1", date_of_birth="soon")], TODAY), [])
        self.assertEqual(anniversary_events([employee("EMP-1", date_of_joining="x")], TODAY), [])

    def test_milestones_stay_within_a_company(self):
        staff = [employee("EMP-1", company="Acme"), employee("EMP-2", company="Globex")]
        self.assertEqual(set(_by_company("Birthdays", staff)), {"Birthdays — Acme", "Birthdays — Globex"})
        self.assertEqual(set(_by_company("Birthdays", staff[:1])), {"Birthdays"})

    def test_a_share_goes_only_to_the_people_hr_named(self):
        service = MagicMock()
        service.create_batches.side_effect = lambda items, size: [items]
        service.query.return_value = {"ids": ["p1", "p2", "p3"]}
        service.get.return_value = [
            {"id": "p1", "email": "Akash@x.io", "type": "individual"},
            # found by a loose search, never named by HR
            {"id": "p2", "email": "akash.other@x.io", "type": "individual"},
            # named by HR, but a group: sharing with it shares with everyone in it
            {"id": "p3", "email": "team@x.io", "type": "group"},
        ]
        with patch.object(hr_sync, "get_principal_service", return_value=service):
            self.assertEqual(_principals("acc", {"akash@x.io", "team@x.io"}), ["p1"])
