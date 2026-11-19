# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.calendar import jmap_events
from suite.calendar.api import get_participant_availability
from suite.calendar.doctype.calendar_event.calendar_event import add_calendar_event
from suite.mail.tests.base import StalwartIntegrationTestCase

DAY = ("2026-09-02T00:00:00Z", "2026-09-03T00:00:00Z")


class TestParticipantAvailability(StalwartIntegrationTestCase):
    """What the mail server tells one member about another's busy time (specs/calendar/002)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.writer = cls.create_member(first_name="Writer")
        cls.colleague = cls.create_member(first_name="Colleague")
        cls.writer_account = cls.personal_account(cls.writer)
        cls.colleague_account = cls.personal_account(cls.colleague)

        with cls.set_user(cls.colleague.email):
            for start, free_busy in (("2026-09-02T10:00:00", "Busy"), ("2026-09-02T14:00:00", "Free")):
                add_calendar_event(
                    cls.colleague_account,
                    title=f"{free_busy} hour",
                    start=start,
                    duration="PT1H",
                    time_zone="UTC",
                    free_busy_status=free_busy,
                )

    def look_up(self, emails: list[str], window: tuple[str, str] = DAY) -> list[dict]:
        with self.set_user(self.writer.email):
            return get_participant_availability(self.writer_account, emails, *window)

    def share_with_writer(self, rights: dict | None) -> None:
        client = self.get_user_jmap_client(self.colleague.email)
        calendar = next(c for c in jmap_events.get_calendars(client) if c.get("isDefault", True))
        share = {self.writer_account: rights} if rights else None
        with client.batch() as b:
            b.add(
                "Calendar/set",
                {"accountId": self.colleague_account, "update": {calendar["id"]: {"shareWith": share}}},
            )

    def test_a_colleague_who_shared_nothing_answers_as_an_empty_day(self):
        self.assertEqual(self.look_up([self.colleague.email]), [{"email": self.colleague.email, "busy": []}])

    def test_a_free_busy_share_shows_the_busy_time_and_not_the_free_time(self):
        self.share_with_writer({"mayReadFreeBusy": True})
        self.addCleanup(self.share_with_writer, None)

        answer = self.wait_until(
            lambda: (found := self.look_up([self.colleague.email])) and found[0]["busy"] and found,
            message="The shared busy hour never showed up.",
        )
        self.assertEqual(
            [(p["utc_start"], p["utc_end"]) for p in answer[0]["busy"]],
            [("2026-09-02T10:00:00Z", "2026-09-02T11:00:00Z")],
        )

    def test_neither_the_writer_nor_people_on_other_servers_are_answered(self):
        answer = self.look_up([self.writer.email, "someone@elsewhere.example", self.colleague.email.upper()])
        self.assertEqual([person["email"] for person in answer], [self.colleague.email.lower()])

    def test_no_lookup_past_the_limits(self):
        many = [f"guest{n}@elsewhere.example" for n in range(21)]
        self.assertRaises(frappe.ValidationError, self.look_up, many)
        fortnight_and_a_day = ("2026-09-01T00:00:00Z", "2026-09-16T00:00:00Z")
        self.assertRaises(frappe.ValidationError, self.look_up, [self.colleague.email], fortnight_and_a_day)

    def test_another_members_account_is_not_the_writers_to_ask_from(self):
        with self.set_user(self.writer.email):
            self.assertRaises(
                frappe.PermissionError,
                get_participant_availability,
                self.colleague_account,
                [self.writer.email],
                *DAY,
            )
