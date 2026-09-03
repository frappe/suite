# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""``ensure_push_subscription`` — the self-healing check that (re)creates this site's push
subscription on the mail server. A subscription lost to a failed creation, an unrenewed
expiry or a server-side delete silently ends the user's webhooks, so presence must be
verifiable and recoverable without any locally stored record."""

import unittest
from datetime import timedelta
from unittest import mock

import frappe
from frappe.utils.file_lock import LockTimeoutError

from suite.mail.doctype.push_subscription import push_subscription
from suite.utils.dt import get_utc_now

USER = "user@example.test"


class EnsurePushSubscription(unittest.TestCase):
    def _run(
        self,
        subscriptions: list[dict],
        url: str = "https://mail.example.test",
        disabled: bool = False,
        delete_error: Exception | None = None,
    ) -> tuple[mock.Mock, mock.Mock]:
        with (
            mock.patch.object(push_subscription.frappe.utils, "get_url", return_value=url),
            mock.patch.object(push_subscription, "is_push_subscription_disabled", return_value=disabled),
            mock.patch.object(push_subscription, "get_site_device_client_id", return_value="site-device"),
            mock.patch.object(push_subscription, "get_push_subscription_service") as service,
            mock.patch.object(push_subscription, "_create_push_subscription") as add,
        ):
            service.return_value.get.return_value = subscriptions
            if delete_error:
                service.return_value.delete.side_effect = delete_error
            push_subscription.ensure_push_subscription(USER)

        return add, service

    def test_creates_when_no_subscription_exists(self):
        add, _ = self._run([])

        add.assert_called_once_with(USER, ignore_permissions=True)

    def test_skips_when_live_subscription_exists(self):
        add, _ = self._run([{"deviceClientId": "site-device", "expires": "2999-01-01T00:00:00Z"}])

        add.assert_not_called()

    def test_skips_when_subscription_never_expires(self):
        add, _ = self._run([{"deviceClientId": "site-device", "expires": None}])

        add.assert_not_called()

    def test_other_devices_subscriptions_do_not_count(self):
        add, _ = self._run([{"deviceClientId": "other-device", "expires": "2999-01-01T00:00:00Z"}])

        add.assert_called_once_with(USER, ignore_permissions=True)

    def test_recreates_when_subscription_expired(self):
        add, service = self._run(
            [{"id": "sub-old", "deviceClientId": "site-device", "expires": "2000-01-01T00:00:00Z"}]
        )

        add.assert_called_once_with(USER, ignore_permissions=True)
        service.return_value.delete.assert_called_once_with(["sub-old"])

    def test_expired_duplicate_is_deleted_even_when_live_exists(self):
        add, service = self._run(
            [
                {"id": "sub-old", "deviceClientId": "site-device", "expires": "2000-01-01T00:00:00Z"},
                {"deviceClientId": "site-device", "expires": "2999-01-01T00:00:00Z"},
            ]
        )

        add.assert_not_called()
        service.return_value.delete.assert_called_once_with(["sub-old"])

    def test_delete_failure_does_not_block_recreation(self):
        add, _ = self._run(
            [{"id": "sub-old", "deviceClientId": "site-device", "expires": "2000-01-01T00:00:00Z"}],
            delete_error=RuntimeError("boom"),
        )

        add.assert_called_once_with(USER, ignore_permissions=True)

    def test_skips_on_non_https_site(self):
        add, service = self._run([], url="http://site.localhost:8001")

        add.assert_not_called()
        service.assert_not_called()

    def test_skips_when_user_disabled_push(self):
        add, service = self._run([], disabled=True)

        add.assert_not_called()
        service.assert_not_called()

    def test_skips_when_concurrent_run_holds_the_lock(self):
        with (
            mock.patch.object(
                push_subscription.frappe.utils, "get_url", return_value="https://mail.example.test"
            ),
            mock.patch.object(push_subscription, "is_push_subscription_disabled", return_value=False),
            mock.patch.object(push_subscription, "filelock", side_effect=LockTimeoutError),
            mock.patch.object(push_subscription, "get_push_subscription_service") as service,
            mock.patch.object(push_subscription, "_create_push_subscription") as add,
        ):
            push_subscription.ensure_push_subscription(USER)

        service.assert_not_called()
        add.assert_not_called()

    def test_surplus_live_duplicates_are_pruned_keeping_the_longest_lived(self):
        add, service = self._run(
            [
                {"id": "sub-a", "deviceClientId": "site-device", "expires": "2998-01-01T00:00:00Z"},
                {"id": "sub-b", "deviceClientId": "site-device", "expires": None},
                {"id": "sub-c", "deviceClientId": "site-device", "expires": "2999-01-01T00:00:00Z"},
            ]
        )

        add.assert_not_called()
        (deleted,), _ = service.return_value.delete.call_args
        self.assertCountEqual(deleted, ["sub-a", "sub-c"])


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
            mock.patch.object(push_subscription, "get_push_subscription_service") as service,
            mock.patch.object(
                push_subscription, "_create_push_subscription", return_value="new-id"
            ) as create,
        ):
            service.return_value.get.return_value = subscriptions
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
            mock.patch.object(push_subscription, "get_push_subscription_service") as service,
        ):
            service.return_value.create.side_effect = lambda subs: {
                "created": {subs[0]["creation_id"]: {"id": "new-id"}}
            }
            push_subscription._create_push_subscription(USER, ignore_permissions=True, **kwargs)
            (subs,), _ = service.return_value.create.call_args

        return subs[0]

    def test_default_creation_wears_the_site_device_id(self):
        self.assertEqual(self._create()["device_client_id"], "site-device")

    def test_custom_url_creation_gets_a_unique_device_id(self):
        sub = self._create(url="https://elsewhere.example.test/hook")

        self.assertNotEqual(sub["device_client_id"], "site-device")

    def test_custom_types_creation_gets_a_unique_device_id(self):
        self.assertNotEqual(self._create(types=["Email"])["device_client_id"], "site-device")

    def test_site_device_id_with_custom_parameters_is_rejected(self):
        with (
            mock.patch.object(push_subscription, "get_site_device_client_id", return_value="site-device"),
            mock.patch.object(push_subscription, "get_push_subscription_service") as service,
            self.assertRaises(push_subscription.frappe.ValidationError),
        ):
            push_subscription._create_push_subscription(
                USER, "site-device", "https://elsewhere.example.test/hook", ignore_permissions=True
            )

        service.return_value.create.assert_not_called()

    def test_explicit_device_id_is_honored(self):
        sub = self._create(device_client_id="my-device", url="https://elsewhere.example.test/hook")

        self.assertEqual(sub["device_client_id"], "my-device")


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
            mock.patch.object(push_subscription, "get_push_subscription_service") as service_factory,
            mock.patch.object(push_subscription, "_create_push_subscription") as add,
            mock.patch.object(push_subscription, "log_mail_error") as log_mail_error,
        ):
            service = service_factory.return_value
            service.get.return_value = subscriptions
            service.update.return_value = {"updated": {}}
            push_subscription.renew_expiring_push_subscriptions()

        self.assertEqual(service.get.call_count, 1)
        log_mail_error.assert_not_called()
        return service, add

    def test_expiring_subscription_is_renewed_from_the_shared_fetch(self):
        expiring = (get_utc_now() + timedelta(days=1)).isoformat()
        service, add = self._run(
            [
                {"id": "site-sub", "deviceClientId": "site-device", "expires": "2999-01-01T00:00:00Z"},
                {"id": "exp-1", "deviceClientId": "other-device", "expires": expiring},
            ]
        )

        service.update.assert_called_once_with([{"id": "exp-1"}])
        add.assert_not_called()

    def test_already_expired_foreign_subscription_is_not_renewed(self):
        service, add = self._run(
            [
                {"id": "site-sub", "deviceClientId": "site-device", "expires": "2999-01-01T00:00:00Z"},
                {"id": "dead-1", "deviceClientId": "other-device", "expires": "2000-01-01T00:00:00Z"},
            ]
        )

        service.update.assert_not_called()
        service.delete.assert_not_called()
        add.assert_not_called()

    def test_deleted_expired_subscription_is_not_renewed(self):
        service, add = self._run(
            [{"id": "sub-old", "deviceClientId": "site-device", "expires": "2000-01-01T00:00:00Z"}]
        )

        service.delete.assert_called_once_with(["sub-old"])
        add.assert_called_once_with(USER, ignore_permissions=True)
        service.update.assert_not_called()


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
    def _run(self, subscriptions: list[dict], not_destroyed: dict | None = None) -> mock.Mock:
        with (
            mock.patch.object(push_subscription, "get_site_device_client_id", return_value="site-device"),
            mock.patch.object(push_subscription, "get_push_subscription_service") as service,
        ):
            service.return_value.get.return_value = subscriptions
            service.return_value.delete.return_value = {"destroyed": [], "notDestroyed": not_destroyed or {}}
            push_subscription.delete_site_push_subscriptions(USER)

        return service

    def test_deletes_only_the_site_subscriptions(self):
        service = self._run(
            [
                {"id": "site-1", "deviceClientId": "site-device"},
                {"id": "custom", "deviceClientId": "other-device"},
                {"id": "site-2", "deviceClientId": "site-device"},
            ]
        )

        service.assert_called_once_with(USER, ignore_permissions=True, allow_disabled=True)
        service.return_value.delete.assert_called_once_with(["site-1", "site-2"])

    def test_nothing_to_delete_skips_the_delete_call(self):
        service = self._run([{"id": "custom", "deviceClientId": "other-device"}])

        service.return_value.delete.assert_not_called()

    def test_server_side_delete_errors_surface(self):
        with self.assertRaises(push_subscription.frappe.ValidationError):
            self._run(
                [{"id": "site-1", "deviceClientId": "site-device"}],
                not_destroyed={"site-1": {"type": "notFound", "description": "gone"}},
            )


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


class GetJMAPConnectionForDisabledUser(unittest.TestCase):
    """The factory refuses disabled users unless the caller says the disabled state is expected."""

    def _run(self, enabled: int | None, allow_disabled: bool = False) -> None:
        from suite.mail import jmap

        with (
            mock.patch.object(jmap.frappe, "get_cached_value", return_value=enabled),
            # No User Settings: a call that gets past the enabled check fails here instead.
            mock.patch.object(jmap.frappe.db, "exists", return_value=None),
            self.assertRaises(frappe.ValidationError) as raised,
        ):
            jmap.get_jmap_connection(USER, ignore_permissions=True, allow_disabled=allow_disabled)

        return str(raised.exception)

    def test_disabled_user_is_refused_by_default(self):
        self.assertIn("disabled", self._run(enabled=0))

    def test_allow_disabled_lets_the_call_through(self):
        self.assertIn("JMAP settings", self._run(enabled=0, allow_disabled=True))

    def test_allow_disabled_still_refuses_a_missing_user(self):
        self.assertIn("does not exist", self._run(enabled=None, allow_disabled=True))
