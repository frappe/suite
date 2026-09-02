# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.calendar.api import (
    edit_calendar_event,
    get_calendar_events,
    rsvp_calendar_event,
    split_calendar_event_series,
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

        # The override written first has to survive both of the writes that followed it. Each of
        # them lands on one occurrence's key; the map as a whole is never read, edited and sent
        # back, which is how a second writer's override used to disappear.
        moved = self._events_in_range(f"{title} (moved)")
        self.assertEqual(len(moved), 1)
        self.assertEqual(moved[0]["recurrence_id"], target["recurrence_id"])

    def test_instance_overrides_are_independent(self):
        """Overriding one occurrence leaves every other occurrence's override where it was."""

        title = f"Series {unique_name('event')}"
        with self.set_user(self.member.email):
            master_id = add_calendar_event(
                self.account,
                title=title,
                start="2026-09-07T08:00:00",
                duration="PT1H",
                time_zone="UTC",
                recurrence_rule={"@type": "RecurrenceRule", "frequency": "weekly", "count": 3},
            )

        instances = self._wait_for_event(title, count=3)
        first, second, third = instances[0], instances[1], instances[2]

        with self.set_user(self.member.email):
            # The first override on an event with none: the whole map is written, since there is
            # nothing to patch into. The second adds a key beside it, the third patches a property
            # of the first — three different shapes, and none of them may disturb the others.
            update_calendar_event_instance(
                self.account, master_id, first["recurrence_id"], {"title": f"{title} (first)"}
            )
            update_calendar_event_instance(
                self.account, master_id, second["recurrence_id"], {"title": f"{title} (second)"}
            )
            update_calendar_event_instance(
                self.account, master_id, first["recurrence_id"], {"start": "2026-09-07T11:00:00"}
            )

        def all_three_stand():
            events = {
                e["recurrence_id"]: e
                for e in self._events_in_range(f"{title} (first)")
                + self._events_in_range(f"{title} (second)")
                + self._events_in_range(title)
            }
            first_now = events.get(first["recurrence_id"])
            second_now = events.get(second["recurrence_id"])
            third_now = events.get(third["recurrence_id"])
            if not (first_now and second_now and third_now):
                return None
            # The first keeps the title it was given AND takes the later start; the second keeps
            # its own title; the third was never touched.
            return (
                first_now["title"] == f"{title} (first)"
                and first_now["start"].endswith("11:00:00")
                and second_now["title"] == f"{title} (second)"
                and third_now["title"] == title
            ) or None

        self.wait_until(all_three_stand, message="An override was lost when another one was written.")

    def test_this_and_following_splits_the_series(self):
        """The occurrences before the split keep what they had; the rest carry the edit.

        JSCalendar can say "this date" or "the series" and nothing in between, so the series is
        cut in two. The old half stops before this occurrence and the new one starts at it —
        which is why the count has to be shared out rather than repeated.
        """

        title = f"Series {unique_name('event')}"
        with self.set_user(self.member.email):
            master_id = add_calendar_event(
                self.account,
                title=title,
                start="2026-09-07T08:00:00",
                duration="PT1H",
                time_zone="UTC",
                recurrence_rule={"@type": "RecurrenceRule", "frequency": "weekly", "count": 4},
            )

        instances = self._wait_for_event(title, count=4)
        third = instances[2]
        renamed = f"{title} (from the third)"

        with self.set_user(self.member.email):
            split_calendar_event_series(
                self.account,
                master_id,
                third["recurrence_id"],
                title=renamed,
                start=third["recurrence_id"],
                duration="PT1H",
                time_zone="UTC",
                recurrence_rule={"@type": "RecurrenceRule", "frequency": "weekly", "count": 4},
            )

        def both_halves_stand():
            kept = self._events_in_range(title)
            moved = self._events_in_range(renamed)
            # Two each: the count is shared out between the halves, not handed to both.
            if len(kept) != 2 or len(moved) != 2:
                return None
            return sorted(e["start"] for e in kept) < sorted(e["start"] for e in moved) or None

        self.wait_until(both_halves_stand, message="The series did not split into two halves.")

    def test_rsvp_answers_one_occurrence_at_a_time(self):
        """An answer to one occurrence is stored on that date and leaves the others alone."""

        title = f"Series {unique_name('event')}"
        with self.set_user(self.member.email):
            master_id = add_calendar_event(
                self.account,
                organizer=self.member.email,
                title=title,
                start="2026-09-08T08:00:00",
                duration="PT1H",
                time_zone="UTC",
                recurrence_rule={"@type": "RecurrenceRule", "frequency": "weekly", "count": 3},
                participants=[
                    {
                        "email": self.member.email,
                        "participation_status": "NEEDS-ACTION",
                        "expect_reply": True,
                    }
                ],
            )

        instances = self._wait_for_event(title, count=3)
        answered = instances[1]

        with self.set_user(self.member.email):
            rsvp_calendar_event(self.account, master_id, "declined", recurrence_id=answered["recurrence_id"])

        def only_that_one_declined():
            statuses = {
                event["recurrence_id"]: next(
                    (
                        p["participation_status"]
                        for p in event["participants"]
                        if p["email"] == self.member.email
                    ),
                    None,
                )
                for event in self._events_in_range(title)
            }
            if len(statuses) != 3:
                return None
            return (
                statuses.get(answered["recurrence_id"]) == "DECLINED"
                and all(
                    status != "DECLINED"
                    for rid, status in statuses.items()
                    if rid != answered["recurrence_id"]
                )
            ) or None

        self.wait_until(only_that_one_declined, message="The RSVP did not stay on its own occurrence.")

    def test_unknown_event(self):
        with self.set_user(self.member.email):
            self.assertEqual(get_events_by_ids(self.account, ["nope"]), [])
            self.assertRaises(frappe.DoesNotExistError, edit_calendar_event, self.account, "nope", title="x")
