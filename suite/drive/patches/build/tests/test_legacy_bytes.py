"""§14.2 steps 1 to 3 end to end: gate, backfill, copy, durable record."""

import hashlib
import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from suite.drive.patches.build import prepare_legacy_bytes
from suite.drive.patches.build.environment import BACKFILL_BATCH_SIZE, LegacyS3Config
from suite.drive.patches.build.state import (
    MISSING_BYTES_KEPT,
    STATE_FILENAME,
    STATE_VERSION,
    BuildState,
    MissingBytes,
    StoragePreparation,
)
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


def skipped(name, file_url, reason):
    return {"name": name, "file_url": file_url, "reason": reason}


class PrepareCase(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def env(self, **kwargs):
        return build_environment(self.path, **kwargs)

    def saved_storage(self):
        return BuildState(self.path / STATE_FILENAME).storage()


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

    def test_the_backfill_result_is_saved_before_the_copy_starts(self):
        # A run killed inside the S3 step still leaves the backfill's answer.
        storage = FakeStorage(backfill={"linked": 4, "blobs_created": 2})
        bucket = FakeBucket().put("team/f1", BYTES)
        bucket.fail_copy_at = 1
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))

        with self.assertRaises(InterruptedRun):
            prepare_legacy_bytes(self.env(storage=storage, files=files, bucket=bucket))

        saved = self.saved_storage()
        self.assertEqual(saved.backfill_linked, 4)
        self.assertFalse(saved.completed)


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
    def local_only(self, *skips):
        storage = FakeStorage(backfill={"linked": 0, "blobs_created": 0, "skipped": list(skips)})
        return prepare_legacy_bytes(self.env(storage=storage, legacy_s3=LegacyS3Config(enabled=False)))

    def test_a_local_row_the_backfill_could_not_read_keeps_its_reason(self):
        prep = self.local_only(skipped("f1", "/private/files/gone.pdf", "cannot read /x: [Errno 2]"))

        (missing,) = prep.missing_bytes
        self.assertEqual(missing.file, "f1")
        self.assertEqual(missing.file_url, "/private/files/gone.pdf")
        self.assertIn("cannot read", missing.reason)

    def test_a_public_local_row_counts_too(self):
        prep = self.local_only(skipped("f1", "/files/logo.png", "cannot read"))
        self.assertEqual([m.file for m in prep.missing_bytes], ["f1"])

    def test_rows_that_never_named_local_bytes_are_not_missing_bytes(self):
        # A Link node's file_url is an external URL (§14.4); a fetch URL is
        # step 3's job; an asset was never Drive's. None lost bytes.
        prep = self.local_only(
            skipped("link", "https://example.test/page", "file_url is not a local files path"),
            skipped("fetch", get_s3_url("team/f1"), "file_url is not a local files path"),
            skipped("asset", "/assets/suite/logo.png", "file_url is not a local files path"),
            skipped("blank", "", "file_url is not a local files path"),
        )
        self.assertEqual(prep.missing_bytes, [])

    def test_a_missing_s3_object_reaches_the_durable_record_with_its_reason(self):
        files = FakeFiles.with_s3_files(("f1", "gone/f1", "a.txt"))

        prep = prepare_legacy_bytes(self.env(files=files, bucket=FakeBucket()))

        saved = self.saved_storage()
        for record in (prep, saved):
            (missing,) = record.missing_bytes
            self.assertEqual(missing.file, "f1")
            self.assertIn("no object at gone/f1", missing.reason)
            self.assertIn("drive-bucket", missing.reason)
        self.assertEqual(saved.s3_objects_missing, 1)

    def test_bytes_that_came_back_stop_being_reported(self):
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        bucket = FakeBucket()
        env = self.env(files=files, bucket=bucket)

        first = prepare_legacy_bytes(env)
        self.assertEqual([m.file for m in first.missing_bytes], ["f1"])

        bucket.put("team/f1", BYTES)
        second = prepare_legacy_bytes(env)

        self.assertEqual(second.missing_bytes, [])
        self.assertEqual(second.s3_objects_missing, 0)
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

    def fresh_env(self):
        return build_environment(self.path, files=self.files, bucket=self.bucket, storage=self.storage)

    def test_a_kill_mid_batch_loses_only_the_uncommitted_rows(self):
        self.bucket.fail_copy_at = 3
        with self.assertRaises(InterruptedRun):
            prepare_legacy_bytes(self.fresh_env(), batch_size=2)

        # The killed transaction rolls back; the first committed batch stands.
        self.files.rollback()
        self.assertEqual(
            [self.files.blob_of(f"f{i}") is not None for i in range(4)],
            [True, True, False, False],
        )
        saved = self.saved_storage()
        self.assertEqual(saved.s3_objects_copied, 2)
        self.assertFalse(saved.completed)

    def test_the_rerun_finishes_without_copying_a_complete_object_again(self):
        self.bucket.fail_copy_at = 3
        with self.assertRaises(InterruptedRun):
            prepare_legacy_bytes(self.fresh_env(), batch_size=2)
        self.files.rollback()
        copies_before = len(self.bucket.copies)

        self.bucket.fail_copy_at = None
        prep = prepare_legacy_bytes(self.fresh_env(), batch_size=2)

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
    def run_one_copy(self):
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        bucket = FakeBucket().put("team/f1", BYTES)
        return prepare_legacy_bytes(self.env(files=files, bucket=bucket))

    def test_the_record_survives_a_new_process(self):
        self.run_one_copy()

        saved = self.saved_storage()

        self.assertTrue(saved.completed)
        self.assertEqual(saved.s3_objects_copied, 1)
        self.assertEqual(saved.s3_bytes_copied, len(BYTES))
        self.assertEqual(saved.missing_bytes, [])

    def test_the_write_leaves_no_half_written_file_behind(self):
        self.run_one_copy()

        self.assertEqual([p.name for p in self.path.glob("*.tmp")], [])
        json.loads((self.path / STATE_FILENAME).read_text())

    def test_an_unreadable_record_is_kept_aside_not_overwritten(self):
        # The cumulative copy totals live only in this file, so losing it
        # silently would make the report understate a migration that ran.
        for content in ("{not json", "[]", "3"):
            with self.subTest(content=content):
                for stale in self.path.glob("*.corrupt-*"):
                    stale.unlink()
                (self.path / STATE_FILENAME).write_text(content)

                prep = prepare_legacy_bytes(self.env(legacy_s3=LegacyS3Config(enabled=False)))

                self.assertTrue(prep.completed)
                kept = list(self.path.glob(f"{STATE_FILENAME}.corrupt-*"))
                self.assertEqual(len(kept), 1)
                self.assertEqual(kept[0].read_text(), content)

    def test_a_storage_section_of_the_wrong_shape_reads_as_empty(self):
        (self.path / STATE_FILENAME).write_text('{"storage": [], "version": 1}')

        prep = prepare_legacy_bytes(self.env(legacy_s3=LegacyS3Config(enabled=False)))

        self.assertTrue(prep.completed)
        self.assertEqual(prep.s3_objects_copied, 0)

    def test_a_valid_record_is_never_quarantined(self):
        self.run_one_copy()
        prepare_legacy_bytes(self.env(legacy_s3=LegacyS3Config(enabled=False)))
        self.assertEqual(list(self.path.glob("*.corrupt-*")), [])


class TestUnreachableRows(PrepareCase):
    """Rows neither step could read must still reach the record.

    §14.10 Cleanup deletes Drive's legacy prefix from the bucket. A row
    whose bytes Build never carried across, and never named, loses them
    with nothing having said so.
    """

    def prepare(self, files, *, s3=True, bucket=None):
        legacy = LegacyS3Config(enabled=s3, bucket="drive-bucket")
        return prepare_legacy_bytes(self.env(files=files, bucket=bucket or FakeBucket(), legacy_s3=legacy))

    def test_a_bare_bucket_key_is_recorded(self):
        # What a half-finished upload leaves: create_drive_file writes the
        # disk path first and only converts it to a fetch URL on a second save.
        files = FakeFiles().add("f1", "/marketing/abc123", "deck.key")

        prep = self.prepare(files)

        (missing,) = prep.missing_bytes
        self.assertEqual(missing.file, "f1")
        self.assertEqual(missing.file_url, "/marketing/abc123")
        self.assertIn("cannot reach", missing.reason)
        self.assertEqual(prep.missing_bytes_total, 1)

    def test_an_old_fetch_prefix_is_recorded(self):
        # A site whose `migrate_s3_url_prefix` patch never ran.
        files = FakeFiles().add("f1", "/api/method/drive.api.s3.fetch?path=team/x", "x.bin")

        self.assertEqual([m.file for m in self.prepare(files).missing_bytes], ["f1"])

    def test_a_fetch_url_on_a_site_with_s3_off_is_recorded(self):
        # Step 3 never runs, so those bytes are unreachable, not handled.
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))

        prep = self.prepare(files, s3=False)

        self.assertEqual([m.file for m in prep.missing_bytes], ["f1"])

    def test_a_fetch_url_on_a_site_with_s3_on_is_not_recorded_twice(self):
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        bucket = FakeBucket().put("team/f1", BYTES)

        prep = self.prepare(files, bucket=bucket)

        self.assertEqual(prep.missing_bytes, [])
        self.assertIsNotNone(files.blob_of("f1"))

    def test_rows_that_never_had_bytes_are_left_out(self):
        files = FakeFiles()
        files.add("link", "https://example.test/page", "a link", file_type="Link")
        files.add("relative-link", "mailto:someone@example.test", "a link", file_type="Link")
        files.add("blank", "", "a document")
        files.add("local", "/private/files/x.png", "x.png")

        self.assertEqual(self.prepare(files).missing_bytes, [])

    def test_it_pages_past_rows_it_can_never_link_and_writes_nothing(self):
        # Every row here stays in the query, so only the cursor ends the
        # loop. A batch smaller than the row count is what proves it moves.
        files = FakeFiles()
        for i in range(5):
            files.add(f"f{i}", f"/bare/{i}", f"{i}.bin")

        prep = prepare_legacy_bytes(
            self.env(files=files, bucket=FakeBucket(), legacy_s3=LegacyS3Config(enabled=False)),
            batch_size=2,
        )

        self.assertEqual(sorted(m.file for m in prep.missing_bytes), [f"f{i}" for i in range(5)])
        self.assertTrue(all(files.blob_of(f"f{i}") is None for i in range(5)))
        self.assertEqual(self.saved_storage().missing_bytes_total, 5)

    def test_a_cursor_that_stops_moving_stops_the_run(self):
        class Stuck(FakeFiles):
            def rows_outside(self, prefixes, after, limit):
                return super().rows_outside(prefixes, "", limit)

        files = Stuck()
        for i in range(4):
            files.add(f"f{i}", f"/bare/{i}", f"{i}.bin")

        with self.assertRaises(RuntimeError) as caught:
            prepare_legacy_bytes(
                self.env(files=files, bucket=FakeBucket(), legacy_s3=LegacyS3Config(enabled=False)),
                batch_size=2,
            )

        self.assertIn("stalled", str(caught.exception))

    def test_a_row_that_gained_bytes_stops_being_reported(self):
        files = FakeFiles().add("f1", "/bare/1", "a.bin")
        env = self.env(files=files, bucket=FakeBucket())

        self.assertEqual(prepare_legacy_bytes(env).missing_bytes_total, 1)
        files.link_blob("f1", "blob-somewhere")

        self.assertEqual(prepare_legacy_bytes(env).missing_bytes_total, 0)


class TestBackfillTotalsSurviveARerun(PrepareCase):
    """The framework backfill skips rows that already have a blob.

    A rerun therefore links nothing. Reporting that as zero would tell the
    operator no local bytes were ever carried across.
    """

    def test_a_rerun_keeps_the_first_runs_totals(self):
        storage = FakeStorage(backfill={"linked": 120, "blobs_created": 90})
        env = self.env(storage=storage, legacy_s3=LegacyS3Config(enabled=False))
        first = prepare_legacy_bytes(env)

        storage._backfill = {"linked": 0, "blobs_created": 0}
        second = prepare_legacy_bytes(env)

        self.assertEqual((first.backfill_linked, first.backfill_blobs_created), (120, 90))
        self.assertEqual((second.backfill_linked, second.backfill_blobs_created), (120, 90))
        self.assertEqual(self.saved_storage().backfill_linked, 120)

    def test_a_second_run_that_links_more_adds_to_the_total(self):
        storage = FakeStorage(backfill={"linked": 5, "blobs_created": 5})
        env = self.env(storage=storage, legacy_s3=LegacyS3Config(enabled=False))
        prepare_legacy_bytes(env)

        storage._backfill = {"linked": 2, "blobs_created": 1}

        self.assertEqual(prepare_legacy_bytes(env).backfill_linked, 7)


class TestTheRecordCannotUnderstate(PrepareCase):
    def test_the_kept_list_is_bounded_but_the_count_is_exact(self):
        prep = StoragePreparation()
        for i in range(MISSING_BYTES_KEPT + 25):
            prep.record_missing(MissingBytes(file=f"f{i}", file_url="", reason="gone"))

        self.assertEqual(len(prep.missing_bytes), MISSING_BYTES_KEPT)
        self.assertEqual(prep.missing_bytes_total, MISSING_BYTES_KEPT + 25)

    def test_a_read_error_stops_the_run_instead_of_resetting_the_totals(self):
        # The cumulative totals live only here. Quarantining on a transient
        # EIO would make the report say zero for a migration that copied
        # everything.
        state = BuildState(self.path / STATE_FILENAME)
        state.save({"storage": StoragePreparation(s3_objects_copied=9).as_dict()})

        with patch("builtins.open", side_effect=OSError("EIO")):
            with self.assertRaises(OSError):
                state.load()

        self.assertTrue(state.path.exists())
        self.assertEqual(state.storage().s3_objects_copied, 9)
        self.assertEqual(list(self.path.glob("*.corrupt-*")), [])

    def test_a_write_that_fails_leaves_the_previous_record_readable(self):
        # The point of the temp file. Writing straight to the target would
        # pass the "no .tmp left behind" check and still lose the totals.
        state = BuildState(self.path / STATE_FILENAME)
        state.save({"storage": StoragePreparation(s3_objects_copied=4).as_dict()})

        with patch("json.dump", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                state.save({"storage": StoragePreparation(s3_objects_copied=99).as_dict()})

        self.assertEqual(state.storage().s3_objects_copied, 4)

    def test_the_record_keeps_its_version_and_its_other_sections(self):
        # Tickets 27 to 29 write their own sections beside this one.
        state = BuildState(self.path / STATE_FILENAME)
        state.save({"tree": {"nodes": 3}})

        state.put_storage(StoragePreparation(s3_objects_copied=1))

        saved = json.loads(state.path.read_text())
        self.assertEqual(saved["tree"], {"nodes": 3})
        self.assertEqual(saved["version"], STATE_VERSION)

    def test_the_write_leaves_no_temp_file_two_runs_could_share(self):
        # A second process writing the same `.tmp` could interleave and have
        # `os.replace` promote a half-written file.
        state = BuildState(self.path / STATE_FILENAME)
        state.save({"storage": StoragePreparation().as_dict()})

        self.assertEqual([p.name for p in self.path.glob("*.tmp")], [])
        self.assertIn(str(os.getpid()), state._temp_path().name)


if __name__ == "__main__":
    unittest.main()
