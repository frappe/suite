# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""How the push-sync path reacts when the JMAP server cannot answer an ``Email/changes`` call:
method-level errors surface as exceptions instead of flowing downstream as fake changes results,
and the stored sync state is never advanced on failure."""

import unittest
from unittest import mock

from suite.mail.doctype.mail_message import mail_message
from suite.mail.jmap.services.mail.email import EmailService

FORBIDDEN = {"type": "forbidden", "description": "You are not authorized to perform this action"}


class EmailServiceChanges(unittest.TestCase):
    """``EmailService.changes`` — unwrap real results, raise on method-level errors."""

    def _service(self, response: dict) -> EmailService:
        service = EmailService("f7", mock.MagicMock())
        service._exec = mock.MagicMock(return_value=response)
        return service

    def test_returns_first_method_response_body(self):
        body = {"created": [], "updated": ["e1"], "destroyed": [], "newState": "s2", "hasMoreChanges": False}
        service = self._service({"methodResponses": [["Email/changes", body, "0"]]})

        self.assertEqual(service.changes("s1"), body)

    def test_raises_on_method_level_error(self):
        service = self._service({"methodResponses": [["error", FORBIDDEN, "0"]]})

        with self.assertRaises(RuntimeError) as ctx:
            service.changes("s1")

        self.assertIn("Email/changes failed", str(ctx.exception))
        self.assertIn("forbidden", str(ctx.exception))

    def test_returns_empty_dict_without_method_responses(self):
        self.assertEqual(self._service({}).changes("s1"), {})


class EmailServiceGetState(unittest.TestCase):
    """``CoreService.get_state`` — unwrap the state from an empty 'get', None when unavailable."""

    def _service(self, response: dict) -> EmailService:
        service = EmailService("f7", mock.MagicMock())
        service._exec = mock.MagicMock(return_value=response)
        return service

    def test_returns_state_from_first_method_response_via_an_empty_get(self):
        body = {"accountId": "f7", "state": "s9", "list": [], "notFound": []}
        service = self._service({"methodResponses": [["Email/get", body, "0"]]})

        self.assertEqual(service.get_state(), "s9")
        service._exec.assert_called_once_with("get", ids=[], properties=["id"])

    def test_error_response_yields_none(self):
        service = self._service({"methodResponses": [["error", FORBIDDEN, "0"]]})

        self.assertIsNone(service.get_state())

    def test_missing_method_responses_yield_none(self):
        self.assertIsNone(self._service({}).get_state())


class FetchChanges(unittest.TestCase):
    """``fetch_changes`` — server failures are logged and leave the sync state untouched."""

    def _run(self, changes: mock.Mock) -> tuple[mock.Mock, mock.Mock]:
        with (
            mock.patch.object(mail_message, "get_sync_state", return_value="s1"),
            mock.patch.object(mail_message, "update_sync_state") as update_sync_state,
            mock.patch.object(mail_message, "get_jmap_connection"),
            mock.patch.object(mail_message, "MailboxService"),
            mock.patch.object(mail_message, "EmailService") as email_service,
            mock.patch.object(mail_message, "log_mail_error") as log_mail_error,
        ):
            email_service.return_value.changes = changes
            mail_message.fetch_changes("user@example.test", "f7", email_state="s2")

        return update_sync_state, log_mail_error

    def test_method_level_error_is_logged_and_preserves_state(self):
        changes = mock.MagicMock(side_effect=RuntimeError(f"Email/changes failed: {FORBIDDEN}"))

        update_sync_state, log_mail_error = self._run(changes)

        log_mail_error.assert_called_once()
        update_sync_state.assert_not_called()

    def test_empty_response_is_not_an_error_and_preserves_state(self):
        update_sync_state, log_mail_error = self._run(mock.MagicMock(return_value={}))

        log_mail_error.assert_not_called()
        update_sync_state.assert_not_called()


class FetchChangesRealtime(unittest.TestCase):
    """``fetch_changes`` — a change made on one device reaches the user's other open clients."""

    def _events(self, **changes: list[str]) -> list[mock.call]:
        result = {"created": [], "updated": [], "destroyed": [], "newState": "s2", "hasMoreChanges": False}
        result.update(changes)

        with (
            mock.patch.object(mail_message, "get_sync_state", return_value="s1"),
            mock.patch.object(mail_message, "update_sync_state"),
            mock.patch.object(mail_message, "get_jmap_connection"),
            mock.patch.object(mail_message, "MailboxService"),
            mock.patch.object(mail_message, "EmailService") as email_service,
            mock.patch.object(mail_message, "_remove_cached_messages"),
            mock.patch.object(mail_message.frappe, "publish_realtime") as publish_realtime,
        ):
            email_service.return_value.changes = mock.MagicMock(return_value=result)
            mail_message.fetch_changes("user@example.test", "f7", email_state="s2")

        return publish_realtime.call_args_list

    def test_deleted_mail_is_announced_to_the_user(self):
        self.assertEqual(
            self._events(destroyed=["e1"]), [mock.call("mail_changed", user="user@example.test")]
        )

    def test_updated_mail_is_announced_to_the_user(self):
        self.assertEqual(self._events(updated=["e1"]), [mock.call("mail_changed", user="user@example.test")])

    def test_nothing_is_announced_when_nothing_changed(self):
        self.assertEqual(self._events(), [])


class FetchChangesInit(unittest.TestCase):
    """``fetch_changes`` with no stored sync state — how the state gets seeded.

    A webhook carries the new state and initializes from it directly. A manual or
    scheduled run carries none; storing that None would leave the account
    re-"initializing" on every run with changes never fetched, so the state is seeded
    from the server instead.
    """

    def _run(
        self, email_state: str | None, server_state: str | mock.Mock | None
    ) -> tuple[mock.Mock, mock.Mock, mock.Mock]:
        with (
            mock.patch.object(mail_message, "get_sync_state", return_value=None),
            mock.patch.object(mail_message, "update_sync_state") as update_sync_state,
            mock.patch.object(mail_message, "get_jmap_connection"),
            mock.patch.object(mail_message, "EmailService") as email_service,
            mock.patch.object(mail_message, "log_mail_error") as log_mail_error,
        ):
            if isinstance(server_state, mock.Mock):
                email_service.return_value.get_state = server_state
            else:
                email_service.return_value.get_state = mock.MagicMock(return_value=server_state)
            mail_message.fetch_changes("user@example.test", "f7", email_state=email_state)

        return update_sync_state, log_mail_error, email_service.return_value.get_state

    def test_webhook_state_initializes_directly(self):
        update_sync_state, log_mail_error, get_state = self._run("s2", "unused")

        update_sync_state.assert_called_once_with("f7", type="email", state="s2")
        get_state.assert_not_called()
        log_mail_error.assert_not_called()

    def test_missing_state_is_seeded_from_server(self):
        update_sync_state, log_mail_error, _ = self._run(None, "s5")

        update_sync_state.assert_called_once_with("f7", type="email", state="s5")
        log_mail_error.assert_not_called()

    def test_unavailable_server_state_is_not_stored(self):
        update_sync_state, log_mail_error, _ = self._run(None, None)

        update_sync_state.assert_not_called()
        log_mail_error.assert_not_called()

    def test_seed_failure_is_logged_and_not_stored(self):
        update_sync_state, log_mail_error, _ = self._run(
            None, mock.MagicMock(side_effect=RuntimeError("boom"))
        )

        update_sync_state.assert_not_called()
        log_mail_error.assert_called_once()
