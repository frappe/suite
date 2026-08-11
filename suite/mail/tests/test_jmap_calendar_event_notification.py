# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""``CalendarEventNotification/get`` must always name the properties it wants.

Stalwart returns a reduced default property set when a ``get`` omits ``properties``, which
silently drops ``event``/``eventPatch`` from every notification. The service therefore sends
``EVENT_NOTIFICATION_PROPERTIES`` unless the caller names its own set - on every request, batched
or not. These tests pin that forwarding, since a regression is invisible in the response shape:
the call still succeeds, the fields just stop arriving.
"""

import unittest
from unittest import mock

from suite.mail.jmap.services.calendars.calendar_event_notification import (
    CalendarEventNotificationService,
)


class _StubConnection:
    """The slice of ``JMAPConnection`` the service reads: server limits, via capabilities."""

    def __init__(self, max_objects_in_get: int = 500) -> None:
        self.capabilities = {
            "urn:ietf:params:jmap:core": {"maxObjectsInGet": max_objects_in_get},
            "urn:ietf:params:jmap:calendars": {},
        }


def _response(*ids: str) -> dict:
    """A ``CalendarEventNotification/get`` response carrying the given notification ids."""

    return {"methodResponses": [["CalendarEventNotification/get", {"list": [{"id": i} for i in ids]}, "0"]]}


class CalendarEventNotificationGetProperties(unittest.TestCase):
    """``get`` - what lands in the ``properties`` argument of each underlying ``_get``."""

    def _service(self, max_objects_in_get: int = 500) -> CalendarEventNotificationService:
        return CalendarEventNotificationService("account-1", _StubConnection(max_objects_in_get))

    def test_unbatched_get_sends_the_default_properties(self):
        service = self._service()
        with mock.patch.object(service, "_get", return_value=_response("n1")) as _get:
            service.get()

        _get.assert_called_once_with(properties=service.EVENT_NOTIFICATION_PROPERTIES)

    def test_unbatched_get_sends_caller_supplied_properties(self):
        service = self._service()
        with mock.patch.object(service, "_get", return_value=_response("n1")) as _get:
            service.get(properties=["id", "created"])

        _get.assert_called_once_with(properties=["id", "created"])

    def test_batched_get_sends_the_default_properties(self):
        service = self._service()
        with mock.patch.object(service, "_get", return_value=_response("n1")) as _get:
            service.get(["n1"])

        _get.assert_called_once_with(["n1"], properties=service.EVENT_NOTIFICATION_PROPERTIES)

    def test_batched_get_sends_caller_supplied_properties(self):
        service = self._service()
        with mock.patch.object(service, "_get", return_value=_response("n1")) as _get:
            service.get(["n1"], properties=["id", "type"])

        _get.assert_called_once_with(["n1"], properties=["id", "type"])

    def test_every_batch_carries_the_properties(self):
        """Not just the first one: forwarding inside the loop is the part that can rot."""

        service = self._service(max_objects_in_get=2)
        with mock.patch.object(service, "_get", return_value=_response()) as _get:
            service.get(["n1", "n2", "n3", "n4", "n5"], properties=["id", "event"])

        self.assertEqual(
            _get.call_args_list,
            [
                mock.call(["n1", "n2"], properties=["id", "event"]),
                mock.call(["n3", "n4"], properties=["id", "event"]),
                mock.call(["n5"], properties=["id", "event"]),
            ],
        )

    def test_every_batch_carries_the_defaults(self):
        service = self._service(max_objects_in_get=2)
        with mock.patch.object(service, "_get", return_value=_response()) as _get:
            service.get(["n1", "n2", "n3"])

        self.assertEqual(
            [call.kwargs["properties"] for call in _get.call_args_list],
            [service.EVENT_NOTIFICATION_PROPERTIES] * 2,
        )

    def test_empty_properties_falls_back_to_the_defaults(self):
        """``[]`` means "no preference", not "no properties" - an empty set would fetch nothing usable."""

        service = self._service()
        with mock.patch.object(service, "_get", return_value=_response("n1")) as _get:
            service.get(["n1"], properties=[])
            service.get(properties=[])

        self.assertEqual(
            [call.kwargs["properties"] for call in _get.call_args_list],
            [service.EVENT_NOTIFICATION_PROPERTIES] * 2,
        )

    def test_results_are_collected_across_batches(self):
        service = self._service(max_objects_in_get=2)
        responses = [_response("n1", "n2"), _response("n3")]
        with mock.patch.object(service, "_get", side_effect=responses):
            results = service.get(["n1", "n2", "n3"])

        self.assertEqual([r["id"] for r in results], ["n1", "n2", "n3"])

    def test_missing_method_responses_yields_no_results(self):
        service = self._service()
        with mock.patch.object(service, "_get", return_value={}):
            self.assertEqual(service.get(["n1"]), [])
            self.assertEqual(service.get(), [])


class CalendarEventNotificationDefaultProperties(unittest.TestCase):
    """The default set has to cover everything the Event Notification doctype renders."""

    def test_defaults_cover_every_field_the_formatter_reads(self):
        from suite.calendar.doctype.event_notification.event_notification import (
            format_event_notification,
        )

        notification = {
            "id": "n1",
            "created": "2026-08-11T09:00:00Z",
            "changedBy": {
                "name": "Jamie",
                "email": "jamie@example.test",
                "principalId": "p1",
                "scheduleId": "s1",
            },
            "comment": "moved a day",
            "type": "updated",
            "calendarEventId": "e1",
            "isDraft": False,
            "event": {"title": "Standup"},
            "eventPatch": {"start": "2026-08-12T09:00:00"},
        }
        self.assertEqual(
            sorted(notification), sorted(CalendarEventNotificationService.EVENT_NOTIFICATION_PROPERTIES)
        )

        formatted = format_event_notification("account-1", notification)
        self.assertEqual(formatted["changed_by_name"], "Jamie")
        self.assertEqual(formatted["calendar_event"], "account-1|e1")
        self.assertIn("Standup", formatted["event"])
        self.assertIn("2026-08-12T09:00:00", formatted["event_patch"])
