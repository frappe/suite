"""Ticket 28 guards around preserved legacy Sheet history."""

from __future__ import annotations

import json
import pathlib
import unittest
from contextlib import ExitStack
from datetime import datetime
from types import MethodType, SimpleNamespace
from unittest import mock

from suite.sheets import drive as sheets_drive
from suite.sheets.doctype.sheet_snapshot.sheet_snapshot import SheetSnapshot
from suite.sheets.versioning import labels, snapshots, state, tasks


class HeadSchema(unittest.TestCase):
    """`Sheet.head_snapshot` must name the doctype the live writer stores in it.

    §10.7 retargets the field to a `Drive Node Version`, and §14.10 is the only
    place that may: an unlinked sheet keeps writing `Sheet Snapshot` names here
    for the whole Build release, and `Document._validate_links` checks the value
    on every `Sheet.save()`. Retargeting early makes trash, restore, rename, and
    the rename-on-autosave throw `LinkValidationError` on any legacy sheet that
    ever took a snapshot.
    """

    def _field(self, fieldname: str) -> dict:
        path = pathlib.Path(__file__).parents[2] / "doctype" / "sheet" / "sheet.json"
        meta = json.loads(path.read_text())
        return next(row for row in meta["fields"] if row["fieldname"] == fieldname)

    def test_head_snapshot_targets_the_doctype_the_legacy_writer_stores(self):
        self.assertEqual(self._field("head_snapshot")["options"], sheets_drive.SNAPSHOT_DOCTYPE)

    def test_a_legacy_snapshot_write_would_survive_frappe_link_validation(self):
        # The coupling this pair exists to hold: `snapshots.create` writes a
        # `Sheet Snapshot` name, so the Link must accept one until Cleanup drops
        # that doctype and rewrites the values in the same patch.
        head = SimpleNamespace(sheets_data="{}", head_seq=4)
        snapshot = mock.Mock()
        snapshot.name = "SS-1"
        snapshot.insert.return_value = snapshot
        with (
            mock.patch.object(snapshots, "_refuse_linked_sheet"),
            mock.patch.object(snapshots, "_last_snapshot", return_value=None),
            mock.patch.object(snapshots.frappe.db, "get_value", return_value=head),
            mock.patch.object(snapshots.frappe, "get_doc", return_value=snapshot),
            mock.patch.object(snapshots.frappe.db, "set_value") as set_value,
            mock.patch.object(snapshots.frappe, "publish_realtime"),
        ):
            snapshots.create("SH-1")
        stored = set_value.call_args.args
        self.assertEqual(stored[:3], ("Sheet", "SH-1", "head_snapshot"))
        self.assertEqual(snapshot.insert.call_args.kwargs, {"ignore_permissions": True})
        self.assertEqual(self._field("head_snapshot")["options"], sheets_drive.SNAPSHOT_DOCTYPE)


class LegacyMutationGuards(unittest.TestCase):
    def test_maybe_snapshot_refuses_before_reading_legacy_history(self):
        with (
            mock.patch.object(snapshots, "_refuse_linked_sheet", side_effect=RuntimeError("linked")),
            mock.patch.object(snapshots, "frappe") as frappe,
            self.assertRaisesRegex(RuntimeError, "linked"),
        ):
            snapshots.maybe_snapshot("SH-1")
        frappe.db.get_value.assert_not_called()

    def test_direct_snapshot_create_refuses_before_any_row_write(self):
        with (
            mock.patch.object(snapshots, "_refuse_linked_sheet", side_effect=RuntimeError("linked")),
            mock.patch.object(snapshots, "frappe") as frappe,
            self.assertRaisesRegex(RuntimeError, "linked"),
        ):
            snapshots.create("SH-1")
        frappe.get_doc.assert_not_called()
        frappe.db.set_value.assert_not_called()

    def test_restore_refuses_before_allocating_or_writing(self):
        target = {"sheet": "SH-1", "seq": 3, "sheets_data": "{}"}
        with (
            mock.patch.object(state, "at", return_value=target),
            mock.patch.object(state, "_refuse_linked_sheet", side_effect=RuntimeError("linked")),
            mock.patch.object(state.seq_mod, "allocate") as allocate,
            mock.patch.object(state, "frappe") as frappe,
            self.assertRaisesRegex(RuntimeError, "linked"),
        ):
            state.restore("SS-1")
        allocate.assert_not_called()
        frappe.get_doc.assert_not_called()
        frappe.db.set_value.assert_not_called()

    def test_label_and_pin_refuse_before_saving_the_snapshot(self):
        snapshot = mock.Mock(sheet="SH-1")
        with (
            mock.patch.object(labels.frappe, "get_doc", return_value=snapshot),
            mock.patch.object(labels, "_refuse_linked_sheet", side_effect=RuntimeError("linked")),
            self.assertRaisesRegex(RuntimeError, "linked"),
        ):
            labels.set_label("SS-1", "named", pinned=True)
        snapshot.save.assert_not_called()

    def test_delete_refuses_before_removing_or_repointing_history(self):
        snapshot = SimpleNamespace(sheet="SH-1", pinned=0)
        with (
            mock.patch.object(labels.frappe.db, "get_value", return_value=snapshot),
            mock.patch.object(labels, "_refuse_linked_sheet", side_effect=RuntimeError("linked")),
            mock.patch.object(labels.frappe, "delete_doc") as delete_doc,
            self.assertRaisesRegex(RuntimeError, "linked"),
        ):
            labels.delete("SS-1")
        delete_doc.assert_not_called()
        labels.frappe.db.set_value.assert_not_called()

    def test_snapshot_controller_refuses_both_save_and_delete(self):
        row = SimpleNamespace(sheet="SH-1", kind="auto", seq=1)
        row._refuse_linked_parent = MethodType(SheetSnapshot._refuse_linked_parent, row)
        with mock.patch(
            "suite.sheets.drive.refuse_drive_native", side_effect=RuntimeError("linked")
        ) as refuse:
            for callback in (SheetSnapshot.validate, SheetSnapshot.on_trash):
                with self.subTest(callback=callback.__name__), self.assertRaisesRegex(RuntimeError, "linked"):
                    callback(row)
        self.assertEqual(refuse.call_count, 2)

    def _job_frappe(self, stack, sql):
        frappe = stack.enter_context(mock.patch.object(tasks, "frappe"))
        stack.enter_context(mock.patch.object(tasks, "now_datetime", return_value=datetime(2026, 9, 8)))
        frappe.conf.get.return_value = None
        frappe.get_all.return_value = []
        frappe.db.sql.side_effect = sql
        return frappe

    def test_snapshot_rollup_iterates_only_unlinked_sheets(self):
        # `delete_doc` runs `SheetSnapshot.on_trash`, which refuses a linked
        # parent, and one refusal would end the whole nightly pass.
        with ExitStack() as stack:
            frappe = self._job_frappe(stack, [[("SH-1",)], []])
            tasks.rollup_snapshots()
        self.assertIn("node IS NULL OR node = ''", frappe.db.sql.call_args_list[0].args[0])

    def test_op_log_truncation_still_covers_a_linked_sheet(self):
        # `Sheet Op Log` is a satellite, not a version. §14.6 does not migrate
        # it and Drive prunes nothing, so skipping linked sheets here would let
        # every migrated sheet's op log grow without a bound.
        with ExitStack() as stack:
            frappe = self._job_frappe(stack, [[("SH-1",)], None, [(0,)], []])
            tasks.truncate_op_log()
        self.assertNotIn("node", frappe.db.sql.call_args_list[0].args[0])

    def test_the_legacy_filter_reads_an_empty_link_as_unlinked(self):
        # Frappe stores an unset Link as `''`, not NULL
        # (`frappe/model/base_document.py:624-627`), and `IS NULL` alone would
        # skip that sheet's retention forever.
        with mock.patch.object(tasks, "frappe") as frappe:
            frappe.db.sql.side_effect = [[]]
            list(tasks._iter_sheets(legacy_only=True))
        self.assertIn("(node IS NULL OR node = '')", frappe.db.sql.call_args_list[0].args[0])

    def test_an_unlinked_sheet_still_creates_a_snapshot(self):
        head = SimpleNamespace(sheets_data="{}", head_seq=4)
        snapshot = mock.Mock()
        snapshot.name = "SS-1"
        snapshot.insert.return_value = snapshot
        with (
            mock.patch.object(snapshots, "_refuse_linked_sheet") as guard,
            mock.patch.object(snapshots, "_last_snapshot", return_value=None),
            mock.patch.object(snapshots.frappe.db, "get_value", return_value=head),
            mock.patch.object(snapshots.frappe, "get_doc", return_value=snapshot),
            mock.patch.object(snapshots.frappe.db, "set_value") as set_value,
            mock.patch.object(snapshots.frappe, "publish_realtime"),
        ):
            self.assertEqual(snapshots.create("SH-1"), "SS-1")
        guard.assert_called_once_with("SH-1")
        snapshot.insert.assert_called_once_with(ignore_permissions=True)
        set_value.assert_called_once_with("Sheet", "SH-1", "head_snapshot", "SS-1", update_modified=False)


if __name__ == "__main__":
    unittest.main()
