"""The canonical layout, pinned against the framework it has to match."""

import unittest

from frappe.storage.blob import make_key, sanitized_extension
from frappe.storage.s3_driver import S3Driver

from suite.drive.patches.build.layout import (
    MULTIPART_COPY_THRESHOLD,
    blob_key,
    needs_multipart_copy,
    object_key,
)
from suite.drive.patches.build.tests.fakes import S3_COPY_OBJECT_MAX_BYTES

SHA = "0123456789abcdef" * 4


class TestCanonicalLayout(unittest.TestCase):
    def test_object_key_is_the_layout_the_spec_fixes(self):
        self.assertEqual(object_key(SHA, "report.PDF"), f"private/01/23/{SHA}.pdf")

    def test_blob_key_is_the_object_key_without_the_privacy_prefix(self):
        self.assertEqual(blob_key(SHA, "report.PDF"), f"01/23/{SHA}.pdf")

    def test_a_file_without_a_usable_extension_keeps_a_bare_key(self):
        for filename in (None, "", "no-extension", "x." + "a" * 11, "archive.tar.gz2!"):
            with self.subTest(filename=filename):
                self.assertEqual(blob_key(SHA, filename), f"01/23/{SHA}")

    def test_the_key_matches_frappe_make_key_and_its_extension_rule(self):
        # `put_blob` composes exactly this (frappe/storage/blob.py:150-152);
        # Build has to land on the same key or it would store a duplicate.
        for filename in ("report.PDF", "note.txt", None, "no-extension"):
            with self.subTest(filename=filename):
                expected = make_key(SHA)
                if ext := sanitized_extension(filename):
                    expected = f"{expected}.{ext}"
                self.assertEqual(blob_key(SHA, filename), expected)

    def test_the_object_key_matches_the_s3_driver_private_namespace(self):
        # `S3Driver.object_key` does not touch self, so it reads as the pure
        # function it is. This is the check that catches a framework rename.
        self.assertEqual(
            object_key(SHA, "report.PDF"),
            S3Driver.object_key(None, blob_key(SHA, "report.PDF"), True),
        )


class TestMultipartThreshold(unittest.TestCase):
    def test_the_threshold_is_the_s3_copy_object_ceiling(self):
        self.assertEqual(MULTIPART_COPY_THRESHOLD, 5 * 1024**3)

    def test_the_threshold_is_what_the_fake_bucket_refuses(self):
        # The other boundary tests express themselves in terms of the
        # constant, so they move with it. This is the one assertion that
        # would fail if the threshold became a decimal 5 GB, and the fake's
        # own literal is the independent side of it.
        self.assertEqual(MULTIPART_COPY_THRESHOLD, S3_COPY_OBJECT_MAX_BYTES)

    def test_only_above_the_threshold(self):
        self.assertFalse(needs_multipart_copy(0))
        self.assertFalse(needs_multipart_copy(MULTIPART_COPY_THRESHOLD - 1))
        self.assertFalse(needs_multipart_copy(MULTIPART_COPY_THRESHOLD))
        self.assertTrue(needs_multipart_copy(MULTIPART_COPY_THRESHOLD + 1))


if __name__ == "__main__":
    unittest.main()
