# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""``ensure_push_subscription`` — the self-healing check that (re)creates this site's push
subscription on the mail server. A subscription lost to a failed creation, an unrenewed
expiry or a server-side delete silently ends the user's webhooks, so presence must be
verifiable and recoverable without any locally stored record."""

import unittest
from datetime import timedelta
from types import SimpleNamespace
from unittest import mock

import frappe
import httpx
from frappe.utils.file_lock import LockTimeoutError
from jmap.auth import BasicAuth
from jmap.core.retry import RetryPolicy
from jmap.testing.fake import FakeJMAPServer

from suite.mail.doctype.push_subscription import push_subscription
from suite.mail.jmap import MailServerUnavailableError, SetResult, SuiteJMAPClient
from suite.utils.dt import get_utc_now

USER = "user@example.test"


class EnsurePushSubscription(unittest.TestCase):
    def _run(
        self,
        subscriptions: list[dict],
        url: str = "https://mail.example.test",
        disabled: bool = False,
        delete_error: Exception | None = None,
    ) -> tuple[mock.Mock, mock.Mock, mock.Mock]:
        with (
            mock.patch.object(push_subscription.frappe.utils, "get_url", return_value=url),
            mock.patch.object(push_subscription, "is_push_subscription_disabled", return_value=disabled),
            mock.patch.object(push_subscription, "get_site_device_client_id", return_value="site-device"),
            mock.patch.object(push_subscription, "_fetch_subscriptions", return_value=subscriptions) as fetch,
            mock.patch.object(push_subscription, "_set_subscriptions", return_value=SetResult()) as delete,
            mock.patch.object(push_subscription, "_create_push_subscription") as add,
        ):
            if delete_error:
                delete.side_effect = delete_error
            push_subscription.ensure_push_subscription(USER)

        return add, fetch, delete

    def test_creates_when_no_subscription_exists(self):
        add, _, _ = self._run([])

        add.assert_called_once_with(USER, ignore_permissions=True)

    def test_skips_when_live_subscription_exists(self):
        add, _, _ = self._run([{"deviceClientId": "site-device", "expires": "2999-01-01T00:00:00Z"}])

        add.assert_not_called()

    def test_skips_when_subscription_never_expires(self):
        add, _, _ = self._run([{"deviceClientId": "site-device", "expires": None}])

        add.assert_not_called()

    def test_other_devices_subscriptions_do_not_count(self):
        add, _, _ = self._run([{"deviceClientId": "other-device", "expires": "2999-01-01T00:00:00Z"}])

        add.assert_called_once_with(USER, ignore_permissions=True)

    def test_recreates_when_subscription_expired(self):
        add, _, delete = self._run(
            [{"id": "sub-old", "deviceClientId": "site-device", "expires": "2000-01-01T00:00:00Z"}]
        )

        add.assert_called_once_with(USER, ignore_permissions=True)
        delete.assert_called_once_with(USER, destroy=["sub-old"], ignore_permissions=True)

    def test_expired_duplicate_is_deleted_even_when_live_exists(self):
        add, _, delete = self._run(
            [
                {"id": "sub-old", "deviceClientId": "site-device", "expires": "2000-01-01T00:00:00Z"},
                {"deviceClientId": "site-device", "expires": "2999-01-01T00:00:00Z"},
            ]
        )

        add.assert_not_called()
        delete.assert_called_once_with(USER, destroy=["sub-old"], ignore_permissions=True)

    def test_delete_failure_does_not_block_recreation(self):
        add, _, _ = self._run(
            [{"id": "sub-old", "deviceClientId": "site-device", "expires": "2000-01-01T00:00:00Z"}],
            delete_error=RuntimeError("boom"),
        )

        add.assert_called_once_with(USER, ignore_permissions=True)

    def test_skips_on_non_https_site(self):
        add, fetch, _ = self._run([], url="http://site.localhost:8001")

        add.assert_not_called()
        fetch.assert_not_called()

    def test_skips_when_user_disabled_push(self):
        add, fetch, _ = self._run([], disabled=True)

        add.assert_not_called()
        fetch.assert_not_called()

    def test_skips_when_concurrent_run_holds_the_lock(self):
        with (
            mock.patch.object(
                push_subscription.frappe.utils, "get_url", return_value="https://mail.example.test"
            ),
            mock.patch.object(push_subscription, "is_push_subscription_disabled", return_value=False),
            mock.patch.object(push_subscription, "filelock", side_effect=LockTimeoutError),
            mock.patch.object(push_subscription, "_fetch_subscriptions") as fetch,
            mock.patch.object(push_subscription, "_create_push_subscription") as add,
        ):
            push_subscription.ensure_push_subscription(USER)

        fetch.assert_not_called()
        add.assert_not_called()

    def test_surplus_live_duplicates_are_pruned_keeping_the_longest_lived(self):
        add, _, delete = self._run(
            [
                {"id": "sub-a", "deviceClientId": "site-device", "expires": "2998-01-01T00:00:00Z"},
                {"id": "sub-b", "deviceClientId": "site-device", "expires": None},
                {"id": "sub-c", "deviceClientId": "site-device", "expires": "2999-01-01T00:00:00Z"},
            ]
        )

        add.assert_not_called()
        _, kwargs = delete.call_args
        self.assertCountEqual(kwargs["destroy"], ["sub-a", "sub-c"])


class AddPushSubscription(unittest.TestCase):
    """``_add_push_subscription`` — manual creations serialize under the healing lock, and
    the default creation is idempotent against an existing live site subscription."""

    def _add(
        self,
        subscriptions: list[dict],
        device_client_id: str | None = None,
        url: str | None = None,
        types: list[str] | None = None,
    ) -> tuple[str, mock.Mock, mock.Mock]:
        with (
            mock.patch.object(push_subscription, "filelock") as filelock,
            mock.patch.object(push_subscription, "is_push_subscription_disabled", return_value=False),
            mock.patch.object(push_subscription, "get_site_device_client_id", return_value="site-device"),
            mock.patch.object(push_subscription, "_fetch_subscriptions", return_value=subscriptions),
            mock.patch.object(
                push_subscription, "_create_push_subscription", return_value="new-id"
            ) as create,
        ):
            result = push_subscription._add_push_subscription(
                USER, device_client_id, url, types, ignore_permissions=True
            )

        return result, create, filelock

    def test_manual_creation_takes_the_per_user_lock(self):
        result, create, filelock = self._add([])

        self.assertEqual(result, "new-id")
        filelock.assert_called_once_with(f"ensure_push_subscription_{USER}", timeout=10)
        create.assert_called_once_with(USER, None, None, None, True)

    def test_default_creation_returns_the_existing_live_site_subscription(self):
        result, create, _ = self._add(
            [
                {"id": "old", "deviceClientId": "site-device", "expires": "2998-01-01T00:00:00Z"},
                {"id": "keeper", "deviceClientId": "site-device", "expires": None},
            ]
        )

        self.assertEqual(result, "keeper")
        create.assert_not_called()

    def test_expired_or_foreign_subscriptions_do_not_shortcut_creation(self):
        result, create, _ = self._add(
            [
                {"id": "dead", "deviceClientId": "site-device", "expires": "2000-01-01T00:00:00Z"},
                {"id": "other", "deviceClientId": "other-device", "expires": None},
            ]
        )

        self.assertEqual(result, "new-id")
        create.assert_called_once()

    def test_custom_parameters_always_create(self):
        result, create, _ = self._add(
            [{"id": "existing", "deviceClientId": "site-device", "expires": None}],
            url="https://elsewhere.example.test/hook",
        )

        self.assertEqual(result, "new-id")
        create.assert_called_once_with(USER, None, "https://elsewhere.example.test/hook", None, True)

    def test_lock_timeout_surfaces_a_friendly_error(self):
        with (
            mock.patch.object(push_subscription, "filelock", side_effect=LockTimeoutError),
            mock.patch.object(push_subscription, "is_push_subscription_disabled", return_value=False),
            mock.patch.object(push_subscription, "_create_push_subscription") as create,
            self.assertRaises(push_subscription.frappe.ValidationError),
        ):
            push_subscription._add_push_subscription(USER, ignore_permissions=True)

        create.assert_not_called()


class CreatePushSubscription(unittest.TestCase):
    """``_create_push_subscription`` — the site's deterministic device id stays exclusive
    to the site-default subscription; custom creations get their own identity."""

    def _create(self, **kwargs) -> dict:
        with (
            mock.patch.object(
                push_subscription.frappe.utils, "get_url", return_value="https://site.example.test"
            ),
            mock.patch.object(push_subscription, "get_site_device_client_id", return_value="site-device"),
            mock.patch.object(push_subscription, "get_push_subscription_keys", return_value=None),
            mock.patch.object(push_subscription, "_set_subscriptions") as set_subscriptions,
        ):
            set_subscriptions.side_effect = lambda user, create, **kw: SetResult(
                created={next(iter(create)): SimpleNamespace(id="new-id")}
            )
            push_subscription._create_push_subscription(USER, ignore_permissions=True, **kwargs)
            _, call_kwargs = set_subscriptions.call_args

        return next(iter(call_kwargs["create"].values()))

    def test_default_creation_wears_the_site_device_id(self):
        self.assertEqual(self._create()["deviceClientId"], "site-device")

    def test_custom_url_creation_gets_a_unique_device_id(self):
        sub = self._create(url="https://elsewhere.example.test/hook")

        self.assertNotEqual(sub["deviceClientId"], "site-device")

    def test_custom_types_creation_gets_a_unique_device_id(self):
        self.assertNotEqual(self._create(types=["Email"])["deviceClientId"], "site-device")

    def test_site_device_id_with_custom_parameters_is_rejected(self):
        with (
            mock.patch.object(push_subscription, "get_site_device_client_id", return_value="site-device"),
            mock.patch.object(push_subscription, "_set_subscriptions") as set_subscriptions,
            self.assertRaises(push_subscription.frappe.ValidationError),
        ):
            push_subscription._create_push_subscription(
                USER, "site-device", "https://elsewhere.example.test/hook", ignore_permissions=True
            )

        set_subscriptions.assert_not_called()

    def test_explicit_device_id_is_honored(self):
        sub = self._create(device_client_id="my-device", url="https://elsewhere.example.test/hook")

        self.assertEqual(sub["deviceClientId"], "my-device")


class RenewExpiringPushSubscriptions(unittest.TestCase):
    """``renew_expiring_push_subscriptions`` — healing and the expiry scan share one fetch."""

    def _run(self, subscriptions: list[dict]) -> tuple[mock.Mock, mock.Mock]:
        with (
            mock.patch.object(
                push_subscription.frappe.utils, "get_url", return_value="https://mail.example.test"
            ),
            mock.patch.object(push_subscription, "get_jmap_configured_users", return_value=[USER]),
            mock.patch.object(push_subscription, "is_push_subscription_disabled", return_value=False),
            mock.patch.object(push_subscription, "get_site_device_client_id", return_value="site-device"),
            mock.patch.object(push_subscription, "_fetch_subscriptions", return_value=subscriptions) as fetch,
            mock.patch.object(
                push_subscription, "_set_subscriptions", return_value=SetResult()
            ) as set_subscriptions,
            mock.patch.object(push_subscription, "_create_push_subscription") as add,
            mock.patch.object(push_subscription, "log_mail_error") as log_mail_error,
        ):
            push_subscription.renew_expiring_push_subscriptions()

        self.assertEqual(fetch.call_count, 1)
        log_mail_error.assert_not_called()
        return set_subscriptions, add

    def test_expiring_subscription_is_renewed_from_the_shared_fetch(self):
        expiring = (get_utc_now() + timedelta(days=1)).isoformat()
        set_subscriptions, add = self._run(
            [
                {"id": "site-sub", "deviceClientId": "site-device", "expires": "2999-01-01T00:00:00Z"},
                {"id": "exp-1", "deviceClientId": "other-device", "expires": expiring},
            ]
        )

        set_subscriptions.assert_called_once_with(
            USER, update={"exp-1": {"expires": None}}, ignore_permissions=True
        )
        add.assert_not_called()

    def test_already_expired_foreign_subscription_is_not_renewed(self):
        set_subscriptions, add = self._run(
            [
                {"id": "site-sub", "deviceClientId": "site-device", "expires": "2999-01-01T00:00:00Z"},
                {"id": "dead-1", "deviceClientId": "other-device", "expires": "2000-01-01T00:00:00Z"},
            ]
        )

        # Neither renewed nor deleted.
        set_subscriptions.assert_not_called()
        add.assert_not_called()

    def test_deleted_expired_subscription_is_not_renewed(self):
        set_subscriptions, add = self._run(
            [{"id": "sub-old", "deviceClientId": "site-device", "expires": "2000-01-01T00:00:00Z"}]
        )

        # The one set call is healing's deletion; no renewal follows it.
        set_subscriptions.assert_called_once_with(USER, destroy=["sub-old"], ignore_permissions=True)
        add.assert_called_once_with(USER, ignore_permissions=True)


class OnLogin(unittest.TestCase):
    def _run(self, user: str, jmap_configured: bool = True) -> mock.Mock:
        login_manager = mock.MagicMock()
        login_manager.user = user
        with (
            mock.patch.object(push_subscription, "is_jmap_configured", return_value=jmap_configured),
            mock.patch.object(push_subscription, "enqueue_job") as enqueue_job,
        ):
            push_subscription.on_login(login_manager)

        return enqueue_job

    def test_enqueues_healing_for_jmap_user(self):
        enqueue_job = self._run(USER)

        enqueue_job.assert_called_once()
        self.assertIs(enqueue_job.call_args.args[0], push_subscription.ensure_push_subscription)
        self.assertEqual(enqueue_job.call_args.kwargs["user"], USER)
        self.assertEqual(enqueue_job.call_args.kwargs["job_id"], f"ensure_push_subscription:{USER}")
        self.assertTrue(enqueue_job.call_args.kwargs["deduplicate"])

    def test_skips_guest_and_administrator(self):
        self._run("Guest").assert_not_called()
        self._run("Administrator").assert_not_called()

    def test_skips_users_without_jmap(self):
        self._run(USER, jmap_configured=False).assert_not_called()


class DeleteSitePushSubscriptions(unittest.TestCase):
    def _run(
        self, subscriptions: list[dict], not_destroyed: dict | None = None
    ) -> tuple[mock.Mock, mock.Mock]:
        with (
            mock.patch.object(push_subscription, "get_site_device_client_id", return_value="site-device"),
            mock.patch.object(push_subscription, "_fetch_subscriptions", return_value=subscriptions) as fetch,
            mock.patch.object(
                push_subscription,
                "_set_subscriptions",
                return_value=SetResult(not_destroyed=not_destroyed or {}),
            ) as delete,
        ):
            push_subscription.delete_site_push_subscriptions(USER)

        return fetch, delete

    def test_deletes_only_the_site_subscriptions(self):
        fetch, delete = self._run(
            [
                {"id": "site-1", "deviceClientId": "site-device"},
                {"id": "custom", "deviceClientId": "other-device"},
                {"id": "site-2", "deviceClientId": "site-device"},
            ]
        )

        fetch.assert_called_once_with(USER, ignore_permissions=True, allow_disabled=True)
        delete.assert_called_once_with(
            USER, destroy=["site-1", "site-2"], ignore_permissions=True, allow_disabled=True
        )

    def test_nothing_to_delete_skips_the_delete_call(self):
        _, delete = self._run([{"id": "custom", "deviceClientId": "other-device"}])

        delete.assert_not_called()

    def test_server_side_delete_errors_surface(self):
        with self.assertRaises(push_subscription.frappe.ValidationError):
            self._run(
                [{"id": "site-1", "deviceClientId": "site-device"}],
                not_destroyed={"site-1": {"type": "notFound", "description": "gone"}},
            )


class DeletePushSubscriptions(unittest.TestCase):
    """``delete_push_subscriptions`` against a fake server that takes two ids to a set: a long
    list goes out in several sets, and the ones before a refused set are already applied."""

    IDS = ("sub-1", "sub-2", "sub-3", "sub-4", "sub-5")

    def setUp(self) -> None:
        core = "urn:ietf:params:jmap:core"
        self.server = FakeJMAPServer(
            capabilities={core: {"maxObjectsInSet": 2}},
            accounts={"f7": {"name": USER, "isPersonal": True, "accountCapabilities": {}}},
            primary_accounts={core: "f7"},
        )
        http = httpx.Client(auth=BasicAuth(USER, "pw"), **self.server.client_kwargs())
        client = SuiteJMAPClient.connect(
            "https://jmap.example.com/.well-known/jmap",
            auth=BasicAuth(USER, "pw"),
            http=http,
            experimental=True,
            retry_policy=RetryPolicy(max_attempts=1),
        )
        for patcher in (
            mock.patch.object(push_subscription, "get_jmap_client", return_value=client),
            mock.patch.object(push_subscription, "has_permission_for_user", return_value=True),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def refuse_after(self, answer: dict | None = None) -> None:
        """Makes the server answer the first set (destroying all of it, unless `answer` says
        otherwise) and refuse every set after it outright."""

        def answer_then_refuse(arguments: dict, server: FakeJMAPServer) -> dict:
            server.fail("PushSubscription/set", "serverFail", description="Storage is unavailable.")
            return answer or {"destroyed": arguments["destroy"]}

        self.server.handle("PushSubscription/set", answer_then_refuse)

    def refusal(self) -> str:
        with self.assertRaises(frappe.ValidationError) as refused:
            push_subscription.delete_push_subscriptions(USER, list(self.IDS))

        return str(refused.exception)

    def test_every_id_is_destroyed_across_sets(self):
        self.server.handle(
            "PushSubscription/set", lambda arguments, server: {"destroyed": arguments["destroy"]}
        )

        push_subscription.delete_push_subscriptions(USER, list(self.IDS))

        destroyed = [
            call[1]["destroy"] for request in self.server.requests for call in request["methodCalls"]
        ]
        self.assertEqual(destroyed, [["sub-1", "sub-2"], ["sub-3", "sub-4"], ["sub-5"]])

    def test_a_refusal_part_way_says_what_was_already_deleted(self):
        self.refuse_after()

        message = self.refusal()

        self.assertIn("2 of 5 push subscription(s) were deleted", message)
        self.assertIn("Storage is unavailable.", message)

    def test_a_refusal_part_way_keeps_the_errors_of_the_applied_sets(self):
        gone = {"type": "notFound", "description": "No such subscription."}
        self.refuse_after({"destroyed": ["sub-1"], "notDestroyed": {"sub-2": gone}})

        message = self.refusal()

        self.assertIn("1 of 5 push subscription(s) were deleted", message)
        self.assertIn("sub-2: No such subscription.", message)
        self.assertIn("Storage is unavailable.", message)

    def test_a_refusal_at_once_is_not_reported_as_partial(self):
        self.server.fail("PushSubscription/set", "serverFail", description="Storage is unavailable.")

        self.assertEqual(self.refusal(), "Storage is unavailable.")

    def test_an_outage_part_way_says_what_was_already_deleted(self):
        def answer_then_go_down(arguments: dict, server: FakeJMAPServer) -> dict:
            server.intercept = lambda request: httpx.Response(503)
            return {"destroyed": arguments["destroy"]}

        self.server.handle("PushSubscription/set", answer_then_go_down)

        message = self.refusal()

        self.assertIn("2 of 5 push subscription(s) were deleted", message)
        self.assertIn("mail server became unavailable", message)
        # The set that went unanswered may have been applied.
        self.assertIn("Some of the rest may have been deleted as well", message)

    def test_a_server_that_turned_the_rest_away_leaves_no_doubt_about_them(self):
        def answer_then_limit(arguments: dict, server: FakeJMAPServer) -> dict:
            # A rate limit: the request it answers was not run.
            server.intercept = lambda request: httpx.Response(429)
            return {"destroyed": arguments["destroy"]}

        self.server.handle("PushSubscription/set", answer_then_limit)

        message = self.refusal()

        self.assertIn("2 of 5 push subscription(s) were deleted", message)
        self.assertIn("mail server became unavailable", message)
        self.assertIn("The rest were not deleted", message)
        self.assertNotIn("may have been deleted", message)

    def test_an_outage_at_once_stays_an_outage(self):
        self.server.intercept = mock.Mock(side_effect=httpx.ConnectError("connection refused"))

        with self.assertRaises(MailServerUnavailableError):
            push_subscription.delete_push_subscriptions(USER, list(self.IDS))

    def test_ids_the_server_refuses_are_named_with_their_reasons(self):
        gone = {"type": "notFound", "description": "No such subscription."}
        self.server.respond("PushSubscription/set", {"destroyed": ["sub-1"], "notDestroyed": {"sub-2": gone}})

        with self.assertRaises(frappe.ValidationError) as refused:
            push_subscription.delete_push_subscriptions(USER, ["sub-1", "sub-2"])

        self.assertIn("sub-2: No such subscription.", str(refused.exception))
        self.assertNotIn("sub-1", str(refused.exception))


class DeletePushSubscriptionsOnDisable(unittest.TestCase):
    def _run(
        self,
        enabled: int = 0,
        changed: bool = True,
        in_insert: bool = False,
        jmap_configured: bool = True,
    ) -> mock.Mock:
        from suite.mail import events

        doc = mock.Mock()
        doc.name = USER
        doc.enabled = enabled
        doc.flags = frappe._dict(in_insert=in_insert)
        doc.has_value_changed.return_value = changed

        with (
            mock.patch.object(events, "is_jmap_configured", return_value=jmap_configured),
            mock.patch.object(push_subscription, "delete_site_push_subscriptions") as delete,
        ):
            events.delete_push_subscriptions_on_disable(doc)

        return delete

    def test_disabling_deletes_the_site_subscriptions(self):
        self._run().assert_called_once_with(USER)

    def test_enabled_user_or_unchanged_flag_is_ignored(self):
        self._run(enabled=1).assert_not_called()
        self._run(changed=False).assert_not_called()
        self._run(in_insert=True).assert_not_called()

    def test_users_without_jmap_are_skipped(self):
        self._run(jmap_configured=False).assert_not_called()

    def test_server_failure_is_logged_not_raised(self):
        from suite.mail import events

        doc = mock.Mock()
        doc.name = USER
        doc.enabled = 0
        doc.flags = frappe._dict()
        doc.has_value_changed.return_value = True

        with (
            mock.patch.object(events, "is_jmap_configured", return_value=True),
            mock.patch.object(push_subscription, "delete_site_push_subscriptions", side_effect=RuntimeError),
            mock.patch("suite.utils.log_error") as log_error,
        ):
            events.delete_push_subscriptions_on_disable(doc)

        log_error.assert_called_once()


class GetJMAPClientForDisabledUser(unittest.TestCase):
    """The factory refuses disabled users unless the caller says the disabled state is expected."""

    def _run(self, enabled: int | None, allow_disabled: bool = False) -> None:
        from suite.mail import jmap

        with (
            mock.patch.object(jmap.frappe, "get_cached_value", return_value=enabled),
            # No User Settings: a call that gets past the enabled check fails here instead.
            mock.patch.object(jmap.frappe.db, "exists", return_value=None),
            self.assertRaises(frappe.ValidationError) as raised,
        ):
            jmap.get_jmap_client(USER, ignore_permissions=True, allow_disabled=allow_disabled)

        return str(raised.exception)

    def test_disabled_user_is_refused_by_default(self):
        self.assertIn("disabled", self._run(enabled=0))

    def test_allow_disabled_lets_the_call_through(self):
        self.assertIn("JMAP settings", self._run(enabled=0, allow_disabled=True))

    def test_allow_disabled_still_refuses_a_missing_user(self):
        self.assertIn("does not exist", self._run(enabled=None, allow_disabled=True))
