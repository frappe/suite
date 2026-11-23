"""Device notifications reach the app they are about, through the one relay project."""

from __future__ import annotations

import unittest
from unittest import mock

import frappe

from suite.suite_core import push


class FakeRelay:
    """The relay as the site sees it: tokens by address, and what was sent to whom."""

    def __init__(self, project_name: str, enabled: bool = True):
        self.project_name = project_name
        self.enabled = enabled
        self.tokens: dict[str, set[str]] = {}
        self.sent: list[tuple[str, str, str | None]] = []

    def is_enabled(self) -> bool:
        return self.enabled

    def add_token(self, user_id, token):
        self.tokens.setdefault(user_id, set()).add(token)
        return True, "Token added"

    def remove_token(self, user_id, token):
        self.tokens.get(user_id, set()).discard(token)
        return True, "Token removed"

    def send_notification_to_user(self, user_id, title, body, link=None, icon=None):
        self.sent.append((user_id, title, link))
        return True


class PushPerApp(unittest.TestCase):
    def setUp(self):
        self.relay = FakeRelay("mail")
        patcher = mock.patch(
            "suite.suite_core.push.PushNotification",
            side_effect=lambda project: self.relay if project == "mail" else FakeRelay(project),
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        frappe.set_user("Administrator")
        self.addCleanup(frappe.set_user, "Administrator")

    def test_an_installed_app_is_notified_only_of_its_own(self):
        # The Calendar app subscribes for Calendar; the Mail app, on another device, for Mail.
        push.subscribe("calendar-device", ["calendar"])
        push.subscribe("mail-device", ["mail"])

        push.notify("Administrator", "calendar", "Standup", "In 10 minutes", "/calendar/e/1")
        push.notify("Administrator", "mail", "Ada", "Lunch?", "/mail/m/1")

        delivered = {
            user_id: sorted(self.relay.tokens[user_id]) for user_id, _title, _link in self.relay.sent
        }
        self.assertEqual(
            delivered,
            {"Administrator::calendar": ["calendar-device"], "Administrator": ["mail-device"]},
        )

    def test_a_browser_tab_is_subscribed_for_every_app(self):
        push.subscribe("tab", ["mail", "calendar"])
        self.assertEqual(
            {user_id for user_id, tokens in self.relay.tokens.items() if "tab" in tokens},
            {"Administrator", "Administrator::calendar"},
        )
        push.unsubscribe("tab", ["mail", "calendar"])
        self.assertFalse(any("tab" in tokens for tokens in self.relay.tokens.values()))

    def test_mail_keeps_the_address_subscriptions_had_before_the_split(self):
        self.assertEqual(push.relay_user("ada@example.com", "mail"), "ada@example.com")

    def test_an_unknown_app_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            push.subscribe("tab", ["drive"])

    def test_nothing_is_sent_while_the_relay_is_off(self):
        self.relay.enabled = False
        self.assertFalse(push.notify("Administrator", "mail", "Ada", "Lunch?"))
        self.assertEqual(self.relay.sent, [])
