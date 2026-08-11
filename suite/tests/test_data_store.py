# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""``DataStore.set_many``'s newness contract: storing a batch reports which of it the store did not
already hold, decided inside the transaction that writes it — so of two writers racing to store the
same key, exactly one is told it was theirs to store."""

import shutil
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from enum import Enum

from suite.store.data_store import DataStore


class Thing(Enum):
    """An entity to scope test keys under; the store only reads `.value` off it."""

    THING = "thing"


class SetMany(unittest.TestCase):
    """``set_many`` — stores the batch, and says which of it the store had never held."""

    def setUp(self):
        # A directory per test: LMDB environments are cached per path for the life of the process.
        self.path = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.path, ignore_errors=True)
        self.store = DataStore(base_path=self.path, namespace=("test", "data-store"))

    def test_every_key_of_a_fresh_batch_is_new(self):
        self.assertEqual(self.store.set_many(Thing.THING, {"a": 1, "b": 2}), {"a", "b"})

    def test_a_key_already_stored_is_not_new_again(self):
        self.store.set_many(Thing.THING, {"a": 1})

        self.assertEqual(self.store.set_many(Thing.THING, {"a": 2, "b": 3}), {"b"})

    def test_a_key_that_isnt_new_is_still_written(self):
        self.store.set_many(Thing.THING, {"a": 1})
        self.store.set_many(Thing.THING, {"a": 2})

        self.assertEqual(self.store.get(Thing.THING, "a"), 2)

    def test_an_empty_batch_stores_nothing_and_is_new_in_no_part(self):
        self.assertEqual(self.store.set_many(Thing.THING, {}), set())

    def test_only_one_of_two_writers_racing_on_a_key_is_told_it_was_new(self):
        # The race this contract exists to close. Checking before writing cannot settle it: both
        # writers look before either commits, both are told the key is new, and a caller that acts
        # on that — indexing a message's addresses, say — does it twice. Deciding inside the write
        # hands it to whichever transaction LMDB serializes first.
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda n: self.store.set_many(Thing.THING, {"a": n}), range(8)))

        self.assertEqual(sum("a" in result for result in results), 1)

    def test_a_racing_batch_is_split_between_its_writers(self):
        # Every key is claimed, and claimed once, however the writers interleave.
        batches = [{"a": 1, "b": 1}, {"b": 2, "c": 2}, {"c": 3, "a": 3}]

        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(lambda batch: self.store.set_many(Thing.THING, batch), batches))

        claimed = [key for result in results for key in result]
        self.assertEqual(sorted(claimed), ["a", "b", "c"])


if __name__ == "__main__":
    unittest.main()
