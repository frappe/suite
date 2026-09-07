"""§14.2 steps 1 to 3 end to end: gate, backfill, copy, durable record."""

import hashlib
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from suite.drive.patches.build import prepare_legacy_bytes
from suite.drive.patches.build.environment import BACKFILL_BATCH_SIZE, LegacyS3Config
from suite.drive.patches.build.legacy_bytes import BARE_S3_KEY_REASON, NO_BLOB_REASON
from suite.drive.patches.build.state import BuildState
from suite.drive.patches.build.tests.fakes import (
    FakeBucket,
    FakeFiles,
    FakeStorage,
    InterruptedRun,
    build_environment,
)
from suite.drive.utils.files import get_s3_url

BYTES = b"drive bytes" * 40
SHA = hashlib.sha256(BYTES).hexdigest()


class PrepareCase(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def env(self, **kwargs):
        return build_environment(self.path, **kwargs)

    def saved_storage(self):
        return BuildState(self.path / "drive-build-state.json").storage()


class TestOrder(PrepareCase):
    def test_the_backfill_runs_at_the_frameworks_own_page_size(self):
        storage = FakeStorage(backfill={"linked": 7, "blobs_created": 3})
        env = self.env(storage=storage, legacy_s3=LegacyS3Config(enabled=False))

        prep = prepare_legacy_bytes(env)

        self.assertEqual(storage.backfill_calls, [BACKFILL_BATCH_SIZE])
        self.assertEqual(prep.backfill_linked, 7)
        self.assertEqual(prep.backfill_blobs_created, 3)

    def test_a_local_site_never_opens_a_bucket(self):
        def no_bucket():
            raise AssertionError("a local site must not build an S3 client")

        env = self.env(legacy_s3=LegacyS3Config(enabled=False))
        env.open_bucket = no_bucket

        prep = prepare_legacy_bytes(env)

        self.assertTrue(prep.completed)
        self.assertEqual(prep.s3_rows_seen, 0)


class TestPreservation(PrepareCase):
    def test_a_framework_attachment_outside_drive_is_left_alone(self):
        # The backfill links local bytes in place: it never rewrites file_url
        # and never moves a file, so an attachment under Home keeps working.
        files = FakeFiles().add("home-att", "/private/files/invoice.pdf", "invoice.pdf")
        files.link_blob("home-att", "blob-local")
        before = dict(files.rows["home-att"])

        prep = prepare_legacy_bytes(self.env(files=files, legacy_s3=LegacyS3Config(enabled=False)))

        self.assertEqual(files.rows["home-att"], before)
        self.assertEqual(prep.missing_bytes, [])

    def test_the_legacy_s3_object_and_url_survive_the_copy(self):
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        bucket = FakeBucket().put("team/f1", BYTES)

        prepare_legacy_bytes(self.env(files=files, bucket=bucket))

        self.assertEqual(bucket.objects["team/f1"], BYTES)
        self.assertEqual(files.rows["f1"]["file_url"], get_s3_url("team/f1"))
        self.assertEqual(files.rows["f1"]["file_name"], "a.txt")


class TestMissingBytes(PrepareCase):
    def test_a_row_the_backfill_could_not_read_keeps_its_reason(self):
        files = FakeFiles().add("f1", "/private/files/gone.pdf", "gone.pdf")
        storage = FakeStorage(
            backfill={
                "linked": 0,
                "blobs_created": 0,
                "skipped": [{"name": "f1", "file_url": "/private/files/gone.pdf", "reason": "cannot read"}],
            }
        )

        prep = prepare_legacy_bytes(
            self.env(files=files, storage=storage, legacy_s3=LegacyS3Config(enabled=False))
        )

        (missing,) = prep.missing_bytes
        self.assertEqual(missing.file, "f1")
        self.assertEqual(missing.reason, "cannot read")

    def test_a_blobless_row_no_step_touched_gets_the_default_reason(self):
        files = FakeFiles().add("f1", "https://example.test/remote.pdf", "remote.pdf")

        prep = prepare_legacy_bytes(self.env(files=files, legacy_s3=LegacyS3Config(enabled=False)))

        self.assertEqual(prep.missing_bytes[0].reason, NO_BLOB_REASON)

    def test_a_bare_bucket_key_on_an_s3_site_is_named_as_such(self):
        files = FakeFiles().add("f1", "team/f1", "a.txt")

        prep = prepare_legacy_bytes(self.env(files=files))

        self.assertEqual(prep.missing_bytes[0].reason, BARE_S3_KEY_REASON)

    def test_bytes_that_came_back_stop_being_reported(self):
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        bucket = FakeBucket()
        env = self.env(files=files, bucket=bucket)

        first = prepare_legacy_bytes(env)
        self.assertEqual([m.file for m in first.missing_bytes], ["f1"])

        bucket.put("team/f1", BYTES)
        second = prepare_legacy_bytes(env)

        self.assertEqual(second.missing_bytes, [])
        self.assertEqual(self.saved_storage().missing_bytes, [])
        self.assertIsNotNone(files.blob_of("f1"))


class TestIdempotence(PrepareCase):
    def test_a_second_run_copies_nothing_and_keeps_the_totals(self):
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"), ("f2", "team/f2", "b.txt"))
        bucket = FakeBucket().put("team/f1", BYTES).put("team/f2", b"other")
        storage = FakeStorage()
        env = self.env(files=files, bucket=bucket, storage=storage)

        first = prepare_legacy_bytes(env)
        links = {name: files.blob_of(name) for name in ("f1", "f2")}
        copies = list(bucket.copies)
        opened = list(bucket.opened)

        second = prepare_legacy_bytes(env)

        self.assertEqual(bucket.copies, copies)
        self.assertEqual(bucket.opened, opened)
        self.assertEqual({name: files.blob_of(name) for name in ("f1", "f2")}, links)
        self.assertEqual(len(storage.blobs), 2)
        self.assertEqual(second.s3_objects_copied, first.s3_objects_copied)
        self.assertEqual(second.s3_bytes_copied, first.s3_bytes_copied)
        self.assertEqual(second.s3_rows_seen, 0)


class TestInterruptedRunResumes(PrepareCase):
    def setUp(self):
        super().setUp()
        specs = [(f"f{i}", f"team/f{i}", f"{i}.txt") for i in range(4)]
        self.files = FakeFiles.with_s3_files(*specs)
        self.bucket = FakeBucket()
        for _, key, _ in specs:
            self.bucket.put(key, key.encode() * 8)
        self.storage = FakeStorage()
        self.env = self.env_for()

    def env_for(self):
        return build_environment(self.path, files=self.files, bucket=self.bucket, storage=self.storage)

    def test_a_kill_mid_batch_loses_only_the_uncommitted_rows(self):
        self.bucket.fail_copy_at = 3
        with self.assertRaises(InterruptedRun):
            prepare_legacy_bytes(self.env, batch_size=2)

        # The killed transaction rolls back; the first committed batch stands.
        self.files.rollback()
        self.assertEqual(
            [self.files.blob_of(f"f{i}") is not None for i in range(4)], [True, True, False, False]
        )
        saved = self.saved_storage()
        self.assertEqual(saved.s3_objects_copied, 2)
        self.assertFalse(saved.completed)

    def test_the_rerun_finishes_without_copying_a_complete_object_again(self):
        self.bucket.fail_copy_at = 3
        with self.assertRaises(InterruptedRun):
            prepare_legacy_bytes(self.env, batch_size=2)
        self.files.rollback()
        copies_before = len(self.bucket.copies)

        self.bucket.fail_copy_at = None
        prep = prepare_legacy_bytes(self.env_for(), batch_size=2)

        self.assertTrue(all(self.files.blob_of(f"f{i}") for i in range(4)))
        self.assertTrue(prep.completed)
        # f0 and f1 are already at their canonical keys, so the rerun copies
        # only f2 (whose copy never landed) and f3.
        self.assertEqual(len(self.bucket.copies) - copies_before, 2)
        self.assertEqual(prep.s3_objects_copied, 4)
        self.assertEqual(prep.s3_bytes_copied, sum(len(f"team/f{i}".encode() * 8) for i in range(4)))

    def test_a_copy_that_does_not_verify_stops_the_run(self):
        class SilentlyTruncating(FakeBucket):
            def _copy(self, kind, source_key, destination_key):
                self.copies.append((kind, source_key, destination_key))
                self.sizes[destination_key] = 1

        bucket = SilentlyTruncating().put("team/f0", BYTES)
        files = FakeFiles.with_s3_files(("f0", "team/f0", "a.txt"))

        with self.assertRaises(OSError) as caught:
            prepare_legacy_bytes(build_environment(self.path, files=files, bucket=bucket))

        self.assertIn("did not verify", str(caught.exception))
        self.assertIsNone(files.blob_of("f0"))


class TestDurableRecord(PrepareCase):
    def test_the_record_survives_a_new_process(self):
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        bucket = FakeBucket().put("team/f1", BYTES)
        prepare_legacy_bytes(self.env(files=files, bucket=bucket))

        saved = self.saved_storage()

        self.assertTrue(saved.completed)
        self.assertEqual(saved.s3_objects_copied, 1)
        self.assertEqual(saved.s3_bytes_copied, len(BYTES))
        self.assertEqual(saved.missing_bytes, [])

    def test_a_truncated_record_does_not_stop_a_rerun(self):
        (self.path / "drive-build-state.json").write_text("{not json")
        prep = prepare_legacy_bytes(self.env(legacy_s3=LegacyS3Config(enabled=False)))
        self.assertTrue(prep.completed)


if __name__ == "__main__":
    unittest.main()
