# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""``_cache_messages``'s contract with the address index: a message is indexed the once, when the
cache first takes it, and only stays cached if that indexing got through — so a failure costs a
re-fetch rather than leaving the people on that message out of suggestions for good."""

import shutil
import tempfile
import unittest
from unittest import mock

from suite.mail.doctype.mail_message import mail_message
from suite.mail.store import Entity
from suite.store.data_store import DataStore


class CacheMessages(unittest.TestCase):
    """``_cache_messages`` — index what the cache had never held, and keep only what indexed."""

    def cache(self, messages, new_ids=None, index_error=None, rollback_error=None):
        """Cache `messages`; returns the store, index, error log and rebuild, all mocked."""

        store = mock.Mock()
        # Whatever the store reports as new is what the batch is judged by.
        store.set_many.return_value = set(messages) if new_ids is None else new_ids
        store.delete_many.side_effect = rollback_error

        index = mock.Mock()
        index.index_addresses.side_effect = index_error

        with (
            mock.patch.object(mail_message, "get_data_store", return_value=store),
            mock.patch.object(mail_message, "get_email_address_index", return_value=index),
            mock.patch.object(mail_message, "log_mail_error") as log_error,
            mock.patch.object(mail_message, "rebuild_email_address_index") as rebuild,
        ):
            mail_message._cache_messages("account", messages)

        return store, index, log_error, rebuild

    def message(self, id, email):
        return {"id": id, "from_name": "Jane Doe", "from_email": email, "recipients": []}

    def test_a_new_message_has_its_addresses_indexed(self):
        message = self.message("m1", "jane@example.com")
        _store, index, _log, _rebuild = self.cache({"m1": message})

        addresses = index.index_addresses.call_args.args[0]
        self.assertEqual(addresses, [{"name": "Jane Doe", "email": "jane@example.com"}])

    def test_a_message_the_cache_already_held_is_not_indexed_again(self):
        # The re-cache a flag change causes: counting it would score sync churn as correspondence.
        _store, index, _log, _rebuild = self.cache(
            {"m1": self.message("m1", "jane@example.com")}, new_ids=set()
        )

        index.index_addresses.assert_not_called()

    def test_only_the_new_messages_of_a_mixed_batch_are_indexed(self):
        messages = {
            "m1": self.message("m1", "jane@example.com"),
            "m2": self.message("m2", "john@example.com"),
        }
        _store, index, _log, _rebuild = self.cache(messages, new_ids={"m2"})

        addresses = index.index_addresses.call_args.args[0]
        self.assertEqual([address["email"] for address in addresses], ["john@example.com"])

    def test_a_message_that_indexed_stays_cached(self):
        _store, _index, _log, _rebuild = self.cache({"m1": self.message("m1", "jane@example.com")})

        _store.delete_many.assert_not_called()

    def test_a_message_that_failed_to_index_is_uncached(self):
        # Being cached is what marks a message indexed. Left cached, it would never be offered as
        # new again and jane@example.com would be missing from suggestions until a manual rebuild.
        store, _index, log_error, _rebuild = self.cache(
            {"m1": self.message("m1", "jane@example.com")}, index_error=RuntimeError("index is down")
        )

        store.delete_many.assert_called_once_with(Entity.EMAIL, keys=["m1"])
        log_error.assert_called_once()

    def test_only_the_messages_that_went_unindexed_are_uncached(self):
        messages = {
            "m1": self.message("m1", "jane@example.com"),
            "m2": self.message("m2", "john@example.com"),
        }
        store, _index, _log, _rebuild = self.cache(messages, new_ids={"m2"}, index_error=RuntimeError("boom"))

        store.delete_many.assert_called_once_with(Entity.EMAIL, keys=["m2"])

    def test_indexing_failure_never_reaches_the_caller(self):
        # Caching is the caller's business; a search index that is down is not their problem.
        _store, _index, log_error, _rebuild = self.cache(
            {"m1": self.message("m1", "jane@example.com")}, index_error=RuntimeError("boom")
        )

        log_error.assert_called_once()

    def test_a_rollback_that_fails_is_swallowed_too(self):
        # Same reason: whatever the store does here, caching must not raise at the caller.
        _store, _index, log_error, _rebuild = self.cache(
            {"m1": self.message("m1", "jane@example.com")},
            index_error=RuntimeError("boom"),
            rollback_error=RuntimeError("store is down"),
        )

        # Both failures are on the record: the index write, and the uncaching meant to undo it.
        self.assertEqual(log_error.call_count, 2)

    def test_a_rollback_that_fails_hands_the_account_to_a_rebuild(self):
        # Nothing local can fix this one: the message stays cached, so it will never be offered as
        # new again, and its addresses would go unindexed until someone noticed. A rebuild
        # reconciles the whole index against the cache, and dedupes per account.
        _store, _index, _log, rebuild = self.cache(
            {"m1": self.message("m1", "jane@example.com")},
            index_error=RuntimeError("boom"),
            rollback_error=RuntimeError("store is down"),
        )

        rebuild.assert_called_once_with("account")

    def test_a_rollback_that_works_needs_no_rebuild(self):
        # The next fetch retries this one on its own; a rebuild would be a lot of work for nothing.
        _store, _index, _log, rebuild = self.cache(
            {"m1": self.message("m1", "jane@example.com")}, index_error=RuntimeError("boom")
        )

        rebuild.assert_not_called()

    def test_a_rebuild_that_cannot_be_queued_still_does_not_reach_the_caller(self):
        # Redis down on top of the rest. The failures are logged; caching does not raise.
        store = mock.Mock()
        store.set_many.return_value = {"m1"}
        store.delete_many.side_effect = RuntimeError("store is down")

        index = mock.Mock()
        index.index_addresses.side_effect = RuntimeError("boom")

        with (
            mock.patch.object(mail_message, "get_data_store", return_value=store),
            mock.patch.object(mail_message, "get_email_address_index", return_value=index),
            mock.patch.object(mail_message, "log_mail_error") as log_error,
            mock.patch.object(mail_message, "rebuild_email_address_index") as rebuild,
        ):
            rebuild.side_effect = RuntimeError("queue is down")
            mail_message._cache_messages("account", {"m1": self.message("m1", "jane@example.com")})

        self.assertEqual(log_error.call_count, 2)


class RollbackAgainstAConcurrentUpdate(unittest.TestCase):
    """What the rollback does when another request re-cached the message while indexing ran.

    Against a real store, with the competing write landing inside the failing index call — the
    window it would really land in.
    """

    def setUp(self):
        self.path = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.path, ignore_errors=True)
        self.store = DataStore(base_path=self.path, namespace=("test", "message-caching"))

    def cache_with_a_competing_write_during_indexing(self, message, competing):
        """Cache `message`; while indexing runs (and fails), another request caches `competing`."""

        def index_addresses(_addresses):
            self.store.set_many(Entity.EMAIL, items={"m1": competing})
            raise RuntimeError("index is down")

        index = mock.Mock()
        index.index_addresses.side_effect = index_addresses

        with (
            mock.patch.object(mail_message, "get_data_store", return_value=self.store),
            mock.patch.object(mail_message, "get_email_address_index", return_value=index),
            mock.patch.object(mail_message, "log_mail_error"),
        ):
            mail_message._cache_messages("account", {"m1": message})

    def test_the_newer_copy_is_dropped_along_with_the_rest(self):
        # Deliberate, and the reason is the other request: it found the id already cached, so it
        # skipped indexing on the same grounds this one did. Keeping its copy would leave the
        # message cached with no one left to index it, and nothing brings it back through here
        # except a cache miss — so the addresses on it would never be indexed at all. The copy is a
        # mirror of the server, so dropping it costs a re-fetch; keeping it would cost the index.
        message = {"id": "m1", "from_name": "Jane Doe", "from_email": "jane@example.com"}
        self.cache_with_a_competing_write_during_indexing(message, {**message, "seen": 1})

        self.assertFalse(self.store.exists(Entity.EMAIL, "m1"))

    def test_the_next_fetch_of_it_is_new_again(self):
        # Which is what makes the drop recoverable: the retry indexes the addresses that were lost.
        message = {"id": "m1", "from_name": "Jane Doe", "from_email": "jane@example.com"}
        self.cache_with_a_competing_write_during_indexing(message, {**message, "seen": 1})

        self.assertEqual(self.store.set_many(Entity.EMAIL, items={"m1": message}), {"m1"})


if __name__ == "__main__":
    unittest.main()
