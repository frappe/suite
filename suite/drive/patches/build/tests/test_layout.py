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
    key_of_private_object,
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

    def test_a_private_blob_sits_inside_the_sites_storage_folder(self):
        prefix = "sites/acme.test/storage/"
        self.assertEqual(
            private_key(blob_key(prefix, NAME, "Q3 report.PDF")),
            f"sites/acme.test/storage/private/{NAME}/Q3 report.PDF",
        )
        self.assertEqual(private_key(blob_folder(prefix, NAME)), f"sites/acme.test/storage/private/{NAME}/")

    def test_the_key_is_what_the_frameworks_s3_driver_builds(self):
        # The driver's own prefix, from the site config, and `make_key` over
        # it. Filenames the framework rewrites must be rewritten the same way.
        driver = s3_driver()
        for filename in ("report.PDF", "a/b?.txt", None, "x" * 300 + ".pdf"):
            with self.subTest(filename=filename):
                key = blob_key(driver.key_prefix, NAME, filename)
                self.assertEqual(key, make_key(driver, NAME, filename))
                object_key = driver.object_key(key, is_private=True)
                self.assertEqual(private_key(key), object_key)
                self.assertEqual(key_of_private_object(object_key), key)

    def test_an_older_blob_key_still_gets_the_frameworks_bucket_key(self):
        # Blobs written before the storage folder keep their keys.
        driver = s3_driver()
        key = f"57b841b5ba8c/{NAME}/report.PDF"
        object_key = driver.object_key(key, is_private=True)
        self.assertEqual(private_key(key), object_key)
        self.assertEqual(key_of_private_object(object_key), key)

    def test_the_prefix_is_the_sites_storage_folder(self):
        self.assertEqual(s3_driver().key_prefix, f"sites/{frappe.local.site}/storage/")

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
