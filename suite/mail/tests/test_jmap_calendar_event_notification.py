# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""``CalendarEventNotification/get`` must always name the properties it wants.

Stalwart returns a reduced default property set when a ``get`` omits ``properties``, which
silently drops ``event``/``eventPatch`` from every notification. ``fetch_notifications``
therefore sends ``EVENT_NOTIFICATION_PROPERTIES`` unless the caller names its own set - on
every request, chunked or not. These tests pin that at the wire (the fake server records the
actual request bodies), since a regression is invisible in the response shape: the call still
succeeds, the fields just stop arriving.
"""

import unittest

import httpx
from jmap.auth import BasicAuth
from jmap.core.retry import RetryPolicy
from jmap.testing.fake import FakeJMAPServer

from suite.calendar.doctype.event_notification.event_notification import (
    EVENT_NOTIFICATION_PROPERTIES,
    fetch_notifications,
)
from suite.mail.jmap import SuiteJMAPClient

CORE = "urn:ietf:params:jmap:core"
CALENDARS = "urn:ietf:params:jmap:calendars"


class CalendarEventNotificationGetProperties(unittest.TestCase):
    """What lands in the ``properties`` argument of each ``CalendarEventNotification/get``."""

    def _client(self, max_objects_in_get: int = 500) -> tuple[SuiteJMAPClient, FakeJMAPServer]:
        server = FakeJMAPServer(
            capabilities={CORE: {"maxObjectsInGet": max_objects_in_get}, CALENDARS: {}},
            accounts={
                "acc1": {
                    "name": "alice@example.com",
                    "isPersonal": True,
                    "accountCapabilities": {CALENDARS: {}},
                }
            },
            primary_accounts={CORE: "acc1", CALENDARS: "acc1"},
        )
        server.handle("CalendarEventNotification/get", _get_handler)
        http = httpx.Client(auth=BasicAuth("alice", "pw"), **server.client_kwargs())
        client = SuiteJMAPClient.connect(
            "https://jmap.example.com/.well-known/jmap",
            auth=BasicAuth("alice", "pw"),
            http=http,
            experimental=True,
            retry_policy=RetryPolicy(max_attempts=1),
        )
        return client, server

    def _properties_sent(self, server: FakeJMAPServer) -> list[list[str] | None]:
        return [
            call[1].get("properties")
            for request in server.requests
            for call in request["methodCalls"]
            if call[0] == "CalendarEventNotification/get"
        ]

    def test_unchunked_get_sends_the_default_properties(self):
        client, server = self._client()
        fetch_notifications(client)

        self.assertEqual(self._properties_sent(server), [EVENT_NOTIFICATION_PROPERTIES])

    def test_unchunked_get_sends_caller_supplied_properties(self):
        client, server = self._client()
        fetch_notifications(client, properties=["id", "created"])

        self.assertEqual(self._properties_sent(server), [["id", "created"]])

    def test_every_chunk_carries_the_properties(self):
        """Not just the first one: jmaplib splits an oversized ids list into several calls,
        and each must carry the requested properties."""

        client, server = self._client(max_objects_in_get=2)
        fetch_notifications(client, ["n1", "n2", "n3", "n4", "n5"], properties=["id", "event"])

        self.assertEqual(self._properties_sent(server), [["id", "event"]] * 3)

    def test_every_chunk_carries_the_defaults(self):
        client, server = self._client(max_objects_in_get=2)
        fetch_notifications(client, ["n1", "n2", "n3"])

        self.assertEqual(self._properties_sent(server), [EVENT_NOTIFICATION_PROPERTIES] * 2)

    def test_empty_properties_falls_back_to_the_defaults(self):
        """``[]`` means "no preference", not "no properties" - an empty set would fetch nothing usable."""

        client, server = self._client()
        fetch_notifications(client, ["n1"], properties=[])
        fetch_notifications(client, properties=[])

        self.assertEqual(self._properties_sent(server), [EVENT_NOTIFICATION_PROPERTIES] * 2)

    def test_results_are_collected_across_chunks(self):
        client, server = self._client(max_objects_in_get=2)
        results = fetch_notifications(client, ["n1", "n2", "n3"])

        self.assertEqual([r["id"] for r in results], ["n1", "n2", "n3"])


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
        self.assertEqual(sorted(notification), sorted(EVENT_NOTIFICATION_PROPERTIES))

        formatted = format_event_notification("account-1", notification)
        self.assertEqual(formatted["changed_by_name"], "Jamie")
        self.assertEqual(formatted["calendar_event"], "account-1|e1")
        self.assertIn("Standup", formatted["event"])
        self.assertIn("2026-08-12T09:00:00", formatted["event_patch"])


def _get_handler(args: dict, _server: FakeJMAPServer) -> dict:
    """Answers a get with one stub row per asked id (or a fixed row for an id-less get),
    with a constant state so jmaplib's chunk merge never reads it as torn."""

    ids = args.get("ids")
    rows = [{"id": i} for i in ids] if ids else [{"id": "n1"}]
    return {"accountId": args.get("accountId"), "state": "s0", "list": rows, "notFound": []}
