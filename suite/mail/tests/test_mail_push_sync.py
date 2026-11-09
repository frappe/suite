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

    def _created(self, *messages: dict) -> list[mock.call]:
        mailboxes = [
            {"id": "inbox", "isSubscribed": True, "role": "inbox"},
            {"id": "sent", "isSubscribed": True, "role": "sent"},
            {"id": "drafts", "isSubscribed": True, "role": "drafts"},
            {"id": "old", "isSubscribed": False, "role": None},
        ]
        with (
            mock.patch.object(mail_message, "get_messages", return_value=list(messages)),
            mock.patch.object(mail_message, "get_cached_mailboxes", return_value=mailboxes),
            mock.patch.object(mail_message.frappe.db, "get_all", return_value=[]),
            mock.patch.object(mail_message, "PushNotification") as push,
        ):
            push.return_value.is_enabled.return_value = False
            return self._events(created=[message["id"] for message in messages])

    def test_new_mail_is_announced_with_its_folder(self):
        received = {
            "id": "e1",
            "thread_id": "t1",
            "draft": 0,
            "seen": 0,
            "mailboxes": [{"mailbox_id": "inbox"}],
        }

        self.assertEqual(self._created(received), [mock.call("new_mail_created", ["inbox"], user=USER)])

    def test_a_reply_sent_from_another_client_is_announced_too(self):
        # Sent mail arrives read; it still belongs on the lists, and in the conversation it answers.
        sent = {"id": "e2", "thread_id": "t1", "draft": 0, "seen": 1, "mailboxes": [{"mailbox_id": "sent"}]}

        self.assertEqual(self._created(sent), [mock.call("new_mail_created", ["sent"], user=USER)])

    def test_a_draft_saved_elsewhere_is_announced_too(self):
        draft = {"id": "e3", "draft": 1, "seen": 1, "mailboxes": [{"mailbox_id": "drafts"}]}

        self.assertEqual(self._created(draft), [mock.call("new_mail_created", ["drafts"], user=USER)])

    def test_mail_in_an_unsubscribed_folder_moves_no_list(self):
        hidden = {"id": "e4", "thread_id": "t1", "draft": 0, "seen": 0, "mailboxes": [{"mailbox_id": "old"}]}

        self.assertEqual(self._created(hidden), [])


class FetchChangesFound(unittest.TestCase):
    """``fetch_changes`` returns what it announced, for a caller that has no socket to hear it on."""

    def test_returns_the_folders_with_new_mail_and_whether_mail_changed(self):
        server = _server()
        server.respond("Email/changes", _changes(created=["e1"], updated=["e2"]))
        received = {
            "id": "e1",
            "thread_id": "t1",
            "draft": 0,
            "seen": 0,
            "mailboxes": [{"mailbox_id": "inbox"}],
        }

        with (
            mock.patch.object(mail_message, "get_sync_state", return_value="s1"),
            mock.patch.object(mail_message, "update_sync_state"),
            mock.patch.object(mail_message, "get_jmap_client", return_value=_client(server)),
            mock.patch.object(mail_message, "_remove_cached_messages"),
            mock.patch.object(mail_message, "_without_classification_echoes", return_value=["e2"]),
            mock.patch.object(mail_message, "get_messages", return_value=[received]),
            mock.patch.object(
                mail_message,
                "get_cached_mailboxes",
                return_value=[{"id": "inbox", "isSubscribed": True, "role": "inbox"}],
            ),
            mock.patch.object(mail_message.frappe.db, "get_all", return_value=[]),
            mock.patch.object(mail_message, "PushNotification") as push,
            mock.patch.object(mail_message.frappe, "publish_realtime"),
        ):
            push.return_value.is_enabled.return_value = False
            found = mail_message.fetch_changes(USER, ACCOUNT, email_state="s2")

        self.assertEqual(found, {"new_mail_in": ["inbox"], "changed": True})

    def test_a_reaction_changes_the_lists_without_being_new_mail(self):
        server = _server()
        server.respond("Email/changes", _changes(created=["e1"]))
        reaction = {
            "id": "e1",
            "thread_id": "t1",
            "draft": 0,
            "seen": 0,
            "mailboxes": [{"mailbox_id": "inbox"}],
        }

        with (
            mock.patch.object(mail_message, "get_sync_state", return_value="s1"),
            mock.patch.object(mail_message, "update_sync_state"),
            mock.patch.object(mail_message, "get_jmap_client", return_value=_client(server)),
            mock.patch.object(mail_message, "_remove_cached_messages"),
            mock.patch.object(mail_message, "get_messages", return_value=[reaction]),
            mock.patch.object(
                mail_message,
                "get_cached_mailboxes",
                return_value=[{"id": "inbox", "isSubscribed": True, "role": "inbox"}],
            ),
            mock.patch.object(mail_message, "read_reactions", return_value=["👍"]),
            mock.patch.object(mail_message, "try_set_seen"),
            mock.patch.object(mail_message.frappe.db, "get_all", return_value=[]),
            mock.patch.object(mail_message, "PushNotification") as push,
            mock.patch.object(mail_message.frappe, "publish_realtime"),
        ):
            push.return_value.is_enabled.return_value = False
            found = mail_message.fetch_changes(USER, ACCOUNT, email_state="s2")

        self.assertEqual(found, {"new_mail_in": [], "changed": True})

    def test_returns_nothing_found_when_the_state_is_unchanged(self):
        with mock.patch.object(mail_message, "get_sync_state", return_value="s2"):
            found = mail_message.fetch_changes(USER, ACCOUNT, email_state="s2")

        self.assertEqual(found, {"new_mail_in": [], "changed": False})


class SyncAccountChanges(unittest.TestCase):
    """``sync_account_changes`` — the client's ask runs the push path, once at a time."""

    def test_fetches_the_changes_under_the_push_lock(self):
        with (
            mock.patch.object(mail_message, "acquire_lock", return_value="lock-1") as acquire,
            mock.patch.object(mail_message, "release_lock") as release,
            mock.patch.object(
                mail_message, "fetch_changes", return_value={"new_mail_in": ["inbox"], "changed": False}
            ) as fetch_changes,
        ):
            found = mail_message.sync_account_changes(USER, ACCOUNT)

        self.assertEqual(found, {"new_mail_in": ["inbox"], "changed": False})
        acquire.assert_called_once_with(f"fetch_changes:{USER}:{ACCOUNT}", acquire_timeout=0)
        fetch_changes.assert_called_once()
        self.assertEqual(fetch_changes.call_args.args, (USER, ACCOUNT))
        release.assert_called_once_with(f"fetch_changes:{USER}:{ACCOUNT}", "lock-1")

    def test_leaves_it_to_a_fetch_already_under_way(self):
        with (
            mock.patch.object(mail_message, "acquire_lock", return_value=None),
            mock.patch.object(mail_message, "fetch_changes") as fetch_changes,
        ):
            found = mail_message.sync_account_changes(USER, ACCOUNT)

        fetch_changes.assert_not_called()
        self.assertEqual(found, {"new_mail_in": [], "changed": False})

    def test_releases_the_lock_when_the_fetch_fails(self):
        with (
            mock.patch.object(mail_message, "acquire_lock", return_value="lock-1"),
            mock.patch.object(mail_message, "release_lock") as release,
            mock.patch.object(mail_message, "fetch_changes", side_effect=RuntimeError),
            self.assertRaises(RuntimeError),
        ):
            mail_message.sync_account_changes(USER, ACCOUNT)

        release.assert_called_once_with(f"fetch_changes:{USER}:{ACCOUNT}", "lock-1")


class FetchChangesReactions(unittest.TestCase):
    """``fetch_changes`` — a reaction is a mark on a message, not mail to read."""

    def _arrive(self, message: dict) -> tuple[mock.Mock, mock.Mock, mock.Mock]:
        server = _server()
        server.respond("Email/changes", _changes(created=[message["id"]]))
        pn = mock.Mock()
        pn.return_value.is_enabled.return_value = True

        with (
            mock.patch.object(mail_message, "get_sync_state", return_value="s1"),
            mock.patch.object(mail_message, "update_sync_state"),
            mock.patch.object(mail_message, "get_jmap_client", return_value=_client(server)),
            mock.patch.object(mail_message, "get_messages", return_value=[message]),
            mock.patch.object(
                mail_message,
                "get_cached_mailboxes",
                return_value=[{"id": "inbox", "isSubscribed": True, "role": "inbox"}],
            ),
            mock.patch.object(mail_message.frappe.db, "get_all", return_value=[]),
            mock.patch.object(mail_message.frappe.utils, "get_url", return_value="https://x"),
            mock.patch.object(mail_message, "get_config", return_value=5),
            mock.patch.object(mail_message, "PushNotification", pn),
            mock.patch.object(mail_message, "try_set_seen") as try_set_seen,
            mock.patch.object(mail_message.frappe, "publish_realtime") as publish_realtime,
            mock.patch.object(mail_message, "log_mail_error") as log_mail_error,
        ):
            mail_message.fetch_changes(USER, ACCOUNT, email_state="s2")

        log_mail_error.assert_not_called()
        return pn.return_value.send_notification_to_user, try_set_seen, publish_realtime

    def _message(self, **fields) -> dict:
        return {
            "id": "e1",
            "draft": 0,
            "seen": 0,
            "keywords": "{}",
            "mailboxes": [{"mailbox_id": "inbox"}],
            "from_name": "Ana",
            "from_email": "ana@example.com",
            "subject": "Plans",
            "thread_id": "t1",
            "in_reply_to": "original@example.com",
            "text_body": "\U0001f602\n\nAna reacted via Gmail\n",
            "_text_body": [{"type": "text/plain", "disposition": None}],
            "attachments": [],
            **fields,
        }

    def test_a_reaction_sends_no_push_and_is_read_as_it_lands(self):
        reaction = self._message(
            attachments=[{"filename": None, "type": "text/vnd.google.email-reaction+json"}]
        )
        push, try_set_seen, publish_realtime = self._arrive(reaction)
        push.assert_not_called()
        try_set_seen.assert_called_once_with(ACCOUNT, ["e1"], True)
        self.assertEqual(publish_realtime.call_args_list, [mock.call("mail_changed", user=USER)])

    def test_a_lone_emoji_reply_is_mail_like_any_other(self):
        push, try_set_seen, publish_realtime = self._arrive(self._message())
        push.assert_called_once()
        try_set_seen.assert_not_called()
        self.assertEqual(
            publish_realtime.call_args_list, [mock.call("new_mail_created", ["inbox"], user=USER)]
        )


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
