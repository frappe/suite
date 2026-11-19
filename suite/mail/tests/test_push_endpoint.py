# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""The push endpoint is open to anyone, and without push encryption nothing proves the mail
server sent a push. So it may only start work for a real user, on accounts that user holds."""

import json
from contextlib import contextmanager
from unittest import mock

import frappe
from frappe.tests import IntegrationTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite.mail.api import jmap as push_api
from suite.tests.utils import ABSENT, restore_local

EXTRA_TEST_RECORD_DEPENDENCIES = ["User"]

USER = "test1@example.com"
HELD = "push-held-account"
NOT_HELD = "push-other-account"


@contextmanager
def push(user: str, body: dict):
    """A plain-JSON push to the endpoint, as a mail server sends it without encryption."""

    kept = getattr(frappe.local, "request", ABSENT)
    builder = EnvironBuilder(
        path="/api/method/suite.mail.api.jmap.push_notification",
        method="POST",
        query_string={"user": user},
        data=json.dumps(body),
        content_type="application/json",
    )
    frappe.local.request = Request(builder.get_environ())
    try:
        yield
    finally:
        restore_local("request", kept)


class TestPushEndpoint(IntegrationTestCase):
    def setUp(self):
        for account in (HELD, NOT_HELD):
            if not frappe.db.exists("JMAP Account", account):
                frappe.get_doc({"doctype": "JMAP Account", "name": account}).db_insert()
        if not frappe.db.exists("User Account", HELD):
            frappe.get_doc(
                {"doctype": "User Account", "name": HELD, "account": HELD, "user": USER}
            ).db_insert()

        frappe.set_user("Guest")
        self.addCleanup(frappe.set_user, "Administrator")

        self.synced = self._watch("enqueue_fetch_changes")
        self.alerted = self._watch("enqueue_send_event_alert_notification")

    def _watch(self, name: str) -> mock.Mock:
        patch = mock.patch.object(push_api, name)
        self.addCleanup(patch.stop)
        return patch.start()

    def _push(self, user: str, body: dict) -> dict:
        with push(user, body):
            return push_api.push_notification()

    def _synced_accounts(self) -> list[str]:
        return [call.args[1] for call in self.synced.call_args_list]

    def test_a_push_for_someone_who_is_not_a_user_starts_nothing(self):
        result = self._push(
            "nobody@example.test", {"@type": "StateChange", "changed": {HELD: {"Email": "s2"}}}
        )

        self.assertEqual(result["status"], "error")
        self.synced.assert_not_called()

    def test_a_push_syncs_only_the_accounts_the_user_holds(self):
        result = self._push(
            USER,
            {
                "@type": "StateChange",
                "changed": {HELD: {"Email": "s2"}, NOT_HELD: {"Email": "s9"}},
            },
        )

        self.assertEqual(result["status"], "processed")
        self.assertEqual(self._synced_accounts(), [HELD])

    def test_a_calendar_alert_for_an_account_the_user_does_not_hold_alerts_nothing(self):
        alert = {
            "@type": "CalendarAlert",
            "calendarEventId": "e7",
            "uid": "5e0a9d3c-standup",
            "alertId": "a1",
        }

        self._push(USER, {**alert, "accountId": NOT_HELD})
        self.alerted.assert_not_called()

        self._push(USER, {**alert, "accountId": HELD})
        self.alerted.assert_called_once()
