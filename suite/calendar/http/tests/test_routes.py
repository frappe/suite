import frappe
from frappe.tests import UnitTestCase
from unittest.mock import patch

from suite.calendar.http.framework import HTTP
from suite.calendar.http import routes
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
