"""The blob layout, pinned against the framework it has to match."""

import unittest
from unittest.mock import patch

import frappe
from frappe.storage.blob import key_basename, make_key
from frappe.storage.s3_driver import S3Driver

from suite.drive.patches.build.layout import (
    MULTIPART_COPY_THRESHOLD,
    blob_folder,
    blob_key,
    blob_name,
    needs_multipart_copy,
    private_key,
)
from suite.drive.patches.build.tests.fakes import S3_COPY_OBJECT_MAX_BYTES

SHA = "0123456789abcdef" * 4
# sha256(b"suite-drive-build:" + SHA) cut to ten characters. Spelled out: a
# resumed run must find the blob an older run named.
NAME = "739d24408f"


def s3_driver(**config) -> S3Driver:
    """A real `S3Driver`, built from a site config the test controls."""
    conf = frappe._dict(db_name="suite_build_db", storage_driver_config={"bucket": "b", **config})
    with patch.object(frappe, "conf", conf):
        return S3Driver()


class TestBlobLayout(unittest.TestCase):
    def test_the_blob_name_derives_from_the_checksum(self):
        self.assertEqual(blob_name(SHA), NAME)
        self.assertNotEqual(blob_name("f" * 64), NAME)

    def test_the_bucket_key_is_the_layout_build_copies_into(self):
        self.assertEqual(
            private_key(blob_key("acme/", NAME, "Q3 report.PDF")),
            f"private/acme/{NAME}/Q3 report.PDF",
        )
        self.assertEqual(blob_folder("acme/", NAME), f"acme/{NAME}/")

    def test_the_key_is_what_the_frameworks_s3_driver_builds(self):
        # The driver's own prefix, from the site config, and `make_key` over
        # it. Filenames the framework rewrites must be rewritten the same way.
        for driver in (s3_driver(), s3_driver(prefix="acme")):
            for filename in ("report.PDF", "a/b?.txt", None, "x" * 300 + ".pdf"):
                with self.subTest(prefix=driver.key_prefix, filename=filename):
                    key = blob_key(driver.key_prefix, NAME, filename)
                    self.assertEqual(key, make_key(driver, NAME, filename))
                    self.assertEqual(private_key(key), driver.object_key(key, is_private=True))

    def test_the_default_prefix_is_the_database_name_hash(self):
        # sha256(b"suite_build_db")[:12]
        self.assertEqual(s3_driver().key_prefix, "57b841b5ba8c/")

    def test_relocate_leaves_a_build_blob_where_it_is(self):
        # `relocate_blobs` moves a blob unless its key already equals
        # `make_key(target, name, key_basename(key))`.
        driver = s3_driver()
        key = blob_key(driver.key_prefix, NAME, "a/b?.txt")
        self.assertEqual(make_key(driver, NAME, key_basename(key)), key)


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
