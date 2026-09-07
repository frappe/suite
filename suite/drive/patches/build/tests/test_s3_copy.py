"""§14.2 step 3: hash once, copy into the canonical layout, link the blob."""

import hashlib
import io
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from frappe.storage import blob
from frappe.storage.blob import sniff_mime

from suite.drive.patches.build import layout, s3_copy
from suite.drive.patches.build.layout import MULTIPART_COPY_THRESHOLD, blob_key, object_key
from suite.drive.patches.build.s3_copy import (
    READ_CHUNK,
    SNIFF_BYTES,
    copy_in_bucket,
    copy_legacy_s3_objects,
)
from suite.drive.patches.build.tests.fakes import (
    FakeBucket,
    FakeFiles,
    FakeStorage,
    build_environment,
)
from suite.drive.utils.files import get_s3_url

BYTES = b"the quick brown fox" * 16
SHA = hashlib.sha256(BYTES).hexdigest()
OTHER = b"a different object"
OTHER_SHA = hashlib.sha256(OTHER).hexdigest()


class S3CopyCase(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def run_copy(self, *, files, bucket, storage=None, batch_size=1000):
        env = build_environment(self.path, files=files, bucket=bucket, storage=storage or FakeStorage())
        prep = env.state.storage()
        copy_legacy_s3_objects(env, prep, batch_size=batch_size)
        return env, prep


class TestOneObject(S3CopyCase):
    def setUp(self):
        super().setUp()
        self.files = FakeFiles.with_s3_files(("f1", "team/f1", "report.PDF"))
        self.bucket = FakeBucket().put("team/f1", BYTES)
        self.storage = FakeStorage()
        self.env, self.prep = self.run_copy(files=self.files, bucket=self.bucket, storage=self.storage)

    def test_the_object_lands_at_the_canonical_key(self):
        destination = object_key(SHA, "report.PDF")
        self.assertEqual(destination, f"private/{SHA[:2]}/{SHA[2:4]}/{SHA}.pdf")
        self.assertEqual(self.bucket.copies, [("copy_object", "team/f1", destination)])
        self.assertEqual(self.bucket.objects[destination], BYTES)

    def test_one_blob_row_describes_the_content(self):
        (blob,) = self.storage.blobs.values()
        self.assertEqual(blob["key"], blob_key(SHA, "report.PDF"))
        self.assertEqual(blob["checksum"], SHA)
        self.assertEqual(blob["file_size"], len(BYTES))
        self.assertEqual(blob["driver"], "s3")
        self.assertEqual(blob["is_private"], 1)
        self.assertEqual(blob["status"], "Ready")
        self.assertEqual(blob["mime_type"], sniff_mime(io.BytesIO(BYTES)))

    def test_the_file_row_points_at_it(self):
        (name,) = self.storage.blobs
        self.assertEqual(self.files.blob_of("f1"), name)

    def test_the_object_is_read_exactly_once(self):
        self.assertEqual(self.bucket.opened, ["team/f1"])

    def test_the_legacy_object_is_left_where_it_was(self):
        # Cleanup deletes Drive's prefix a release later (§14.10); Build must
        # leave a rollback that is only "truncate the new tables".
        self.assertEqual(self.bucket.objects["team/f1"], BYTES)
        self.assertEqual(self.files.rows["f1"]["file_url"], get_s3_url("team/f1"))

    def test_the_counters_are_recorded(self):
        self.assertEqual(self.prep.s3_rows_seen, 1)
        self.assertEqual(self.prep.s3_objects_copied, 1)
        self.assertEqual(self.prep.s3_bytes_copied, len(BYTES))
        self.assertEqual(self.prep.s3_objects_reused, 0)
        self.assertEqual(self.prep.s3_objects_missing, 0)
        self.assertEqual(self.prep.missing_bytes, [])


class TestDeduplication(S3CopyCase):
    def test_two_files_with_one_content_end_as_one_object_and_one_blob(self):
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"), ("f2", "personal/f2", "a.txt"))
        bucket = FakeBucket().put("team/f1", BYTES).put("personal/f2", BYTES)
        storage = FakeStorage()

        _, prep = self.run_copy(files=files, bucket=bucket, storage=storage)

        self.assertEqual(len(storage.blobs), 1)
        self.assertEqual(files.blob_of("f1"), files.blob_of("f2"))
        self.assertEqual(len(bucket.copies), 1)
        # Both objects are still read: the checksum is what proves they match.
        self.assertEqual(sorted(bucket.opened), ["personal/f2", "team/f1"])
        self.assertEqual(prep.s3_objects_copied, 1)
        self.assertEqual(prep.s3_objects_reused, 1)


class TestResume(S3CopyCase):
    def test_a_linked_row_is_never_read_again(self):
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        files.link_blob("f1", "blob1")
        bucket = FakeBucket().put("team/f1", BYTES)

        _, prep = self.run_copy(files=files, bucket=bucket)

        self.assertEqual(bucket.opened, [])
        self.assertEqual(bucket.copies, [])
        self.assertEqual(prep.s3_rows_seen, 0)

    def test_an_existing_blob_row_skips_the_copy(self):
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        destination = object_key(SHA, "a.txt")
        bucket = FakeBucket().put("team/f1", BYTES).put(destination, BYTES)
        storage = FakeStorage().add_blob("blob-existing", key=blob_key(SHA, "a.txt"), checksum=SHA)

        _, prep = self.run_copy(files=files, bucket=bucket, storage=storage)

        self.assertEqual(bucket.copies, [])
        self.assertEqual(files.blob_of("f1"), "blob-existing")
        self.assertEqual(prep.s3_objects_reused, 1)
        self.assertEqual(prep.s3_objects_copied, 0)

    def test_a_blob_still_uploading_is_not_claimed(self):
        # A Pending row is an upload in flight; its object may not be there.
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        bucket = FakeBucket().put("team/f1", BYTES)
        storage = FakeStorage().add_blob(
            "blob-pending", key=blob_key(SHA, "a.txt"), checksum=SHA, status="Pending"
        )

        _, prep = self.run_copy(files=files, bucket=bucket, storage=storage)

        self.assertIsNone(files.blob_of("f1"))
        self.assertEqual(prep.s3_objects_reused, 0)
        self.assertEqual(prep.s3_objects_copied, 0)

    def test_a_complete_object_at_the_destination_is_not_copied_again(self):
        # What an interrupted run leaves: the object copied, no blob row.
        destination = object_key(SHA, "a.txt")
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        bucket = FakeBucket().put("team/f1", BYTES).put(destination, BYTES)

        _, prep = self.run_copy(files=files, bucket=bucket)

        self.assertEqual(bucket.copies, [])
        self.assertIsNotNone(files.blob_of("f1"))
        self.assertEqual(prep.s3_objects_copied, 1)

    def test_a_truncated_object_at_the_destination_is_copied_again(self):
        destination = object_key(SHA, "a.txt")
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        bucket = FakeBucket().put("team/f1", BYTES).put(destination, BYTES[:10])

        self.run_copy(files=files, bucket=bucket)

        self.assertEqual(bucket.copies, [("copy_object", "team/f1", destination)])
        self.assertEqual(bucket.objects[destination], BYTES)


class TestMissingBytes(S3CopyCase):
    def test_a_missing_object_is_recorded_and_the_row_stays_blobless(self):
        files = FakeFiles.with_s3_files(("f1", "gone/f1", "a.txt"), ("f2", "team/f2", "b.txt"))
        bucket = FakeBucket().put("team/f2", OTHER)

        _, prep = self.run_copy(files=files, bucket=bucket)

        self.assertIsNone(files.blob_of("f1"))
        self.assertIsNotNone(files.blob_of("f2"))
        self.assertEqual(prep.s3_objects_missing, 1)
        (missing,) = prep.missing_bytes
        self.assertEqual(missing.file, "f1")
        self.assertIn("gone/f1", missing.reason)
        self.assertIn("drive-bucket", missing.reason)

    def test_a_fetch_url_with_no_path_is_recorded(self):
        files = FakeFiles().add("f1", get_s3_url(""), "a.txt")
        _, prep = self.run_copy(files=files, bucket=FakeBucket())

        (missing,) = prep.missing_bytes
        self.assertIn("no object path", missing.reason)

    def test_a_row_that_is_not_a_fetch_url_is_recorded(self):
        class LooseFiles(FakeFiles):
            def s3_rows_without_blob(self, after, limit):
                return self._page(after, limit, lambda row: True)

        files = LooseFiles().add("f1", "/private/files/a.txt", "a.txt")
        _, prep = self.run_copy(files=files, bucket=FakeBucket())

        (missing,) = prep.missing_bytes
        self.assertIn("not a Drive S3 fetch URL", missing.reason)


class TestCopyChoice(unittest.TestCase):
    """Which copy call a size picks. Sizes are declared, so no bytes move."""

    def choice(self, size):
        bucket = FakeBucket().declare("src", size)
        copy_in_bucket(bucket, "src", "dst", size)
        return bucket.copies[0][0]

    def test_at_or_below_five_gb_is_a_single_copy_object(self):
        self.assertEqual(self.choice(0), "copy_object")
        self.assertEqual(self.choice(MULTIPART_COPY_THRESHOLD - 1), "copy_object")
        self.assertEqual(self.choice(MULTIPART_COPY_THRESHOLD), "copy_object")

    def test_above_five_gb_is_the_managed_multipart_copy(self):
        self.assertEqual(self.choice(MULTIPART_COPY_THRESHOLD + 1), "managed_copy")
        self.assertEqual(self.choice(20 * 1024**3), "managed_copy")


class TestBatching(S3CopyCase):
    def test_it_commits_per_batch(self):
        specs = [(f"f{i:02d}", f"team/f{i:02d}", "a.txt") for i in range(5)]
        files = FakeFiles.with_s3_files(*specs)
        bucket = FakeBucket()
        for _, key, _ in specs:
            bucket.put(key, key.encode())

        _, prep = self.run_copy(files=files, bucket=bucket, batch_size=2)

        # 2 + 2 + 1: the short last page ends the loop without a sixth query.
        self.assertEqual(files.commits, 3)
        self.assertEqual(prep.s3_objects_copied, 5)
        self.assertTrue(all(files.blob_of(name) for name, _, _ in specs))

    def test_an_exact_multiple_of_the_batch_size_stops_on_an_empty_page(self):
        specs = [(f"f{i:02d}", f"team/f{i:02d}", "a.txt") for i in range(4)]
        files = FakeFiles.with_s3_files(*specs)
        bucket = FakeBucket()
        for _, key, _ in specs:
            bucket.put(key, key.encode())

        self.run_copy(files=files, bucket=bucket, batch_size=2)

        self.assertEqual(files.commits, 2)


class TestTermination(S3CopyCase):
    def test_rows_that_can_never_be_linked_do_not_stall_the_cursor(self):
        # Every one of these stays blobless, so a cursor that did not advance
        # would hand back the same page forever.
        specs = [(f"f{i}", f"gone/f{i}", "a.txt") for i in range(3)]
        files = FakeFiles.with_s3_files(*specs)

        _, prep = self.run_copy(files=files, bucket=FakeBucket(), batch_size=2)

        self.assertEqual(prep.s3_rows_seen, 3)
        self.assertEqual([m.file for m in prep.missing_bytes], ["f0", "f1", "f2"])
        self.assertEqual(files.commits, 2)


class TestMultipartWiring(S3CopyCase):
    """The choice as the copy step actually makes it, not as a pure call.

    The threshold is read at call time, so a small fixture proves the wiring
    without a 5 GB object.
    """

    def copy_with_threshold(self, threshold):
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        bucket = FakeBucket().put("team/f1", BYTES)
        with patch.object(layout, "MULTIPART_COPY_THRESHOLD", threshold):
            self.run_copy(files=files, bucket=bucket)
        return bucket.copies[0][0]

    def test_a_large_object_goes_through_the_managed_copy(self):
        self.assertEqual(self.copy_with_threshold(len(BYTES) - 1), "managed_copy")

    def test_a_small_object_goes_through_copy_object(self):
        self.assertEqual(self.copy_with_threshold(len(BYTES)), "copy_object")


class TestStreamingAcrossChunks(S3CopyCase):
    """A body arrives in pieces, so the size, hash, and sniff must accumulate."""

    def test_the_head_is_the_first_bytes_and_the_size_is_all_of_them(self):
        content = b"<svg xmlns='http://www.w3.org/2000/svg'>" + b"y" * 20000
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.bin"))
        bucket = FakeBucket().put("team/f1", content)
        storage = FakeStorage()

        self.run_copy(files=files, bucket=bucket, storage=storage)

        (blob,) = storage.blobs.values()
        self.assertEqual(blob["file_size"], len(content))
        self.assertEqual(blob["checksum"], hashlib.sha256(content).hexdigest())
        self.assertEqual(blob["mime_type"], "image/svg+xml")
        # Sniffing the tail instead would answer something else entirely.
        self.assertNotEqual(blob["mime_type"], sniff_mime(io.BytesIO(content[-64:])))

    def test_the_body_is_never_rewound(self):
        # `FakeBucket.open` hands back a single-use stream, like botocore's.
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        bucket = FakeBucket().put("team/f1", BYTES)

        self.run_copy(files=files, bucket=bucket)

        self.assertEqual(bucket.opened, ["team/f1"])


if __name__ == "__main__":
    unittest.main()


class TestReuseVerifiesTheObject(S3CopyCase):
    """A `Ready` row is not proof that its object survives.

    `frappe/storage/gc.py` deletes a blob's bytes first and its row second,
    and it keeps the row when the delete raises. A bucket swap in
    `storage_driver_config` leaves the same state for every older blob.
    Linking to one of those without looking would hand Cleanup a `File`
    pointing at no bytes at all.
    """

    def setUp(self):
        super().setUp()
        self.blob_key = blob_key(SHA, "a.txt")
        self.destination = object_key(SHA, "a.txt")

    def storage_holding(self, key):
        return FakeStorage().add_blob("blob-existing", key=key, checksum=SHA)

    def test_a_claimed_blob_with_no_object_gets_one_before_the_link(self):
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        bucket = FakeBucket().put("team/f1", BYTES)

        _, prep = self.run_copy(files=files, bucket=bucket, storage=self.storage_holding(self.blob_key))

        self.assertEqual(bucket.copies, [("copy_object", "team/f1", self.destination)])
        self.assertEqual(bucket.objects[self.destination], BYTES)
        self.assertEqual(files.blob_of("f1"), "blob-existing")
        self.assertEqual(prep.s3_objects_reused, 1)

    def test_the_object_is_healed_at_the_blobs_own_key_not_ours(self):
        # The existing row may carry a different extension, so its key is
        # not the one this row's file_name would produce.
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        bucket = FakeBucket().put("team/f1", BYTES)
        theirs = blob_key(SHA, "a.pdf")

        self.run_copy(files=files, bucket=bucket, storage=self.storage_holding(theirs))

        self.assertEqual(bucket.copies, [("copy_object", "team/f1", f"private/{theirs}")])

    def test_a_claimed_blob_whose_object_is_there_is_not_copied_again(self):
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        bucket = FakeBucket().put("team/f1", BYTES).put(self.destination, BYTES)

        _, prep = self.run_copy(files=files, bucket=bucket, storage=self.storage_holding(self.blob_key))

        self.assertEqual(bucket.copies, [])
        self.assertEqual(prep.s3_objects_reused, 1)

    def test_a_truncated_object_under_a_claimed_blob_is_recopied(self):
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        bucket = FakeBucket().put("team/f1", BYTES).put(self.destination, BYTES[:5])

        self.run_copy(files=files, bucket=bucket, storage=self.storage_holding(self.blob_key))

        self.assertEqual(bucket.objects[self.destination], BYTES)


class TestObjectAboveFiveGB(S3CopyCase):
    """A 6 GB object, declared rather than allocated.

    `_read_once` is the only step that has to touch every byte, so it is the
    one thing stood in for; the size and checksum it hands back are what a
    6 GB object would produce. Everything after it runs for real: the copy
    choice, the size verification, the blob row, and the link.

    `FakeBucket.copy_object` raises above 5 GB the way S3 does, so a
    regression to the single-part copy fails here rather than in production.
    """

    SIZE = 6 * 1024**3
    CHECKSUM = "5f" * 32

    def run_it(self):
        files = FakeFiles.with_s3_files(("f1", "team/big", "movie.mov"))
        bucket = FakeBucket().declare("team/big", self.SIZE)
        storage = FakeStorage()
        digest = s3_copy._Digest(self.CHECKSUM, self.SIZE, "video/quicktime")
        with patch.object(s3_copy, "_read_once", return_value=digest):
            _, prep = self.run_copy(files=files, bucket=bucket, storage=storage)
        return files, bucket, storage, prep

    def test_it_goes_through_the_managed_multipart_copy(self):
        _, bucket, _, _ = self.run_it()

        destination = object_key(self.CHECKSUM, "movie.mov")
        self.assertEqual(bucket.copies, [("managed_copy", "team/big", destination)])

    def test_the_blob_row_carries_the_whole_size(self):
        files, _, storage, prep = self.run_it()

        (name,) = storage.blobs
        blob = storage.blobs[name]
        self.assertEqual(blob["file_size"], self.SIZE)
        self.assertEqual(blob["key"], blob_key(self.CHECKSUM, "movie.mov"))
        self.assertEqual(files.blob_of("f1"), name)

    def test_it_is_counted_as_a_copy_and_not_as_a_missing_byte(self):
        _, _, _, prep = self.run_it()

        self.assertEqual(prep.s3_objects_copied, 1)
        self.assertEqual(prep.s3_bytes_copied, self.SIZE)
        self.assertEqual(prep.s3_objects_missing, 0)
        self.assertEqual(prep.missing_bytes, [])


class TestBlockedByAnotherBlob(S3CopyCase):
    """The unique index is `(checksum, is_private, driver)`, without `status`."""

    def test_a_pending_row_is_reported_and_the_run_carries_on(self):
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"), ("f2", "team/f2", "b.txt"))
        bucket = FakeBucket().put("team/f1", BYTES).put("team/f2", OTHER)
        storage = FakeStorage().add_blob(
            "blob-pending", key=blob_key(SHA, "a.txt"), checksum=SHA, status="Pending"
        )

        _, prep = self.run_copy(files=files, bucket=bucket, storage=storage)

        # f1 cannot be linked, but a migration must not stop on it and stop
        # again on every rerun.
        self.assertIsNone(files.blob_of("f1"))
        (missing,) = prep.missing_bytes
        self.assertEqual(missing.file, "f1")
        self.assertIn("Pending", missing.reason)
        self.assertIsNotNone(files.blob_of("f2"))
        self.assertEqual(prep.s3_objects_copied, 1)


class TestTheReadIsBounded(S3CopyCase):
    """A multi-GB object must never be held in memory during `bench migrate`."""

    def read_one(self):
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        bucket = FakeBucket().put("team/f1", BYTES)
        self.run_copy(files=files, bucket=bucket)
        return bucket

    def test_every_read_asks_for_a_bounded_number_of_bytes(self):
        # botocore hands back the whole remainder for a negative or absent
        # size, so an unbounded read is a whole object in RAM.
        (body,) = self.read_one().bodies
        self.assertTrue(body.requested)
        for size in body.requested:
            self.assertIsNotNone(size)
            self.assertGreater(size, 0)

    def test_the_read_size_is_the_declared_chunk(self):
        (body,) = self.read_one().bodies
        self.assertEqual(set(body.requested), {READ_CHUNK})

    def test_the_body_is_closed_after_the_hash(self):
        # One leaked connection per object exhausts botocore's pool part way
        # through a large migration.
        (body,) = self.read_one().bodies
        self.assertTrue(body.closed)

    def test_the_sniff_buffer_never_grows_past_the_frameworks_window(self):
        big = b"\x00" * (SNIFF_BYTES * 4)
        files = FakeFiles.with_s3_files(("f1", "team/big", "a.bin"))
        bucket = FakeBucket().put("team/big", big)
        seen = []

        with patch(
            "suite.drive.patches.build.s3_copy.sniff_mime",
            side_effect=lambda s: seen.append(s.getvalue()) or "application/octet-stream",
        ):
            self.run_copy(files=files, bucket=bucket)

        (head,) = seen
        self.assertEqual(len(head), SNIFF_BYTES)
        self.assertEqual(head, big[:SNIFF_BYTES])

    def test_the_sniff_window_is_the_frameworks_own(self):
        # A smaller window answers a different MIME type from `put_blob`.
        self.assertEqual(SNIFF_BYTES, blob.SNIFF_BYTES)


class TestByteAccounting(S3CopyCase):
    def test_reused_content_is_not_counted_twice(self):
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"), ("f2", "team/f2", "b.txt"))
        bucket = FakeBucket().put("team/f1", BYTES).put("team/f2", BYTES)

        _, prep = self.run_copy(files=files, bucket=bucket)

        self.assertEqual(prep.s3_objects_copied, 1)
        self.assertEqual(prep.s3_objects_reused, 1)
        # §14.9 prints this. One object was moved, so one object's bytes were.
        self.assertEqual(prep.s3_bytes_copied, len(BYTES))


class TestTermination2(S3CopyCase):
    def test_a_cursor_that_stops_moving_stops_the_run(self):
        class Stuck(FakeFiles):
            def s3_rows_without_blob(self, after, limit):
                return super().s3_rows_without_blob("", limit)

        files = Stuck.with_s3_files(*[(f"f{i}", f"gone/f{i}", f"{i}.bin") for i in range(4)])

        with self.assertRaises(RuntimeError) as caught:
            self.run_copy(files=files, bucket=FakeBucket(), batch_size=2)

        self.assertIn("stalled", str(caught.exception))


class TestBatchBoundaries(S3CopyCase):
    def test_every_row_is_processed_before_its_batch_commits(self):
        files = FakeFiles.with_s3_files(*[(f"f{i}", f"team/f{i}", f"{i}.txt") for i in range(5)])
        bucket = FakeBucket()
        for i in range(5):
            bucket.put(f"team/f{i}", f"body {i}".encode())

        self.run_copy(files=files, bucket=bucket, batch_size=2)

        # A commit taken before the loop would leave the last rows linked in
        # memory only, while the durable record already claimed the copies.
        self.assertEqual(files.committed, files.rows)
        self.assertTrue(all(files.blob_of(f"f{i}") for i in range(5)))
