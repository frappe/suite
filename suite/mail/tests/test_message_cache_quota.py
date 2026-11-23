# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import shutil
import tempfile
import unittest
from datetime import UTC, datetime
from unittest import mock

from suite.mail.doctype.mail_message import mail_message
from suite.mail.store import Entity, quota
from suite.mail.store.quota import BYTES_PER_MB, MessageCacheQuota
from suite.store.data_store import DataStore


class MessageCacheQuotaTestCase(unittest.TestCase):
    """Runs against a real LMDB store, since eviction depends on stored sizes."""

    def setUp(self):
        self.path = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.path, ignore_errors=True)
        self.store = DataStore(base_path=self.path, namespace=("mail", "account"))

        patcher = mock.patch.object(quota, "get_data_store", return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.quota = MessageCacheQuota("account")

    def cache(self, id, accessed=None, received_at="2026-01-01T00:00:00Z", megabytes=1):
        """Cache a message of about `megabytes`, optionally stamped as accessed on a date."""

        body = "x" * (megabytes * BYTES_PER_MB - 1024)
        self.store.set(Entity.EMAIL, id, {"id": id, "received_at": received_at, "html_body": body})
        if accessed:
            self.store.set(Entity.EMAIL_ACCESS, id, accessed)

    def cached_ids(self):
        return set(self.store.get_value_sizes(Entity.EMAIL))


class Enforce(MessageCacheQuotaTestCase):
    def test_a_cache_within_quota_is_left_alone(self):
        self.cache("a", accessed="2026-01-01")
        self.cache("b", accessed="2026-01-02")

        self.assertEqual(self.quota.enforce(quota_mb=2), 0)
        self.assertEqual(self.cached_ids(), {"a", "b"})

    def test_least_recently_accessed_messages_go_first(self):
        self.cache("newest", accessed="2026-03-01")
        self.cache("oldest", accessed="2026-01-01")
        self.cache("middle", accessed="2026-02-01")

        self.quota.enforce(quota_mb=1)

        self.assertEqual(self.cached_ids(), {"newest"})

    def test_eviction_stops_once_the_cache_fits(self):
        for day in range(1, 6):
            self.cache(f"m{day}", accessed=f"2026-01-0{day}")

        self.assertEqual(self.quota.enforce(quota_mb=3), 2)
        self.assertEqual(self.cached_ids(), {"m3", "m4", "m5"})

    def test_an_old_message_read_recently_outlives_a_newer_unread_one(self):
        self.cache("old-but-read", received_at="2020-01-01T00:00:00Z")
        self.cache("new-but-unread", received_at="2026-01-01T00:00:00Z", accessed="2026-01-01")
        self.quota.record_access(["old-but-read"])

        self.quota.enforce(quota_mb=1)

        self.assertEqual(self.cached_ids(), {"old-but-read"})

    def test_messages_cached_before_tracking_are_ranked_by_arrival(self):
        self.cache("older", received_at="2024-01-01T00:00:00Z")
        self.cache("newer", received_at="2025-01-01T00:00:00Z")

        self.quota.enforce(quota_mb=1)

        self.assertEqual(self.cached_ids(), {"newer"})

    def test_an_evicted_message_leaves_no_stamp(self):
        self.cache("old", accessed="2026-01-01")
        self.cache("new", accessed="2026-02-01")

        self.quota.enforce(quota_mb=1)

        self.assertIsNone(self.store.get(Entity.EMAIL_ACCESS, "old"))

    def test_a_stamp_whose_message_is_gone_is_dropped(self):
        self.store.set(Entity.EMAIL_ACCESS, "removed", "2026-01-01")

        self.quota.enforce(quota_mb=1)

        self.assertIsNone(self.store.get(Entity.EMAIL_ACCESS, "removed"))

    def test_other_cached_entities_are_not_evicted(self):
        self.store.set(Entity.CONTACT_CARD, "card", {"id": "card"})
        self.cache("a", accessed="2026-01-01")
        self.cache("b", accessed="2026-01-02")

        self.quota.enforce(quota_mb=1)

        self.assertEqual(self.store.get(Entity.CONTACT_CARD, "card"), {"id": "card"})

    def test_one_failing_account_does_not_stop_the_rest(self):
        enforced = []

        def enforce(instance, quota_mb):
            if instance.account == "broken":
                raise OSError("store unavailable")
            enforced.append(instance.account)

        def init(instance, account):
            instance.account = account

        with (
            mock.patch.object(MessageCacheQuota, "__init__", init),
            mock.patch.object(MessageCacheQuota, "enforce", enforce),
            mock.patch.object(quota, "log_mail_error") as log_error,
            mock.patch.object(quota.frappe, "get_traceback", return_value=""),
        ):
            quota.enforce_quotas({"broken": 1, "healthy": 1})

        self.assertEqual(enforced, ["healthy"])
        log_error.assert_called_once()


class RecordAccess(MessageCacheQuotaTestCase):
    def test_a_read_stamps_the_message_with_today(self):
        self.cache("a", accessed="2026-01-01")

        self.quota.record_access(["a"])

        self.assertEqual(self.store.get(Entity.EMAIL_ACCESS, "a"), datetime.now(UTC).date().isoformat())

    def test_a_second_read_on_the_same_day_writes_nothing(self):
        self.quota.record_access(["a"])

        with mock.patch.object(self.store, "set_many") as set_many:
            self.quota.record_access(["a"])

        set_many.assert_not_called()

    def test_a_failed_stamp_does_not_break_the_read(self):
        with (
            mock.patch.object(MessageCacheQuota, "record_access", side_effect=OSError("disk full")),
            mock.patch.object(quota, "log_mail_error") as log_error,
            mock.patch.object(quota.frappe, "get_traceback", return_value=""),
        ):
            quota.record_message_access("account", ["a"])

        log_error.assert_called_once()

    def test_reading_through_get_messages_protects_a_message_from_eviction(self):
        self.cache("read", accessed="2026-01-01")
        self.cache("unread", accessed="2026-02-01")

        with (
            mock.patch.object(mail_message, "get_data_store", return_value=self.store),
            mock.patch.object(mail_message, "get_user_for_jmap_account"),
            mock.patch.object(mail_message.classification, "is_enabled", return_value=False),
        ):
            mail_message.get_messages("account", ["read"])

        self.quota.enforce(quota_mb=1)

        self.assertEqual(self.cached_ids(), {"read"})


class ValueSizes(MessageCacheQuotaTestCase):
    def test_sizes_cover_only_the_entity_asked_for(self):
        self.store.set(Entity.EMAIL, "a", "x" * 100)
        self.store.set(Entity.EMAIL_ACCESS, "b", "2026-01-01")

        sizes = self.store.get_value_sizes(Entity.EMAIL)

        self.assertEqual(set(sizes), {"a"})
        self.assertGreaterEqual(sizes["a"], 100)


if __name__ == "__main__":
    unittest.main()
