"""The manual legacy-object delete (§14.11), against fakes: no site, no bucket.

The ledger, the Cleanup state, the Build state and the deleted record are
the real file-backed classes in a temporary directory; only the bucket, the
`File Blob` lookups and site_config are doubles.
"""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from suite.drive.patches.build.copy_ledger import CopiedObject, CopyLedger
from suite.drive.patches.build.legacy import (
    BARE_ROOT_KEY,
    KEY_SHAPES,
    LEADING_SLASH,
    ROOT_FOLDER,
    UNDER_ROOT_FOLDER,
)
from suite.drive.patches.build.state import BuildState, StoragePreparation
from suite.drive.patches.cleanup.delete_legacy_objects import (
    OWN_DESTINATION,
    REFERENCED_BY_BLOB,
    UNDER_FRAMEWORK_ROOT,
    DeletedRecord,
    DeleteEnvironment,
    DestinationUnverifiedError,
    LegacyObjectDeleteError,
    run_delete,
)
from suite.drive.patches.cleanup.patch import PHASES
from suite.drive.patches.cleanup.state import CleanupState, PhaseResult

BUCKET = "drive.frappe.cloud"


class FakeBucket:
    """`Bucket` over a dict of key -> size, recording every HEAD and delete."""

    def __init__(self, sizes: dict[str, int]):
        self.sizes = dict(sizes)
        self.heads: list[str] = []
        self.deletes: list[tuple[str, ...]] = []

    def size(self, key):
        self.heads.append(key)
        return self.sizes.get(key)

    def delete_keys(self, keys):
        self.deletes.append(tuple(keys))
        for key in keys:
            self.sizes.pop(key, None)
        return len(keys)

    @property
    def deleted_keys(self) -> list[str]:
        return [key for batch in self.deletes for key in batch]


class FakeBlobs:
    """`BlobReferences` over a set of `File Blob.key` values."""

    def __init__(self, keys=(), s3_count: int | None = None):
        self.keys = set(keys)
        self.s3_count = len(self.keys) if s3_count is None else s3_count

    def s3_blob_count(self):
        return self.s3_count

    def referenced(self, keys):
        return {
            key
            for key in keys
            if key in self.keys or (key.startswith("private/") and key[len("private/") :] in self.keys)
        }


class FakeStorageConfig:
    def __init__(self, *, enabled=True, driver="s3", bucket=BUCKET):
        self._enabled = enabled
        self._driver = driver
        self._bucket = bucket

    def enabled(self):
        return self._enabled

    def driver_name(self):
        return self._driver

    def configured_bucket(self):
        return self._bucket


def copied(legacy_key: str, size: int = 10, *, destination: str | None = None, bucket: str = BUCKET):
    """A ledger entry whose destination is derived from the key unless given."""
    return CopiedObject(
        file=f"file-{legacy_key}",
        legacy_key=legacy_key,
        destination=destination or f"private/ab/cd/{abs(hash(legacy_key)):x}",
        size=size,
        checksum="c" * 64,
        bucket=bucket,
    )


# One key of every production layout, with `root_folder = "drive"`.
ONE_OF_EACH = (
    copied("/abc/leading.pdf", 100),
    copied("bare.pdf", 20),
    copied("drive/under-root.pdf", 3),
    copied("user%40example.com/in-folder.pdf", 4000),
)


class DeleteFixture:
    """A migrated S3 site, as the command finds it: ledger written, Cleanup
    complete, Build's storage step complete, every legacy object and its
    canonical copy present in the bucket."""

    def __init__(self, tmp: Path, entries=ONE_OF_EACH, *, blob_keys=None, s3_count=None, missing_bytes=0):
        self.tmp = tmp
        self.entries = tuple(entries)
        self.ledger = CopyLedger(tmp / "drive-build-copied-objects.jsonl")
        for entry in self.entries:
            self.ledger.record(entry)
        self.cleanup = CleanupState(tmp / "drive-cleanup-state.json")
        for name, _phase in PHASES:
            self.cleanup.put(name, PhaseResult(completed=True))
        self.cleanup.put_settings_snapshot({"enabled": True, "root_folder": "drive", "bucket": BUCKET})
        self.build = BuildState(tmp / "drive-build-state.json")
        self.build.put_storage(StoragePreparation(completed=True, missing_bytes_total=missing_bytes))
        sizes = {}
        for entry in self.entries:
            sizes[entry.legacy_key] = entry.size
            sizes[entry.destination] = entry.size
        self.bucket = FakeBucket(sizes)
        self.blobs = FakeBlobs(blob_keys or (), s3_count=len(self.entries) if s3_count is None else s3_count)
        self.storage = FakeStorageConfig()
        self.deleted = DeletedRecord(tmp / "drive-legacy-objects-deleted.jsonl")

    def environment(self) -> DeleteEnvironment:
        return DeleteEnvironment(
            ledger=self.ledger,
            bucket=self.bucket,
            blobs=self.blobs,
            storage=self.storage,
            cleanup=self.cleanup,
            build=self.build,
            deleted=self.deleted,
        )

    @property
    def legacy_keys(self) -> set[str]:
        return {entry.legacy_key for entry in self.entries}

    @property
    def destinations(self) -> set[str]:
        return {entry.destination for entry in self.entries}


class TestDryRun(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_a_dry_run_deletes_nothing_and_reports_every_key_layout(self):
        site = DeleteFixture(self.path, missing_bytes=7)
        report = run_delete(site.environment(), confirm=False)

        self.assertEqual(site.bucket.deletes, [])
        self.assertEqual(site.bucket.heads, [])  # a dry run never touches the bucket
        self.assertFalse(site.deleted.path.exists())

        self.assertEqual(report.shapes[LEADING_SLASH].deletable, 1)
        self.assertEqual(report.shapes[LEADING_SLASH].deletable_bytes, 100)
        self.assertEqual(report.shapes[BARE_ROOT_KEY].deletable, 1)
        self.assertEqual(report.shapes[UNDER_ROOT_FOLDER].deletable, 1)
        self.assertEqual(report.shapes[ROOT_FOLDER].deletable, 1)
        self.assertEqual(report.shapes[ROOT_FOLDER].deletable_bytes, 4000)
        self.assertEqual(report.totals().deletable, 4)
        self.assertEqual(report.totals().deletable_bytes, 4123)
        self.assertEqual(report.missing_bytes_total, 7)

        text = "\n".join(report.lines())
        for shape in KEY_SHAPES:
            self.assertIn(shape, text)
        self.assertIn("nothing deleted", text)
        self.assertIn("4 keys", text)
        self.assertIn("7 File rows with no reachable bytes", text)


class TestConfirmedDelete(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_keys_the_command_must_not_delete_are_reported_as_kept_with_a_reason(self):
        # Every real canonical copy is under private/; this one is spelled
        # elsewhere so the own-destination rule is exercised on its own.
        canonical = "drive/same.pdf"
        site = DeleteFixture(
            self.path,
            entries=(
                copied("abc/referenced.pdf"),
                copied("private/ab/cd/framework.pdf"),
                copied("public/ab/cd/framework.pdf"),
                copied(canonical, destination=canonical),
                copied("abc/plain.pdf"),
            ),
            blob_keys={"abc/referenced.pdf"},
        )
        report = run_delete(site.environment(), confirm=True)

        self.assertEqual(site.bucket.deleted_keys, ["abc/plain.pdf"])
        kept = report.totals().kept
        self.assertEqual(kept[REFERENCED_BY_BLOB], 1)
        self.assertEqual(kept[UNDER_FRAMEWORK_ROOT], 2)
        self.assertEqual(kept[OWN_DESTINATION], 1)
        self.assertIn("abc/referenced.pdf", site.bucket.sizes)
        self.assertIn(canonical, site.bucket.sizes)

    def test_confirm_deletes_exactly_the_ledger_keys_and_leaves_every_canonical_copy(self):
        site = DeleteFixture(self.path)
        report = run_delete(site.environment(), confirm=True)

        self.assertEqual(set(site.bucket.deleted_keys), site.legacy_keys)
        self.assertEqual(set(site.bucket.sizes), site.destinations)
        self.assertEqual(report.totals().deleted, 4)
        self.assertEqual(report.totals().deleted_bytes, 4123)
        self.assertEqual(site.deleted.keys(), site.legacy_keys)
        self.assertIn("4 deleted", "\n".join(report.lines()))

    def test_a_leading_slash_key_and_a_bare_root_key_are_headed_and_deleted_as_spelled(self):
        site = DeleteFixture(self.path, entries=(copied("/abc/x.pdf"), copied("bare.pdf")))
        run_delete(site.environment(), confirm=True)

        self.assertEqual(site.bucket.deletes, [("/abc/x.pdf", "bare.pdf")])
        self.assertIn("/abc/x.pdf", site.bucket.heads)
        self.assertIn("bare.pdf", site.bucket.heads)
        self.assertNotIn("abc/x.pdf", site.bucket.heads)

    def test_a_missing_canonical_copy_stops_the_run_before_its_batch_is_deleted(self):
        entries = (copied("a/1.pdf"), copied("a/2.pdf"), copied("a/3.pdf"), copied("a/4.pdf"))
        site = DeleteFixture(self.path, entries=entries)
        del site.bucket.sizes[entries[2].destination]

        with self.assertRaises(DestinationUnverifiedError) as caught:
            run_delete(site.environment(), confirm=True, batch_size=2)

        self.assertIn("a/3.pdf", str(caught.exception))
        # The first batch went; the batch holding the unverified copy, and
        # everything after it, did not. The record matches what happened.
        self.assertEqual(site.bucket.deleted_keys, ["a/1.pdf", "a/2.pdf"])
        self.assertIn("a/3.pdf", site.bucket.sizes)
        self.assertIn("a/4.pdf", site.bucket.sizes)
        self.assertEqual(site.deleted.keys(), {"a/1.pdf", "a/2.pdf"})
        self.assertEqual(caught.exception.report.stopped_at, "a/3.pdf")
        self.assertEqual(caught.exception.report.totals().deleted, 2)

    def test_a_wrong_sized_canonical_copy_stops_the_run_with_nothing_deleted(self):
        entries = (copied("a/1.pdf", 10), copied("a/2.pdf", 10))
        site = DeleteFixture(self.path, entries=entries)
        site.bucket.sizes[entries[0].destination] = 9

        with self.assertRaises(DestinationUnverifiedError):
            run_delete(site.environment(), confirm=True)
        self.assertEqual(site.bucket.deletes, [])
        self.assertFalse(site.deleted.path.exists())

    def test_a_rerun_skips_recorded_keys_and_counts_an_already_gone_key_as_done(self):
        site = DeleteFixture(self.path)
        # One legacy object was deleted by an earlier run that died before
        # recording it: the rerun must find it gone and not call it an error.
        del site.bucket.sizes["bare.pdf"]

        first = run_delete(site.environment(), confirm=True)
        self.assertEqual(first.totals().deleted, 3)
        self.assertEqual(first.totals().already_gone, 1)
        self.assertNotIn("bare.pdf", site.bucket.deleted_keys)
        self.assertEqual(site.deleted.keys(), site.legacy_keys)

        site.bucket.deletes.clear()
        site.bucket.heads.clear()
        second = run_delete(site.environment(), confirm=True)
        self.assertEqual(site.bucket.deletes, [])
        self.assertEqual(site.bucket.heads, [])
        self.assertEqual(second.totals().already_gone, 4)
        self.assertEqual(second.totals().deleted, 0)


class TestRefusals(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def _refuses(self, site: DeleteFixture, *fragments: str) -> None:
        for confirm in (False, True):
            with self.subTest(confirm=confirm):
                with self.assertRaises(LegacyObjectDeleteError) as caught:
                    run_delete(site.environment(), confirm=confirm)
                for fragment in fragments:
                    self.assertIn(fragment, str(caught.exception))
        self.assertEqual(site.bucket.deletes, [])
        self.assertEqual(site.bucket.heads, [])

    def test_an_incomplete_cleanup_refuses_even_with_confirm(self):
        site = DeleteFixture(self.path)
        site.cleanup.put("thumbnails", PhaseResult(completed=False))
        self._refuses(site, "Cleanup has not completed", "thumbnails")

    def test_no_s3_blob_rows_refuses_because_the_database_was_probably_restored(self):
        site = DeleteFixture(self.path, s3_count=0)
        self._refuses(site, "No blob references, refusing")

    def test_an_unfinished_build_storage_step_refuses(self):
        site = DeleteFixture(self.path)
        site.build.put_storage(StoragePreparation(completed=False))
        self._refuses(site, "Build's storage step has not completed")

    def test_a_missing_or_empty_ledger_refuses(self):
        site = DeleteFixture(self.path, entries=())
        self._refuses(site, "no copy ledger")

        site.ledger.path.write_text("", encoding="utf-8")
        self._refuses(site, "ledger is empty")

    def test_storage_that_is_not_the_ledgers_s3_bucket_refuses(self):
        cases = {
            "storage_v2 off": (FakeStorageConfig(enabled=False), "File Storage v2 is off"),
            "local driver": (FakeStorageConfig(driver="local"), "not 's3'"),
            "other bucket": (FakeStorageConfig(bucket="other"), "'other'"),
        }
        for label, (storage, fragment) in cases.items():
            with self.subTest(label):
                site = DeleteFixture(self.path / label)
                site.storage = storage
                self._refuses(site, fragment)

    def test_every_failing_precondition_is_named_at_once(self):
        site = DeleteFixture(self.path, s3_count=0)
        site.cleanup.put("file_rows", PhaseResult(completed=False))
        site.storage = FakeStorageConfig(driver="local")
        with self.assertRaises(LegacyObjectDeleteError) as caught:
            run_delete(site.environment(), confirm=False)
        message = str(caught.exception)
        for fragment in ("file_rows", "not 's3'", "No blob references"):
            self.assertIn(fragment, message)


if __name__ == "__main__":
    unittest.main()
