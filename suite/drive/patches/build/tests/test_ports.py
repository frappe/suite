"""The real ports, checked against mocks of what they call.

The fakes elsewhere prove the rules; these prove the wiring, so a framework
rename or a stray column write shows up as a failing test and not as a bad
migration.
"""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import frappe

from suite.drive.patches.build.ports import BotoBucket, SiteFiles, SiteStorage
from suite.drive.utils.files import S3_URL_PREFIX


class StubbedDatabase(unittest.TestCase):
    """`frappe.db` replaced by a mock, so the ports run with no connection."""

    def setUp(self):
        missing = object()
        previous = getattr(frappe.local, "db", missing)
        self.db = MagicMock()
        frappe.local.db = self.db

        def restore():
            if previous is missing:
                # Leaving `frappe.local.db = None` behind would break every
                # later module in the same process: `frappe.db` proxies to it.
                del frappe.local.db
            else:
                frappe.local.db = previous

        self.addCleanup(restore)


class TestSiteFiles(StubbedDatabase):
    def setUp(self):
        super().setUp()
        self.files = SiteFiles(S3_URL_PREFIX)

    def test_linking_writes_the_blob_column_and_nothing_else(self):
        self.files.link_blob("file-1", "blob-1")

        # No doc events, no `modified` bump: the source row is preserved for
        # Cleanup, which ships a release later (§14.10).
        self.db.set_value.assert_called_once_with("File", "file-1", "blob", "blob-1", update_modified=False)

    def test_the_s3_page_asks_for_blobless_non_folder_fetch_urls(self):
        with patch.object(frappe, "get_all", return_value=[]) as get_all:
            self.files.s3_rows_without_blob("after-me", 1000)

        filters = get_all.call_args.kwargs["filters"]
        self.assertEqual(filters["blob"], ("is", "not set"))
        self.assertEqual(filters["is_folder"], 0)
        self.assertEqual(filters["name"], (">", "after-me"))
        self.assertEqual(filters["file_url"], ("like", S3_URL_PREFIX + "%"))
        self.assertEqual(get_all.call_args.kwargs["order_by"], "name asc")
        self.assertEqual(get_all.call_args.kwargs["limit"], 1000)

    def test_the_blobless_scan_has_no_url_filter(self):
        with patch.object(frappe, "get_all", return_value=[]) as get_all:
            self.files.rows_without_blob("", 10)

        self.assertNotIn("file_url", get_all.call_args.kwargs["filters"])

    def test_a_row_with_no_file_url_reads_as_an_empty_string(self):
        rows = [frappe._dict(name="f1", file_url=None, file_name=None)]
        with patch.object(frappe, "get_all", return_value=rows):
            (row,) = self.files.rows_without_blob("", 10)

        self.assertEqual(row.file_url, "")


class TestSiteStorage(StubbedDatabase):
    def setUp(self):
        super().setUp()
        self.storage = SiteStorage()

    def test_enabled_is_the_framework_switch(self):
        for value in (True, False):
            with self.subTest(value=value):
                with patch("frappe.storage.enabled", return_value=value):
                    self.assertEqual(self.storage.enabled(), value)

    def test_the_backfill_is_the_frameworks_own(self):
        with patch("frappe.storage.backfill.run", return_value={"linked": 1}) as run:
            self.assertEqual(self.storage.run_backfill(500), {"linked": 1})
        run.assert_called_once_with(batch_size=500)

    def test_claiming_looks_for_a_private_s3_blob_and_revives_it(self):
        self.db.get_value.return_value = "blob-1"
        with patch("frappe.storage.blob.revive_blob", return_value=True) as revive:
            self.assertEqual(self.storage.claim_blob("abc"), "blob-1")

        self.db.get_value.assert_called_once_with(
            "File Blob", {"checksum": "abc", "is_private": 1, "driver": "s3"}
        )
        revive.assert_called_once_with("blob-1")

    def test_a_blob_the_gc_already_took_is_not_claimed(self):
        self.db.get_value.return_value = "blob-1"
        with patch("frappe.storage.blob.revive_blob", return_value=False):
            self.assertIsNone(self.storage.claim_blob("abc"))

    def test_the_inserted_blob_is_a_ready_private_s3_row(self):
        blob = MagicMock()
        blob.name = "blob-9"
        with patch.object(frappe, "new_doc", return_value=blob):
            self.assertEqual(
                self.storage.insert_blob(key="ab/cd/x", checksum="x", size=12, mime_type="text/plain"),
                "blob-9",
            )

        blob.update.assert_called_once_with(
            {
                "key": "ab/cd/x",
                "checksum": "x",
                "file_size": 12,
                "mime_type": "text/plain",
                "driver": "s3",
                "is_private": 1,
                "status": "Ready",
            }
        )
        blob.insert.assert_called_once_with(ignore_permissions=True)


class StubClientError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


class TestBotoBucket(unittest.TestCase):
    def setUp(self):
        self.client = MagicMock()
        self.bucket = BotoBucket(
            SimpleNamespace(bucket="drive-bucket", client=self.client, _client_error=StubClientError)
        )

    def test_it_reads_the_legacy_key_verbatim(self):
        # `?path=/team/id` keeps its leading slash on the wire, so the copy has
        # to ask for the same key the live read asks for.
        self.client.get_object.return_value = {"Body": "stream"}
        self.assertEqual(self.bucket.open("/team/id"), "stream")
        self.client.get_object.assert_called_once_with(Bucket="drive-bucket", Key="/team/id")

    def test_a_missing_object_reads_as_file_not_found(self):
        self.client.get_object.side_effect = StubClientError("NoSuchKey")
        with self.assertRaises(FileNotFoundError):
            self.bucket.open("gone")

    def test_a_missing_object_has_no_size(self):
        self.client.head_object.side_effect = StubClientError("404")
        self.assertIsNone(self.bucket.size("gone"))

    def test_an_unrelated_s3_error_is_not_swallowed(self):
        self.client.head_object.side_effect = StubClientError("AccessDenied")
        with self.assertRaises(StubClientError):
            self.bucket.size("forbidden")

    def test_size_is_the_content_length(self):
        self.client.head_object.return_value = {"ContentLength": 42}
        self.assertEqual(self.bucket.size("k"), 42)

    def test_both_copies_stay_inside_one_bucket(self):
        self.bucket.copy_object("src", "dst")
        self.client.copy_object.assert_called_once_with(
            Bucket="drive-bucket", Key="dst", CopySource={"Bucket": "drive-bucket", "Key": "src"}
        )

        self.bucket.managed_copy("src", "dst")
        self.client.copy.assert_called_once_with(
            {"Bucket": "drive-bucket", "Key": "src"}, "drive-bucket", "dst"
        )


if __name__ == "__main__":
    unittest.main()
