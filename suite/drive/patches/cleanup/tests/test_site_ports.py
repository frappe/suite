"""The real `Site*` ports, port-level: no fixture stands between the test
and the actual code Ticket 36 would wire in. `tests.fakes` proves the
*phases* behave correctly against a double; this file proves the doubles
were honest about what the real port does, for the ports whose correctness
is not obvious from their contract alone.
"""

import gzip
import json
import unittest
from base64 import b64encode
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch

import frappe

from suite.drive.patches.cleanup.ports import (
    DISK_SETTINGS_FIELDS,
    SiteClientCallerEvidence,
    SiteContentRows,
    SiteDiskSettingsSnapshot,
    SiteLegacyFileRows,
    SiteS3LegacyPrefix,
    SiteThumbnailStore,
    SiteTransactionGateway,
)


def _gz_envelope(plain: dict) -> str:
    compressed = gzip.compress(json.dumps(plain).encode("utf-8"))
    return json.dumps({"_z": "gzip", "data": b64encode(compressed).decode("ascii")})


def _decode_written(stored: str) -> dict:
    """`_encode_sheets_data` always writes the gzip envelope, regardless of
    whether the row it read was plain JSON or already gzip-encoded."""
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
        written = _decode_written(db.set_value.call_args.args[3])
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
    """Finding: an S3-enabled site must fail loudly (`NotImplementedError`),
    never swallow the bucket error and quietly report "not deleted" —
    indistinguishable from an ordinary missing local file."""

    def test_s3_enabled_raises_honestly_never_swallows_the_error(self):
        with self.assertRaises(NotImplementedError):
            SiteThumbnailStore().delete_sidecars(("a",), settings={"enabled": True})

    def test_local_disk_deletes_only_sidecars_that_exist(self):
        with TemporaryDirectory() as tmp:
            thumbs = Path(tmp) / ".thumbnails"
            thumbs.mkdir()
            (thumbs / "a.thumbnail").write_bytes(b"x")
            settings = {"enabled": False, "root_folder": tmp, "thumbnail_prefix": ".thumbnails"}
            deleted = SiteThumbnailStore().delete_sidecars(("a", "b"), settings=settings)
            self.assertEqual(deleted, 1)
            self.assertFalse((thumbs / "a.thumbnail").exists())


class TestSiteDiskSettingsSnapshot(unittest.TestCase):
    def test_reads_exactly_the_ten_disk_settings_fields(self):
        settings = MagicMock()
        settings.get.side_effect = lambda field: f"value-of-{field}"
        with patch("frappe.get_single", return_value=settings) as get_single:
            values = SiteDiskSettingsSnapshot().read()
        get_single.assert_called_once_with("Drive Disk Settings")
        self.assertEqual(set(values), set(DISK_SETTINGS_FIELDS))
        self.assertEqual(values["root_folder"], "value-of-root_folder")


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


class TestSiteClientCallerEvidence(unittest.TestCase):
    def _app_tree(self, tmp_path, files: dict[str, str]):
        app_root = Path(tmp_path) / "apps" / "suite" / "suite"
        src = Path(tmp_path) / "apps" / "suite" / "frontend" / "src"
        src.mkdir(parents=True)
        app_root.mkdir(parents=True)
        for relpath, contents in files.items():
            path = src / relpath
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(contents, encoding="utf-8")
        return app_root

    def test_a_call_site_using_the_dotted_name_is_found(self):
        with TemporaryDirectory() as tmp:
            app_root = self._app_tree(tmp, {"api/upload.js": "call('suite.drive.api.files.upload_file', {})"})
            with patch("frappe.get_app_path", return_value=str(app_root)):
                found = SiteClientCallerEvidence().still_referenced(
                    ("api.files.upload_file", "api.files.gone")
                )
        self.assertEqual(found, frozenset({"api.files.upload_file"}))

    def test_a_missing_source_tree_raises_rather_than_reporting_all_clear(self):
        with TemporaryDirectory() as tmp:
            with patch("frappe.get_app_path", return_value=str(Path(tmp) / "apps" / "suite" / "suite")):
                with self.assertRaises(RuntimeError):
                    SiteClientCallerEvidence().still_referenced(("api.files.upload_file",))

    def test_non_bundle_extensions_are_not_scanned(self):
        with TemporaryDirectory() as tmp:
            app_root = self._app_tree(
                tmp, {"README.md": "mentions suite.drive.api.files.upload_file in prose"}
            )
            with patch("frappe.get_app_path", return_value=str(app_root)):
                found = SiteClientCallerEvidence().still_referenced(("api.files.upload_file",))
        self.assertEqual(found, frozenset())


class TestSiteS3LegacyPrefix(unittest.TestCase):
    def test_blob_references_queries_file_blob_by_key(self):
        with patch("frappe.get_all", return_value=["team/a"]) as get_all:
            found = SiteS3LegacyPrefix().blob_references(("team/a", "team/b"))
        self.assertEqual(found, {"team/a"})
        get_all.assert_called_once_with(
            "File Blob", filters={"key": ["in", ["team/a", "team/b"]]}, pluck="key"
        )

    def test_an_empty_key_tuple_never_queries(self):
        with patch("frappe.get_all") as get_all:
            found = SiteS3LegacyPrefix().blob_references(())
        self.assertEqual(found, set())
        get_all.assert_not_called()

    def test_list_prefix_and_enqueue_delete_are_honest_not_implemented_ports(self):
        s3 = SiteS3LegacyPrefix()
        with self.assertRaises(NotImplementedError):
            s3.list_prefix("team", "", 100)
        with self.assertRaises(NotImplementedError):
            s3.enqueue_delete(("team/a",))


if __name__ == "__main__":
    unittest.main()
