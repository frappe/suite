# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import io
import json
from unittest.mock import MagicMock, patch
from urllib.parse import unquote, urlparse

import frappe
import requests
import urllib3
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.calendar import external
from suite.calendar.hr import source as hr_source
from suite.calendar.hr import sync as hr_sync
from suite.calendar.hr.mapping import anniversary_events, birthday_events, holiday_events
from suite.calendar.hr.source import HRSource, validate_site_url
from suite.tests.utils import ensure_user

HR = "https://hr.example.com"

# Not "Frappe HR": what this site's own sync keeps is not these tests' to touch.
TEST_SOURCE = "Test HR Sync"


def employee(name: str, **fields) -> dict:
    return {"name": name, "employee_name": "Akash Tom", **fields}


def holiday(day: str, title: str, **fields) -> dict:
    return {"holiday_date": day, "description": title, **fields}


def answer(data, status: int = 200) -> MagicMock:
    response = MagicMock(status_code=status)
    response.raw.read.return_value = json.dumps({"data": data}).encode()
    return response


class FakeHRSite:
    """An HR site as its REST API answers: employees and holiday lists, read in pages of at most
    `page_length` whatever was asked for, and one holiday list by its name."""

    def __init__(self, employees=(), lists=None, page_length: int | None = None):
        self.employees = list(employees)
        self.lists = dict(lists or {})
        self.page_length = page_length

    def get(self, url, params=None, **kwargs):
        # Whatever host is asked: which one was is the test's to check, not this site's to refuse.
        path = urlparse(url).path
        if path.startswith("/api/resource/Holiday List/"):
            name = unquote(path.removeprefix("/api/resource/Holiday List/"))
            return answer({"name": name, "holidays": self.lists[name]})

        rows = {
            "/api/resource/Employee": self.employees,
            "/api/resource/Holiday List": [{"name": name} for name in self.lists],
        }[path]
        start = params["limit_start"]
        length = min(params["limit_page_length"], self.page_length or params["limit_page_length"])
        return answer(rows[start : start + length])


class UnitTestHolidayEvents(UnitTestCase):
    def test_a_day_off_for_each_holiday(self):
        events = holiday_events("India 2026", [holiday("2026-10-02", "Gandhi Jayanti")])
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
        holidays = [holiday("2026-10-04", "Sunday", weekly_off=1), holiday("2026-10-02", "Gandhi Jayanti")]
        self.assertEqual([e["title"] for e in holiday_events("India 2026", holidays)], ["Gandhi Jayanti"])

    def test_rich_text_reads_as_plain_text(self):
        holidays = [
            holiday("2026-11-08", '<div class="ql-editor"><p>Diwali</p></div>'),
            holiday("2026-12-25", "Christmas &amp; New Year"),
        ]
        titles = [event["title"] for event in holiday_events("India 2026", holidays)]
        self.assertEqual(titles, ["Diwali", "Christmas & New Year"])

    def test_a_holiday_with_no_name_is_still_a_holiday(self):
        [event] = holiday_events("India 2026", [holiday("2026-10-02", "")])
        self.assertEqual(event["title"], "Holiday")

    def test_a_date_that_is_not_one_is_skipped(self):
        holidays = [holiday("2026-13-45", "Nope"), {"holiday_date": None}]
        self.assertEqual(holiday_events("India 2026", holidays), [])
        self.assertEqual(birthday_events([employee("EMP-1", date_of_birth="soon")]), [])
        self.assertEqual(anniversary_events([employee("EMP-1", date_of_joining="x")]), [])


class UnitTestCelebrationEvents(UnitTestCase):
    def test_a_birthday_repeats_yearly_from_the_day_itself(self):
        [event] = birthday_events([employee("EMP-1", date_of_birth="1990-07-09")])
        self.assertEqual(event["uid"], "hr-birthday-EMP-1")
        self.assertEqual(event["title"], "Akash Tom's birthday")
        self.assertEqual(event["starts_on"], "1990-07-09 00:00:00")
        self.assertEqual(event["repeats"], "Yearly")

    def test_an_employee_without_a_birth_date_has_no_birthday(self):
        self.assertEqual(birthday_events([employee("EMP-1")]), [])

    def test_an_anniversary_starts_at_the_first_one(self):
        [event] = anniversary_events([employee("EMP-1", date_of_joining="2020-03-01")])
        self.assertEqual(event["starts_on"], "2021-03-01 00:00:00")
        self.assertEqual(event["title"], "Akash Tom's work anniversary")
        self.assertEqual(event["description"], "Joined on 1 March 2020")


class UnitTestTheHRSite(UnitTestCase):
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

    def test_a_key_without_its_secret_is_refused(self):
        for key, secret in (("a", None), (None, "b"), ("", "")):
            with self.subTest(key=key, secret=secret):
                self.assertRaises(frappe.ValidationError, HRSource, HR, key, secret)

    def test_redirects_are_not_followed(self):
        # The HR site sends this server to an address on the inside network, which would answer.
        inside = "http://169.254.169.254/latest/meta-data"
        asked = []

        def send(adapter, request, **kwargs):
            asked.append(request.url)
            if request.url.startswith(inside):
                raw = urllib3.HTTPResponse(io.BytesIO(b'{"data": []}'), status=200, preload_content=False)
            else:
                raw = urllib3.HTTPResponse(
                    io.BytesIO(b""), headers={"Location": inside}, status=302, preload_content=False
                )
            return adapter.build_response(request, raw)

        with patch.object(requests.adapters.HTTPAdapter, "send", send):
            self.assertRaises(frappe.ValidationError, HRSource(HR, "a", "b").employees)
        self.assertEqual([urlparse(url).netloc for url in asked], ["hr.example.com"])

    def test_an_answer_too_large_is_refused(self):
        response = answer([])
        response.raw.read.return_value = b"x" * (hr_source.MAX_RESPONSE_BYTES + 1)
        with patch.object(hr_source.requests, "get", return_value=response):
            self.assertRaises(frappe.ValidationError, HRSource(HR, "a", "b").employees)

    def test_a_site_that_caps_its_pages_is_still_read_to_the_end(self):
        # a proxy or a hardened site hands back fewer than asked for; a reader that took a short
        # page as the last would stop at the cap, and the sync would drop everyone past it
        everyone = [employee(f"EMP-{n}") for n in range(1203)]
        with patch.object(hr_source.requests, "get", FakeHRSite(everyone, page_length=500).get):
            self.assertEqual(len(HRSource(HR, "a", "b").employees()), 1203)

    def test_a_holiday_list_name_cannot_lead_somewhere_else_on_the_site(self):
        with patch.object(hr_source.requests, "get", return_value=answer({"holidays": []})) as get:
            HRSource(HR, "a", "b").holidays("../../method/ping?x=1#y")
        self.assertEqual(
            get.call_args.args[0], f"{HR}/api/resource/Holiday List/..%2F..%2Fmethod%2Fping%3Fx%3D1%23y"
        )


class IntegrationTestHRCalendarSync(IntegrationTestCase):
    """A run against an HR site, read through its API, and what the calendars then say."""

    def setUp(self) -> None:
        super().setUp()
        self.user = "hr-sync-reader@calendar.test"
        ensure_user(self.user)
        source = patch.object(hr_sync, "SOURCE", TEST_SOURCE)
        source.start()
        self.addCleanup(source.stop)
        self.addCleanup(self.remove_calendars)

        self.settings = frappe.get_doc("HR Calendar Sync Settings")
        self.settings.update(
            {"sync_holidays": 1, "holiday_lists": "", "sync_birthdays": 0, "sync_anniversaries": 0}
        )
        self.hr = FakeHRSite(
            employees=[employee("EMP-1", date_of_birth="1990-07-09", date_of_joining="2020-03-01")],
            lists={
                "India 2026": [holiday("2026-10-02", "Gandhi Jayanti"), holiday("2026-11-08", "Diwali")],
                "Dubai 2026": [holiday("2026-12-02", "National Day")],
            },
        )

    def remove_calendars(self) -> None:
        for name in frappe.get_all("External Calendar", {"source": TEST_SOURCE}, pluck="name"):
            frappe.delete_doc("External Calendar", name, ignore_permissions=True, delete_permanently=True)

    def run_sync(self) -> hr_sync.RunResult:
        with patch.object(hr_source.requests, "get", self.hr.get):
            return hr_sync.sync(self.settings, HRSource(HR, "a", "b"))

    def calendar(self, key: str) -> str:
        return frappe.db.get_value("External Calendar", {"source": TEST_SOURCE, "source_key": key})

    def ours(self) -> set[str]:
        """This test's calendars. The site may draw its own for the reader too: those aren't the
        sync under test's."""

        return set(frappe.get_all("External Calendar", {"source": TEST_SOURCE}, pluck="name"))

    def drawn(self) -> dict[str, int]:
        """Each calendar drawn for the reader, and whether it starts ticked."""

        rows = external.calendar_rows(self.user)
        return {row["_name"]: row["visible"] for row in rows if row["id"] in self.ours()}

    def events(self) -> list[dict]:
        events = external.events_in_window(self.user, "2026-01-01", "2026-12-31")
        return [event for event in events if event["calendars"][0]["calendar_id"] in self.ours()]

    def titles(self) -> list[str]:
        return sorted(event["title"] for event in self.events())

    def test_each_holiday_list_is_a_calendar_drawn_for_nobody_until_assigned(self):
        self.run_sync()
        self.assertEqual(self.drawn(), {})

        frappe.db.set_value("External Calendar", self.calendar("holidays:India 2026"), "site_wide", 1)

        # a holiday calendar starts ticked: a closed office is news to everyone it is drawn for
        self.assertEqual(self.drawn(), {"India 2026": 1})
        self.assertEqual(self.titles(), ["Diwali", "Gandhi Jayanti"])

    def test_who_sees_a_calendar_survives_the_next_run(self):
        self.run_sync()
        india, dubai = self.calendar("holidays:India 2026"), self.calendar("holidays:Dubai 2026")
        frappe.db.set_value("External Calendar", india, "site_wide", 1)
        frappe.get_doc(
            {"doctype": "External Calendar Assignment", "calendar": dubai, "user": self.user}
        ).insert(ignore_permissions=True)

        self.run_sync()

        self.assertEqual(self.drawn(), {"Dubai 2026": 1, "India 2026": 1})

    def test_a_second_run_with_nothing_changed_writes_nothing(self):
        self.run_sync()
        result = self.run_sync()
        self.assertEqual(result.calendars["holidays:India 2026"], {"created": 0, "updated": 0, "removed": 0})

    def test_a_holiday_gone_from_a_list_is_removed_and_a_moved_one_rewritten(self):
        self.run_sync()
        frappe.db.set_value("External Calendar", self.calendar("holidays:India 2026"), "site_wide", 1)

        self.hr.lists["India 2026"] = [holiday("2026-11-09", "Diwali")]
        self.run_sync()

        self.assertEqual([(e["title"], e["start"][:10]) for e in self.events()], [("Diwali", "2026-11-09")])

    def test_a_list_hr_no_longer_names_keeps_its_calendar_and_its_audience(self):
        self.run_sync()
        frappe.db.set_value("External Calendar", self.calendar("holidays:Dubai 2026"), "site_wide", 1)

        del self.hr.lists["Dubai 2026"]
        result = self.run_sync()

        self.assertEqual(result.not_updated, ["Dubai 2026"])
        self.assertEqual(self.drawn(), {"Dubai 2026": 1})
        self.assertEqual(self.titles(), ["National Day"])

    def test_a_list_the_settings_leave_out_is_not_made_and_one_already_made_is_left_alone(self):
        self.settings.holiday_lists = "India 2026"
        result = self.run_sync()
        self.assertIsNone(self.calendar("holidays:Dubai 2026"))
        self.assertEqual(result.not_updated, [])

        self.settings.holiday_lists = ""
        self.run_sync()
        self.settings.holiday_lists = "India 2026"
        self.hr.lists["Dubai 2026"] = []
        result = self.run_sync()

        self.assertEqual(result.not_updated, ["Dubai 2026"])
        self.assertEqual(
            frappe.db.count("External Calendar Event", {"calendar": self.calendar("holidays:Dubai 2026")}), 1
        )

    def test_holidays_switched_off_keeps_every_holiday_calendar_and_names_each_as_not_updated(self):
        self.run_sync()

        self.settings.sync_holidays = 0
        result = self.run_sync()

        self.assertEqual(result.not_updated, ["Dubai 2026", "India 2026"])
        self.assertIsNotNone(self.calendar("holidays:India 2026"))
        self.assertIsNotNone(self.calendar("holidays:Dubai 2026"))

    def test_birthdays_and_anniversaries_are_calendars_of_their_own_that_start_unticked(self):
        self.settings.update({"sync_holidays": 0, "sync_birthdays": 1, "sync_anniversaries": 1})
        self.run_sync()
        for key in ("birthdays", "anniversaries"):
            frappe.db.set_value("External Calendar", self.calendar(key), "site_wide", 1)

        self.assertEqual(self.drawn(), {"Birthdays": 0, "Work anniversaries": 0})
        self.assertEqual(self.titles(), ["Akash Tom's birthday", "Akash Tom's work anniversary"])

    def test_birthdays_switched_off_removes_their_calendar(self):
        self.settings.update({"sync_holidays": 0, "sync_birthdays": 1})
        self.run_sync()
        frappe.db.set_value("External Calendar", self.calendar("birthdays"), "site_wide", 1)

        self.settings.sync_birthdays = 0
        self.run_sync()

        self.assertIsNone(self.calendar("birthdays"))
        self.assertEqual(self.titles(), [])

    def test_someone_who_leaves_drops_off_the_birthdays(self):
        self.settings.update({"sync_holidays": 0, "sync_birthdays": 1})
        self.run_sync()
        frappe.db.set_value("External Calendar", self.calendar("birthdays"), "site_wide", 1)

        # HR answers active employees only
        self.hr.employees = []
        self.run_sync()

        self.assertEqual(self.titles(), [])


class IntegrationTestARunAsTheSchedulerStartsIt(IntegrationTestCase):
    """The run as a job: the saved settings, the lock, and what a failure leaves behind."""

    SECRET = "SECRET-abcdef"

    def setUp(self) -> None:
        super().setUp()
        source = patch.object(hr_sync, "SOURCE", TEST_SOURCE)
        source.start()
        self.addCleanup(source.stop)
        settings = frappe.get_doc("HR Calendar Sync Settings")
        settings.update(
            {
                "enabled": 0,
                "hr_site_url": HR,
                "api_key": "KEY-12345",
                "api_secret": self.SECRET,
                "sync_holidays": 1,
                "sync_birthdays": 1,
            }
        )
        settings.save(ignore_permissions=True)

    def test_the_hourly_run_does_nothing_until_enabled(self):
        with patch.object(hr_source.requests, "get", side_effect=AssertionError("asked HR")):
            self.assertEqual(hr_sync.sync_hr_calendars_hourly(), {})

    @staticmethod
    def hr_that_fails_after_the_employees(url, params=None, **kwargs):
        # The employee is made here, not in the test: the test's own frame is in the traceback
        # it reads, and a real job has no such frame.
        if url.endswith("/api/resource/Employee"):
            private = employee("EMP-1", employee_name="Priya Private", date_of_birth="1990-01-02")
            return answer([private] if params["limit_start"] == 0 else [])
        raise requests.ConnectionError("no route")

    def logged_by_failing(self, work) -> list[str]:
        """What `work` leaves in the Error Log, failing against an HR site that answers with an
        employee and then can't be reached: what it logs itself, and what Frappe writes for the
        error it raises, every frame with its variables."""

        logged = []
        with (
            patch.object(hr_source.requests, "get", side_effect=self.hr_that_fails_after_the_employees),
            # a failure commits what went wrong; the test's own transaction is what is rolled back
            patch.object(hr_sync.frappe.db, "commit"),
            patch.object(hr_sync.frappe.db, "rollback"),
            patch.object(hr_sync.frappe, "log_error", side_effect=lambda **kw: logged.append(kw["message"])),
        ):
            try:
                work()
            except frappe.ValidationError:
                logged.append(frappe.get_traceback(with_context=True))
            else:
                self.fail("it did not fail")
        return logged

    def assert_nothing_private(self, logged: list[str]) -> None:
        for written in logged:
            for private_value in (self.SECRET, "KEY-12345", "Priya Private", "1990-01-02"):
                self.assertNotIn(private_value, written)

    def test_a_failed_run_logs_neither_the_key_nor_an_employee(self):
        frappe.db.set_single_value("HR Calendar Sync Settings", "enabled", 1)
        self.assert_nothing_private(self.logged_by_failing(hr_sync.sync_hr_calendars_hourly))
        self.assertIn(
            "could not be reached", frappe.db.get_single_value("HR Calendar Sync Settings", "last_error")
        )

    def test_a_failed_test_connection_logs_neither_the_key_nor_an_employee(self):
        settings = frappe.get_doc("HR Calendar Sync Settings")
        self.assert_nothing_private(self.logged_by_failing(settings.test_connection))

    def asked_by(self, work, hr: FakeHRSite) -> list[str]:
        """The hosts `work` asks, each answered as `hr` would."""

        asked = []

        def get(url, params=None, **kwargs):
            asked.append(urlparse(url).netloc)
            return hr.get(url, params, **kwargs)

        with patch.object(hr_source.requests, "get", get):
            work()
        return asked

    def test_test_connection_asks_the_saved_site_not_one_sent_with_the_request(self):
        settings = frappe.get_doc("HR Calendar Sync Settings")
        settings.hr_site_url = "https://elsewhere.example.com"

        asked = self.asked_by(settings.test_connection, FakeHRSite([employee("EMP-1")], {"India 2026": []}))

        self.assertEqual(set(asked), {"hr.example.com"})

    def test_sync_now_runs_on_the_saved_site_not_one_sent_with_the_request(self):
        self.addCleanup(self.remove_calendars)
        settings = frappe.get_doc("HR Calendar Sync Settings")
        settings.hr_site_url = "https://elsewhere.example.com"
        hr = FakeHRSite([employee("EMP-1", date_of_birth="1990-07-09")], {"India 2026": []})

        def run_here(method, queue, timeout, job_id, deduplicate, enqueue_after_commit, **kwargs):
            # the job, run where it is queued, with whatever it is handed
            return frappe.get_attr(method)(**kwargs)

        with patch.object(frappe, "enqueue", run_here):
            asked = self.asked_by(settings.sync_now, hr)

        self.assertEqual(set(asked), {"hr.example.com"})

    def test_test_connection_names_a_list_in_the_settings_that_hr_does_not_have(self):
        frappe.db.set_single_value("HR Calendar Sync Settings", "holiday_lists", "India 2026\nMars 2026")
        hr = FakeHRSite(lists={"India 2026": [], "Dubai 2026": []})

        with patch.object(hr_source.requests, "get", hr.get):
            report = frappe.get_doc("HR Calendar Sync Settings").test_connection()

        self.assertEqual(report["unknown_holiday_lists"], ["Mars 2026"])

    @staticmethod
    def remove_calendars() -> None:
        for name in frappe.get_all("External Calendar", {"source": TEST_SOURCE}, pluck="name"):
            frappe.delete_doc("External Calendar", name, ignore_permissions=True, delete_permanently=True)

    def test_a_run_stands_aside_while_another_holds_the_lock(self):
        with (
            patch.object(hr_sync, "acquire_lock", return_value=None),
            patch.object(hr_source.requests, "get", side_effect=AssertionError("asked HR")),
        ):
            self.assertEqual(hr_sync.sync_hr_calendars(), {})

    def test_a_saved_key_does_not_follow_the_settings_to_another_site(self):
        settings = frappe.get_doc("HR Calendar Sync Settings")
        settings.hr_site_url = "https://elsewhere.example.com"
        self.assertRaises(frappe.ValidationError, settings.save, ignore_permissions=True)

        settings.reload()
        settings.update(
            {"hr_site_url": "https://elsewhere.example.com", "api_key": "typed-again", "api_secret": "again"}
        )
        settings.save(ignore_permissions=True)
