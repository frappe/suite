# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.calendar.api import (
    create_calendar,
    delete_calendar,
    edit_calendar,
    get_calendars,
    get_calendars_with_shared,
)
from suite.calendar.doctype.calendar.calendar import (
    add_calendar,
    bulk_delete,
    delete_calendars,
    fetch_calendars,
    get_calendar,
    update_calendar,
)
from suite.mail.jmap import get_calendar_service
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestCalendarCalendars(StalwartIntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.member = cls.create_member()
        cls.account = cls.personal_account(cls.member)

    def _calendars(self) -> dict[str, dict]:
        with self.set_user(self.member.email):
            return {c["_name"]: c for c in fetch_calendars(self.account, limit=50)}

    def test_default_calendar(self):
        with self.set_user(self.member.email):
            rows = get_calendars(self.account)
        self.assertTrue(rows)
        self.assertTrue(any(c["default"] for c in self._calendars().values()))

    def test_calendar_lifecycle(self):
        name = unique_name("cal")
        with self.set_user(self.member.email):
            calendar_id = add_calendar(self.account, name, color="#336699", description="Test calendar")

            detail = get_calendar(self.account, calendar_id)
            self.assertEqual(detail["_name"], name)
            self.assertEqual(detail["color"], "#336699")

            renamed = f"{name}-renamed"
            update_calendar(self.account, calendar_id, renamed, color="#993366")
            detail = get_calendar(self.account, calendar_id)
            self.assertEqual(detail["_name"], renamed)
            self.assertEqual(detail["color"], "#993366")

            delete_calendars(self.account, [calendar_id], remove_events=True)
        self.assertNotIn(renamed, self._calendars())

    def test_bulk_delete(self):
        name = unique_name("cal")
        with self.set_user(self.member.email):
            calendar_id = add_calendar(self.account, name)
            bulk_delete([f"{self.account}|{calendar_id}"])
        self.assertNotIn(name, self._calendars())

    def test_app_calendar_lifecycle(self):
        name = unique_name("cal")
        with self.set_user(self.member.email):
            calendar = create_calendar(self.account, f"  {name}  ", color="#336699")
            account, calendar_id = calendar.split("|")
            self.assertEqual(account, self.account)

            row = next(c for c in get_calendars(self.account) if c["name"] == calendar)
            self.assertEqual((row["_name"], row["color"], row["default"]), (name, "#336699", 0))
            # Listed straight after, it has the reminders every other calendar was seeded with.
            response = get_calendar_service(self.account)._get(
                [calendar_id], properties=["defaultAlertsWithTime"]
            )
            self.assertTrue(response["methodResponses"][0][1]["list"][0].get("defaultAlertsWithTime"))

            # Set wherever else, as another client would.
            update_calendar(
                self.account,
                calendar_id,
                name,
                color="#336699",
                description="Kept",
                time_zone="Asia/Kolkata",
            )
            edit_calendar(self.account, calendar_id, name=f"{name}-renamed")
            detail = get_calendar(self.account, calendar_id)
            # A rename leaves what it was not asked to change.
            self.assertEqual(detail["_name"], f"{name}-renamed")
            self.assertEqual(detail["color"], "#336699")
            self.assertEqual(detail["description"], "Kept")
            self.assertEqual(detail["time_zone"], "Asia/Kolkata")

            edit_calendar(self.account, calendar_id, color="#993366")
            self.assertEqual(get_calendar(self.account, calendar_id)["color"], "#993366")

            self.assertRaises(frappe.ValidationError, edit_calendar, self.account, calendar_id, name="  ")

            delete_calendar(self.account, calendar_id)
        self.assertNotIn(f"{name}-renamed", self._calendars())

    def test_default_calendar_moves_and_is_not_deleted(self):
        with self.set_user(self.member.email):
            previous = next(c for c in get_calendars(self.account) if c["default"])
            calendar = create_calendar(self.account, unique_name("cal"))
            calendar_id = calendar.split("|")[1]

            edit_calendar(self.account, calendar_id, default=True)
            defaults = [c["name"] for c in get_calendars(self.account) if c["default"]]
            self.assertEqual(defaults, [calendar])

            self.assertRaises(frappe.ValidationError, delete_calendar, self.account, calendar_id)

            edit_calendar(self.account, previous["id"], default=True)
            delete_calendar(self.account, calendar_id)
            self.assertNotIn(calendar, [c["name"] for c in get_calendars(self.account)])

    def test_hidden_calendar_stays_hidden(self):
        with self.set_user(self.member.email):
            calendar = create_calendar(self.account, unique_name("cal"))
            calendar_id = calendar.split("|")[1]
            row = next(c for c in get_calendars_with_shared(self.account) if c["name"] == calendar)
            self.assertEqual((row["account"], row["visible"]), (self.account, 1))

            edit_calendar(self.account, calendar_id, visible=False)
            row = next(c for c in get_calendars_with_shared(self.account) if c["name"] == calendar)
            self.assertEqual(row["visible"], 0)

            delete_calendar(self.account, calendar_id)

    def test_foreign_account_denied(self):
        other = self.create_member()
        with self.set_user(other.email):
            self.assertRaises(Exception, add_calendar, self.account, unique_name("cal"))
            self.assertRaises(Exception, create_calendar, self.account, unique_name("cal"))
            self.assertRaises(Exception, edit_calendar, self.account, "b", name=unique_name("cal"))
            self.assertRaises(Exception, delete_calendar, self.account, "b")
            self.assertRaises(Exception, get_calendars_with_shared, self.account)
