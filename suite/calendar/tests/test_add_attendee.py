"""Adding a workspace member to someone's event: both calendars show the same meeting."""

from datetime import datetime

from suite import calendar
from suite.calendar import jmap_events
from suite.mail.jmap import get_account_client
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestAddAttendee(StalwartIntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.organizer = cls.create_member()
        cls.attendee = cls.create_member()
        # Looking an account up once records it, as a person's first visit to Mail does.
        cls.personal_account(cls.organizer)
        cls.personal_account(cls.attendee)

    def events_titled(self, member, title: str) -> list[dict]:
        client = get_account_client(self.personal_account(member), ignore_permissions=True)
        return [event for event in jmap_events.get_events(client) if event.get("title") == title]

    def addresses(self, event: dict) -> set[str]:
        return {
            participant["calendarAddress"].removeprefix("mailto:")
            for participant in (event.get("participants") or {}).values()
        }

    def test_the_event_lands_in_both_calendars_once_with_both_people_on_it(self):
        title = f"Stand-up {unique_name('event')}"
        with self.set_user(self.organizer.email):
            event_id = calendar.add_event(title, datetime(2026, 12, 1, 10), "PT15M", time_zone="UTC")

        self.assertTrue(calendar.add_attendee(self.organizer.email, event_id, self.attendee.email))
        # A second call, as when a welcome is retried, changes nothing.
        self.assertTrue(calendar.add_attendee(self.organizer.email, event_id, self.attendee.email))

        [organizers_copy] = self.events_titled(self.organizer, title)
        [attendees_copy] = self.events_titled(self.attendee, title)
        self.assertEqual(attendees_copy["uid"], organizers_copy["uid"])
        both = {self.organizer.email, self.attendee.email}
        self.assertEqual(self.addresses(organizers_copy), both)
        self.assertEqual(self.addresses(attendees_copy), both)

    def test_a_deleted_event_is_reported_not_raised(self):
        self.assertFalse(calendar.add_attendee(self.organizer.email, "no-such-event", self.attendee.email))
