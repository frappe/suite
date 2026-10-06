# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""The client glue over jmaplib, against jmap.testing.FakeJMAPServer."""

import base64
import unittest
from unittest import mock
from uuid import uuid4

import frappe
import httpx
from jmap import AuthenticationError, MethodError, RequestError, TransportError
from jmap import client as jmap_client
from jmap.auth import BasicAuth
from jmap.batch import NoAccountError, ReadOnlyAccountError
from jmap.core.retry import RetryPolicy
from jmap.core.session import Session
from jmap.testing.fake import FakeJMAPServer

from suite.mail import jmap as suite_jmap
from suite.mail.jmap import (
    RETRY_POLICY,
    MailServerUnavailableError,
    SuiteHTTPClient,
    SuiteJMAPClient,
    account_view,
    clear_jmap_session,
    get_cached_session,
    get_jmap_client,
    maybe_applied,
    never_applied,
    store_cached_session,
    translated_errors,
)

CORE = "urn:ietf:params:jmap:core"
MAIL = "urn:ietf:params:jmap:mail"
PERSONAL = "f7"
SHARED = "s2"
USER = "user@example.test"
SERVER_URL = "https://jmap.example.com"
API = ("POST", "/jmap/")
ENDPOINT_URLS = ("apiUrl", "downloadUrl", "uploadUrl", "eventSourceUrl")


class RelativeUrlServer(FakeJMAPServer):
    """Advertises its endpoints relative to the session resource."""

    @property
    def session_document(self) -> dict:
        document = super().session_document
        return document | {key: document[key].removeprefix(self.base_url) for key in ENDPOINT_URLS}


def _server(server_class: type[FakeJMAPServer] = FakeJMAPServer) -> FakeJMAPServer:
    server = server_class(
        capabilities={CORE: {}, MAIL: {}},
        accounts={
            PERSONAL: {"name": USER, "isPersonal": True, "accountCapabilities": {MAIL: {}}},
            SHARED: {"name": "team@example.test", "isPersonal": False, "accountCapabilities": {MAIL: {}}},
        },
        primary_accounts={CORE: PERSONAL, MAIL: PERSONAL},
    )
    server.respond("Mailbox/get", {"state": "m1", "list": [], "notFound": []})
    server.respond("Email/set", {"oldState": "s1", "newState": "s2", "destroyed": ["e1"]})
    return server


def _client(server: FakeJMAPServer, retry_policy: RetryPolicy | None = None) -> SuiteJMAPClient:
    http = SuiteHTTPClient(auth=BasicAuth(USER, "pw"), **server.client_kwargs())
    client = SuiteJMAPClient.connect(
        f"{SERVER_URL}/.well-known/jmap",
        auth=BasicAuth(USER, "pw"),
        http=http,
        experimental=True,
        retry_policy=retry_policy or RetryPolicy(max_attempts=1),
    )
    client.peers = [client]
    return client


def _mailboxes(client: SuiteJMAPClient) -> None:
    with client.batch() as b:
        b.mail.mailbox.get()


def _watch(server: FakeJMAPServer) -> list[tuple[str, str]]:
    """The (method, path) of every HTTP request the server receives from here on, answered or
    not. `server.requests` holds only the API requests that reached a handler."""

    seen: list[tuple[str, str]] = []
    server.intercept = lambda request: seen.append((request.method, request.url.path))
    return seen


def _answer_with(server: FakeJMAPServer, *statuses: int) -> None:
    """The next API requests are answered with these statuses, before any handler runs."""

    server.quirks.scripted_failures = [httpx.Response(status) for status in statuses]


class SessionRefresh(unittest.TestCase):
    """A client and the account views made from it share one session."""

    def test_a_changed_session_is_fetched_once_for_every_view(self):
        server = _server()
        client = _client(server)
        personal, shared = account_view(client, PERSONAL), account_view(client, SHARED)
        _mailboxes(personal)

        server.session_state = "changed"
        with mock.patch.object(jmap_client, "_fetch_session", wraps=jmap_client._fetch_session) as fetch:
            _mailboxes(personal)  # notices the change and refreshes
            _mailboxes(shared)  # already moved on: no second fetch
            _mailboxes(client)

        self.assertEqual(fetch.call_count, 1)
        self.assertEqual({c.session.state for c in (client, personal, shared)}, {"changed"})
        self.assertFalse(any(c.session_stale for c in (client, personal, shared)))

    def test_a_view_keeps_its_own_account_after_a_refresh(self):
        server = _server()
        client = _client(server)
        shared = account_view(client, SHARED)

        server.session_state = "changed"
        _mailboxes(client)

        self.assertEqual(str(shared.default_account), SHARED)
        self.assertEqual(str(client.default_account), PERSONAL)
        with client.batch() as b:
            handle = b.mail.mailbox.get()
        self.assertEqual(server.requests[-1]["methodCalls"][0][1]["accountId"], PERSONAL)
        self.assertIsNotNone(handle.result)

    def test_a_refresh_that_fails_leaves_the_answered_batch_readable(self):
        server = _server()
        client = _client(server)
        server.session_state = "changed"
        server.intercept = lambda request: httpx.Response(503) if request.method == "GET" else None

        with mock.patch.object(suite_jmap, "log_mail_error") as log, client.batch() as b:
            handle = b.mail.mailbox.get()

        self.assertEqual(handle.result.state, "m1")
        self.assertTrue(client.session_stale)
        log.assert_called_once()

    def test_a_refresh_that_failed_is_tried_again_by_the_next_call(self):
        server = _server()
        client = _client(server)
        server.session_state = "changed"
        server.intercept = lambda request: httpx.Response(503) if request.method == "GET" else None
        with mock.patch.object(suite_jmap, "log_mail_error"):
            _mailboxes(client)

        server.intercept = None
        _mailboxes(client)

        self.assertEqual(client.session.state, "changed")
        self.assertFalse(client.session_stale)


class Unavailability(unittest.TestCase):
    """An outage is reported as MailServerUnavailableError; any other failure keeps its own error."""

    def setUp(self):
        self.server = _server()
        self.client = _client(self.server)

    def test_a_request_that_gets_no_answer_reports_the_mail_server_unavailable(self):
        failures = {
            "connection refused": httpx.ConnectError("connection refused"),
            "timed out": httpx.ReadTimeout("timed out"),
        }
        for name, failure in failures.items():
            with self.subTest(name):
                self.server.intercept = mock.Mock(side_effect=failure)

                with self.assertRaises(MailServerUnavailableError) as raised:
                    _mailboxes(self.client)

                self.assertEqual(raised.exception.http_status_code, 503)
                self.assertIsInstance(raised.exception.__cause__, TransportError)

    def test_a_gateway_or_rate_limit_status_reports_the_mail_server_unavailable(self):
        for status in (429, 502, 503, 504):
            with self.subTest(status=status):
                _answer_with(self.server, status)

                with self.assertRaises(MailServerUnavailableError) as raised:
                    _mailboxes(self.client)

                self.assertEqual(raised.exception.http_status_code, 503)
                self.assertEqual(raised.exception.__cause__.status, status)

    def test_any_other_error_status_stays_a_request_error(self):
        for status in (400, 500):
            with self.subTest(status=status):
                _answer_with(self.server, status)

                with self.assertRaises(RequestError) as raised:
                    _mailboxes(self.client)

                self.assertEqual(raised.exception.status, status)

    def test_rejected_credentials_stay_an_authentication_error(self):
        _answer_with(self.server, 401)

        with self.assertRaises(AuthenticationError):
            _mailboxes(self.client)

    def test_a_blob_endpoint_answering_503_reports_the_mail_server_unavailable(self):
        self.server.intercept = lambda request: httpx.Response(503)

        with self.assertRaises(MailServerUnavailableError):
            self.client.upload(b"content")
        with self.assertRaises(MailServerUnavailableError):
            self.client.download("B1")

    def test_a_server_url_without_a_scheme_is_a_transport_error_not_an_outage(self):
        with httpx.Client() as http, self.assertRaises(TransportError) as raised, translated_errors():
            SuiteJMAPClient.connect(
                "jmap.example.com/.well-known/jmap", auth=BasicAuth(USER, "pw"), http=http
            )

        self.assertIsInstance(raised.exception.__cause__, httpx.UnsupportedProtocol)

    def test_an_api_url_that_cannot_be_opened_is_not_an_outage_either(self):
        # A revived session is taken at its word: no discovery request meets the URL first.
        for api_url, error in {
            "jmap.example.com/jmap/": TransportError,  # no scheme: httpx.UnsupportedProtocol
            "ftp://jmap.example.com/jmap/": TransportError,
            "https://jmap.example.com:port/jmap/": httpx.InvalidURL,
        }.items():
            with self.subTest(api_url), SuiteHTTPClient() as http:
                session = Session.from_wire(self.server.session_document | {"apiUrl": api_url})
                client = SuiteJMAPClient(
                    session,
                    self.client.registry.resolve(session, self.client.default_account, experimental=True),
                    http,
                    registry=self.client.registry,
                    retry_policy=RetryPolicy(max_attempts=1),
                    default_account=self.client.default_account,
                    experimental=True,
                )

                with self.assertRaises(error):
                    _mailboxes(client)


class NeverApplied(unittest.TestCase):
    """never_applied: whether a failed request provably changed nothing on the server."""

    def setUp(self):
        self.server = _server()
        self.client = _client(self.server)

    def failure_of_a_write(self, failure: Exception | int) -> Exception:
        if isinstance(failure, int):
            _answer_with(self.server, failure)
        else:
            self.server.intercept = mock.Mock(side_effect=failure)
        self.addCleanup(setattr, self.server, "intercept", None)

        with self.assertRaises(Exception) as raised, self.client.batch() as b:
            b.mail.email.set(destroy=["e1"])
        self.server.intercept = None
        return raised.exception

    def test_a_request_that_never_left_or_was_turned_away_changed_nothing(self):
        failures = {
            "connection refused": httpx.ConnectError("connection refused"),
            "connection timed out": httpx.ConnectTimeout("timed out"),
            "no free connection": httpx.PoolTimeout("pool exhausted"),
            "proxy refused the tunnel": httpx.ProxyError("403 Forbidden"),
            "rate limited": 429,
            "rejected credentials": 401,
            "bad request": 400,
        }
        for name, failure in failures.items():
            with self.subTest(name):
                self.assertTrue(never_applied(self.failure_of_a_write(failure)))

    def test_a_request_that_went_out_and_got_no_answer_of_the_servers_may_have_been_applied(self):
        failures = {
            "no answer in time": httpx.ReadTimeout("timed out"),
            "connection dropped": httpx.RemoteProtocolError("server disconnected"),
            "connection reset": httpx.ReadError("reset by peer"),
            "bad gateway": 502,
            "service unavailable": 503,
            "gateway timeout": 504,
            "server error": 500,
        }
        for name, failure in failures.items():
            with self.subTest(name):
                self.assertFalse(never_applied(self.failure_of_a_write(failure)))

    def test_a_request_jmaplib_refuses_to_send_changed_nothing(self):
        self.assertTrue(never_applied(ReadOnlyAccountError("Email/set", PERSONAL)))
        self.assertTrue(never_applied(NoAccountError("Email/set", MAIL)))

    def test_an_error_that_says_nothing_of_the_request_proves_nothing(self):
        self.assertFalse(never_applied(KeyError("blobId")))
        self.assertFalse(never_applied(MailServerUnavailableError()))

    def test_only_the_server_or_the_way_to_it_failing_leaves_a_request_in_doubt(self):
        self.assertTrue(maybe_applied(self.failure_of_a_write(httpx.ReadTimeout("timed out"))))
        self.assertTrue(maybe_applied(self.failure_of_a_write(502)))
        self.assertTrue(maybe_applied(MethodError("serverPartialFail", "c0", {})))
        # Known not to be applied, and not about the server at all.
        self.assertFalse(maybe_applied(self.failure_of_a_write(httpx.ConnectError("connection refused"))))
        self.assertFalse(maybe_applied(MethodError("serverFail", "c0", {})))
        self.assertFalse(maybe_applied(KeyError("blobId")))

    def test_a_method_error_leaves_the_server_as_it_was_but_for_three(self):
        self.assertTrue(never_applied(MethodError("serverFail", "c0", {})))
        for type in ("serverPartialFail", "malformedResult", "missingResponse"):
            with self.subTest(type):
                self.assertFalse(never_applied(MethodError(type, "c0", {})))


class Retries(unittest.TestCase):
    """RETRY_POLICY: a read or a state-guarded write gets a second attempt, any other write is
    sent once."""

    def setUp(self):
        sleep = mock.patch.object(jmap_client.time, "sleep")  # jmaplib backs off between attempts
        sleep.start()
        self.addCleanup(sleep.stop)

        self.server = _server()
        self.client = _client(self.server, RETRY_POLICY)
        self.http = _watch(self.server)

    def test_a_read_answered_503_then_ok_succeeds_on_its_second_attempt(self):
        _answer_with(self.server, 503)

        with self.client.batch() as b:
            handle = b.mail.mailbox.get()

        self.assertEqual(self.http, [API, API])
        self.assertEqual(handle.result.state, "m1")

    def test_a_read_is_given_up_after_its_second_attempt(self):
        _answer_with(self.server, 503, 503, 503)

        with self.assertRaises(MailServerUnavailableError):
            _mailboxes(self.client)

        self.assertEqual(self.http, [API, API])

    def test_an_unguarded_write_is_sent_once_though_a_second_attempt_would_be_answered(self):
        for status in (503, 429):
            with self.subTest(status=status):
                self.http.clear()
                _answer_with(self.server, status)

                with self.assertRaises(MailServerUnavailableError), self.client.batch() as b:
                    b.mail.email.set(destroy=["e1"])

                self.assertEqual(self.http, [API])
                self.assertEqual(self.server.requests, [])

    def test_a_write_guarded_by_a_literal_state_is_retried(self):
        _answer_with(self.server, 503)

        with self.client.batch() as b:
            handle = b.mail.email.set(destroy=["e1"], if_in_state="s1")

        self.assertEqual(self.http, [API, API])
        self.assertEqual(self.server.requests[-1]["methodCalls"][0][1]["ifInState"], "s1")
        self.assertEqual(handle.result.destroyed, ["e1"])

    def test_a_write_guarded_by_a_state_read_in_the_same_batch_is_sent_once(self):
        # A retry would read the state afresh, so the guard would pass a write that already landed.
        self.server.respond("Email/get", {"state": "s1", "list": [], "notFound": []})
        _answer_with(self.server, 503)

        with self.assertRaises(MailServerUnavailableError), self.client.batch() as b:
            state = b.mail.email.get(ids=[]).ref("/state")
            b.mail.email.set(destroy=["e1"], if_in_state=state)

        self.assertEqual(self.http, [API])

    def test_a_guarded_write_batched_with_an_unguarded_one_is_sent_once(self):
        _answer_with(self.server, 503)

        with self.assertRaises(MailServerUnavailableError), self.client.batch() as b:
            b.mail.email.set(destroy=["e1"], if_in_state="s1")
            b.mail.mailbox.set(destroy=["m1"])

        self.assertEqual(self.http, [API])

    def test_a_read_after_a_write_that_went_out_once_is_retried_again(self):
        _answer_with(self.server, 503, 503)

        with self.assertRaises(MailServerUnavailableError), self.client.batch() as b:
            b.mail.email.set(destroy=["e1"])
        _mailboxes(self.client)

        self.assertEqual(self.http, [API, API, API])


class ClientForUser(unittest.TestCase):
    """get_jmap_client: the user's credentials, the configured server and the cached session."""

    def setUp(self):
        # get_jmap_client is cached per request and the session per user: a user of this test's own.
        self.user = f"{uuid4().hex}@example.test"
        self.addCleanup(clear_jmap_session, self.user)

        settings = mock.Mock(username=USER)
        settings.get_password.return_value = "pw"
        for patcher in (
            mock.patch.object(frappe, "get_cached_value", return_value=1),
            mock.patch.object(frappe.db, "exists", return_value="settings"),
            mock.patch.object(frappe, "get_cached_doc", return_value=settings),
            mock.patch.object(suite_jmap, "get_config", return_value=(SERVER_URL, 1)),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def client_for_user(self, server: FakeJMAPServer) -> SuiteJMAPClient:
        def to_fake_server(**kwargs) -> httpx.Client:
            return SuiteHTTPClient(auth=kwargs["auth"], **server.client_kwargs())

        # One client per request: this is the next request.
        frappe.local.request_cache.clear()
        with mock.patch.object(suite_jmap, "SuiteHTTPClient", side_effect=to_fake_server):
            return get_jmap_client(self.user, ignore_permissions=True)

    def test_without_a_cached_session_it_discovers_one_and_caches_it(self):
        server = _server()
        http = _watch(server)

        client = self.client_for_user(server)

        self.assertEqual(http, [("GET", "/.well-known/jmap"), ("GET", "/jmap/session")])
        self.assertEqual(client.session.state, server.session_state)
        cached = get_cached_session(self.user)
        self.assertEqual(cached["state"], server.session_state)
        self.assertEqual(set(cached["accounts"]), {PERSONAL, SHARED})

    def test_a_cached_session_is_revived_without_a_discovery_round_trip(self):
        server = _server()
        store_cached_session(self.user, _client(server).session)
        requests = []
        server.intercept = requests.append

        client = self.client_for_user(server)
        with client.batch() as b:
            handle = b.mail.mailbox.get()

        self.assertEqual([(r.method, r.url.path) for r in requests], [API])
        credentials = base64.b64encode(f"{USER}:pw".encode()).decode()
        self.assertEqual(requests[0].headers["Authorization"], f"Basic {credentials}")
        self.assertEqual(server.requests[-1]["methodCalls"][0][1]["accountId"], PERSONAL)
        self.assertEqual(handle.result.state, "m1")

    def test_relative_endpoint_urls_are_cached_absolute_and_reached_by_the_revived_client(self):
        server = _server(RelativeUrlServer)
        blob_id = server.store_blob(b"stored")
        store_cached_session(self.user, _client(server).session)

        cached = get_cached_session(self.user)
        self.assertEqual(cached["apiUrl"], f"{SERVER_URL}/jmap/")
        self.assertTrue(all(cached[key].startswith(f"{SERVER_URL}/jmap/") for key in ENDPOINT_URLS))

        http = _watch(server)
        client = self.client_for_user(server)
        _mailboxes(client)
        uploaded = client.upload(b"sent")
        downloaded = client.download(blob_id, name="stored.txt")

        self.assertEqual(
            http,
            [
                API,
                ("POST", f"/jmap/upload/{PERSONAL}/"),
                ("GET", f"/jmap/download/{PERSONAL}/{blob_id}/stored.txt"),
            ],
        )
        self.assertEqual(len(server.requests), 1)
        self.assertEqual(server.blobs[uploaded.blob_id][0], b"sent")
        self.assertEqual(downloaded, b"stored")

    def failing_sync(self, *outcomes) -> mock.Mock:
        """Has the JMAP Account sync end in `outcomes`, one per call: an error, True for a sync
        that ran, False for one left to another run that holds the user's lock."""

        sync = mock.patch(
            "suite.mail.doctype.jmap_account.jmap_account.sync_jmap_accounts", side_effect=list(outcomes)
        )
        logged = mock.patch.object(suite_jmap, "log_mail_error")
        self.addCleanup(sync.stop)
        self.addCleanup(logged.stop)
        self.logged = logged.start()
        return sync.start()

    def test_an_account_sync_that_fails_is_left_alone_for_a_while(self):
        server = _server()
        store_cached_session(self.user, _client(server).session)
        server.session_state = "changed"
        sync = self.failing_sync(RuntimeError("database is busy"), True)
        _mailboxes(self.client_for_user(server))  # the session is refreshed, the sync fails
        http = _watch(server)

        _mailboxes(self.client_for_user(server))
        _mailboxes(self.client_for_user(server))

        # Neither fetched again nor synced again, by either request: the refreshed session is in use.
        self.assertEqual(http, [API, API])
        self.assertEqual(sync.call_count, 1)
        self.logged.assert_called_once()
        self.assertEqual(get_cached_session(self.user)["state"], "changed")

    def test_an_account_sync_that_failed_is_tried_again_once_it_has_been_left_alone(self):
        server = _server()
        store_cached_session(self.user, _client(server).session)
        server.session_state = "changed"
        sync = self.failing_sync(RuntimeError("database is busy"), True)
        with mock.patch.object(suite_jmap, "SYNC_BACK_OFF", -1):  # over as soon as it starts
            _mailboxes(self.client_for_user(server))
        http = _watch(server)

        _mailboxes(self.client_for_user(server))  # syncs, with the session it already has
        _mailboxes(self.client_for_user(server))  # nothing is owed any more

        self.assertEqual(http, [API, API])
        self.assertEqual(sync.call_count, 2)

    def test_within_one_job_the_sync_is_tried_again_by_a_later_call(self):
        server = _server()
        store_cached_session(self.user, _client(server).session)
        server.session_state = "changed"
        sync = self.failing_sync(RuntimeError("database is busy"), True)
        client = self.client_for_user(server)
        view = account_view(client, SHARED)

        with mock.patch.object(suite_jmap, "SYNC_BACK_OFF", -1):
            _mailboxes(client)
        _mailboxes(view)  # the same job, through another view of the client
        _mailboxes(client)

        self.assertEqual(sync.call_count, 2)

    def test_a_request_that_left_the_sync_to_another_does_not_wipe_what_that_one_owes(self):
        server = _server()
        store_cached_session(self.user, _client(server).session)
        # Two requests under way with the session as it was, when the server's changes.
        first, second = self.client_for_user(server), self.client_for_user(server)
        server.session_state = "changed"
        sync = self.failing_sync(RuntimeError("database is busy"), False, True)

        with mock.patch.object(suite_jmap, "SYNC_BACK_OFF", -1):
            _mailboxes(first)  # refreshes; its sync fails
        _mailboxes(second)  # refreshes too; finds the sync taken and leaves it

        _mailboxes(self.client_for_user(server))  # the next request: the sync is still owed

        self.assertEqual(sync.call_count, 3)

    def test_an_unreachable_server_is_reported_unavailable_and_nothing_is_cached(self):
        server = _server()
        server.intercept = mock.Mock(side_effect=httpx.ConnectError("connection refused"))

        with self.assertRaises(MailServerUnavailableError):
            self.client_for_user(server)

        self.assertIsNone(get_cached_session(self.user))
