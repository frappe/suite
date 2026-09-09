"""The real ports, checked against mocks of what they call.

The fakes elsewhere prove the rules; these prove the wiring, so a framework
rename or a stray column write shows up as a failing test and not as a bad
migration. Where a fake copies a database constraint rather than a rule,
the check that it still copies it belongs here too, beside the port it
stands in for.
"""

import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import frappe

from suite.drive._core.roles import MANAGE, NONE
from suite.drive.patches.build.environment import BuildEnvironment, LegacyS3Config
from suite.drive.patches.build.ports import (
    ACTIVE,
    GRANT_COLUMNS,
    NODE_COLUMNS,
    NODE_READ_COLUMNS,
    ROOT_COLUMNS,
    ROOT_READ_COLUMNS,
    BlobConflict,
    BotoBucket,
    SiteContentSource,
    SiteContentTarget,
    SiteDrive,
    SiteFiles,
    SiteStorage,
    SiteTree,
    TreeRow,
)
from suite.drive.patches.build.tests.fakes import FakeDrive
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


class TestTreeRow(unittest.TestCase):
    def test_a_legacy_row_is_read_column_by_column(self):
        row = frappe._dict(name="f1", file_name="a.txt", folder="F", status=None, unmapped="x")

        made = TreeRow.of(row)

        self.assertEqual((made.name, made.file_name, made.folder), ("f1", "a.txt", "F"))
        # A NULL column keeps the dataclass default instead of becoming None,
        # which is what makes `status` read as Active on an old row that has
        # none. A column outside §14.4's map is not carried over at all.
        self.assertEqual(made.status, ACTIVE)
        self.assertFalse(hasattr(made, "unmapped"))


class TestSiteTree(StubbedDatabase):
    """The hand-written SQL, rendered and bound without a database.

    Only a site proves it runs. These prove what it says, which is where
    the tuple parameter and the missing prefix clauses were hiding.
    """

    def sql_call(self):
        """The `frappe.db.sql` call as `(one-line query, values)`."""
        query, values = self.db.sql.call_args.args[:2]
        return " ".join(query.split()), values

    def test_the_child_page_binds_one_placeholder_per_parent(self):
        self.db.sql.return_value = []
        SiteTree().children(("a", "b", "c"), ("", ""), 100)

        query, values = self.sql_call()
        self.assertIn("`folder` IN (%(parent0)s, %(parent1)s, %(parent2)s)", query)
        self.assertEqual(
            values,
            {"folder": "", "name": "", "limit": 100, "parent0": "a", "parent1": "b", "parent2": "c"},
        )
        # A tuple bound to one placeholder is what frappe's SQLite backend
        # string-formats into `IN '('a', 'b')'`, which will not parse.
        for key, value in values.items():
            with self.subTest(key=key):
                self.assertNotIsInstance(value, tuple)

    def test_no_parents_asks_nothing(self):
        self.assertEqual(SiteTree().children((), ("", ""), 10), [])
        self.db.sql.assert_not_called()

    def test_the_child_page_keysets_on_folder_then_name(self):
        self.db.sql.return_value = []
        SiteTree().children(("a",), ("F", "n1"), 10)

        query, values = self.sql_call()
        self.assertIn(
            "(`folder` > %(folder)s OR (`folder` = %(folder)s AND `name` > %(name)s))",
            query,
        )
        self.assertIn("ORDER BY `folder`, `name` LIMIT %(limit)s", query)
        self.assertEqual((values["folder"], values["name"]), ("F", "n1"))

    def test_a_prefix_narrows_the_child_page(self):
        self.db.sql.return_value = []
        SiteTree("bld").children(("a",), ("", ""), 10)

        query, values = self.sql_call()
        self.assertIn("AND `name` LIKE %(build_name_prefix)s", query)
        self.assertEqual(values["build_name_prefix"], "bld%")

    def test_the_unreached_join_finds_files_with_no_node(self):
        self.db.sql.return_value = []
        SiteTree("bld").unreached("after-me", 50)

        query, values = self.sql_call()
        self.assertIn("LEFT JOIN `tabDrive Node` n ON n.`name` = f.`name`", query)
        self.assertIn("WHERE n.`name` IS NULL AND f.`name` > %(after)s", query)
        self.assertIn("AND f.`name` LIKE %(build_name_prefix)s", query)
        self.assertEqual(values, {"after": "after-me", "limit": 50, "build_name_prefix": "bld%"})

    def test_the_permission_page_keysets_on_the_compound_key(self):
        self.db.sql.return_value = []
        SiteTree().permissions(("e1", "u1", "n1"), 500)

        query, values = self.sql_call()
        self.assertIn("(`entity`, `user`, `name`) > (%(entity)s, %(user)s, %(name)s)", query)
        self.assertIn("ORDER BY `entity`, `user`, `name` LIMIT %(limit)s", query)
        # Production passes no prefix, so the read stays exactly what it was.
        self.assertNotIn("LIKE", query)
        self.assertEqual(values, {"entity": "e1", "user": "u1", "name": "n1", "limit": 500})

    def test_a_prefix_narrows_the_permission_page_on_entity(self):
        # `entity` links `File.name`, so this is the same prefix the `File`
        # reads use. Without it a site-backed run pages every permission row
        # on the site and writes grants outside its own cleanup net.
        self.db.sql.return_value = []
        SiteTree("bld").permissions(("", "", ""), 10)

        query, values = self.sql_call()
        self.assertIn("AND `entity` LIKE %(build_name_prefix)s", query)
        self.assertEqual(values["build_name_prefix"], "bld%")

    def test_a_permission_row_reads_its_flags_as_integers(self):
        self.db.sql.return_value = [
            frappe._dict(name="p1", entity="f1", user=None, read=1, comment=None, share=0, creation=None)
        ]
        (row,) = SiteTree().permissions(("", "", ""), 10)

        self.assertEqual((row.user, row.read, row.comment, row.creation), ("", 1, 0, ""))

    def test_the_prefix_narrows_the_sheet_lookup(self):
        self.db.get_value.return_value = None
        SiteTree("bld").sheet_entity("sheet-1")

        self.assertEqual(
            self.db.get_value.call_args.args[1],
            [
                ["content_doctype", "=", "Sheet"],
                ["content_docname", "=", "sheet-1"],
                ["name", "like", "bld%"],
            ],
        )

    def test_the_prefix_narrows_the_composite_deck_lookup(self):
        self.db.get_value.return_value = None
        self.assertFalse(SiteTree("bld").is_composite_deck("f1"))

        self.assertEqual(self.db.get_value.call_args.args[1], [["name", "=", "f1"], ["name", "like", "bld%"]])

    def test_production_reads_both_lookups_unnarrowed(self):
        self.db.get_value.return_value = None
        SiteTree().sheet_entity("sheet-1")
        self.assertEqual(
            self.db.get_value.call_args.args[1],
            [["content_doctype", "=", "Sheet"], ["content_docname", "=", "sheet-1"]],
        )

        SiteTree().is_composite_deck("f1")
        self.assertEqual(self.db.get_value.call_args.args[1], [["name", "=", "f1"]])

    def test_the_docshare_page_reads_sheet_shares_in_name_order(self):
        with patch.object(frappe, "get_all", return_value=[]) as get_all:
            SiteTree("bld").docshares("after-me", 25)

        # No prefix clause: a `DocShare` names a `Sheet`, not a `File`.
        self.assertEqual(
            get_all.call_args.kwargs["filters"],
            [["share_doctype", "=", "Sheet"], ["name", ">", "after-me"]],
        )
        self.assertEqual(get_all.call_args.kwargs["order_by"], "name asc")
        self.assertEqual(get_all.call_args.kwargs["limit"], 25)


# One root pair, in the shape `root_pairs` hands it over: only the columns
# that row decides. Everything else is `_values`' job to default.
PAIR_NODE = {"name": "n1", "title": "Report", "kind": "root", "owner": "a@b.co"}
PAIR_METADATA = {"name": "n1", "node": "n1", "kind": "Personal", "user": "a@b.co", "state": ACTIVE}
PAIR_GRANT = {"name": "g1", "node": "n1", "principal": "a@b.co", "role": MANAGE}


class TestSiteDrive(StubbedDatabase):
    """The three bulk inserts and the reads that resume them."""

    def setUp(self):
        super().setUp()
        self.drive = SiteDrive()

    def inserted(self):
        """`(doctype, fields, values)` for each `bulk_insert` call, in order."""
        return [
            (call.args[0], call.kwargs["fields"], call.kwargs["values"])
            for call in self.db.bulk_insert.call_args_list
        ]

    # -- the pair, and its savepoint

    def test_a_root_pair_goes_in_node_then_metadata_then_anchors(self):
        self.drive.write_root_pair(PAIR_NODE, PAIR_METADATA, [PAIR_GRANT])

        self.assertEqual([row[0] for row in self.inserted()], ["Drive Node", "Drive Root", "Drive Grant"])

    def test_a_clean_pair_releases_its_savepoint(self):
        self.drive.write_root_pair(PAIR_NODE, PAIR_METADATA, [PAIR_GRANT])

        # Released, not rolled back: the batch's own transaction is not this
        # method's to undo.
        self.db.savepoint.assert_called_once_with("drive_build_root_pair")
        self.db.release_savepoint.assert_called_once_with("drive_build_root_pair")
        self.db.rollback.assert_not_called()

    def test_a_failed_metadata_insert_rolls_the_whole_pair_back(self):
        # §3.2: "Publish no partial pair." The node half is already in when
        # the metadata insert dies, so the rollback is the only thing between
        # a killed run and a root node no metadata describes.
        def fail_on_metadata(doctype, **kwargs):
            if doctype == "Drive Root":
                raise ValueError("duplicate primary key")

        self.db.bulk_insert.side_effect = fail_on_metadata
        with self.assertRaises(ValueError):
            self.drive.write_root_pair(PAIR_NODE, PAIR_METADATA, [PAIR_GRANT])

        self.db.rollback.assert_called_once_with(save_point="drive_build_root_pair")
        self.db.release_savepoint.assert_not_called()

    def test_a_mariadb_deadlock_keeps_the_original_error_when_the_savepoint_is_gone(self):
        deadlock = frappe.QueryDeadlockError("deadlock victim")
        self.db.bulk_insert.side_effect = deadlock
        self.db.rollback.side_effect = [RuntimeError("savepoint was rolled back"), None]

        with self.assertRaises(frappe.QueryDeadlockError) as caught:
            self.drive.write_root_pair(PAIR_NODE, PAIR_METADATA, [PAIR_GRANT])

        self.assertIs(caught.exception, deadlock)
        self.assertEqual(self.db.rollback.call_args_list[0].kwargs, {"save_point": "drive_build_root_pair"})
        self.assertEqual(self.db.rollback.call_args_list[1].args, ())

    def test_a_repaired_pair_writes_only_its_missing_half(self):
        self.drive.write_root_pair(None, PAIR_METADATA, [])

        self.assertEqual([row[0] for row in self.inserted()], ["Drive Root"])

    def test_the_metadata_row_fills_every_root_column(self):
        self.drive.write_root_pair(None, PAIR_METADATA, [])

        (_, fields, values) = self.inserted()[0]
        self.assertEqual(fields, list(ROOT_COLUMNS))
        (row,) = values
        self.assertEqual(row[ROOT_COLUMNS.index("name")], "n1")
        self.assertEqual(row[ROOT_COLUMNS.index("user")], "a@b.co")
        self.assertIsNone(row[ROOT_COLUMNS.index("used_bytes")])

    # -- the bulk inserts

    def test_the_node_insert_names_every_column_and_orders_the_row(self):
        self.drive.insert_nodes([dict(PAIR_NODE)])

        (doctype, fields, values) = self.inserted()[0]
        self.assertEqual(doctype, "Drive Node")
        self.assertEqual(fields, list(NODE_COLUMNS))
        (row,) = values
        self.assertEqual(len(row), len(NODE_COLUMNS))
        self.assertEqual(row[NODE_COLUMNS.index("title")], "Report")
        self.assertEqual(row[NODE_COLUMNS.index("owner")], "a@b.co")
        # A column the caller does not name goes in as NULL, not as its
        # neighbour's value shifted one place along.
        self.assertIsNone(row[NODE_COLUMNS.index("parent")])

    def test_the_grant_insert_names_every_column_and_orders_the_row(self):
        self.drive.insert_grants([dict(PAIR_GRANT)])

        (doctype, fields, values) = self.inserted()[0]
        self.assertEqual(doctype, "Drive Grant")
        self.assertEqual(fields, list(GRANT_COLUMNS))
        (row,) = values
        self.assertEqual(len(row), len(GRANT_COLUMNS))
        self.assertEqual(row[GRANT_COLUMNS.index("principal")], "a@b.co")
        self.assertEqual(row[GRANT_COLUMNS.index("role")], MANAGE)
        self.assertIsNone(row[GRANT_COLUMNS.index("expires_on")])

    def test_an_empty_batch_writes_nothing(self):
        self.drive.insert_nodes([])
        self.drive.insert_grants([])

        self.db.bulk_insert.assert_not_called()

    # -- the reads a rerun depends on

    def test_the_resume_read_asks_only_for_the_columns_it_uses(self):
        with patch.object(frappe, "get_all", return_value=[frappe._dict(name="n1", title="t")]) as get_all:
            self.assertEqual(self.drive.nodes(("n1",)), {"n1": {"name": "n1", "title": "t"}})

        self.assertEqual(get_all.call_args.kwargs["fields"], list(NODE_READ_COLUMNS))
        self.assertEqual(get_all.call_args.kwargs["filters"], [["name", "in", ["n1"]]])

    def test_the_metadata_read_asks_for_the_primary_key_first(self):
        row = frappe._dict(name="n1", node="n1", user="a@b.co", kind="Personal", state=ACTIVE)
        self.db.get_value.return_value = row

        self.assertEqual(self.drive.root_metadata("n1"), dict(row))
        self.db.get_value.assert_called_once_with("Drive Root", "n1", list(ROOT_READ_COLUMNS), as_dict=True)

    def test_a_row_named_this_id_is_found_even_when_its_node_points_away(self):
        # `autoname: field:node` (§3.2) makes `name` the id Build is about to
        # write. A row named it whose `node` column points elsewhere is
        # invisible to the `node` read, and the insert then dies on a
        # duplicate primary key on this run and on every rerun after it.
        squatter = frappe._dict(name="n1", node="elsewhere", user=None, kind="Shared", state=ACTIVE)
        self.db.get_value.side_effect = [None, squatter]

        self.assertEqual(self.drive.root_metadata("n1"), dict(squatter))
        self.assertEqual(self.db.get_value.call_args_list[1].args[1], {"node": "n1"})

    def test_no_metadata_either_way_reads_as_none(self):
        self.db.get_value.return_value = None

        self.assertIsNone(self.drive.root_metadata("n1"))
        self.assertEqual(self.db.get_value.call_count, 2)

    def test_the_active_personal_roots_are_read_by_user_kind_and_state(self):
        # The same filter `_core/roots.py active_root_for` uses. A `User`
        # insert already provisions a Personal root at a fresh node id, so
        # Build has to be able to see one before it writes a second.
        self.db.get_values.return_value = ["other-node", "second-node"]

        self.assertEqual(
            self.drive.active_roots("Personal", "a@b.co"),
            ("other-node", "second-node"),
        )

        self.db.get_values.assert_called_once_with(
            "Drive Root",
            {"kind": "Personal", "state": ACTIVE, "user": "a@b.co"},
            "node",
            order_by="node asc",
            for_update=True,
            pluck=True,
        )

    def test_the_active_shared_root_query_names_no_user(self):
        self.db.get_values.return_value = []

        self.assertEqual(self.drive.active_roots("Shared", None), ())

        self.db.get_values.assert_called_once_with(
            "Drive Root",
            {"kind": "Shared", "state": ACTIVE},
            "node",
            order_by="node asc",
            for_update=True,
            pluck=True,
        )

    def test_a_personal_identity_locks_the_stable_user_row(self):
        self.drive.lock_root_identity("Personal", "a@b.co")

        self.db.get_value.assert_called_once_with("User", "a@b.co", "name", for_update=True)

    def test_a_shared_identity_locks_the_stable_doctype_row(self):
        self.drive.lock_root_identity("Shared", None)

        self.db.get_value.assert_called_once_with("DocType", "Drive Root", "name", for_update=True)

    def test_the_stored_roles_come_back_as_integers(self):
        rows = [frappe._dict(principal="a@b.co", role="30")]
        with patch.object(frappe, "get_all", return_value=rows) as get_all:
            self.assertEqual(self.drive.grant_roles("n1", ("a@b.co",)), {"a@b.co": 30})

        self.assertEqual(
            get_all.call_args.kwargs["filters"],
            [["node", "=", "n1"], ["principal", "in", ["a@b.co"]]],
        )

    def test_the_link_grant_probe_is_a_prefix_match_above_none(self):
        # Link minting resumes on this. A probe that also matched a stored
        # deny would hand out a second token for a row that already has one.
        self.db.exists.return_value = "g1"

        self.assertTrue(self.drive.has_link_grant("n1"))
        self.db.exists.assert_called_once_with(
            "Drive Grant", {"node": "n1", "principal": ["like", "$LINK:%"], "role": [">", NONE]}
        )

    def test_raising_a_grant_moves_the_role_and_not_the_stamp(self):
        self.db.get_value.return_value = "g1"

        self.drive.raise_grant("n1", "a@b.co", MANAGE)

        self.db.get_value.assert_called_once_with(
            "Drive Grant", {"node": "n1", "principal": "a@b.co"}, "name"
        )
        self.db.set_value.assert_called_once_with("Drive Grant", "g1", "role", MANAGE, update_modified=False)

    def test_raising_a_grant_that_is_not_there_writes_nothing(self):
        self.db.get_value.return_value = None

        self.drive.raise_grant("n1", "a@b.co", MANAGE)

        self.db.set_value.assert_not_called()

    def test_a_batch_commits_only_outside_a_test_run(self):
        previous = frappe.flags.in_test
        self.addCleanup(setattr, frappe.flags, "in_test", previous)
        for in_test, expected in ((False, 1), (True, 0)):
            with self.subTest(in_test=in_test):
                self.db.commit.reset_mock()
                frappe.flags.in_test = in_test
                self.drive.commit()
                self.assertEqual(self.db.commit.call_count, expected)


class TestFakeDriveKeys(unittest.TestCase):
    """The `Drive Root` keys `FakeDrive` copies off the real table.

    A double that lets two metadata rows share one name, or one node, hides
    the bug it exists to catch: `bulk_insert` bypasses every controller, so
    the two indexes are all that is left (§3.2).
    """

    def setUp(self):
        self.drive = FakeDrive()
        self.drive.write_root_pair({"name": "n1", "title": "Mine", "kind": "root"}, dict(PAIR_METADATA), [])

    def test_a_second_row_for_one_name_raises(self):
        with self.assertRaises(ValueError):
            self.drive.write_root_pair(None, dict(PAIR_METADATA), [])

    def test_a_second_row_claiming_one_node_raises(self):
        # `unique: 1` on `node`. A different name is not a different row.
        with self.assertRaises(ValueError):
            self.drive.write_root_pair(None, {**PAIR_METADATA, "name": "other"}, [])

    def test_a_refused_metadata_row_takes_its_node_half_with_it(self):
        with self.assertRaises(ValueError):
            self.drive.write_root_pair(
                {"name": "n2", "title": "Theirs", "kind": "root"}, {**PAIR_METADATA, "name": "n2"}, []
            )

        self.assertEqual(self.drive.node_ids(), {"n1"})

    def test_the_active_root_read_answers_per_identity(self):
        self.assertEqual(self.drive.active_roots("Personal", "a@b.co"), ("n1",))
        self.assertEqual(self.drive.active_roots("Personal", "nobody@example.com"), ())
        self.assertEqual(self.drive.active_roots("Shared", None), ())

    def test_an_archived_row_is_not_an_active_root(self):
        self.drive.write_root_pair(
            {"name": "n2", "title": "Old", "kind": "root"},
            {"name": "n2", "node": "n2", "kind": "Shared", "user": None, "state": "Archived"},
            [],
        )

        self.assertEqual(self.drive.active_roots("Shared", None), ())


class TestSiteContentTarget(StubbedDatabase):
    """The wiring ticket 28 writes through, checked without a connection."""

    def setUp(self):
        super().setUp()
        self.target = SiteContentTarget()

    def test_root_metadata_tries_the_primary_key_before_the_node_column(self):
        self.db.get_value.return_value = {"name": "root-1", "node": "root-1"}

        found = self.target.root_metadata("root-1")

        # §3.2 names a `Drive Root` after its node. A row named this id whose
        # `node` column points elsewhere is invisible to the filter read, and
        # Build would then insert a duplicate primary key on every run.
        first = self.db.get_value.call_args_list[0]
        self.assertEqual(first.args[1], "root-1")
        self.assertEqual(found["name"], "root-1")

    def test_root_metadata_falls_back_to_the_node_column(self):
        self.db.get_value.side_effect = [None, {"name": "other", "node": "root-1"}]

        found = self.target.root_metadata("root-1")

        self.assertEqual(self.db.get_value.call_args_list[1].args[1], {"node": "root-1"})
        self.assertEqual(found["node"], "root-1")

    def test_the_personal_root_reads_lock_the_user_and_stay_current(self):
        self.db.get_values.return_value = []

        self.target.lock_root_identity("owner@example.com")
        self.target.active_roots("owner@example.com")
        self.target.personal_roots("owner@example.com")

        # Postgres cannot lock a root row that does not exist yet, so the
        # User row is the identity both creators lock, and the reads behind
        # it must be current or Build mints a second Active Personal Root.
        self.db.get_value.assert_called_once_with("User", "owner@example.com", "name", for_update=True)
        for call in self.db.get_values.call_args_list:
            self.assertTrue(call.kwargs["for_update"])
            self.assertEqual(call.kwargs["order_by"], "name asc")

    def test_a_deadlocked_unit_keeps_the_original_error_and_resets(self):
        deadlock = frappe.QueryDeadlockError("victim")

        def rollback(save_point=None):
            if save_point:
                raise Exception("savepoint does not exist")

        self.db.rollback.side_effect = rollback

        def fail():
            raise deadlock

        with self.assertRaises(frappe.QueryDeadlockError):
            self.target._unit("drive_build_unit", fail)

        # InnoDB already rolled the victim back, savepoints included. The
        # narrow rollback raises over the original error, and the shared
        # helper answers that with a full rollback.
        self.assertIn(((),), [(call.args,) for call in self.db.rollback.call_args_list])


class TestSiteContentSource(StubbedDatabase):
    def test_the_residual_version_sample_is_ordered(self):
        with patch.object(frappe, "get_all", return_value=[]) as get_all:
            SiteContentSource().residual_writer_versions(20)

        # These ids are the sample §14.9 prints. An unordered `LIMIT 20`
        # names different rows on every run.
        self.assertEqual(get_all.call_args.kwargs["order_by"], "name asc")


class TestSiteContentHistory(StubbedDatabase):
    """The ticket 28 history reads, rendered without a database.

    Both source pages carry whole document bodies, so what matters here is
    that the SQL really is a bounded keyset page and not a full read with a
    cursor bolted on.
    """

    def setUp(self):
        super().setUp()
        self.source = SiteContentSource()
        self.db.sql.return_value = []

    def test_the_writer_version_page_is_a_bounded_creation_name_keyset(self):
        self.source.writer_versions("doc-1", ("2024-01-01 00:00:00", "v-3"), 250)

        query, values = self.db.sql.call_args.args[0], self.db.sql.call_args.args[1]
        self.assertIn("`doc` = %(doc)s", query)
        self.assertIn("(`creation`, `name`) > (%(creation)s, %(name)s)", query)
        self.assertIn("ORDER BY `creation`, `name` LIMIT %(limit)s", query)
        self.assertEqual(
            values, {"doc": "doc-1", "creation": "2024-01-01 00:00:00", "name": "v-3", "limit": 250}
        )

    def test_the_first_writer_page_starts_below_every_stored_stamp(self):
        # An empty cursor must not compare as a string above a real datetime,
        # or the first page would skip the whole document.
        self.source.writer_versions("doc-1", ("", ""), 10)

        self.assertEqual(self.db.sql.call_args.args[1]["creation"], "1000-01-01")

    def test_the_sheet_snapshot_page_is_a_bounded_seq_name_keyset(self):
        self.source.sheet_snapshots("sheet-1", (7, "s-2"), 100)

        query, values = self.db.sql.call_args.args[0], self.db.sql.call_args.args[1]
        self.assertIn("`sheet` = %(sheet)s", query)
        self.assertIn("(`seq`, `name`) > (%(seq)s, %(name)s)", query)
        self.assertIn("ORDER BY `seq`, `name` LIMIT %(limit)s", query)
        self.assertEqual(values, {"sheet": "sheet-1", "seq": 7, "name": "s-2", "limit": 100})
        # `sheets_data` is the 75 MB column, so it is read one page at a time.
        self.assertIn("`sheets_data`", query)

    def test_every_column_the_history_pages_filter_on_is_indexed(self):
        """Ticket 31: the page reads a Link column, so that column needs an index.

        Without it MariaDB scans the `creation` index end to end for every
        document. On the rehearsal restore that was 45 s a page over 142,530
        rows, once per Writer Document.
        """
        for doctype, path, column in (
            ("Writer Version", ("writer", "writer_version"), "doc"),
            ("Sheet Snapshot", ("sheets", "sheet_snapshot"), "sheet"),
        ):
            with self.subTest(doctype=doctype):
                folder, name = path
                schema = Path(__file__).parents[4] / folder / "doctype" / name / f"{name}.json"
                fields = {field["fieldname"]: field for field in json.loads(schema.read_text())["fields"]}
                self.assertEqual(fields[column].get("search_index"), 1)


class TestGrantPairs(StubbedDatabase):
    """The batched grant read the share mapper uses."""

    def setUp(self):
        super().setUp()
        self.target = SiteContentTarget()

    def test_one_read_names_every_node_and_keeps_only_the_pairs_asked_for(self):
        pairs = (("node-a", "u1@example.com"), ("node-b", "u2@example.com"))
        rows = [
            frappe._dict(node="node-a", principal="u1@example.com", role=8),
            # The cross product also matches this stored grant. It was not
            # asked for, so merging it would move a role nobody shared.
            frappe._dict(node="node-b", principal="u1@example.com", role=1),
        ]
        calls = []

        def get_all(doctype, **kwargs):
            calls.append((doctype, kwargs))
            return rows

        with patch.object(frappe, "get_all", get_all):
            found = self.target.grant_pairs(pairs)

        self.assertEqual(found, {("node-a", "u1@example.com"): 8})
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1]["filters"][0], ["node", "in", ["node-a", "node-b"]])
        self.assertEqual(calls[0][1]["filters"][1], ["principal", "in", ["u1@example.com", "u2@example.com"]])

    def test_the_node_list_is_paged_so_neither_in_list_grows_without_bound(self):
        pairs = tuple((f"node-{index:03d}", f"u{index}@example.com") for index in range(250))
        calls = []

        def get_all(doctype, **kwargs):
            calls.append(kwargs)
            return []

        with patch.object(frappe, "get_all", get_all):
            self.assertEqual(self.target.grant_pairs(pairs), {})

        self.assertEqual(len(calls), 3)
        self.assertEqual([len(call["filters"][0][2]) for call in calls], [100, 100, 50])
        # Each page names only its own nodes' principals.
        self.assertEqual([len(call["filters"][1][2]) for call in calls], [100, 100, 50])

    def test_an_empty_batch_reads_nothing(self):
        with patch.object(frappe, "get_all", side_effect=AssertionError("read")):
            self.assertEqual(self.target.grant_pairs(()), {})


class TestSiteContentMedia(StubbedDatabase):
    """The ticket 28 Slides reads.

    `elements` is a whole slide body, so these must be bounded pages even
    though the caller holds one deck at a time to preflight it.
    """

    def setUp(self):
        super().setUp()
        self.source = SiteContentSource()
        self.db.sql.return_value = []

    def test_the_slide_page_is_a_bounded_idx_name_keyset(self):
        self.source.slides("deck-1", (3, "slide-2"), 250)

        query, values = self.db.sql.call_args.args[0], self.db.sql.call_args.args[1]
        self.assertIn("`parent` = %(deck)s AND `parenttype` = 'Presentation'", query)
        self.assertIn("(`idx`, `name`) > (%(idx)s, %(name)s)", query)
        self.assertIn("ORDER BY `idx`, `name` LIMIT %(limit)s", query)
        self.assertIn("`elements`", query)
        self.assertEqual(values, {"deck": "deck-1", "idx": 3, "name": "slide-2", "limit": 250})

    def test_the_media_file_page_is_a_bounded_creation_name_keyset(self):
        self.source.media_files("deck-1", ("2024-01-01 00:00:00", "file-3"), 100)

        query, values = self.db.sql.call_args.args[0], self.db.sql.call_args.args[1]
        self.assertIn("`attached_to_doctype` = 'Presentation'", query)
        self.assertIn("(`creation`, `name`) > (%(creation)s, %(name)s)", query)
        self.assertIn("ORDER BY `creation`, `name` LIMIT %(limit)s", query)
        self.assertEqual(
            values,
            {"deck": "deck-1", "creation": "2024-01-01 00:00:00", "name": "file-3", "limit": 100},
        )

    def test_the_first_media_page_starts_below_every_stored_stamp(self):
        self.source.media_files("deck-1", ("", ""), 10)

        self.assertEqual(self.db.sql.call_args.args[1]["creation"], "1000-01-01")


class TestVersionsToThin(StubbedDatabase):
    def setUp(self):
        super().setUp()
        self.target = SiteContentTarget()

    def test_the_census_reads_pages_of_nodes_not_one_query_per_node(self):
        # After Build every migrated document carries auto versions, so a
        # per-node query is one round trip per document on the site.
        nodes = [f"node-{index}" for index in range(3)]
        rows = [
            frappe._dict(name=f"v-{node}", node=node, seq=1, creation="2020-01-01", size=10) for node in nodes
        ]
        calls = []

        def get_all(doctype, **kwargs):
            calls.append(kwargs)
            if kwargs.get("pluck") == "node":
                return nodes if len(calls) == 1 else []
            return rows

        with (
            patch.object(frappe, "get_all", side_effect=get_all),
            patch("suite.drive._core.versions._pick_deletions", return_value=["a", "b"]) as picked,
        ):
            total = self.target.versions_to_thin("2024-04-01 00:00:00")

        self.assertEqual(total, 6)
        # One node page and one row page. A short page ends the walk, so the
        # three nodes cost two round trips instead of four.
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1]["filters"][2], ["node", "in", nodes])
        self.assertEqual(picked.call_count, 3)
        # Each node is projected against only its own rows.
        self.assertEqual([call.args[0] for call in picked.call_args_list], [[row] for row in rows])


if __name__ == "__main__":
    unittest.main()
