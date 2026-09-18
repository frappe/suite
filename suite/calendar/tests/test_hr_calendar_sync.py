# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from datetime import date
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests import UnitTestCase

from suite.calendar.hr import source as hr_source
from suite.calendar.hr import sync as hr_sync
from suite.calendar.hr.mapping import anniversary_events, birthday_events, holiday_events, strip_html
from suite.calendar.hr.source import HRSource, validate_site_url
from suite.calendar.hr.sync import OwnedCalendars, _by_company, _differs, _principals

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
        settings.milestones_calendar = "Celebrations"
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
            patch.object(hr_sync, "OwnedCalendars"),
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
        self.assertEqual(birthday_events([employee("EMP-1", date_of_birth="soon")], TODAY), [])
        self.assertEqual(anniversary_events([employee("EMP-1", date_of_joining="x")], TODAY), [])

    def test_milestones_stay_within_a_company(self):
        staff = [employee("EMP-1", company="Acme"), employee("EMP-2", company="Globex")]
        names = {company: name for company, (name, _staff) in _by_company("Celebrations", staff).items()}
        self.assertEqual(names, {"Acme": "Celebrations — Acme", "Globex": "Celebrations — Globex"})
        self.assertEqual(_by_company("Celebrations", staff[:1])["Acme"][0], "Celebrations")

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
        return hr_sync._holiday_lists(settings, source, staff, TODAY)

    def test_the_fields_hr_left_behind_are_not_read(self):
        source = MagicMock()
        source.holiday_list_assignments.return_value = [self.assignment("Acme", "India 2026", "2026-01-01")]
        staff = [employee("EMP-1", company="Acme", holiday_list="Stale 2024", user_id="a@x.io")]
        self.assertEqual(self.holiday_lists(source, staff), {"India 2026": ["a@x.io"]})
        self.assertNotIn("holiday_list", hr_source.EMPLOYEE_FIELDS)

    def test_a_long_answer_is_read_to_the_end(self):
        source = HRSource("https://hr.example.com", lambda: "token a:b")
        pages = [[{"name": f"EMP-{n}"} for n in range(hr_source.PAGE_LENGTH)], [{"name": "EMP-last"}]]

        def get(url, params, **kwargs):
            response = MagicMock(status_code=200)
            page = pages[params["limit_start"] // hr_source.PAGE_LENGTH]
            response.raw.read.return_value = frappe.as_json({"data": page}).encode()
            return response

        with patch("suite.calendar.hr.source.requests.get", side_effect=get):
            self.assertEqual(len(source.employees()), hr_source.PAGE_LENGTH + 1)


class UnitTestOwnedCalendars(UnitTestCase):
    """The sync touches the calendars it made, and no calendar because of what it is called."""

    def owned(self, stored: dict, in_account: list[dict]) -> OwnedCalendars:
        settings = MagicMock(synced_calendars=frappe.as_json(stored))
        service = MagicMock()
        service.get.return_value = in_account
        service._update.return_value = {}
        with patch.object(hr_sync, "get_calendar_service", return_value=service):
            return OwnedCalendars(settings, "acc")

    def test_a_calendar_of_the_same_name_is_never_adopted(self):
        # "Birthdays" is already in the account, and is somebody's own.
        owned = self.owned({}, [{"id": "private", "name": "Birthdays"}])
        with patch.object(hr_sync, "add_calendar", return_value="made") as add:
            self.assertEqual(owned.ensure("birthday:Acme", "Birthdays", "#fff"), "made")
        add.assert_called_once()

    def test_its_own_calendar_is_reused_whatever_it_is_called_now(self):
        stored = {"account": "acc", "calendars": {"birthday:Acme": "made"}}
        owned = self.owned(stored, [{"id": "made", "name": "Renamed by an admin"}])
        with patch.object(hr_sync, "add_calendar") as add:
            self.assertEqual(owned.ensure("birthday:Acme", "Birthdays", "#fff"), "made")
        add.assert_not_called()

    def test_a_name_or_colour_changed_in_the_settings_is_changed_on_the_calendar(self):
        stored = {"account": "acc", "calendars": {"milestones:Acme": "made"}}
        owned = self.owned(stored, [{"id": "made", "name": "Milestones", "color": "#761acb"}])
        owned.ensure("milestones:Acme", "Celebrations", "#761ACB")
        owned.service._update.assert_called_once_with({"made": {"name": "Celebrations"}})

        owned.service._update.reset_mock()
        owned.ensure("milestones:Acme", "Milestones", "#00ff00")
        owned.service._update.assert_called_once_with({"made": {"color": "#00ff00"}})

    def test_a_calendar_that_already_says_so_is_not_written_to(self):
        stored = {"account": "acc", "calendars": {"milestones:Acme": "made"}}
        owned = self.owned(stored, [{"id": "made", "name": "Celebrations", "color": "#761ACB"}])
        owned.ensure("milestones:Acme", "Celebrations", "#761acb")
        owned.ensure("milestones:Acme", "Celebrations", None)
        owned.service._update.assert_not_called()

    def test_a_calendar_deleted_by_hand_is_made_again(self):
        stored = {"account": "acc", "calendars": {"birthday:Acme": "gone"}}
        owned = self.owned(stored, [])
        with patch.object(hr_sync, "add_calendar", return_value="made"):
            self.assertEqual(owned.ensure("birthday:Acme", "Birthdays", "#fff"), "made")

    def test_another_accounts_calendars_are_not_this_ones(self):
        stored = {"account": "other", "calendars": {"birthday:Acme": "made"}}
        owned = self.owned(stored, [{"id": "made", "name": "Birthdays"}])
        self.assertEqual(owned.calendars, {})

    def test_what_is_no_longer_planned_is_what_gets_retired(self):
        stored = {"account": "acc", "calendars": {"holiday:2025": "old", "holiday:2026": "new"}}
        owned = self.owned(stored, [{"id": "old", "name": "2025"}, {"id": "new", "name": "2026"}])
        self.assertEqual(owned.others({"holiday:2026"}), {"holiday:2025": "old"})

    def test_a_calendar_made_before_a_failure_is_not_forgotten(self):
        settings = MagicMock(synced_calendars="{}")
        service = MagicMock()
        service.get.return_value = []
        with patch.object(hr_sync, "get_calendar_service", return_value=service):
            owned = OwnedCalendars(settings, "acc")
        self.assertEqual(owned.made(), {})
        with patch.object(hr_sync, "add_calendar", return_value="made"):
            owned.ensure("birthday:Acme", "Birthdays", "#fff")
        # what the failure handler is handed, to save in its one commit
        self.assertEqual(owned.made(), {"account": "acc", "calendars": {"birthday:Acme": "made"}})

    def test_a_failed_run_hands_over_what_it_made(self):
        settings = MagicMock(
            enabled=1, account="acc", sync_holidays=0, sync_birthdays=1, sync_anniversaries=0
        )
        settings.milestones_calendar = "Celebrations"
        settings.hr_source.return_value.employees.return_value = [employee("EMP-1", company="Acme")]
        made = {"account": "acc", "calendars": {"milestones:Acme": "made"}}
        with (
            patch.object(hr_sync.frappe, "get_doc", return_value=settings),
            patch.object(hr_sync, "OwnedCalendars") as owned,
            patch.object(hr_sync, "_sync_calendar", side_effect=RuntimeError("mail server down")),
        ):
            owned.return_value.made.return_value = made
            with self.assertRaises(hr_sync.RunFailed) as failure:
                hr_sync._run()
        self.assertEqual(failure.exception.made, made)
        self.assertIsInstance(failure.exception.__cause__, RuntimeError)

    def test_a_run_that_fails_while_saving_still_hands_over_what_it_made(self):
        settings = MagicMock(enabled=1, account="acc", sync_holidays=0, sync_birthdays=1)
        settings.milestones_calendar = "Celebrations"
        settings.hr_source.return_value.employees.return_value = [employee("EMP-1", company="Acme")]
        made = {"account": "acc", "calendars": {"milestones:Acme": "made"}}
        with (
            patch.object(hr_sync.frappe, "get_doc", return_value=settings),
            patch.object(hr_sync, "OwnedCalendars") as owned,
            patch.object(hr_sync, "_sync_calendar", return_value={}),
        ):
            owned.return_value.made.return_value = made
            owned.return_value.others.return_value = {}
            owned.return_value.save.side_effect = RuntimeError("database gone")
            with self.assertRaises(hr_sync.RunFailed) as failure:
                hr_sync._run()
        self.assertEqual(failure.exception.made, made)


class UnitTestMilestonesShareACalendar(UnitTestCase):
    def plans(self, **switches) -> list:
        settings = MagicMock(
            enabled=1, account="acc", sync_holidays=0, milestones_calendar="Celebrations", **switches
        )
        settings.hr_source.return_value.employees.return_value = [
            employee(
                "EMP-1",
                company="Acme",
                date_of_birth="1990-07-09",
                date_of_joining="2020-03-01",
                user_id="a@x.io",
            )
        ]
        synced = []
        with (
            patch.object(hr_sync.frappe, "get_doc", return_value=settings),
            patch.object(hr_sync, "_record_success"),
            patch.object(hr_sync, "OwnedCalendars"),
            patch.object(hr_sync, "_sync_calendar", side_effect=lambda *args: synced.append(args) or {}),
        ):
            hr_sync._run()
        return synced

    def test_birthdays_and_anniversaries_land_on_one_calendar(self):
        [(_account, _calendar, events, audience, prefix)] = self.plans(sync_birthdays=1, sync_anniversaries=1)
        self.assertEqual({event["uid"] for event in events}, {"hr-birthday-EMP-1", "hr-anniversary-EMP-1"})
        self.assertEqual(audience, ["a@x.io"])
        self.assertEqual(prefix, hr_sync.MILESTONES)

    def test_a_kind_switched_off_is_left_out_and_so_removed(self):
        [(_account, _calendar, events, _audience, prefix)] = self.plans(
            sync_birthdays=0, sync_anniversaries=1
        )
        self.assertEqual([event["uid"] for event in events], ["hr-anniversary-EMP-1"])
        # still reconciled as the calendar's own, so the birthdays already on it go
        self.assertIn("hr-birthday-", prefix)

    def test_neither_kind_means_no_milestones_calendar(self):
        self.assertEqual(self.plans(sync_birthdays=0, sync_anniversaries=0), [])
