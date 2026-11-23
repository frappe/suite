# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import os
import shutil
import tempfile
import unittest
from datetime import UTC, datetime
from unittest import mock

from suite.mail.doctype.mail_message import mail_message
from suite.mail.store import Entity, quota
from suite.mail.store.indexes.email_address import EmailAddressIndex
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

    def test_no_limit_evicts_nothing(self):
        self.cache("a", accessed="2026-01-01")
        self.cache("b", accessed="2026-01-02")

        self.assertEqual(self.quota.enforce(quota_mb=0), 0)
        self.assertEqual(self.cached_ids(), {"a", "b"})

    def test_no_limit_still_drops_a_stamp_whose_message_is_gone(self):
        self.store.set(Entity.EMAIL_ACCESS, "removed", "2026-01-01")

        self.quota.enforce(quota_mb=0)

        self.assertIsNone(self.store.get(Entity.EMAIL_ACCESS, "removed"))

    def test_eviction_is_logged_with_what_it_freed(self):
        self.cache("old", accessed="2026-01-01")
        self.cache("new", accessed="2026-02-01")
        size = self.store.get_value_sizes(Entity.EMAIL)["old"]

        with mock.patch.object(self.store.logger, "info") as info:
            self.quota.enforce(quota_mb=1)

        info.assert_called_once_with("message-cache-evicted", evicted=1, freed_bytes=size, quota_mb=1)

    def test_the_daily_job_leaves_out_an_account_that_never_opened_mail(self):
        database = mock.Mock()
        database.get_all.return_value = (("account", 512), ("never-opened", 512))

        with (
            mock.patch.object(quota.frappe, "db", database),
            mock.patch.object(quota, "get_data_base_path", return_value=self.path),
            mock.patch.object(quota, "enqueue_job") as enqueue,
        ):
            quota.enforce_message_cache_quotas()

        self.assertEqual(enqueue.call_args.kwargs["quotas"], {"account": 512})
        self.assertFalse(os.path.exists(os.path.join(self.path, "mail", "never-opened")))

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


class IndexWithRealMerge:
    """The address index's real merge rules, without Tantivy or the Redis write lock."""

    def __init__(self):
        self.documents = {}
        self.rules = EmailAddressIndex.__new__(EmailAddressIndex)

    def index_addresses(self, addresses):
        for address in addresses:
            document = self.rules.to_document(address)
            self.documents[document["id"]] = self.rules.merge_document(
                document, self.documents.get(document["id"])
            )

    def name_of(self, email):
        return self.documents[email]["name"]


class RefetchAfterEviction(MessageCacheQuotaTestCase):
    """Old mail coming back must not undo what newer mail taught the address index."""

    def setUp(self):
        super().setUp()
        self.index = IndexWithRealMerge()
        for name, value in {
            "get_data_store": self.store,
            "get_email_address_index": self.index,
            "get_account_emails": [],
        }.items():
            patcher = mock.patch.object(mail_message, name, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def store_message(self, id, sender, recipient="Bob"):
        message = {
            "id": id,
            "from_name": sender,
            "from_email": "jane@example.com",
            "recipients": [{"type": "To", "display_name": recipient, "email": "bob@example.com"}],
            "sent_at": "2026-01-01T00:00:00+00:00",
        }
        mail_message._cache_messages("account", {id: message})
        return message

    def evict_and_refetch(self, message):
        self.quota.evict([message["id"]])
        mail_message._cache_messages("account", {message["id"]: message})

    def test_old_mail_back_after_eviction_keeps_the_senders_newer_name(self):
        old = self.store_message("old", "Jane Doe")
        self.store_message("new", "Jane Smith")

        self.evict_and_refetch(old)

        self.assertEqual(self.index.name_of("jane@example.com"), "Jane Smith")

    def test_old_mail_back_after_eviction_keeps_a_recipients_newer_name(self):
        old = self.store_message("old", "Jane", recipient="Bob Old")
        self.store_message("new", "Jane", recipient="Bob New")

        self.evict_and_refetch(old)

        self.assertEqual(self.index.name_of("bob@example.com"), "Bob New")

    def test_mail_never_evicted_still_updates_the_name(self):
        old = self.store_message("old", "Jane Doe")
        self.evict_and_refetch(old)

        self.store_message("newest", "Jane Smith")

        self.assertEqual(self.index.name_of("jane@example.com"), "Jane Smith")

    def test_mail_back_after_eviction_restores_an_address_the_index_lost(self):
        old = self.store_message("old", "Jane Doe")
        self.index.documents.clear()

        self.evict_and_refetch(old)

        self.assertEqual(self.index.name_of("jane@example.com"), "Jane Doe")

    def test_mail_back_after_eviction_fills_in_a_name_the_index_lacks(self):
        old = self.store_message("old", "Jane Doe")
        self.index.index_addresses([{"name": None, "email": "carol@example.com"}])
        old["from_email"] = "carol@example.com"

        self.evict_and_refetch(old)

        self.assertEqual(self.index.name_of("carol@example.com"), "Jane Doe")

    def test_the_mark_goes_once_the_message_is_back(self):
        old = self.store_message("old", "Jane Doe")

        self.evict_and_refetch(old)

        self.assertIsNone(self.store.get(Entity.EVICTED_EMAIL, "old"))

    def test_the_mark_stays_when_indexing_fails(self):
        old = self.store_message("old", "Jane Doe")
        self.store_message("new", "Jane Smith")
        self.quota.evict(["old"])

        with (
            mock.patch.object(self.index, "index_addresses", side_effect=RuntimeError("index down")),
            mock.patch.object(mail_message, "log_mail_error"),
            mock.patch.object(mail_message.frappe, "get_traceback", return_value=""),
        ):
            mail_message._cache_messages("account", {"old": old})

        mail_message._cache_messages("account", {"old": old})

        self.assertEqual(self.index.name_of("jane@example.com"), "Jane Smith")

    def test_mail_deleted_from_the_server_loses_its_mark(self):
        self.store_message("old", "Jane Doe")
        self.quota.evict(["old"])

        with mock.patch.object(mail_message, "_note_written"):
            mail_message._remove_cached_messages("account", ["old"], is_destroyed=True)

        self.assertIsNone(self.store.get(Entity.EVICTED_EMAIL, "old"))

    def test_mail_changed_on_the_server_keeps_its_mark(self):
        self.store_message("old", "Jane Doe")
        self.quota.evict(["old"])

        with mock.patch.object(mail_message, "_note_written"):
            mail_message._remove_cached_messages("account", ["old"])

        self.assertTrue(self.store.get(Entity.EVICTED_EMAIL, "old"))


class ValueSizes(MessageCacheQuotaTestCase):
    def test_sizes_cover_only_the_entity_asked_for(self):
        self.store.set(Entity.EMAIL, "a", "x" * 100)
        self.store.set(Entity.EMAIL_ACCESS, "b", "2026-01-01")

        sizes = self.store.get_value_sizes(Entity.EMAIL)

        self.assertEqual(set(sizes), {"a"})
        self.assertGreaterEqual(sizes["a"], 100)

    def test_total_size_covers_only_the_entity_asked_for(self):
        self.store.set(Entity.EMAIL, "a", "x" * 1000)
        self.store.set(Entity.EMAIL, "b", "x" * 2000)
        self.store.set(Entity.EMAIL_ACCESS, "a", "y" * 5000)

        total = self.store.get_total_value_size(Entity.EMAIL)

        self.assertGreaterEqual(total, 3000)
        self.assertLess(total, 3100)


if __name__ == "__main__":
    unittest.main()
