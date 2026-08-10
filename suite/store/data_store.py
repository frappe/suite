from collections import OrderedDict
from contextlib import contextmanager, suppress
from enum import Enum
from threading import RLock
from typing import Any, ClassVar

import frappe
import lmdb
import msgpack

from suite.store.base_store import BaseStore, Namespace


class _EnvEntry:
    """Tracks a cached LMDB environment and the number of in-flight transactions using it."""

    __slots__ = ("env", "refcount")

    def __init__(self, env: lmdb.Environment) -> None:
        self.env = env
        self.refcount = 0


class DataStore(BaseStore):
    """A key-value store backed by LMDB, with one environment per ``namespace``.

    The store is shared by every user with access to the namespace. LMDB natively supports
    concurrent multi-process access: many readers run lock-free via MVCC snapshots while a
    single writer briefly serializes on a robust mutex (and waits
    rather than failing). Environments are kept open and shared per process, so there is no
    per-operation open cost and no external locking layer.
    """

    MAX_MSGPACK_BYTES = 25 * 1024 * 1024
    MAX_MSGPACK_COLLECTION_LEN = 2_00_000

    # Virtual address-space ceiling per environment. It is sparse (not preallocated) on 64-bit
    # systems, and grows automatically on MapFullError. Migration uses this same value.
    DEFAULT_MAP_SIZE = 2 * 1024 * 1024 * 1024

    # Best-effort per-process soft cap on simultaneously open environments. Before opening a
    # new environment, idle ones (no in-flight transactions) are closed least-recently-used
    # first. The cap may be temporarily exceeded under load when every cached environment is
    # busy, since an in-use environment is never force-closed.
    MAX_CACHED_ENVS = 128

    # Size of each environment's reader lock table. A reader slot is held per live process/thread
    # that has the environment open, and is shared across every process via lock.mdb, so the
    # default (126) is easily exhausted by many web + background workers on a hot key
    # (MDB_READERS_FULL). The table is a sparse file (~one page on disk until slots are used), so
    # a generous value is effectively free. Stale slots left by crashed/recycled workers are
    # reclaimed via reader_check().
    MAX_READERS = 2048

    _ENVS: ClassVar[OrderedDict[str, _EnvEntry]] = OrderedDict()
    _ENVS_GUARD: ClassVar[RLock] = RLock()

    def __init__(
        self,
        base_path: str,
        namespace: Namespace,
        map_size: int | None = None,
        **_legacy: Any,
    ) -> None:
        """Initialize the store for the given base path and ``namespace``."""

        super().__init__(base_path=base_path, namespace=namespace)

        self.logger_context["store"] = "data"
        self.map_size = map_size or self.DEFAULT_MAP_SIZE

    def _open_env(self) -> lmdb.Environment:
        """Open the LMDB environment for this store's path."""

        self.logger.debug({**self.logger_context, "event": "opening-env", "path": self.path})

        env = lmdb.open(
            self.path,
            map_size=self.map_size,
            subdir=True,
            max_dbs=0,
            max_readers=self.MAX_READERS,
            readahead=False,
            meminit=False,
            writemap=False,
        )

        # Reclaim reader slots left behind by crashed or recycled workers. This runs whenever a
        # worker opens the environment, keeping the shared reader table from filling up over time.
        self._reader_check(env)
        return env

    def _reader_check(self, env: lmdb.Environment) -> None:
        """Reclaim stale reader-lock-table slots (from dead processes/threads). Best-effort."""

        try:
            reclaimed = env.reader_check()
            if reclaimed:
                self.logger.info(
                    {
                        **self.logger_context,
                        "event": "reader-check",
                        "path": self.path,
                        "reclaimed": reclaimed,
                    }
                )
        except Exception:
            self.logger.warning({**self.logger_context, "event": "reader-check-failed", "path": self.path})

    def _acquire_env(self) -> _EnvEntry:
        """Return the cached environment for this path, opening it if needed, and mark it in use."""

        with self._ENVS_GUARD:
            entry = self._ENVS.get(self.path)
            if entry is None:
                self._evict_idle_envs()
                entry = _EnvEntry(self._open_env())
                self._ENVS[self.path] = entry

            entry.refcount += 1
            self._ENVS.move_to_end(self.path)
            return entry

    def _release_env(self) -> None:
        """Mark this path's environment as no longer in use by the current operation."""

        with self._ENVS_GUARD:
            entry = self._ENVS.get(self.path)
            if entry is not None and entry.refcount > 0:
                entry.refcount -= 1

    @classmethod
    def close_all_envs(cls) -> None:
        """Close every cached LMDB environment in this process.

        Intended for worker shutdown and tests. Must not be called while transactions are
        in flight; LMDB forbids opening the same environment twice in a process, so a fresh
        open afterwards is safe only once all handles are released.
        """

        with cls._ENVS_GUARD:
            for entry in cls._ENVS.values():
                with suppress(Exception):
                    entry.env.close()

            cls._ENVS.clear()

    def _evict_idle_envs(self) -> None:
        """Close least-recently-used idle environments while over the cache cap."""

        while len(self._ENVS) >= self.MAX_CACHED_ENVS:
            victim_path = None
            for path, entry in self._ENVS.items():
                if entry.refcount == 0:
                    victim_path = path
                    break

            if victim_path is None:
                # Every cached environment is currently in use; nothing safe to evict.
                return

            entry = self._ENVS.pop(victim_path)
            self.logger.debug({**self.logger_context, "event": "evicting-env", "path": victim_path})
            with suppress(Exception):
                entry.env.close()

    def _grow_map(self) -> None:
        """Double the map size of this path's environment after a MapFullError."""

        with self._ENVS_GUARD:
            entry = self._ENVS.get(self.path)
            if entry is None:
                return

            self.map_size = max(self.map_size * 2, self.DEFAULT_MAP_SIZE * 2)
            self.logger.warning(
                {**self.logger_context, "event": "growing-map", "path": self.path, "map_size": self.map_size}
            )
            entry.env.set_mapsize(self.map_size)

    @contextmanager
    def _txn(self, write: bool) -> Any:
        """Yield an LMDB transaction on this store's environment."""

        entry = self._acquire_env()
        try:
            with self._begin(entry.env, write) as txn:
                yield txn
        finally:
            self._release_env()

    def _begin(self, env: lmdb.Environment, write: bool) -> Any:
        """Begin a transaction, reclaiming stale reader slots and retrying once on MDB_READERS_FULL."""

        try:
            return env.begin(write=write, buffers=False)
        except lmdb.ReadersFullError:
            self._reader_check(env)
            return env.begin(write=write, buffers=False)

    def _write(self, fn: Any) -> None:
        """Run a write callback in a transaction, growing the map and retrying on MapFullError."""

        for _ in range(2):
            try:
                with self._txn(write=True) as txn:
                    fn(txn)
                return
            except lmdb.MapFullError:
                self._grow_map()

        with self._txn(write=True) as txn:
            fn(txn)

    def _serialize(self, value: Any) -> bytes:
        """Serialize a value to bytes using msgpack.

        The size cap is enforced here and not only on the way back out: an oversized value used to
        commit successfully and then fail every subsequent read, which also took down any ``scan``
        covering it. Refusing the write keeps the store readable.
        """

        packed = msgpack.packb(value, use_bin_type=True)

        if len(packed) > self.MAX_MSGPACK_BYTES:
            raise ValueError("Serialized value exceeds allowed size limit")

        return packed

    def _deserialize(self, value: bytes) -> Any:
        """Deserialize bytes back to a Python object using msgpack."""

        if len(value) > self.MAX_MSGPACK_BYTES:
            raise ValueError("Serialized value exceeds allowed size limit")

        return msgpack.unpackb(
            value,
            raw=False,
            # packb happily writes non-string map keys, so refusing them here would make a value
            # that was accepted on write unreadable for good.
            strict_map_key=False,
            max_bin_len=self.MAX_MSGPACK_BYTES,
            max_str_len=self.MAX_MSGPACK_BYTES,
            max_ext_len=self.MAX_MSGPACK_BYTES,
            max_array_len=self.MAX_MSGPACK_COLLECTION_LEN,
            max_map_len=self.MAX_MSGPACK_COLLECTION_LEN,
        )

    def _entity_prefix(self, entity: Enum) -> str:
        """Return the ``<entity>:`` prefix that scopes keys to an entity within the namespace."""

        return f"{entity.value}{self.SEPARATOR}"

    def _db_key(self, entity: Enum, key: str) -> bytes:
        """Encode a caller's `key` into the entity-scoped LMDB key stored on disk.

        The namespace already isolates this store's directory, so the on-disk key is just
        ``<entity>:<key>`` (as UTF-8 bytes); it does not repeat the namespace.
        """

        return f"{self._entity_prefix(entity)}{key}".encode()

    def get(self, entity: Enum, key: str, default: Any | None = None) -> Any | None:
        """Retrieve a value by key, returning a default if the key does not exist."""

        db_key = self._db_key(entity, key)
        with self._txn(write=False) as txn:
            value = txn.get(db_key)

        return self._deserialize(value) if value is not None else default

    def set(self, entity: Enum, key: str, value: Any) -> None:
        """Store a value by key, serializing it before saving."""

        db_key = self._db_key(entity, key)
        data = self._serialize(value)
        self._write(lambda txn: txn.put(db_key, data))

    def delete(self, entity: Enum, key: str) -> None:
        """Delete a value by key."""

        db_key = self._db_key(entity, key)
        self._write(lambda txn: txn.delete(db_key))

    def exists(self, entity: Enum, key: str) -> bool:
        """Check if a key exists in the storage."""

        db_key = self._db_key(entity, key)
        with self._txn(write=False) as txn:
            return txn.get(db_key) is not None

    def exists_many(self, entity: Enum, keys: list[str]) -> set[str]:
        """Return the subset of `keys` the store already holds, in one read transaction.

        Values are never deserialized, so this stays cheap on hot paths that only need to tell
        what is new from what is already cached.
        """

        if not keys:
            return set()

        db_keys = [(key, self._db_key(entity, key)) for key in keys]

        with self._txn(write=False) as txn:
            return {key for key, db_key in db_keys if txn.get(db_key) is not None}

    def get_many(self, entity: Enum, keys: list[str]) -> dict[str, Any | None]:
        """Retrieve multiple values by a list of keys, returning a dictionary of key-value pairs."""

        if not keys:
            return {}

        db_keys = [(key, self._db_key(entity, key)) for key in keys]

        with self._txn(write=False) as txn:
            raw = [(key, txn.get(db_key)) for key, db_key in db_keys]

        return {key: self._deserialize(value) if value is not None else None for key, value in raw}

    def set_many(self, entity: Enum, items: dict[str, Any]) -> None:
        """Store multiple key-value pairs at once, serializing values before saving."""

        if not items:
            return

        encoded = [(self._db_key(entity, key), self._serialize(value)) for key, value in items.items()]

        def _put_all(txn: Any) -> None:
            for db_key, data in encoded:
                txn.put(db_key, data)

        self._write(_put_all)

    def delete_many(self, entity: Enum, keys: list[str]) -> None:
        """Delete multiple keys from the storage at once."""

        if not keys:
            return

        db_keys = [self._db_key(entity, key) for key in keys]

        def _delete_all(txn: Any) -> None:
            for db_key in db_keys:
                txn.delete(db_key)

        self._write(_delete_all)

    def scan(self, entity: Enum, prefix: str = "", limit: int | None = None) -> dict[str, Any]:
        """Scan for all key-value pairs whose key starts with `prefix`, returning them as a dict."""

        entity_prefix = self._entity_prefix(entity)
        db_prefix = self._db_key(entity, prefix)
        result = {}

        with self._txn(write=False) as txn:
            cursor = txn.cursor()
            if cursor.set_range(db_prefix):
                for db_key, value in cursor:
                    if not db_key.startswith(db_prefix):
                        break

                    key = db_key.decode().removeprefix(entity_prefix)
                    result[key] = self._deserialize(value)

                    if limit is not None and len(result) >= limit:
                        break

        return result

    def count(self, entity: Enum, prefix: str = "") -> int:
        """Count the number of keys that start with `prefix`."""

        db_prefix = self._db_key(entity, prefix)
        count = 0

        with self._txn(write=False) as txn:
            cursor = txn.cursor()
            if cursor.set_range(db_prefix):
                for db_key in cursor.iternext(keys=True, values=False):
                    if not db_key.startswith(db_prefix):
                        break

                    count += 1

        return count

    def delete_all(self, entity: Enum) -> None:
        """Delete all keys for a given entity type."""

        self.logger.info(
            {
                **self.logger_context,
                "user": frappe.session.user,
                "event": "deleting-all-keys",
                "entity": entity.value,
            }
        )

        db_prefix = self._db_key(entity, "")

        def _delete_prefix(txn: Any) -> None:
            # Delete in place via the cursor (O(1) memory) instead of materializing every key.
            # cursor.delete() removes the current entry and advances to the next one.
            cursor = txn.cursor()
            if cursor.set_range(db_prefix):
                while cursor.key().startswith(db_prefix):
                    if not cursor.delete():
                        break

        self._write(_delete_prefix)

    def browse(self, limit: int | None = None) -> list[dict]:
        """List every entry as ``{entity, key, size}`` without deserializing values (for tooling)."""

        entries = []
        with self._txn(write=False) as txn:
            for db_key, value in txn.cursor():
                entity, _, key = db_key.decode().partition(self.SEPARATOR)
                entries.append({"entity": entity, "key": key, "size": len(value)})

                if limit is not None and len(entries) >= limit:
                    break

        return entries

    def read(self, entity: str, key: str) -> dict | None:
        """Return ``{value, size}`` for a single entry, or None if it is absent (for tooling).

        Unlike `get`, `entity` is a plain string, so callers (e.g. the Store Entry browser) do
        not need the entity enum.
        """

        db_key = f"{entity}{self.SEPARATOR}{key}".encode()
        with self._txn(write=False) as txn:
            raw = txn.get(db_key)

        if raw is None:
            return None

        return {"value": self._deserialize(raw), "size": len(raw)}

    def count_entries(self, entity: str | None = None) -> int:
        """Count entries, optionally within one entity, without materializing keys/values.

        `entity` is a plain string (or None for every entity), so callers (e.g. the Store Entry
        browser) don't need the entity enum. Counts over a cursor in O(1) memory.
        """

        prefix = f"{entity}{self.SEPARATOR}".encode() if entity is not None else b""
        total = 0
        with self._txn(write=False) as txn:
            cursor = txn.cursor()
            if cursor.set_range(prefix):
                for db_key in cursor.iternext(keys=True, values=False):
                    if not db_key.startswith(prefix):
                        break
                    total += 1

        return total
