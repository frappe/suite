"""Delete the legacy S3 objects Build copied: a manual command, run after
the migrate, never part of it (§14.10 step 8, §14.11).

Build copies every legacy Drive object server-side to its canonical key and
records the pair in the copy ledger (`build.copy_ledger`). Cleanup deletes
no bucket object, so restoring the database + files backup taken before
the migrate stays a complete rollback until an operator runs this:

    bench --site <site> execute suite.drive.patches.cleanup.delete_legacy_objects.run
    bench --site <site> execute suite.drive.patches.cleanup.delete_legacy_objects.run \\
        --kwargs "{'confirm': True}"

The first form is a dry run: it reports, per legacy key layout, what it
would delete and what it must keep, and deletes nothing. The second
deletes. After it finishes, the legacy objects are gone and only the
canonical copies remain, so the backup is no longer a complete rollback.

Only ledger keys are considered. An object Build never copied (a `File`
row recorded under `missing_bytes`, an orphan object nobody referenced) is
not in the ledger and stays in the bucket; the report says how many such
rows Build recorded. A ledger key is kept, and reported as kept, when it
starts with `private/` or `public/` (the framework's own storage roots),
equals its own destination, or is named by a `File Blob` row.

Before each batch of 1000 the command HEADs every destination and requires
its size to equal the ledger's; a missing or mismatched copy stops the run
before that batch is deleted and names the key. Every deleted key is
appended to `<site>/private/drive-legacy-objects-deleted.jsonl`, so a rerun
skips it, and a legacy key that is already gone (HEAD 404) counts as done.
Keys pass through unchanged: the production bucket holds leading-slash
keys, bare keys at the root and per-user folders, and each is HEADed and
deleted exactly as the ledger spells it.

`run_delete` is pure over `DeleteEnvironment`'s ports, the way Build and
Cleanup are, so `tests/test_delete_legacy_objects.py` runs the whole
contract with no site.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import frappe

from suite.drive.patches.build.copy_ledger import CopiedObject, CopyLedger
from suite.drive.patches.build.legacy import KEY_SHAPES, key_shape
from suite.drive.patches.build.state import BuildState
from suite.drive.patches.cleanup.patch import PHASES
from suite.drive.patches.cleanup.state import CleanupState

# `DeleteObjects` takes at most this many keys per call, and one batch is
# the unit of verification: every destination in it is HEADed before any
# key in it is deleted.
DELETE_BATCH_SIZE = 1000

DELETED_FILENAME = "drive-legacy-objects-deleted.jsonl"

# The framework S3 driver's own key space. A legacy key under either is
# never Drive's to delete, whatever the ledger says.
FRAMEWORK_ROOTS = ("private/", "public/")

# Why a ledger key is kept, as the report names it.
UNDER_FRAMEWORK_ROOT = "under the framework's private/ or public/ root"
OWN_DESTINATION = "is its own canonical copy"
REFERENCED_BY_BLOB = "named by a File Blob"


class LegacyObjectDeleteError(frappe.ValidationError):
    """The command will not delete anything on this site, and says why."""


class DestinationUnverifiedError(LegacyObjectDeleteError):
    """A canonical copy is missing or the wrong size. The run stopped before
    the batch holding it was deleted; `report` is what ran before that."""

    def __init__(self, message: str, report: DeleteReport):
        super().__init__(message)
        self.report = report


# --- ports -------------------------------------------------------------------


class Ledger(Protocol):
    def exists(self) -> bool:
        """Whether Build wrote a copy ledger on this site at all."""

    def entries(self) -> list[CopiedObject]:
        """One entry per legacy key Build copied. Raises on a damaged line."""


class Bucket(Protocol):
    def size(self, key: str) -> int | None:
        """HEAD this exact key: its size, or `None` when there is no object."""

    def delete_keys(self, keys: tuple[str, ...]) -> int:
        """Delete these exact keys. Returns how many the bucket reports deleted."""


class BlobReferences(Protocol):
    def s3_blob_count(self) -> int:
        """How many `File Blob` rows have `driver = "s3"`."""

    def referenced(self, keys: tuple[str, ...]) -> set[str]:
        """The subset of `keys` some `File Blob` row names, as its `key` or
        as `private/<key>`."""


class StorageConfig(Protocol):
    def enabled(self) -> bool:
        """`frappe.storage.enabled()`: the `storage_v2` switch."""

    def driver_name(self) -> str:
        """The site's `storage_driver`, or an empty string when unset."""

    def configured_bucket(self) -> str:
        """`storage_driver_config.bucket`, or an empty string when unset."""


class DeletedRecord:
    """The durable list of legacy keys this command has deleted.

    Append-only JSON lines next to the copy ledger, fsynced per batch. A
    rerun skips every key here without a HEAD. A key deleted but not yet
    recorded (a kill between the two) is found gone by the rerun's HEAD and
    recorded then.
    """

    def __init__(self, path: Path):
        self.path = Path(path)

    @classmethod
    def for_site(cls) -> DeletedRecord:
        return cls(Path(frappe.get_site_path("private", DELETED_FILENAME)))

    def keys(self) -> set[str]:
        if not self.path.exists():
            return set()
        deleted: set[str] = set()
        with open(self.path, encoding="utf-8") as f:
            for number, line in enumerate(f, start=1):
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError as e:
                    raise ValueError(f"{self.path}:{number} is not JSON: {e}") from e
                if not isinstance(entry, dict) or not isinstance(entry.get("legacy_key"), str):
                    raise ValueError(f"{self.path}:{number} is not a deleted-object entry")
                deleted.add(entry["legacy_key"])
        return deleted

    def record(self, entries: Iterable[CopiedObject]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "a", encoding="utf-8") as f:
            for entry in entries:
                line = {"legacy_key": entry.legacy_key, "destination": entry.destination, "size": entry.size}
                f.write(json.dumps(line, sort_keys=True) + "\n")
            f.flush()
            os.fsync(f.fileno())


@dataclass
class DeleteEnvironment:
    ledger: Ledger
    bucket: Bucket
    blobs: BlobReferences
    storage: StorageConfig
    cleanup: CleanupState
    build: BuildState
    deleted: DeletedRecord

    @classmethod
    def for_site(cls) -> DeleteEnvironment:
        return cls(
            ledger=CopyLedger.for_site(),
            bucket=SiteBucket(),
            blobs=SiteBlobReferences(),
            storage=SiteStorageConfig(),
            cleanup=CleanupState.for_site(),
            build=BuildState.for_site(),
            deleted=DeletedRecord.for_site(),
        )


# --- the report ----------------------------------------------------------------


@dataclass
class ShapeReport:
    """What the command found, and did, for one of `KEY_SHAPES`."""

    deletable: int = 0
    deletable_bytes: int = 0
    kept: dict[str, int] = field(default_factory=dict)
    already_gone: int = 0
    deleted: int = 0
    deleted_bytes: int = 0

    def keep(self, reason: str) -> None:
        self.kept[reason] = self.kept.get(reason, 0) + 1

    def add(self, other: ShapeReport) -> None:
        self.deletable += other.deletable
        self.deletable_bytes += other.deletable_bytes
        for reason, count in other.kept.items():
            self.kept[reason] = self.kept.get(reason, 0) + count
        self.already_gone += other.already_gone
        self.deleted += other.deleted
        self.deleted_bytes += other.deleted_bytes


@dataclass
class DeleteReport:
    confirm: bool
    bucket: str
    root_folder: str
    ledger_keys: int
    missing_bytes_total: int
    shapes: dict[str, ShapeReport]
    stopped_at: str | None = None

    def totals(self) -> ShapeReport:
        total = ShapeReport()
        for shape in self.shapes.values():
            total.add(shape)
        return total

    def lines(self) -> list[str]:
        mode = "deleting" if self.confirm else "dry run, nothing deleted"
        out = [f"Legacy Drive objects in bucket {self.bucket!r} ({mode})"]
        out.append(
            f"Only keys in Build's copy ledger are considered: {self.ledger_keys:,} keys. Build "
            f"recorded {self.missing_bytes_total:,} File rows with no reachable bytes "
            "(missing_bytes_total); their objects, and any object Build never copied, stay."
        )
        out.append(f"Per key layout (root_folder {self.root_folder!r}):")
        for shape in KEY_SHAPES:
            out.append(f"  {shape}: {_describe(self.shapes[shape], self.confirm)}")
        out.append(f"Total: {_describe(self.totals(), self.confirm)}")
        if self.stopped_at is not None:
            out.append(f"Stopped before deleting the batch holding {self.stopped_at!r}; see the error.")
        return out


def _describe(shape: ShapeReport, confirm: bool) -> str:
    parts = [f"{shape.deletable:,} to delete ({_human(shape.deletable_bytes)})"]
    if shape.kept:
        reasons = ", ".join(f"{count:,} {reason}" for reason, count in sorted(shape.kept.items()))
        parts.append(f"{sum(shape.kept.values()):,} kept: {reasons}")
    else:
        parts.append("0 kept")
    if shape.already_gone:
        parts.append(f"{shape.already_gone:,} already gone")
    if confirm:
        parts.append(f"{shape.deleted:,} deleted ({_human(shape.deleted_bytes)})")
    return "; ".join(parts)


def _human(size: int) -> str:
    units = ("B", "KB", "MB", "GB", "TB")
    value = float(size)
    index = 0
    while value >= 1024 and index < len(units) - 1:
        value /= 1024
        index += 1
    return f"{size:,} B" if index == 0 else f"{value:,.1f} {units[index]}"


# --- the command -------------------------------------------------------------------


def run(confirm: bool | str = False) -> None:
    """Report, and with `confirm` delete, the legacy objects Build copied.

    `bench execute` passes `--kwargs` through `ast.literal_eval`, so
    `confirm` arrives as a bool; the string forms are accepted so a shell
    quoting mistake cannot turn "no" into "yes" by being truthy.
    """
    env = DeleteEnvironment.for_site()
    try:
        report = run_delete(env, confirm=_is_confirmed(confirm))
    except DestinationUnverifiedError as e:
        for line in e.report.lines():
            print(line)
        raise
    for line in report.lines():
        print(line)


def _is_confirmed(confirm: bool | str) -> bool:
    if isinstance(confirm, bool):
        return confirm
    return str(confirm).strip().lower() in ("1", "true", "yes")


def run_delete(env: DeleteEnvironment, *, confirm: bool, batch_size: int = DELETE_BATCH_SIZE) -> DeleteReport:
    """Plan the delete from the ledger; with `confirm`, verify and run it.

    Raises `LegacyObjectDeleteError` before touching the bucket unless every
    precondition holds (`refuse_unless_ready`), whether or not `confirm` is
    set. With `confirm`, raises `DestinationUnverifiedError` the moment a
    batch holds a destination that is missing or the wrong size; batches
    before it are deleted and recorded, that batch and later ones are not.
    """
    refuse_unless_ready(env)
    entries = env.ledger.entries()
    snapshot = env.cleanup.get_settings_snapshot() or {}
    root_folder = str(snapshot.get("root_folder") or "")
    report = DeleteReport(
        confirm=confirm,
        bucket=entries[0].bucket,
        root_folder=root_folder,
        ledger_keys=len(entries),
        missing_bytes_total=env.build.storage().missing_bytes_total,
        shapes={shape: ShapeReport() for shape in KEY_SHAPES},
    )

    def tally(entry: CopiedObject) -> ShapeReport:
        return report.shapes[key_shape(entry.legacy_key, root_folder)]

    already_deleted = env.deleted.keys()
    candidates: list[CopiedObject] = []
    for entry in entries:
        if entry.legacy_key in already_deleted:
            tally(entry).already_gone += 1
        elif entry.legacy_key.startswith(FRAMEWORK_ROOTS):
            tally(entry).keep(UNDER_FRAMEWORK_ROOT)
        elif entry.legacy_key == entry.destination:
            tally(entry).keep(OWN_DESTINATION)
        else:
            candidates.append(entry)

    deletable: list[CopiedObject] = []
    for batch in _chunks(candidates, batch_size):
        referenced = env.blobs.referenced(tuple(entry.legacy_key for entry in batch))
        for entry in batch:
            if entry.legacy_key in referenced:
                tally(entry).keep(REFERENCED_BY_BLOB)
            else:
                tally(entry).deletable += 1
                tally(entry).deletable_bytes += entry.size
                deletable.append(entry)

    if not confirm:
        return report

    for batch in _chunks(deletable, batch_size):
        _verify_destinations(env, report, batch)
        present: list[CopiedObject] = []
        for entry in batch:
            if env.bucket.size(entry.legacy_key) is None:
                tally(entry).already_gone += 1
            else:
                present.append(entry)
        if present:
            env.bucket.delete_keys(tuple(entry.legacy_key for entry in present))
            for entry in present:
                tally(entry).deleted += 1
                tally(entry).deleted_bytes += entry.size
        env.deleted.record(batch)
    return report


def refuse_unless_ready(env: DeleteEnvironment) -> None:
    """Raise `LegacyObjectDeleteError` naming every precondition that fails.

    All of them are reported at once so an operator fixes the site in one
    pass. The s3-blob check is what catches a database restored from the
    pre-migration backup: the ledger and the bucket still look migrated,
    but no row references a canonical copy, and deleting the legacy
    objects then would delete the only bytes the restored rows point at.
    """
    problems: list[str] = []
    if not env.build.storage().completed:
        problems.append("Build's storage step has not completed on this site; run `bench migrate` first")
    incomplete = [name for name, _phase in PHASES if not env.cleanup.get(name).completed]
    if incomplete:
        problems.append(f"Cleanup has not completed every phase (pending: {', '.join(incomplete)})")

    ledger_bucket = ""
    if not env.ledger.exists():
        problems.append("Build wrote no copy ledger on this site, so there is no record of what it copied")
    else:
        try:
            entries = env.ledger.entries()
        except ValueError as e:
            entries = []
            problems.append(f"the copy ledger cannot be read: {e}")
        else:
            if not entries:
                problems.append(
                    "the copy ledger is empty: Build copied no object, so there is nothing to delete"
                )
        buckets = sorted({entry.bucket for entry in entries})
        if len(buckets) > 1:
            problems.append(f"the copy ledger names more than one bucket ({', '.join(buckets)})")
        elif buckets:
            ledger_bucket = buckets[0]

    if not env.storage.enabled():
        problems.append("File Storage v2 is off (`storage_v2` in site_config)")
    driver = env.storage.driver_name()
    if driver != "s3":
        problems.append(f"site_config `storage_driver` is {driver or 'unset'!r}, not 's3'")
    configured = env.storage.configured_bucket()
    if ledger_bucket and configured != ledger_bucket:
        problems.append(
            f"site_config `storage_driver_config` names bucket {configured or 'nothing'!r}, but the ledger's "
            f"copies live in {ledger_bucket!r}"
        )

    if env.blobs.s3_blob_count() == 0:
        problems.append(
            "no File Blob row has driver 's3', so nothing references the canonical copies; the "
            "database was probably restored from the pre-migration backup. No blob references, refusing"
        )

    if problems:
        raise LegacyObjectDeleteError(
            "Refusing to delete legacy objects:\n- " + "\n- ".join(problems) + "\nNothing was deleted."
        )


def _verify_destinations(env: DeleteEnvironment, report: DeleteReport, batch: list[CopiedObject]) -> None:
    for entry in batch:
        found = env.bucket.size(entry.destination)
        if found == entry.size:
            continue
        report.stopped_at = entry.legacy_key
        state = "is missing" if found is None else f"is {found:,} bytes"
        raise DestinationUnverifiedError(
            f"The canonical copy of {entry.legacy_key!r} at {entry.destination!r} {state}; the ledger "
            f"recorded {entry.size:,} bytes (File {entry.file}). Stopped before deleting this batch of "
            f"{len(batch):,} keys; earlier batches are deleted and recorded. Restore or re-copy the "
            "object, then rerun.",
            report,
        )


def _chunks(items: list, size: int) -> Iterator[list]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


# --- real site ports ------------------------------------------------------------


class SiteBucket:
    """`Bucket` over the framework S3 driver, opened on first use so building
    the environment on a site whose storage is not S3 still reaches the
    refusals instead of failing inside boto."""

    def __init__(self):
        self._reader = None
        self._deleter = None

    def size(self, key: str) -> int | None:
        return self._boto().size(key)

    def delete_keys(self, keys: tuple[str, ...]) -> int:
        from suite.drive.patches.cleanup.ports import LegacyBucket

        if self._deleter is None:
            boto = self._boto()
            self._deleter = LegacyBucket(boto.bucket, boto.client)
        return self._deleter.delete_keys(keys)

    def _boto(self):
        from suite.drive.patches.build.ports import BotoBucket

        if self._reader is None:
            self._reader = BotoBucket.from_site()
        return self._reader


class SiteBlobReferences:
    """`BlobReferences` over the live `File Blob` table."""

    def s3_blob_count(self) -> int:
        return int(frappe.db.count("File Blob", {"driver": "s3"}))

    def referenced(self, keys: tuple[str, ...]) -> set[str]:
        if not keys:
            return set()
        # A private blob's `key` occupies bucket key `private/<key>`, so a
        # legacy key under `private/` is also looked up by its remainder.
        lookup: dict[str, set[str]] = {}
        for key in keys:
            lookup.setdefault(key, set()).add(key)
            if key.startswith("private/"):
                lookup.setdefault(key[len("private/") :], set()).add(key)
        rows = frappe.get_all("File Blob", filters={"key": ["in", list(lookup)]}, pluck="key")
        return {legacy for row in rows for legacy in lookup.get(row, ())}


class SiteStorageConfig:
    """`StorageConfig` over site_config."""

    def enabled(self) -> bool:
        import frappe.storage

        return frappe.storage.enabled()

    def driver_name(self) -> str:
        return frappe.conf.storage_driver or ""

    def configured_bucket(self) -> str:
        return str((frappe.conf.storage_driver_config or {}).get("bucket") or "")
