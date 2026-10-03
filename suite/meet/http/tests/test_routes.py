from unittest.mock import patch

import frappe
from frappe.tests import UnitTestCase

from suite.composition.tests.http_conformance import HttpConformanceMixin
from suite.meet.http import routes
from suite.meet.http.framework import HTTP


def setUpModule():
    if not getattr(frappe.local, "initialised", False):
        frappe.init(site="")


class TestHttpConformance(HttpConformanceMixin, UnitTestCase):
    HTTP = HTTP


class TestHandlers(UnitTestCase):
    def test_duration_uses_the_requested_span(self):
        self.assertEqual(routes._duration("2026-09-15T10:00:00", "2026-09-15T11:30:00"), "PT5400S")

    @patch("suite.meet.api.meeting.create", return_value="abcd-efgh-ijkl")
    @patch.object(routes, "get_url", return_value="https://slides.localhost/meet/abcd-efgh-ijkl")
    def test_room_type_uses_the_open_workflow(self, _url, create):
        self.assertEqual(
            routes.rooms_post("open"),
            {"code": "abcd-efgh-ijkl", "url": "https://slides.localhost/meet/abcd-efgh-ijkl"},
        )
        create.assert_called_once_with(meeting_type="open")
