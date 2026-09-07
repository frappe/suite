"""§14.2 step 3: hash once, copy into the canonical layout, link the blob."""

import hashlib
import io
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from frappe.storage.blob import sniff_mime

from suite.drive.patches.build import layout
from suite.drive.patches.build.layout import MULTIPART_COPY_THRESHOLD, blob_key, object_key
from suite.drive.patches.build.s3_copy import copy_in_bucket, copy_legacy_s3_objects
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
        bucket = FakeBucket().put("team/f1", BYTES)
        storage = FakeStorage()
        storage.blobs["blob-existing"] = {"checksum": SHA, "status": "Ready"}

        _, prep = self.run_copy(files=files, bucket=bucket, storage=storage)

        self.assertEqual(bucket.copies, [])
        self.assertEqual(files.blob_of("f1"), "blob-existing")
        self.assertEqual(prep.s3_objects_reused, 1)
        self.assertEqual(prep.s3_objects_copied, 0)

    def test_a_blob_still_uploading_is_not_claimed(self):
        # A Pending row is an upload in flight; its object may not be there.
        files = FakeFiles.with_s3_files(("f1", "team/f1", "a.txt"))
        bucket = FakeBucket().put("team/f1", BYTES)
        storage = FakeStorage()
        storage.blobs["blob-pending"] = {"checksum": SHA, "status": "Pending"}

        _, prep = self.run_copy(files=files, bucket=bucket, storage=storage)

        self.assertNotEqual(files.blob_of("f1"), "blob-pending")
        self.assertEqual(len(bucket.copies), 1)
        self.assertEqual(prep.s3_objects_reused, 0)

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
