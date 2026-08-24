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


class FetchChanges(unittest.TestCase):
    """``fetch_changes`` — server failures are logged and leave the sync state untouched."""

    def _client(self, server: FakeJMAPServer) -> SuiteJMAPClient:
        http = httpx.Client(auth=BasicAuth("user@example.test", "pw"), **server.client_kwargs())
        return SuiteJMAPClient.connect(
            "https://jmap.example.com/.well-known/jmap",
            auth=BasicAuth("user@example.test", "pw"),
            http=http,
            experimental=True,
            retry_policy=RetryPolicy(max_attempts=1),
        )

    def _run(self, server: FakeJMAPServer) -> tuple[mock.Mock, mock.Mock]:
        client = self._client(server)
        with (
            mock.patch.object(mail_message, "get_sync_state", return_value="s1"),
            mock.patch.object(mail_message, "update_sync_state") as update_sync_state,
            mock.patch.object(mail_message, "get_jmap_client", return_value=client),
            mock.patch.object(mail_message, "log_mail_error") as log_mail_error,
        ):
            mail_message.fetch_changes("user@example.test", ACCOUNT, email_state="s2")

        return update_sync_state, log_mail_error

    def _server(self) -> FakeJMAPServer:
        return FakeJMAPServer(
            capabilities={CORE: {}, MAIL: {}},
            accounts={
                ACCOUNT: {
                    "name": "user@example.test",
                    "isPersonal": True,
                    "accountCapabilities": {MAIL: {}},
                }
            },
            primary_accounts={CORE: ACCOUNT, MAIL: ACCOUNT},
        )

    def test_method_level_error_is_logged_and_preserves_state(self):
        server = self._server()
        server.fail("Email/changes", "forbidden")

        update_sync_state, log_mail_error = self._run(server)

        log_mail_error.assert_called_once()
        update_sync_state.assert_not_called()

    def test_no_changes_response_advances_state(self):
        server = self._server()
        server.respond(
            "Email/changes",
            {
                "accountId": ACCOUNT,
                "oldState": "s1",
                "newState": "s2",
                "hasMoreChanges": False,
                "created": [],
                "updated": [],
                "destroyed": [],
            },
        )

        update_sync_state, log_mail_error = self._run(server)

        log_mail_error.assert_not_called()
        update_sync_state.assert_called_once_with(ACCOUNT, type="email", state="s2")
