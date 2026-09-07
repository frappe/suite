"""The real ports, checked against mocks of what they call.

The fakes elsewhere prove the rules; these prove the wiring, so a framework
rename or a stray column write shows up as a failing test and not as a bad
migration.
"""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import frappe

from suite.drive.patches.build.environment import BuildEnvironment, LegacyS3Config
from suite.drive.patches.build.ports import BlobConflict, BotoBucket, SiteFiles, SiteStorage
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

        self.assertEqual(
            get_all.call_args.kwargs["filters"],
            [
                ["blob", "is", "not set"],
                ["is_folder", "=", 0],
                ["name", ">", "after-me"],
                ["file_url", "like", S3_URL_PREFIX + "%"],
            ],
        )
        self.assertEqual(get_all.call_args.kwargs["order_by"], "name asc")
        self.assertEqual(get_all.call_args.kwargs["limit"], 1000)

    def test_a_narrowing_filter_reaches_both_queries(self):
        # A site-backed test uses this to stay off rows it did not create,
        # the way `frappe.storage.backfill.run` takes its own `filters`.
        files = SiteFiles(S3_URL_PREFIX, [["name", "like", "abc%"]])
        for call in (
            lambda: files.s3_rows_without_blob("", 10),
            lambda: files.rows_outside(("/files/",), "", 10),
        ):
            with patch.object(frappe, "get_all", return_value=[]) as get_all:
                call()
            self.assertIn(["name", "like", "abc%"], get_all.call_args.kwargs["filters"])

    def test_the_fetch_url_prefix_carries_no_like_wildcard(self):
        # `s3_rows_without_blob` appends "%" to this prefix unescaped.
        self.assertNotIn("%", S3_URL_PREFIX)
        self.assertNotIn("_", S3_URL_PREFIX)

    def test_the_residue_page_excludes_every_handled_prefix(self):
        with patch.object(frappe, "get_all", return_value=[]) as get_all:
            self.files.rows_outside(("/files/", S3_URL_PREFIX), "after-me", 500)

        filters = get_all.call_args.kwargs["filters"]
        self.assertEqual(
            filters,
            [
                ["blob", "is", "not set"],
                ["is_folder", "=", 0],
                ["name", ">", "after-me"],
                ["file_url", "not like", "/files/%"],
                ["file_url", "not like", S3_URL_PREFIX + "%"],
            ],
        )
        self.assertEqual(get_all.call_args.kwargs["order_by"], "name asc")
        self.assertEqual(get_all.call_args.kwargs["fields"], ["name", "file_url", "file_name", "file_type"])

    def test_a_row_with_no_file_url_reads_as_an_empty_string(self):
        rows = [frappe._dict(name="f1", file_url=None, file_name=None, file_type=None)]
        with patch.object(frappe, "get_all", return_value=rows):
            (row,) = self.files.s3_rows_without_blob("", 10)

        self.assertEqual(row.file_url, "")

    def test_a_batch_commits_only_outside_a_test_run(self):
        # Every resume claim rests on this call. Under the framework test
        # runner it must stay silent, or the class rollback loses its grip.
        previous = frappe.flags.in_test
        self.addCleanup(setattr, frappe.flags, "in_test", previous)
        for in_test, expected in ((False, 1), (True, 0)):
            with self.subTest(in_test=in_test):
                self.db.commit.reset_mock()
                frappe.flags.in_test = in_test
                self.files.commit()
                self.assertEqual(self.db.commit.call_count, expected)


class TestSiteStorage(StubbedDatabase):
    def setUp(self):
        super().setUp()
        self.storage = SiteStorage()

    def test_the_driver_name_and_config_are_the_site_config_keys(self):
        # The gate reads both; a wrong key name would refuse every S3 site.
        with patch.object(
            frappe, "conf", frappe._dict(storage_driver="s3", storage_driver_config={"bucket": "b"})
        ):
            self.assertEqual(self.storage.driver_name(), "s3")
            self.assertEqual(self.storage.driver_config(), {"bucket": "b"})

        with patch.object(frappe, "conf", frappe._dict()):
            self.assertEqual(self.storage.driver_name(), "")
            self.assertEqual(self.storage.driver_config(), {})

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
        self.db.get_value.return_value = frappe._dict(name="blob-1", key="ab/cd/x")
        with patch("frappe.storage.blob.revive_blob", return_value=True) as revive:
            claimed = self.storage.claim_blob("abc")

        # The key comes back too: a Ready row is not proof that its object
        # is still in the bucket, and only the caller can head it.
        self.assertEqual((claimed.name, claimed.key), ("blob-1", "ab/cd/x"))
        self.db.get_value.assert_called_once_with(
            "File Blob",
            {"checksum": "abc", "is_private": 1, "driver": "s3", "status": "Ready"},
            ["name", "key"],
            as_dict=True,
        )
        revive.assert_called_once_with("blob-1")

    def test_a_blob_the_gc_already_took_is_not_claimed(self):
        self.db.get_value.return_value = frappe._dict(name="blob-1", key="ab/cd/x")
        with patch("frappe.storage.blob.revive_blob", return_value=False):
            self.assertIsNone(self.storage.claim_blob("abc"))

    def test_the_blocking_row_is_looked_up_without_the_status_filter(self):
        # The unique index is (checksum, is_private, driver); a Pending row
        # blocks the insert, and the run has to say so instead of dying.
        self.db.get_value.return_value = "Pending"
        self.assertEqual(self.storage.blocked_by("abc"), "Pending")
        self.db.get_value.assert_called_once_with(
            "File Blob", {"checksum": "abc", "is_private": 1, "driver": "s3"}, "status"
        )

    # Above the signed `int(11)` ceiling the column used to carry, and above
    # the 5 GB single-part copy limit. This port is the only thing that
    # writes `File Blob.file_size`, so a narrowing cast belongs here.
    LARGE_SIZE = 6 * 1024**3

    def test_the_inserted_blob_is_a_ready_private_s3_row(self):
        blob = MagicMock()
        blob.name = "blob-9"
        with patch.object(frappe, "new_doc", return_value=blob):
            self.assertEqual(
                self.storage.insert_blob(
                    key="ab/cd/x", checksum="x", size=self.LARGE_SIZE, mime_type="text/plain"
                ),
                "blob-9",
            )

        blob.update.assert_called_once_with(
            {
                "key": "ab/cd/x",
                "checksum": "x",
                "file_size": self.LARGE_SIZE,
                "mime_type": "text/plain",
                "driver": "s3",
                "is_private": 1,
                "status": "Ready",
            }
        )
        blob.insert.assert_called_once_with(ignore_permissions=True)

    def test_the_insert_is_wrapped_in_a_savepoint(self):
        blob = MagicMock()
        blob.name = "blob-9"
        with patch.object(frappe, "new_doc", return_value=blob):
            self.storage.insert_blob(key="ab/cd/x", checksum="x", size=12, mime_type="text/plain")

        # Released, not rolled back: a clean insert must leave the batch's
        # own transaction alone.
        self.db.savepoint.assert_called_once_with("drive_build_insert_blob")
        self.db.release_savepoint.assert_called_once_with("drive_build_insert_blob")
        self.db.rollback.assert_not_called()

    def test_a_conflict_rolls_back_to_the_savepoint_before_it_is_reported(self):
        # Postgres aborts the whole transaction on a unique violation, so
        # without this rollback the next statement in the batch dies and
        # `BlobConflict` never gets to mean "carry on".
        blob = MagicMock()
        blob.insert.side_effect = frappe.UniqueValidationError("File Blob")
        with patch.object(frappe, "new_doc", return_value=blob):
            with self.assertRaises(BlobConflict):
                self.storage.insert_blob(key="ab/cd/x", checksum="x", size=12, mime_type="text/plain")

        self.db.rollback.assert_called_once_with(save_point="drive_build_insert_blob")
        self.db.release_savepoint.assert_not_called()


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

    def test_it_never_writes_or_deletes_through_the_client(self):
        # The whole copy path, then a check that only reads and copies ran.
        self.client.get_object.return_value = {"Body": "stream"}
        self.client.head_object.return_value = {"ContentLength": 3}
        self.bucket.open("src")
        self.bucket.size("src")
        self.bucket.copy_object("src", "dst")
        self.bucket.managed_copy("src", "dst")

        for forbidden in (
            "delete_object",
            "delete_objects",
            "put_object",
            "upload_file",
            "upload_fileobj",
        ):
            self.assertEqual(getattr(self.client, forbidden).call_count, 0, forbidden)

    def test_both_copies_stay_inside_one_bucket(self):
        self.bucket.copy_object("src", "dst")
        self.client.copy_object.assert_called_once_with(
            Bucket="drive-bucket", Key="dst", CopySource={"Bucket": "drive-bucket", "Key": "src"}
        )

        self.bucket.managed_copy("src", "dst")
        self.client.copy.assert_called_once_with(
            {"Bucket": "drive-bucket", "Key": "src"}, "drive-bucket", "dst"
        )


class TestTheSiteWiring(StubbedDatabase):
    """`for_site` and `from_site` are the lines a framework rename breaks.

    Nothing else executes them: `test_build_storage` builds the environment
    by hand, so a wrong `Drive Disk Settings` field or a bad `get_driver`
    call would ship silently.
    """

    def test_the_legacy_settings_come_from_drive_disk_settings(self):
        settings = frappe._dict(enabled=1, bucket="drive-bucket", endpoint_url="https://minio/")
        with patch.object(frappe, "get_single", return_value=settings) as get_single:
            config = LegacyS3Config.for_site()

        get_single.assert_called_once_with("Drive Disk Settings")
        self.assertEqual(
            (config.enabled, config.bucket, config.endpoint_url),
            (True, "drive-bucket", "https://minio/"),
        )

    def test_an_unset_bucket_and_endpoint_read_as_empty_strings(self):
        settings = frappe._dict(enabled=0, bucket=None, endpoint_url=None)
        with patch.object(frappe, "get_single", return_value=settings):
            config = LegacyS3Config.for_site()

        self.assertEqual((config.enabled, config.bucket, config.endpoint_url), (False, "", ""))

    def test_the_bucket_is_the_frameworks_own_s3_driver(self):
        driver = SimpleNamespace(bucket="drive-bucket", client=object(), _client_error=ValueError)
        with patch("frappe.storage.driver.get_driver", return_value=driver) as get_driver:
            bucket = BotoBucket.from_site()

        get_driver.assert_called_once_with("s3")
        self.assertEqual(bucket.bucket, "drive-bucket")
        self.assertIs(bucket.client, driver.client)

    def test_the_environment_defers_building_the_driver(self):
        # Constructing the driver makes a boto3 client, and the gate has to
        # be able to refuse a misconfigured site before that happens.
        settings = frappe._dict(enabled=1, bucket="b", endpoint_url="")
        with (
            patch.object(frappe, "get_single", return_value=settings),
            patch("frappe.storage.driver.get_driver") as get_driver,
            patch("frappe.get_site_path", return_value="/tmp/x/private/state.json"),
        ):
            env = BuildEnvironment.for_site()

        get_driver.assert_not_called()
        self.assertIs(env.open_bucket.__func__, BotoBucket.from_site.__func__)

    def test_a_site_with_no_bucket_factory_says_so(self):
        env = BuildEnvironment(
            storage=SiteStorage(), files=SiteFiles(S3_URL_PREFIX), state=None, open_bucket=None
        )
        with self.assertRaises(RuntimeError) as caught:
            env.bucket()
        self.assertIn("no S3 bucket", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
