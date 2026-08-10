# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""``DataStore.set_many``'s contract: it stores every item and reports which keys were new, decided
inside the write itself so two writers racing over the same key can't both be told they added it."""

import unittest
from enum import Enum
from unittest import mock

from suite.store.data_store import DataStore


class Key(Enum):
    """Stand-in for a caller's entity enum."""

    EMAIL = "email"


class FakeTransaction:
    """Just enough of an LMDB transaction to exercise put-if-absent."""

    def __init__(self, existing: tuple = ()):
        self.data = {key: b"stored earlier" for key in existing}

    def put(self, key: bytes, value: bytes, overwrite: bool = True) -> bool:
        if not overwrite and key in self.data:
            return False

        self.data[key] = value
        return True


class SetMany(unittest.TestCase):
    """``set_many`` — everything is stored; only keys the store lacked come back."""

    def set_many(self, items, transactions):
        """Run set_many against the given transactions, one per (re)try of the write callback."""

        store = mock.Mock(spec=DataStore)
        store._db_key.side_effect = lambda entity, key: f"{entity.value}:{key}".encode()
        store._serialize.side_effect = lambda value: str(value).encode()
        store._write.side_effect = lambda callback: [callback(txn) for txn in transactions]

        return DataStore.set_many(store, Key.EMAIL, items)

    def test_every_key_is_new_to_an_empty_store(self):
        transaction = FakeTransaction()
        self.assertEqual(self.set_many({"a": 1, "b": 2}, [transaction]), {"a", "b"})
        self.assertEqual(transaction.data[b"email:a"], b"1")

    def test_keys_already_held_are_not_reported_but_are_still_stored(self):
        transaction = FakeTransaction(existing=(b"email:a",))
        self.assertEqual(self.set_many({"a": 1, "b": 2}, [transaction]), {"b"})
        # The value is refreshed even though the key was not new.
        self.assertEqual(transaction.data[b"email:a"], b"1")

    def test_nothing_to_store_adds_nothing(self):
        self.assertEqual(self.set_many({}, []), set())

    def test_retry_after_an_aborted_write_recomputes_what_was_new(self):
        # A MapFullError aborts the first attempt, so its writes are gone when the second runs:
        # the keys it saw as new have to be worked out again, not carried over or doubled up.
        aborted, retried = FakeTransaction(), FakeTransaction(existing=(b"email:a",))
        self.assertEqual(self.set_many({"a": 1, "b": 2}, [aborted, retried]), {"b"})


if __name__ == "__main__":
    unittest.main()
