# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""How the push-sync path reacts to real ``Email/changes`` responses from a fake JMAP server:
method-level errors surface as exceptions instead of flowing downstream as fake changes results,
and the stored sync state only advances after a successful response."""

import unittest
from unittest import mock

import httpx
from jmap.auth import BasicAuth
from jmap.core.retry import RetryPolicy
from jmap.testing.fake import FakeJMAPServer

from suite.mail.doctype.mail_message import mail_message
from suite.mail.jmap import SuiteJMAPClient

CORE = "urn:ietf:params:jmap:core"
MAIL = "urn:ietf:params:jmap:mail"
ACCOUNT = "f7"
USER = "user@example.test"


def _server() -> FakeJMAPServer:
    return FakeJMAPServer(
        capabilities={CORE: {}, MAIL: {}},
        accounts={
            ACCOUNT: {
                "name": USER,
                "isPersonal": True,
                "accountCapabilities": {MAIL: {}},
            }
        },
        primary_accounts={CORE: ACCOUNT, MAIL: ACCOUNT},
    )


def _client(server: FakeJMAPServer) -> SuiteJMAPClient:
    http = httpx.Client(auth=BasicAuth(USER, "pw"), **server.client_kwargs())
    return SuiteJMAPClient.connect(
        "https://jmap.example.com/.well-known/jmap",
        auth=BasicAuth(USER, "pw"),
        http=http,
        experimental=True,
        retry_policy=RetryPolicy(max_attempts=1),
    )


def _changes(**changes: list[str]) -> dict:
    """An ``Email/changes`` response from s1 to s2 carrying ``changes``."""

    result = {
        "accountId": ACCOUNT,
        "oldState": "s1",
        "newState": "s2",
        "hasMoreChanges": False,
        "created": [],
        "updated": [],
        "destroyed": [],
    }
    result.update(changes)
    return result


class FetchChanges(unittest.TestCase):
    """``fetch_changes`` — server failures are logged and leave the sync state untouched."""

    def _run(self, server: FakeJMAPServer) -> tuple[mock.Mock, mock.Mock]:
        client = _client(server)
        with (
            mock.patch.object(mail_message, "get_sync_state", return_value="s1"),
            mock.patch.object(mail_message, "update_sync_state") as update_sync_state,
            mock.patch.object(mail_message, "get_jmap_client", return_value=client),
            mock.patch.object(mail_message, "log_mail_error") as log_mail_error,
        ):
            mail_message.fetch_changes(USER, ACCOUNT, email_state="s2")

        return update_sync_state, log_mail_error

    def test_method_level_error_is_logged_and_preserves_state(self):
        server = _server()
        server.fail("Email/changes", "forbidden")

        update_sync_state, log_mail_error = self._run(server)

        log_mail_error.assert_called_once()
        update_sync_state.assert_not_called()

    def test_no_changes_response_advances_state(self):
        server = _server()
        server.respond("Email/changes", _changes())

        update_sync_state, log_mail_error = self._run(server)

        log_mail_error.assert_not_called()
        update_sync_state.assert_called_once_with(ACCOUNT, type="email", state="s2")


class FetchChangesRealtime(unittest.TestCase):
    """``fetch_changes`` — a change made on one device reaches the user's other open clients."""

    def _events(self, **changes: list[str]) -> list[mock.call]:
        server = _server()
        server.respond("Email/changes", _changes(**changes))

        with (
            mock.patch.object(mail_message, "get_sync_state", return_value="s1"),
            mock.patch.object(mail_message, "update_sync_state"),
            mock.patch.object(mail_message, "get_jmap_client", return_value=_client(server)),
            mock.patch.object(mail_message, "_remove_cached_messages"),
            mock.patch.object(mail_message, "log_mail_error") as log_mail_error,
            mock.patch.object(mail_message.frappe, "publish_realtime") as publish_realtime,
        ):
            mail_message.fetch_changes(USER, ACCOUNT, email_state="s2")

        log_mail_error.assert_not_called()
        return publish_realtime.call_args_list

    def test_deleted_mail_is_announced_to_the_user(self):
        self.assertEqual(self._events(destroyed=["e1"]), [mock.call("mail_changed", user=USER)])

    def test_updated_mail_is_announced_to_the_user(self):
        self.assertEqual(self._events(updated=["e1"]), [mock.call("mail_changed", user=USER)])

    def test_nothing_is_announced_when_nothing_changed(self):
        self.assertEqual(self._events(), [])


class FetchChangesInit(unittest.TestCase):
    """``fetch_changes`` with no stored sync state — how the state gets seeded.

    A webhook carries the new state and initializes from it directly. A manual or
    scheduled run carries none; storing that None would leave the account
    re-"initializing" on every run with changes never fetched, so the state is seeded
    from the server instead, read off an empty ``Email/get``.
    """

    def _run(
        self,
        email_state: str | None,
        server_state: str = "unused",
        refused: bool = False,
        unreachable: bool = False,
    ) -> tuple[mock.Mock, mock.Mock, list[dict]]:
        server = _server()
        if refused:
            server.fail("Email/get", "forbidden")
        else:
            server.respond(
                "Email/get", {"accountId": ACCOUNT, "state": server_state, "list": [], "notFound": []}
            )
        client = _client(server)
        if unreachable:
            server.quirks.scripted_failures.append(httpx.Response(503))

        with (
            mock.patch.object(mail_message, "get_sync_state", return_value=None),
            mock.patch.object(mail_message, "update_sync_state") as update_sync_state,
            mock.patch.object(mail_message, "get_jmap_client", return_value=client),
            mock.patch.object(mail_message, "log_mail_error") as log_mail_error,
        ):
            mail_message.fetch_changes(USER, ACCOUNT, email_state=email_state)

        gets = [
            call[1]
            for request in server.requests
            for call in request["methodCalls"]
            if call[0] == "Email/get"
        ]
        return update_sync_state, log_mail_error, gets

    def test_webhook_state_initializes_directly(self):
        update_sync_state, log_mail_error, gets = self._run("s2")

        update_sync_state.assert_called_once_with(ACCOUNT, type="email", state="s2")
        self.assertEqual(gets, [])
        log_mail_error.assert_not_called()

    def test_missing_state_is_seeded_from_server(self):
        update_sync_state, log_mail_error, gets = self._run(None, server_state="s5")

        update_sync_state.assert_called_once_with(ACCOUNT, type="email", state="s5")
        # Only the state is wanted, so no message is asked for.
        self.assertEqual([get["ids"] for get in gets], [[]])
        log_mail_error.assert_not_called()

    def test_unavailable_server_state_is_not_stored(self):
        update_sync_state, log_mail_error, _ = self._run(None, refused=True)

        update_sync_state.assert_not_called()
        log_mail_error.assert_not_called()

    def test_seed_failure_is_logged_and_not_stored(self):
        update_sync_state, log_mail_error, _ = self._run(None, unreachable=True)

        update_sync_state.assert_not_called()
        log_mail_error.assert_called_once()
