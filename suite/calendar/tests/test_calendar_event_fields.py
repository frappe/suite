# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""The event fields the calendar API takes: what the forms and a stored event send must pass,
in whatever case they spell it, and anything else must be refused before the server sees it."""

import frappe
from frappe.tests import UnitTestCase

from suite.calendar.api import edit_calendar_event
from suite.calendar.doctype.calendar_event.fields import EventFields
from suite.utils.validation import parse


class TestEventFields(UnitTestCase):
    def test_form_values_reach_the_service_in_jscalendar_case(self):
        event = parse(
            EventFields,
            {
                "status": "Tentative",
                "draft": 1,
                "privacy": "Private",
                "free_busy_status": "Free",
                "alerts": [
                    {"type": "OffsetTrigger", "action": "Display", "offset": "-pt10m", "relative_to": "End"},
                    {"type": "AbsoluteTrigger", "action": "Email", "when": "2026-09-01T09:00:00Z"},
                ],
            },
        ).for_service()

        self.assertEqual(
            (event["status"], event["is_draft"], event["privacy"], event["free_busy_status"]),
            ("tentative", True, "private", "free"),
        )
        offset, absolute = event["alerts"]
        self.assertEqual(
            (offset["action"], offset["offset"], offset["relative_to"]), ("display", "-PT10M", "end")
        )
        self.assertEqual((absolute["action"], absolute["when"]), ("email", "2026-09-01T09:00:00Z"))

    def test_a_stored_event_passes_as_it_is_read(self):
        # The formatter reports unset enumerations as "", and the rule as a JSON string.
        event = parse(
            EventFields,
            {"privacy": "", "free_busy_status": "", "recurrence_rule": '{"frequency": "weekly"}'},
        ).for_service()

        self.assertEqual((event["privacy"], event["free_busy_status"]), (None, None))
        self.assertEqual(event["recurrence_rule"], {"frequency": "weekly"})

    def test_a_partial_edit_names_only_what_it_sets(self):
        patch = parse(EventFields, {"title": "Standup", "user": "a@example.com"}).model_dump(
            exclude_unset=True
        )

        self.assertEqual(patch, {"title": "Standup"})

    def test_values_the_server_cannot_take_are_refused(self):
        for fields in (
            {"status": "Postponed"},
            {"privacy": "Everyone"},
            {"free_busy_status": "Away"},
            {"alerts": [{"type": "OffsetTrigger", "action": "Display"}]},  # no offset
            {"alerts": [{"type": "AbsoluteTrigger", "action": "Display"}]},  # no time
            {"alerts": [{"type": "Sometime", "action": "Display"}]},
            {"recurrence_rule": "every monday"},
        ):
            with self.subTest(fields=fields), self.assertRaises(frappe.ValidationError):
                parse(EventFields, fields)


class TestEditCalendarEventBoundary(UnitTestCase):
    def test_a_malformed_edit_is_refused_before_the_event_is_fetched(self):
        # Frappe checks no **kwargs; the explicit parse must refuse this before any server call,
        # which this account-less call would otherwise fail at with a different error.
        with self.assertRaisesRegex(frappe.ValidationError, "privacy: Input should be"):
            edit_calendar_event("no-such-account", "no-such-event", privacy="Everyone")
