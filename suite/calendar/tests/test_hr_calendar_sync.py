# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from datetime import date
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.calendar import external
from suite.calendar.hr import source as hr_source
from suite.calendar.hr import sync as hr_sync
from suite.calendar.hr.mapping import anniversary_events, birthday_events, holiday_events
from suite.calendar.hr.source import HRSource, validate_site_url
from suite.calendar.hr.sync import _by_company
from suite.calendar.tests.fixtures import HOLIDAY
from suite.tests.utils import ensure_user

TODAY = date(2026, 9, 18)
# Not "Frappe HR": what this site's real sync keeps is not these tests' to reconcile away.
TEST_SOURCE = "Test HR Sync"


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
                    "starts_on": "2026-10-02 00:00:00",
                    "ends_on": "2026-10-03 00:00:00",
                    "all_day": True,
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
        holidays = [
            {"holiday_date": "2026-11-08", "description": '<div class="ql-editor"><p>Diwali</p></div>'},
            {"holiday_date": "2026-12-25", "description": "Christmas &amp; New Year"},
        ]
        titles = [event["title"] for event in holiday_events("India 2026", holidays)]
        self.assertEqual(titles, ["Diwali", "Christmas & New Year"])

    def test_a_holiday_with_no_name_is_still_a_holiday(self):
        [event] = holiday_events("India 2026", [{"holiday_date": "2026-10-02", "description": ""}])
        self.assertEqual(event["title"], "Holiday")


class UnitTestCelebrationEvents(UnitTestCase):
    def test_a_birthday_repeats_yearly_without_its_year(self):
        [event] = birthday_events([employee("EMP-1", date_of_birth="1990-07-09")])
        self.assertEqual(event["uid"], "hr-birthday-EMP-1")
        self.assertEqual(event["title"], "Akash Tom's birthday")
        # the day itself, which never moves: the store draws it in whichever year is looked at
        self.assertEqual(event["starts_on"], "1990-07-09 00:00:00")
        self.assertEqual(event["repeats"], "Yearly")

    def test_a_leap_day_birthday_keeps_the_day_it_falls_on(self):
        [event] = birthday_events([employee("EMP-1", date_of_birth="1992-02-29")])
        self.assertEqual(event["starts_on"], "1992-02-29 00:00:00")
        # what the store repeats it by, so a year without a 29th draws it on the 28th and a
        # year with one draws it on the 29th
        self.assertEqual(event["month_day"], "02-29")

    def test_an_employee_without_a_birth_date_has_no_birthday(self):
        self.assertEqual(birthday_events([employee("EMP-1")]), [])

    def test_an_anniversary_starts_at_the_first_one(self):
        [event] = anniversary_events([employee("EMP-1", date_of_joining="2026-03-01")])
        self.assertEqual(event["starts_on"], "2027-03-01 00:00:00")
        self.assertEqual(event["description"], "Joined on 1 March 2026")

    def test_a_longer_serving_employee_is_anchored_on_their_first_anniversary_too(self):
        [event] = anniversary_events([employee("EMP-1", date_of_joining="2020-03-01")])
        self.assertEqual(event["starts_on"], "2021-03-01 00:00:00")
        self.assertEqual(event["title"], "Akash Tom's work anniversary")


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
        settings = MagicMock(enabled=1, sync_holidays=0, sync_birthdays=1, sync_anniversaries=0)
        settings.celebrations_calendar = "Celebrations"
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
            patch.object(hr_sync, "_reconcile", side_effect=RuntimeError("the database went away")),
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

    def test_a_saved_key_does_not_follow_the_settings_to_another_site(self):
        def settings(url: str, key: str, secret: str, before: str | None):
            doc = frappe.new_doc("HR Calendar Sync Settings")
            doc.update({"hr_site_url": url, "api_key": key, "api_secret": secret})
            doc._doc_before_save = frappe._dict(hr_site_url=before)
            return doc

        here, elsewhere = "https://hr.example.com", "https://elsewhere.example.com"
        # either one left as saved would still be sent
        for key, secret in (("*****", "*****"), ("*****", "typed-again"), ("typed-again", "*****")):
            with self.subTest(key=key, secret=secret):
                moved = settings(elsewhere, key, secret, here)
                self.assertRaises(frappe.ValidationError, moved.validate_key_goes_where_it_was_made_for)

        # both typed again, left where it was, or not sent anywhere at all
        settings(elsewhere, "typed-again", "typed-again", here).validate()
        settings(here, "*****", "*****", here).validate()
        settings("", "*****", "*****", here).validate()

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
        self.assertEqual(birthday_events([employee("EMP-1", date_of_birth="soon")]), [])
        self.assertEqual(anniversary_events([employee("EMP-1", date_of_joining="x")]), [])

    def test_celebrations_stay_within_a_company(self):
        staff = [employee("EMP-1", company="Acme"), employee("EMP-2", company="Globex")]
        names = {company: name for company, (name, _staff) in _by_company("Celebrations", staff).items()}
        self.assertEqual(names, {"Acme": "Celebrations — Acme", "Globex": "Celebrations — Globex"})
        self.assertEqual(_by_company("Celebrations", staff[:1])["Acme"][0], "Celebrations")


class UnitTestWhoFollowsAHolidayList(UnitTestCase):
    def assignment(self, holder: str, holiday_list: str, start: str, kind: str | None = None) -> dict:
        kind = kind or ("Employee" if holder.startswith("EMP") else "Company")
        return {
            "applicable_for": kind,
            "assigned_to": holder,
            "holiday_list": holiday_list,
            "from_date": start,
        }

    def follows(self, assignments: list[dict]) -> list[str]:
        staff = [employee("EMP-1", company="Acme")]
        return hr_sync._lists_by_assignment(assignments, staff, TODAY.isoformat())["EMP-1"]

    def test_the_company_list_is_for_those_with_none_of_their_own(self):
        company = self.assignment("Acme", "India 2026", "2026-01-01")
        self.assertEqual(self.follows([company]), ["India 2026"])
        own = self.assignment("EMP-1", "Dubai 2026", "2026-01-01")
        self.assertEqual(self.follows([company, own]), ["Dubai 2026"])

    def test_the_one_in_force_and_what_comes_after_it(self):
        rows = [
            self.assignment("Acme", "India 2025", "2025-01-01"),
            self.assignment("Acme", "India 2026", "2026-01-01"),
            self.assignment("Acme", "India 2027", "2027-01-01"),
        ]
        self.assertEqual(self.follows(rows), ["India 2026", "India 2027"])

    def test_the_company_list_holds_until_their_own_begins(self):
        rows = [
            self.assignment("Acme", "India 2026", "2026-01-01"),
            self.assignment("Acme", "India 2027", "2027-01-01"),
            self.assignment("EMP-1", "Dubai 2026", "2026-11-01"),
        ]
        self.assertEqual(self.follows(rows), ["India 2026", "Dubai 2026"])

    def test_a_company_named_like_an_employee_is_not_that_employee(self):
        rows = [
            self.assignment("Acme", "India 2026", "2026-01-01"),
            self.assignment("EMP-1", "Subsidiary 2026", "2026-01-01", kind="Company"),
        ]
        self.assertEqual(self.follows(rows), ["India 2026"])

    def test_another_companys_list_is_not_theirs(self):
        self.assertEqual(self.follows([self.assignment("Globex", "US 2026", "2026-01-01")]), [])

    def holiday_lists(self, source: MagicMock, staff: list[dict]) -> dict:
        settings = MagicMock()
        settings.chosen_holiday_lists.return_value = set()
        return hr_sync.holiday_audiences(settings, source, staff, TODAY)

    def test_the_fields_hr_left_behind_are_not_read(self):
        source = MagicMock()
        source.holiday_list_assignments.return_value = [self.assignment("Acme", "India 2026", "2026-01-01")]
        staff = [employee("EMP-1", company="Acme", holiday_list="Stale 2024", user_id="a@x.io")]
        self.assertEqual(self.holiday_lists(source, staff), {"India 2026": ["a@x.io"]})
        self.assertNotIn("holiday_list", hr_source.EMPLOYEE_FIELDS)

    def paged(self, everyone: list[dict], page_length: int):
        """An HR site that answers in pages of `page_length`, whatever was asked for."""

        def get(url, params, **kwargs):
            response = MagicMock(status_code=200)
            start = params["limit_start"]
            page = everyone[start : start + page_length]
            response.raw.read.return_value = frappe.as_json({"data": page}).encode()
            return response

        return get

    def test_a_long_answer_is_read_to_the_end(self):
        source = HRSource("https://hr.example.com", lambda: "token a:b")
        everyone = [{"name": f"EMP-{n}"} for n in range(hr_source.PAGE_LENGTH + 1)]

        with patch(
            "suite.calendar.hr.source.requests.get", side_effect=self.paged(everyone, hr_source.PAGE_LENGTH)
        ):
            self.assertEqual(len(source.employees()), hr_source.PAGE_LENGTH + 1)

    def test_a_site_that_caps_the_page_is_still_read_to_the_end(self):
        # a proxy or a hardened site hands back fewer than asked for; a reader that took a short
        # page as the last would stop at the cap, and the sync would remove everyone past it
        source = HRSource("https://hr.example.com", lambda: "token a:b")
        everyone = [{"name": f"EMP-{n}"} for n in range(hr_source.PAGE_LENGTH + 1)]

        with patch("suite.calendar.hr.source.requests.get", side_effect=self.paged(everyone, 500)):
            self.assertEqual(len(source.employees()), hr_source.PAGE_LENGTH + 1)


class UnitTestCelebrationsShareACalendar(UnitTestCase):
    def plans(self, **switches) -> list:
        settings = MagicMock(enabled=1, sync_holidays=0, celebrations_calendar="Celebrations", **switches)
        settings.hr_source.return_value.employees.return_value = [
            employee(
                "EMP-1",
                company="Acme",
                date_of_birth="1990-07-09",
                date_of_joining="2020-03-01",
                user_id="a@x.io",
            )
        ]
        planned = []
        with (
            patch.object(hr_sync.frappe, "get_doc", return_value=settings),
            patch.object(hr_sync, "_record_success"),
            patch.object(hr_sync, "_reconcile", side_effect=lambda plans: planned.extend(plans) or {}),
        ):
            hr_sync._run()
        return planned

    def test_birthdays_and_anniversaries_land_on_one_calendar(self):
        [(key, name, _color, events, audience)] = self.plans(sync_birthdays=1, sync_anniversaries=1)
        self.assertEqual({event["uid"] for event in events}, {"hr-birthday-EMP-1", "hr-anniversary-EMP-1"})
        self.assertEqual(audience, ["a@x.io"])
        self.assertEqual(name, "Celebrations")
        self.assertEqual(key, f"{hr_sync.CELEBRATIONS_KEY}Acme")

    def test_a_kind_switched_off_is_left_out_and_so_removed(self):
        [(_key, _name, _color, events, _audience)] = self.plans(sync_birthdays=0, sync_anniversaries=1)
        # the calendar is still planned, and what is not in the plan is removed from it
        self.assertEqual([event["uid"] for event in events], ["hr-anniversary-EMP-1"])

    def test_neither_kind_means_no_celebrations_calendar(self):
        self.assertEqual(self.plans(sync_birthdays=0, sync_anniversaries=0), [])


class UnitTestANameFromHRIsOneSegment(UnitTestCase):
    def test_a_holiday_list_name_cannot_lead_somewhere_else_on_the_site(self):
        source = HRSource("https://hr.example.com", lambda: "token a:b")
        response = MagicMock(status_code=200)
        response.raw.read.return_value = b'{"data": {"holidays": []}}'
        with patch("suite.calendar.hr.source.requests.get", return_value=response) as get:
            source.holidays("../../method/ping?x=1#y")
        url = get.call_args.args[0]
        self.assertEqual(
            url, "https://hr.example.com/api/resource/Holiday List/..%2F..%2Fmethod%2Fping%3Fx%3D1%23y"
        )


class IntegrationTestTheAudienceIsThisSitesUsers(IntegrationTestCase):
    """Who HR names is not who this site can draw a calendar for.

    A mail server may be shared between sites, so an address HR knows is not on its own a person
    here. The audience is resolved against this site's users: someone HR names who has no account
    here, or whose account is switched off, is left out — there is nobody here to draw for.
    """

    def setUp(self) -> None:
        super().setUp()
        self.employee = ensure_user("employee@calendar.test")
        self.retired = ensure_user("retired@calendar.test", enabled=False)

    def reconcile(self, audience: list[str | None]) -> dict:
        plan = hr_sync.Plan(
            key="holidays:India 2026",
            name="India 2026",
            color="#123456",
            events=[HOLIDAY],
            audience=audience,
        )
        # Under a source of its own: a run reconciles away every calendar of its source that is
        # not in the plan, and the test is one rollback away from the real sync's calendars.
        with patch.object(hr_sync, "SOURCE", TEST_SOURCE):
            return hr_sync._reconcile([plan])

    def drawn(self, user: str) -> list[str]:
        return [row["_name"] for row in external.calendar_rows(user)]

    def test_somebody_hr_names_who_is_not_a_user_here_is_left_out(self):
        summary = self.reconcile([self.employee, "nobody@elsewhere.test"])

        self.assertEqual(summary["India 2026"]["drawn_for"], 1)
        self.assertEqual(self.drawn(self.employee), ["India 2026"])
        self.assertEqual(external.calendar_rows("nobody@elsewhere.test"), [])
        self.assertEqual(external.events_in_window("nobody@elsewhere.test", "2026-10-01", "2026-10-31"), [])

    def test_an_account_switched_off_is_left_out(self):
        self.reconcile([self.employee, self.retired])

        self.assertEqual(self.drawn(self.employee), ["India 2026"])
        self.assertEqual(self.drawn(self.retired), [])

    def test_the_address_hr_spells_differently_is_still_this_user(self):
        # HR is asked for what it has, not for what this site would have written.
        self.reconcile(["  Employee@Calendar.TEST  "])

        self.assertEqual(self.drawn(self.employee), ["India 2026"])

    def test_nobody_hr_names_is_nobody_drawn_for(self):
        summary = self.reconcile([None, "", "nobody@elsewhere.test"])

        self.assertEqual(summary["India 2026"]["drawn_for"], 0)
        self.assertEqual(self.drawn(self.employee), [])
