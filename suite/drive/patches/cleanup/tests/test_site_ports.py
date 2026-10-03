"""The real `Site*` ports, port-level: no fixture stands between the test
and the code `execute()` wires in. `tests.fakes` proves the *phases* behave
correctly against a double; this file proves the doubles were honest about
what the real port does, for the ports whose correctness is not obvious
from their contract alone. Frappe is mocked at `frappe.db` and boto at the
client, so none of this needs a site.
"""

import gzip
import json
import unittest
from base64 import b64encode
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch

import frappe

import suite.drive.patches.cleanup as cleanup
from suite.drive.patches.cleanup.ports import (
    SNAPSHOT_FIELDS,
    LegacyBucket,
    SiteContentRows,
    SiteDiskSettingsSnapshot,
    SiteLegacyFileRows,
    SiteSchemaGateway,
    SiteThumbnailStore,
    SiteTransactionGateway,
    ThumbnailPathError,
)

# The real, checked-in `suite` app root: one level above `patches/cleanup/`'s
# grandparent (`drive`), the same directory `frappe.get_app_path("suite")`
# would return on a real site. Computed from this package's own file, not
# hardcoded, so it stays correct if the repository moves.
SUITE_APP_ROOT = Path(cleanup.__file__).resolve().parents[3]


def _gz_envelope(plain: dict) -> str:
    compressed = gzip.compress(json.dumps(plain).encode("utf-8"))
    return json.dumps({"_z": "gzip", "data": b64encode(compressed).decode("ascii")})


def _decode_written(stored: str) -> dict:
    """Decodes a gzip-envelope write-back. Only valid when the row that was
    read was itself gzip-encoded: `_encode_sheets_data` now preserves the
    format it read, so a plain-JSON row's write-back is plain JSON, not this
    envelope."""
    from base64 import b64decode

    envelope = json.loads(stored)
    return json.loads(gzip.decompress(b64decode(envelope["data"])).decode("utf-8"))


class TestSiteLegacyFileRowsBypassesHooks(unittest.TestCase):
    """Finding: must never run `File.on_trash`/`after_delete` — a plain
    `frappe.delete_doc` call here would delete the linked Writer/
    Presentation/Sheet body, local bytes, and cascade into satellite tables
    (`suite/drive/overrides/file.py`), which is exactly what step 1 must
    not do to rows step 4's phases still need to read."""

    def test_uses_a_plain_delete_never_delete_doc(self):
        with (
            patch("frappe.db", new=MagicMock()) as db,
            patch("frappe.delete_doc") as delete_doc,
        ):
            db.get_all.return_value = ["a", "b"]
            count = SiteLegacyFileRows().delete(("a", "b", "c"))
        self.assertEqual(count, 2)
        delete_doc.assert_not_called()
        db.delete.assert_called_once_with("File", {"name": ["in", ["a", "b"]]})

    def test_returns_the_count_actually_present_not_the_count_requested(self):
        with patch("frappe.db", new=MagicMock()) as db:
            db.get_all.return_value = ["a"]
            count = SiteLegacyFileRows().delete(("a", "already-gone"))
        self.assertEqual(count, 1)

    def test_an_empty_batch_touches_the_database_not_at_all(self):
        with patch("frappe.db", new=MagicMock()) as db:
            count = SiteLegacyFileRows().delete(())
        self.assertEqual(count, 0)
        db.get_all.assert_not_called()
        db.delete.assert_not_called()

    def test_nothing_present_is_a_no_op_not_a_delete_of_an_empty_filter(self):
        with patch("frappe.db", new=MagicMock()) as db:
            db.get_all.return_value = []
            count = SiteLegacyFileRows().delete(("gone-already",))
        self.assertEqual(count, 0)
        db.delete.assert_not_called()


class TestSiteContentRowsCommentStripping(unittest.TestCase):
    """Finding: strip only the cell-comment schema
    (`frontend/src/apps/sheets/engine/comments.js`'s top-level `comments`
    key), never a recursive scan for any key spelled "comment"; must decode
    the gzip envelope first or a compressed row is a silent no-op."""

    def _rows(self, *sheets_data_by_name):
        return [frappe._dict(name=name, sheets_data=data) for name, data in sheets_data_by_name]

    def test_strips_the_top_level_comments_key_only(self):
        payload = {
            "comments": {"Sheet1": {"A1": {"resolved": False, "thread": []}}},
            "cells": {"A1": {"value": "comment: not a real comment"}},
        }
        with (
            patch("frappe.get_all") as get_all,
            patch("frappe.db", new=MagicMock()) as db,
        ):
            get_all.side_effect = [
                self._rows(("sheet-1", json.dumps(payload))),
                [],
            ]
            stripped = SiteContentRows().strip_sheet_comments(batch_size=10)
        self.assertEqual(stripped, 1)
        written_raw = db.set_value.call_args.args[3]
        # Finding: the old encoder always wrote the gzip envelope, even for a
        # row that was plain JSON on the way in. Stripping a key must not
        # change the row's storage format as a side effect.
        self.assertNotEqual(json.loads(written_raw).get("_z"), "gzip")
        written = json.loads(written_raw)
        self.assertNotIn("comments", written)
        # A cell whose own text happens to contain the word "comment" is
        # untouched: this is not a key-name scrub.
        self.assertEqual(written["cells"], payload["cells"])

    def test_decodes_the_gzip_envelope_before_inspecting_it(self):
        payload = {"comments": {"Sheet1": {}}, "title": "Q3"}
        with (
            patch("frappe.get_all") as get_all,
            patch("frappe.db", new=MagicMock()) as db,
        ):
            get_all.side_effect = [
                self._rows(("sheet-1", _gz_envelope(payload))),
                [],
            ]
            stripped = SiteContentRows().strip_sheet_comments(batch_size=10)
        self.assertEqual(stripped, 1)
        written_raw = db.set_value.call_args.args[3]
        self.assertEqual(json.loads(written_raw)["_z"], "gzip")  # re-encoded the same way
        written = _decode_written(written_raw)
        self.assertNotIn("comments", written)
        self.assertEqual(written["title"], "Q3")

    def test_a_sheet_with_no_comments_key_is_never_written(self):
        with (
            patch("frappe.get_all") as get_all,
            patch("frappe.db", new=MagicMock()) as db,
        ):
            get_all.side_effect = [
                self._rows(("sheet-1", json.dumps({"title": "no comments here"}))),
                [],
            ]
            stripped = SiteContentRows().strip_sheet_comments(batch_size=10)
        self.assertEqual(stripped, 0)
        db.set_value.assert_not_called()

    def test_a_null_sheets_data_is_skipped_not_an_error(self):
        with patch("frappe.get_all") as get_all:
            get_all.side_effect = [self._rows(("sheet-1", None)), []]
            stripped = SiteContentRows().strip_sheet_comments(batch_size=10)
        self.assertEqual(stripped, 0)

    def test_pages_in_batch_size_chunks_ordered_by_name(self):
        with (
            patch("frappe.get_all") as get_all,
            patch("frappe.db", new=MagicMock()),
        ):
            non_empty = json.dumps({"comments": {"Sheet1": {"A1": {}}}})
            get_all.side_effect = [
                self._rows(("a", non_empty), ("b", non_empty)),
                self._rows(("c", non_empty)),
                [],
            ]
            stripped = SiteContentRows().strip_sheet_comments(batch_size=2)
        self.assertEqual(stripped, 3)
        self.assertEqual(get_all.call_args_list[0].kwargs["filters"], {"name": [">", ""]})
        self.assertEqual(get_all.call_args_list[1].kwargs["filters"], {"name": [">", "b"]})
        # A second, full-size page short-circuits into a third call; here the
        # second page has only one row (`c`, less than `batch_size=2`), so
        # the scan stops without ever issuing that third call.
        self.assertEqual(len(get_all.call_args_list), 2)

    def test_a_stalled_scan_refuses_instead_of_looping_forever(self):
        with patch("frappe.get_all") as get_all:
            get_all.return_value = self._rows(("a", None))
            with self.assertRaises(RuntimeError):
                SiteContentRows().strip_sheet_comments(batch_size=1)


class TestSiteThumbnailStore(unittest.TestCase):
    """A local site deletes sidecar files, and a filesystem error propagates,
    never a quiet "not deleted" indistinguishable from an ordinary missing
    file. An S3 site deletes nothing: Cleanup deletes no bucket object."""

    def test_s3_enabled_deletes_nothing_and_touches_no_bucket_or_disk(self):
        settings = {"enabled": True, "root_folder": "team", "thumbnail_prefix": "thumbnails"}
        with (
            patch("suite.drive.patches.cleanup.ports.legacy_bucket") as bucket,
            patch("os.path.exists") as exists,
            patch("os.unlink") as unlink,
        ):
            deleted = SiteThumbnailStore().delete_sidecars(("a", "b"), settings=settings)
        self.assertEqual(deleted, 0)
        bucket.assert_not_called()
        exists.assert_not_called()
        unlink.assert_not_called()

    def test_local_disk_deletes_only_sidecars_that_exist(self):
        with TemporaryDirectory() as tmp:
            thumbs = Path(tmp) / ".thumbnails"
            thumbs.mkdir()
            (thumbs / "a.thumbnail").write_bytes(b"x")
            settings = {"enabled": False, "root_folder": tmp, "thumbnail_prefix": ".thumbnails"}
            deleted = SiteThumbnailStore().delete_sidecars(("a", "b"), settings=settings)
            self.assertEqual(deleted, 1)
            self.assertFalse((thumbs / "a.thumbnail").exists())

    def test_an_empty_root_folder_is_a_safe_no_op_never_an_absolute_path(self):
        """Finding: `f"{root_folder}/{thumbnail_prefix}/{name}.thumbnail"`
        with an empty `root_folder` builds a leading-`/` path anchored at
        the filesystem root, not Drive's storage. `os.path.exists`/
        `os.unlink` are spied directly so a regression to that shape is
        caught even though it would coincidentally no-op on a filesystem
        with no matching root-level file."""
        with patch("os.path.exists") as exists, patch("os.unlink") as unlink:
            settings = {"enabled": False, "root_folder": "", "thumbnail_prefix": ".thumbnails"}
            deleted = SiteThumbnailStore().delete_sidecars(("a",), settings=settings)
        self.assertEqual(deleted, 0)
        exists.assert_not_called()
        unlink.assert_not_called()

    def test_an_empty_thumbnail_prefix_is_also_a_safe_no_op(self):
        with patch("os.path.exists") as exists, patch("os.unlink") as unlink:
            settings = {"enabled": False, "root_folder": "/var/drive-files", "thumbnail_prefix": ""}
            deleted = SiteThumbnailStore().delete_sidecars(("a",), settings=settings)
        self.assertEqual(deleted, 0)
        exists.assert_not_called()
        unlink.assert_not_called()

    def test_both_settings_empty_is_also_a_safe_no_op(self):
        with patch("os.path.exists") as exists, patch("os.unlink") as unlink:
            deleted = SiteThumbnailStore().delete_sidecars(("a",), settings={})
        self.assertEqual(deleted, 0)
        exists.assert_not_called()
        unlink.assert_not_called()

    def test_an_absolute_thumbnail_prefix_is_refused_not_joined(self):
        """Finding: `os.path.join`/`Path.__truediv__` both discard the left
        side the moment a later component is itself absolute, so an absolute
        `thumbnail_prefix` would silently escape `root_folder` entirely and
        delete under `/etc` instead. Nothing on disk is touched."""
        with TemporaryDirectory() as tmp:
            settings = {"enabled": False, "root_folder": tmp, "thumbnail_prefix": "/etc"}
            with self.assertRaises(ThumbnailPathError):
                SiteThumbnailStore().delete_sidecars(("a",), settings=settings)

    def test_a_traversal_thumbnail_prefix_is_refused_not_joined(self):
        with TemporaryDirectory() as tmp:
            settings = {"enabled": False, "root_folder": tmp, "thumbnail_prefix": "../../../etc"}
            with self.assertRaises(ThumbnailPathError):
                SiteThumbnailStore().delete_sidecars(("a",), settings=settings)

    def test_an_absolute_root_folder_with_an_ordinary_prefix_still_works(self):
        """`root_folder` itself is allowed to be absolute — only
        `thumbnail_prefix` is untrusted here."""
        with TemporaryDirectory() as tmp:
            thumbs = Path(tmp) / ".thumbnails"
            thumbs.mkdir()
            (thumbs / "a.thumbnail").write_bytes(b"x")
            settings = {"enabled": False, "root_folder": tmp, "thumbnail_prefix": ".thumbnails"}
            deleted = SiteThumbnailStore().delete_sidecars(("a", "b"), settings=settings)
        self.assertEqual(deleted, 1)

    def test_a_prefix_that_resolves_back_inside_root_via_dotdot_is_allowed(self):
        """A `..`-bearing prefix is not banned outright, only one that
        actually escapes: `sub/../.thumbnails` resolves to the same place as
        `.thumbnails` and must behave identically."""
        with TemporaryDirectory() as tmp:
            thumbs = Path(tmp) / ".thumbnails"
            thumbs.mkdir()
            (thumbs / "a.thumbnail").write_bytes(b"x")
            settings = {"enabled": False, "root_folder": tmp, "thumbnail_prefix": "sub/../.thumbnails"}
            deleted = SiteThumbnailStore().delete_sidecars(("a",), settings=settings)
        self.assertEqual(deleted, 1)


class TestSiteSchemaGateway(unittest.TestCase):
    """Finding: `drop_columns` built `table = f"tab{doctype}"` and then
    called `frappe.db.has_column(table, fieldname)` — but `has_column`'s own
    `doctype` parameter prepends `"tab"` itself, so the old code queried
    `tabtab<doctype>` and would raise `TableMissingError` on the first real
    column drop. `frappe.db.has_column` is spied directly here so a
    regression to the wrong call shape fails this test even though a fake
    `SchemaGateway` (which never sees the real signature) could not catch
    it."""

    def test_drop_columns_calls_has_column_with_the_bare_doctype_not_the_table_name(self):
        with (
            patch("frappe.db", new=MagicMock()) as db,
            patch("frappe.get_all", return_value=[]),
            patch("frappe.clear_cache"),
        ):
            db.has_column.return_value = True
            dropped = SiteSchemaGateway().drop_columns("Drive Notification", ("from_user", "type"))
        self.assertEqual(dropped, 2)
        db.has_column.assert_any_call("Drive Notification", "from_user")
        db.has_column.assert_any_call("Drive Notification", "type")
        # Never the tab-prefixed form: that call shape is exactly what
        # `has_column` itself doubles into `tabtabDrive Notification`.
        for call in db.has_column.call_args_list:
            self.assertNotIn("tabDrive Notification", call.args)
        db.sql_ddl.assert_any_call("alter table `tabDrive Notification` drop column `from_user`")
        db.sql_ddl.assert_any_call("alter table `tabDrive Notification` drop column `type`")

    def test_drop_columns_absent_column_is_a_no_op(self):
        with patch("frappe.db", new=MagicMock()) as db, patch("frappe.get_all", return_value=[]):
            db.has_column.return_value = False
            dropped = SiteSchemaGateway().drop_columns("Sheet", ("already_gone",))
        self.assertEqual(dropped, 0)
        db.sql_ddl.assert_not_called()

    def test_drop_columns_deletes_the_matching_custom_field_first(self):
        with (
            patch("frappe.db", new=MagicMock()) as db,
            patch("frappe.get_all", return_value=["CF-001"]) as get_all,
            patch("frappe.delete_doc") as delete_doc,
            patch("frappe.clear_cache"),
        ):
            db.has_column.return_value = True
            SiteSchemaGateway().drop_columns("Sheet", ("title",))
        get_all.assert_called_once_with(
            "Custom Field", filters={"dt": "Sheet", "fieldname": "title"}, pluck="name"
        )
        delete_doc.assert_called_once_with("Custom Field", "CF-001", ignore_permissions=True)

    def test_drop_single_values_deletes_exactly_the_present_fields(self):
        with patch("frappe.db", new=MagicMock()) as db, patch("frappe.clear_document_cache") as clear_cache:
            db.sql.return_value = [("quota",), ("bucket",)]
            dropped = SiteSchemaGateway().drop_single_values(
                "Drive Disk Settings", ("quota", "bucket", "never_was_set")
            )
        self.assertEqual(dropped, 2)
        db.delete.assert_called_once_with(
            "Singles", {"doctype": "Drive Disk Settings", "field": ["in", ["quota", "bucket"]]}
        )
        clear_cache.assert_called_once_with("Drive Disk Settings", "Drive Disk Settings")

    def test_drop_single_values_nothing_present_is_a_no_op(self):
        with patch("frappe.db", new=MagicMock()) as db, patch("frappe.clear_document_cache") as clear_cache:
            db.sql.return_value = []
            dropped = SiteSchemaGateway().drop_single_values("Drive Disk Settings", ("quota",))
        self.assertEqual(dropped, 0)
        db.delete.assert_not_called()
        clear_cache.assert_not_called()

    def test_drop_single_values_an_empty_fieldname_tuple_never_queries(self):
        with patch("frappe.db", new=MagicMock()) as db:
            dropped = SiteSchemaGateway().drop_single_values("Drive Disk Settings", ())
        self.assertEqual(dropped, 0)
        db.sql.assert_not_called()

    def test_drop_single_values_rerun_after_success_is_idempotent(self):
        with patch("frappe.db", new=MagicMock()) as db, patch("frappe.clear_document_cache"):
            db.sql.return_value = [("quota",)]
            first = SiteSchemaGateway().drop_single_values("Drive Disk Settings", ("quota",))
            db.sql.return_value = []  # the row is gone now, a real rerun would see this
            second = SiteSchemaGateway().drop_single_values("Drive Disk Settings", ("quota",))
        self.assertEqual((first, second), (1, 0))
        db.delete.assert_called_once()

    def test_drop_single_values_a_database_error_propagates(self):
        with patch("frappe.db", new=MagicMock()) as db:
            db.sql.side_effect = RuntimeError("connection lost")
            with self.assertRaises(RuntimeError):
                SiteSchemaGateway().drop_single_values("Drive Disk Settings", ("quota",))

    def test_custom_fields_present_queries_by_fieldname_not_name(self):
        """Finding: presence must be checked directly, not inferred from a
        `drop_*` call's own count — a resumed call after a partially-applied
        earlier attempt needs to know what is *still there*, which the count
        a single call reports removing cannot answer on its own."""
        with patch("frappe.get_all", return_value=["mime_type"]) as get_all:
            present = SiteSchemaGateway().custom_fields_present(("mime_type", "status"))
        self.assertEqual(present, {"mime_type"})
        get_all.assert_called_once_with(
            "Custom Field",
            filters={"dt": "File", "fieldname": ["in", ["mime_type", "status"]]},
            pluck="fieldname",
        )

    def test_custom_fields_present_an_empty_tuple_never_queries(self):
        with patch("frappe.get_all") as get_all:
            present = SiteSchemaGateway().custom_fields_present(())
        self.assertEqual(present, frozenset())
        get_all.assert_not_called()

    def test_property_setters_present_checks_each_key_directly(self):
        with patch("frappe.db", new=MagicMock()) as db:
            db.exists.side_effect = [True, False]
            present = SiteSchemaGateway().property_setters_present(
                (("File", "file_url", "depends_on"), ("File", "folder", "hidden"))
            )
        self.assertEqual(present, {("File", "file_url", "depends_on")})

    def test_doctypes_present_counts_a_leftover_table_even_without_a_doctype_row(self):
        # `delete_doc("DocType")` leaves the table behind, so "present" has
        # to mean either half is still there.
        with patch("frappe.db", new=MagicMock()) as db:
            db.exists.return_value = False
            db.table_exists.side_effect = lambda doctype: doctype == "Drive Permission"
            present = SiteSchemaGateway().doctypes_present(("Drive Permission", "Drive Token"))
        self.assertEqual(present, {"Drive Permission"})
        db.exists.assert_any_call("DocType", "Drive Permission")

    def test_drop_doctypes_deletes_the_doctype_row_then_drops_the_table(self):
        with (
            patch("frappe.db", new=MagicMock()) as db,
            patch("frappe.delete_doc") as delete_doc,
            patch("frappe.clear_cache") as clear_cache,
        ):
            db.exists.side_effect = lambda doctype, name: name == "Drive Permission"
            dropped = SiteSchemaGateway().drop_doctypes(("Drive Permission", "Drive Token"))
        self.assertEqual(dropped, 1)
        delete_doc.assert_called_once_with("DocType", "Drive Permission", ignore_permissions=True, force=True)
        # The table goes for both: a doctype row already gone (an earlier
        # partial run, or a site that never shipped the doctype) still has
        # its table dropped if one is there.
        self.assertEqual(
            [call.args[0] for call in db.sql_ddl.call_args_list],
            ["DROP TABLE IF EXISTS `tabDrive Permission`", "DROP TABLE IF EXISTS `tabDrive Token`"],
        )
        clear_cache.assert_called_once()

    def test_columns_present_calls_has_column_with_the_bare_doctype(self):
        with patch("frappe.db", new=MagicMock()) as db:
            db.has_column.side_effect = lambda doctype, field: field == "from_user"
            present = SiteSchemaGateway().columns_present("Drive Notification", ("from_user", "type"))
        self.assertEqual(present, {"from_user"})
        db.has_column.assert_any_call("Drive Notification", "from_user")
        db.has_column.assert_any_call("Drive Notification", "type")

    def test_single_values_present_queries_tabsingles_directly(self):
        with patch("frappe.db", new=MagicMock()) as db:
            db.sql.return_value = [("quota",)]
            present = SiteSchemaGateway().single_values_present("Drive Disk Settings", ("quota", "bucket"))
        self.assertEqual(present, {"quota"})

    def test_single_values_present_an_empty_tuple_never_queries(self):
        with patch("frappe.db", new=MagicMock()) as db:
            present = SiteSchemaGateway().single_values_present("Drive Disk Settings", ())
        self.assertEqual(present, frozenset())
        db.sql.assert_not_called()


class TestSiteDiskSettingsSnapshot(unittest.TestCase):
    """The Single's meta no longer declares these fields, so `frappe.get_single`
    would drop them: the snapshot reads `tabSingles` rows directly."""

    def test_reads_the_snapshot_fields_from_tab_singles(self):
        with patch("frappe.db", new=MagicMock()) as db:
            db.sql.return_value = (("enabled", "1"), ("root_folder", "team"), ("bucket", "b"))
            values = SiteDiskSettingsSnapshot().read()
        self.assertEqual(set(values), set(SNAPSHOT_FIELDS))
        self.assertIs(values["enabled"], True)
        self.assertEqual(values["root_folder"], "team")
        self.assertIsNone(values["thumbnail_prefix"])
        sql, params = db.sql.call_args.args
        self.assertIn("`tabSingles`", sql)
        self.assertEqual(params["fields"], SNAPSHOT_FIELDS)

    def test_a_site_that_never_enabled_s3_reads_as_disabled(self):
        with patch("frappe.db", new=MagicMock()) as db:
            db.sql.return_value = ()
            values = SiteDiskSettingsSnapshot().read()
        self.assertIs(values["enabled"], False)


class TestSiteTransactionGateway(unittest.TestCase):
    def test_commits_outside_a_test_run(self):
        with (
            patch("frappe.flags", MagicMock(in_test=False)),
            patch("frappe.db", new=MagicMock()) as db,
        ):
            SiteTransactionGateway().commit()
        db.commit.assert_called_once()

    def test_never_commits_inside_a_test_run(self):
        with (
            patch("frappe.flags", MagicMock(in_test=True)),
            patch("frappe.db", new=MagicMock()) as db,
        ):
            SiteTransactionGateway().commit()
        db.commit.assert_not_called()


class TestLegacyBucket(unittest.TestCase):
    """boto, at the client: 1000-key batches, keys passed through exactly as
    given, and a partial failure reported instead of swallowed."""

    def test_delete_keys_passes_every_key_shape_through_unchanged(self):
        # The production bucket holds leading-slash keys and bare root keys;
        # normalising either would delete the wrong object or none.
        client = MagicMock()
        client.delete_objects.side_effect = lambda Bucket, Delete: {"Deleted": Delete["Objects"]}
        keys = ("/abc/x.pdf", "bare.pdf", "team/y.pdf")
        deleted = LegacyBucket("bucket", client).delete_keys(keys)
        self.assertEqual(deleted, 3)
        sent = [item["Key"] for item in client.delete_objects.call_args.kwargs["Delete"]["Objects"]]
        self.assertEqual(sent, list(keys))

    def test_delete_keys_batches_a_thousand_per_call(self):
        client = MagicMock()
        client.delete_objects.side_effect = lambda Bucket, Delete: {"Deleted": Delete["Objects"]}
        keys = tuple(f"team/{i}" for i in range(1500))
        deleted = LegacyBucket("bucket", client).delete_keys(keys)
        self.assertEqual(deleted, 1500)
        sizes = [len(call.kwargs["Delete"]["Objects"]) for call in client.delete_objects.call_args_list]
        self.assertEqual(sizes, [1000, 500])

    def test_delete_keys_raises_on_a_partial_failure(self):
        client = MagicMock()
        client.delete_objects.return_value = {
            "Deleted": [{"Key": "team/a"}],
            "Errors": [{"Key": "team/b", "Code": "AccessDenied", "Message": "no"}],
        }
        with self.assertRaises(RuntimeError) as caught:
            LegacyBucket("bucket", client).delete_keys(("team/a", "team/b"))
        self.assertIn("team/b", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
