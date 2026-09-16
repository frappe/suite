# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.calendar.api import (
    edit_calendar_event,
    get_calendar_event_density,
    get_calendar_events,
)
from suite.calendar.doctype.calendar.calendar import add_calendar
from suite.calendar.doctype.calendar_event.calendar_event import (
    add_calendar_event,
    delete_calendar_event_instance,
    delete_calendar_events,
    update_calendar_event_instance,
)
from suite.calendar.doctype.calendar_event.calendar_event import (
    get_calendar_events as get_events_by_ids,
)
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name

RANGE = ("2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z")


class TestCalendarEvents(StalwartIntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.member = cls.create_member()
        cls.account = cls.personal_account(cls.member)

    def _events_in_range(self, title: str) -> list[dict]:
        with self.set_user(self.member.email):
            events = get_calendar_events(self.account, RANGE[0], RANGE[1], "UTC")
            return [e for e in events if e["title"] == title]

    def _wait_for_event(self, title: str, count: int = 1) -> list[dict]:
        return self.wait_until(
            lambda: ((found := self._events_in_range(title)) and len(found) >= count and found) or None,
            timeout=60,
            message=f"Event '{title}' did not show up in the range query.",
        )

    def test_event_lifecycle(self):
        title = f"Standup {unique_name('event')}"
        with self.set_user(self.member.email):
            event_id = add_calendar_event(
                self.account,
                title=title,
                start="2026-09-02T10:00:00",
                duration="PT1H",
                time_zone="UTC",
                description="Daily sync",
                privacy="Private",
                free_busy_status="Busy",
                locations=[{"name": "Room 1"}],
                links=[{"href": "https://meet.example.test/standup", "content_type": "text/html"}],
            )

            detail = get_events_by_ids(self.account, [event_id])[0]
            self.assertEqual(detail["title"], title)
            self.assertEqual(detail["privacy"], "Private")
            self.assertEqual(detail["description"], "Daily sync")
            self.assertEqual([loc["_name"] for loc in detail["locations"]], ["Room 1"])
            self.assertEqual(len(detail["links"]), 1)

        # The range query expands into synthetic instance ids; the real id is master_id.
        found = self._wait_for_event(title)
        self.assertEqual(found[0]["master_id"], event_id)

        # A partial patch must not clobber the child collections (_with_name regression).
        renamed = f"{title} v2"
        with self.set_user(self.member.email):
            edit_calendar_event(self.account, event_id, title=renamed)
            detail = get_events_by_ids(self.account, [event_id])[0]
            self.assertEqual(detail["title"], renamed)
            self.assertEqual([loc["_name"] for loc in detail["locations"]], ["Room 1"])

            delete_calendar_events(self.account, [event_id])
            self.assertEqual(get_events_by_ids(self.account, [event_id]), [])

    def test_event_density_carries_only_what_a_tick_needs(self):
        """The mini month's source: enough to place a mark, and nothing else."""

        title = f"Density {unique_name('event')}"
        with self.set_user(self.member.email):
            event_id = add_calendar_event(
                self.account,
                title=title,
                start="2026-09-08T10:00:00",
                duration="PT1H",
                time_zone="UTC",
                description="Should not travel with a tick",
                locations=[{"name": "Room 1"}],
            )

        self._wait_for_event(title)

        with self.set_user(self.member.email):
            rows = get_calendar_event_density(self.account, RANGE[0], RANGE[1], "UTC")

        self.assertTrue(rows, "Density returned nothing for a range holding an event.")

        # Placed by when it runs and whose calendar it is on — the two things a tick is.
        on_the_day = [row for row in rows if (row["start"] or "").startswith("2026-09-08")]
        self.assertTrue(on_the_day, "The event's own day is missing from the density.")
        self.assertEqual(on_the_day[0]["duration"], "PT1H")
        self.assertTrue(on_the_day[0]["calendars"])
        self.assertFalse(on_the_day[0]["is_declined"])

        # The point of a separate call: none of the payload a full event drags along.
        for row in rows:
            self.assertNotIn("description", row)
            self.assertNotIn("participants", row)
            self.assertNotIn("locations", row)
            self.assertNotIn("title", row)

        with self.set_user(self.member.email):
            delete_calendar_events(self.account, [event_id])

    def test_all_day_event(self):
        title = f"Holiday {unique_name('event')}"
        with self.set_user(self.member.email):
            event_id = add_calendar_event(
                self.account,
                title=title,
                start="2026-09-10T00:00:00",
                duration="P1D",
                show_without_time=True,
            )
            detail = get_events_by_ids(self.account, [event_id])[0]
            self.assertTrue(detail["show_without_time"])

    def test_move_between_calendars(self):
        title = f"Movable {unique_name('event')}"
        with self.set_user(self.member.email):
            other_calendar = add_calendar(self.account, unique_name("cal"))
            event_id = add_calendar_event(
                self.account, title=title, start="2026-09-03T09:00:00", duration="PT30M"
            )

            edit_calendar_event(self.account, event_id, calendar_ids=[other_calendar])
            detail = get_events_by_ids(self.account, [event_id])[0]
            self.assertEqual([c["calendar_id"] for c in detail["calendars"]], [other_calendar])

    def test_recurrence(self):
        title = f"Weekly {unique_name('event')}"
        with self.set_user(self.member.email):
            master_id = add_calendar_event(
                self.account,
                title=title,
                start="2026-09-07T08:00:00",
                duration="PT1H",
                time_zone="UTC",
                recurrence_rule={"@type": "RecurrenceRule", "frequency": "weekly", "count": 3},
            )

        instances = self._wait_for_event(title, count=2)
        self.assertGreaterEqual(len(instances), 2)
        for instance in instances:
            self.assertEqual(instance["master_id"], master_id)
            self.assertTrue(instance["recurrence_id"])

        # Override one instance, then delete another.
        target, other = instances[0], instances[1]
        with self.set_user(self.member.email):
            update_calendar_event_instance(
                self.account, master_id, target["recurrence_id"], {"title": f"{title} (moved)"}
            )
        self.wait_until(
            lambda: self._events_in_range(f"{title} (moved)"),
            message="Instance override did not apply.",
        )

        with self.set_user(self.member.email):
            delete_calendar_event_instance(self.account, master_id, other["recurrence_id"])
        self.wait_until(
            lambda: all(e["recurrence_id"] != other["recurrence_id"] for e in self._events_in_range(title)),
            message="Deleted instance still expands in the range query.",
        )

    def test_unknown_event(self):
        with self.set_user(self.member.email):
            self.assertEqual(get_events_by_ids(self.account, ["nope"]), [])
            self.assertRaises(frappe.DoesNotExistError, edit_calendar_event, self.account, "nope", title="x")
