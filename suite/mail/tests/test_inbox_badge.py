"""The sidebar must not contact Mail when the user cannot use it."""

from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from suite.mail.api import mail


class InboxBadgeTest(TestCase):
    def test_unconfigured_mail_does_not_read_accounts_or_credentials(self):
        with (
            patch.object(mail, "frappe") as frappe_mock,
            patch.object(mail, "can_use_mail", return_value=False) as available,
            patch.object(
                mail, "get_user_jmap_accounts", side_effect=ValueError("Invalid credentials")
            ) as accounts,
            patch.object(mail, "get_account_client") as client,
        ):
            frappe_mock.session.user = "preview@example.test"
            self.assertEqual(mail.get_all_inbox_unread_count(), 0)
            available.assert_called_once_with("preview@example.test")
            accounts.assert_not_called()
            client.assert_not_called()

    def test_configured_mail_still_counts_only_inbox_threads(self):
        client = MagicMock()
        handle = client.batch.return_value.__enter__.return_value.mail.mailbox.get.return_value
        handle.result.items = [
            SimpleNamespace(to_wire=lambda: {"role": "inbox", "unreadThreads": 7}),
            SimpleNamespace(to_wire=lambda: {"role": "sent", "unreadThreads": 20}),
        ]
        with (
            patch.object(mail, "frappe"),
            patch.object(mail, "can_use_mail", return_value=True),
            patch.object(
                mail, "get_user_jmap_accounts", return_value=[{"name": "account", "_name": "a@example.com"}]
            ),
            patch.object(mail, "get_account_client", return_value=client),
        ):
            self.assertEqual(mail.get_all_inbox_unread_count(), 7)

    def test_each_account_is_counted_apart(self):
        def client_with(unread):
            client = MagicMock()
            handle = client.batch.return_value.__enter__.return_value.mail.mailbox.get.return_value
            handle.result.items = [
                SimpleNamespace(to_wire=lambda: {"role": "sent", "unreadThreads": 20}),
                SimpleNamespace(to_wire=lambda: {"role": "inbox", "unreadThreads": unread}),
            ]
            return client

        clients = {"mine": client_with(3), "team": client_with(0), "list": client_with(11)}
        with (
            patch.object(mail, "frappe"),
            patch.object(mail, "can_use_mail", return_value=True),
            patch.object(
                mail,
                "get_user_jmap_accounts",
                return_value=[{"name": name, "_name": f"{name}@example.com"} for name in clients],
            ),
            patch.object(mail, "get_account_client", side_effect=clients.get),
        ):
            self.assertEqual(
                mail.get_inbox_unread_by_account(),
                [
                    {"account": "mine", "name": "mine@example.com", "unread": 3},
                    {"account": "team", "name": "team@example.com", "unread": 0},
                    {"account": "list", "name": "list@example.com", "unread": 11},
                ],
            )
            self.assertEqual(mail.get_all_inbox_unread_count(), 14)

    def test_configured_mail_does_not_hide_invalid_credentials(self):
        with (
            patch.object(mail, "frappe"),
            patch.object(mail, "can_use_mail", return_value=True),
            patch.object(mail, "get_user_jmap_accounts", return_value=[{"name": "account"}]),
            patch.object(mail, "get_account_client", side_effect=ValueError("Invalid credentials")),
        ):
            with self.assertRaisesRegex(ValueError, "Invalid credentials"):
                mail.get_all_inbox_unread_count()
