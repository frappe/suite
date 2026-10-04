from unittest.mock import patch

import frappe
from frappe.tests import UnitTestCase
from pydantic import TypeAdapter

from suite.calendar.http import routes
from suite.calendar.http.framework import HTTP
from suite.composition.tests.http_conformance import HttpConformanceMixin


def setUpModule():
    if not getattr(frappe.local, "initialised", False):
        frappe.init(site="")


class TestHttpConformance(HttpConformanceMixin, UnitTestCase):
    HTTP = HTTP


class TestHandlers(UnitTestCase):
    @patch.object(routes, "get_url", return_value="https://slides.localhost")
    def test_conferencing_accepts_only_same_site_structured_meet_links(self, _url):
        self.assertEqual(
            routes._conferencing([{"href": "https://slides.localhost/meet/room-1"}]),
            {"meeting_id": "room-1", "url": "https://slides.localhost/meet/room-1"},
        )
        self.assertIsNone(routes._conferencing([{"href": "https://other.example/meet/room-1"}]))

    @patch.object(routes, "get_calendar_events")
    @patch.object(routes, "get_user_jmap_accounts", return_value=["a1", "a2"])
    def test_omitted_account_expands_every_owned_account(self, _accounts, get_events):
        get_events.side_effect = [
            [{"account": "a1", "id": "2", "start": "2026-09-15T12:00:00", "links": []}],
            [{"account": "a2", "id": "1", "start": "2026-09-15T10:00:00", "links": []}],
        ]
        rows = routes.events_get(to="2026-09-16T00:00:00", **{"from": "2026-09-15T00:00:00"})
        self.assertEqual([row["account"] for row in rows], ["a2", "a1"])
        self.assertTrue(all(row["conferencing"] is None for row in rows))

    @patch.object(routes, "get_calendar_events")
    @patch.object(routes, "get_user_jmap_accounts", return_value=["a1"])
    def test_recurrence_rule_is_an_object_or_null(self, _accounts, get_events):
        weekly = {"@type": "RecurrenceRule", "frequency": "weekly"}
        get_events.return_value = [
            # Resolved through its series: the object itself.
            {"account": "a1", "id": "1", "start": "2026-09-15T09:00:00", "recurrence_rule": weekly},
            # Not resolved yet: the stored JSON text.
            {
                "account": "a1",
                "id": "2",
                "start": "2026-09-15T10:00:00",
                "recurrence_rule": '{"frequency": "daily"}',
            },
            # One-off events, in each shape the read hands over.
            {"account": "a1", "id": "3", "start": "2026-09-15T11:00:00", "recurrence_rule": "{}"},
            {"account": "a1", "id": "4", "start": "2026-09-15T12:00:00", "recurrence_rule": {}},
            {"account": "a1", "id": "5", "start": "2026-09-15T13:00:00"},
        ]
        rows = routes.events_get(to="2026-09-16T00:00:00", **{"from": "2026-09-15T00:00:00"})
        self.assertEqual(
            [row["recurrence_rule"] for row in rows],
            [weekly, {"frequency": "daily"}, None, None, None],
        )
        # The output schema the client validates against accepts every row.
        TypeAdapter(list[routes.CalendarEvent]).validate_python(rows, strict=True)
