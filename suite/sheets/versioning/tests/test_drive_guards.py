"""Ticket 28 guards around preserved legacy Sheet history."""

from __future__ import annotations

import json
import pathlib
import unittest
from contextlib import ExitStack
from datetime import datetime
from types import MethodType, SimpleNamespace
from unittest import mock

import frappe

from suite.sheets import drive as sheets_drive
from suite.sheets import permissions
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


class RealLinkPredicate(unittest.TestCase):
    """Every legacy mutation entry point, with the real predicate behind it.

    `refuse_drive_native` reads one column and nothing else:
    `frappe.db.get_value("Sheet", docname, "node")`
    (`suite/sheets/drive.py:344-365`). These tests stub that read and let the
    whole guard run, so deleting the predicate, or making it refuse every
    sheet, fails them. Patching `_refuse_linked_sheet` instead proves only that
    a call site is wired to something.

    Both unset spellings are exercised. Frappe stores an unset Link as `''`
    (`frappe/model/base_document.py:624-627`), so `None` alone would not show
    that a legacy sheet keeps its history.
    """

    LINKED = "NODE-1"
    UNLINKED = (None, "")

    def _reads(self, node, other=None):
        """Answer the guard's one `Sheet.node` read, everything else with `other`."""

        def get_value(doctype, name, fieldname=None, *args, **kwargs):
            if (doctype, fieldname) == (sheets_drive.DOCTYPE, sheets_drive.NODE_FIELD):
                return node
            return other

        return mock.patch.object(sheets_drive.frappe.db, "get_value", side_effect=get_value)

    # ── snapshots.create ─────────────────────────────────────────────────────

    def _create_stubs(self, stack):
        """Everything `snapshots.create` touches after the guard has passed."""
        snapshot = mock.Mock()
        snapshot.name = "SS-1"
        stack.enter_context(mock.patch.object(snapshots, "_last_snapshot", return_value=None))
        stack.enter_context(mock.patch.object(snapshots.frappe, "publish_realtime"))
        get_doc = stack.enter_context(mock.patch.object(snapshots.frappe, "get_doc", return_value=snapshot))
        set_value = stack.enter_context(mock.patch.object(snapshots.frappe.db, "set_value"))
        return snapshot, get_doc, set_value

    def test_create_refuses_a_linked_sheet_before_any_row_write(self):
        # An explicit create is a deliberate legacy history write, so it
        # refuses rather than declining. The head row is present, so a create
        # that lost its guard would succeed rather than throw for a missing
        # sheet and pass this test by accident.
        head = SimpleNamespace(sheets_data="{}", head_seq=4)
        with ExitStack() as stack:
            stack.enter_context(self._reads(self.LINKED, other=head))
            _, get_doc, set_value = self._create_stubs(stack)
            with self.assertRaises(frappe.ValidationError):
                snapshots.create("SH-1")
            get_doc.assert_not_called()
            set_value.assert_not_called()

    def test_create_still_writes_for_both_unset_link_spellings(self):
        head = SimpleNamespace(sheets_data="{}", head_seq=4)
        for node in self.UNLINKED:
            with self.subTest(node=node), ExitStack() as stack:
                stack.enter_context(self._reads(node, other=head))
                snapshot, _, set_value = self._create_stubs(stack)
                self.assertEqual(snapshots.create("SH-1"), "SS-1")
                snapshot.insert.assert_called_once_with(ignore_permissions=True)
                set_value.assert_called_once_with(
                    "Sheet", "SH-1", "head_snapshot", "SS-1", update_modified=False
                )

    # ── snapshots.maybe_snapshot ─────────────────────────────────────────────

    def test_maybe_snapshot_declines_a_linked_sheet_without_raising(self):
        # `versioning.save` runs this inline on every autosave and turns any
        # exception into an `Error Log` row. A refusal here would file one per
        # save of every migrated sheet for the whole Build release, so this one
        # path declines instead. It still reads nothing further and writes
        # nothing.
        with (
            self._reads(self.LINKED) as get_value,
            mock.patch.object(snapshots.frappe, "get_doc") as get_doc,
        ):
            self.assertIsNone(snapshots.maybe_snapshot("SH-1"))
        self.assertEqual(get_value.call_args_list[-1].args, ("Sheet", "SH-1", "node"))
        get_doc.assert_not_called()

    def test_maybe_snapshot_reaches_the_policy_for_both_unset_link_spellings(self):
        for node in self.UNLINKED:
            with (
                self.subTest(node=node),
                self._reads(node) as get_value,
                mock.patch.object(snapshots.frappe, "get_doc") as get_doc,
            ):
                self.assertIsNone(snapshots.maybe_snapshot("SH-1"))
                self.assertEqual(
                    get_value.call_args_list[-1].args, ("Sheet", "SH-1", ["head_seq", "head_snapshot"])
                )
                get_doc.assert_not_called()

    # ── state.restore ────────────────────────────────────────────────────────

    def _restore_stubs(self, stack):
        """Everything `state.restore` touches after `at()` and the guard."""
        target = {"sheet": "SH-1", "seq": 3, "label": None, "sheets_data": "{}"}
        stack.enter_context(mock.patch.object(state, "at", return_value=target))
        stack.enter_context(mock.patch.object(state.frappe, "has_permission", return_value=True))
        stack.enter_context(mock.patch.object(state.frappe, "get_doc"))
        stack.enter_context(mock.patch.object(state.snap_mod, "create", return_value="SS-2"))
        allocate = stack.enter_context(mock.patch.object(state.seq_mod, "allocate", return_value=7))
        set_value = stack.enter_context(mock.patch.object(state.frappe.db, "set_value"))
        return allocate, set_value

    def test_restore_refuses_a_linked_sheet_before_allocating_or_writing(self):
        with ExitStack() as stack:
            stack.enter_context(self._reads(self.LINKED))
            allocate, set_value = self._restore_stubs(stack)
            with self.assertRaises(frappe.ValidationError):
                state.restore("SS-1")
            allocate.assert_not_called()
            set_value.assert_not_called()

    def test_restore_still_runs_for_both_unset_link_spellings(self):
        for node in self.UNLINKED:
            with self.subTest(node=node), ExitStack() as stack:
                stack.enter_context(self._reads(node))
                allocate, set_value = self._restore_stubs(stack)
                self.assertEqual(state.restore("SS-1"), {"snapshot": "SS-2", "seq": 7})
                allocate.assert_called_once_with("SH-1")
                set_value.assert_called_once()

    # ── labels.set_label and labels.delete ───────────────────────────────────

    def _label_stubs(self, stack):
        snapshot = mock.Mock(sheet="SH-1")
        stack.enter_context(mock.patch.object(labels.frappe, "get_doc", return_value=snapshot))
        stack.enter_context(mock.patch.object(labels.frappe, "has_permission", return_value=True))
        return snapshot

    def test_set_label_refuses_a_linked_sheet_before_saving(self):
        with ExitStack() as stack:
            stack.enter_context(self._reads(self.LINKED))
            snapshot = self._label_stubs(stack)
            with self.assertRaises(frappe.ValidationError):
                labels.set_label("SS-1", "named", pinned=True)
            snapshot.save.assert_not_called()

    def test_set_label_still_saves_for_both_unset_link_spellings(self):
        for node in self.UNLINKED:
            with self.subTest(node=node), ExitStack() as stack:
                stack.enter_context(self._reads(node))
                snapshot = self._label_stubs(stack)
                labels.set_label("SS-1", "named", pinned=True)
                self.assertEqual(snapshot.kind, "named")
                snapshot.save.assert_called_once_with(ignore_permissions=True)

    def _delete_stubs(self, stack):
        stack.enter_context(mock.patch.object(labels.frappe, "has_permission", return_value=True))
        delete_doc = stack.enter_context(mock.patch.object(labels.frappe, "delete_doc"))
        set_value = stack.enter_context(mock.patch.object(labels.frappe.db, "set_value"))
        return delete_doc, set_value

    def test_delete_refuses_a_linked_sheet_before_removing_or_repointing_history(self):
        row = SimpleNamespace(sheet="SH-1", pinned=0)
        with ExitStack() as stack:
            stack.enter_context(self._reads(self.LINKED, other=row))
            delete_doc, set_value = self._delete_stubs(stack)
            with self.assertRaises(frappe.ValidationError):
                labels.delete("SS-1")
            delete_doc.assert_not_called()
            set_value.assert_not_called()

    def test_delete_still_removes_for_both_unset_link_spellings(self):
        row = SimpleNamespace(sheet="SH-1", pinned=0)
        for node in self.UNLINKED:
            with self.subTest(node=node), ExitStack() as stack:
                stack.enter_context(self._reads(node, other=row))
                delete_doc, _ = self._delete_stubs(stack)
                self.assertEqual(labels.delete("SS-1"), {"deleted": "SS-1"})
                delete_doc.assert_called_once_with("Sheet Snapshot", "SS-1", ignore_permissions=True)

    # ── SheetSnapshot.validate and SheetSnapshot.on_trash ────────────────────

    def _row(self):
        row = SimpleNamespace(sheet="SH-1", kind="auto", label=None, seq=1)
        row._refuse_linked_parent = MethodType(SheetSnapshot._refuse_linked_parent, row)
        return row

    def test_the_snapshot_controller_refuses_a_linked_parent_on_save_and_delete(self):
        for callback in (SheetSnapshot.validate, SheetSnapshot.on_trash):
            with (
                self.subTest(callback=callback.__name__),
                self._reads(self.LINKED),
                self.assertRaises(frappe.ValidationError),
            ):
                callback(self._row())

    def test_the_snapshot_controller_passes_both_unset_link_spellings(self):
        for callback in (SheetSnapshot.validate, SheetSnapshot.on_trash):
            for node in self.UNLINKED:
                with self.subTest(callback=callback.__name__, node=node), self._reads(node):
                    self.assertIsNone(callback(self._row()))


class RefusalOrder(unittest.TestCase):
    """The Drive refusal must not answer a question permission would refuse.

    The message names the snapshot and says Drive owns its parent. A caller
    with no write right on the sheet must learn neither, so the permission
    check runs first. `state.restore` needs no such order: `at()` has already
    validated read.
    """

    def _denied(self):
        return mock.patch.object(
            labels.frappe, "has_permission", side_effect=frappe.PermissionError("no write")
        )

    def test_set_label_asks_permission_before_it_refuses_a_linked_sheet(self):
        with (
            self._denied(),
            mock.patch.object(labels.frappe, "get_doc", return_value=mock.Mock(sheet="SH-1")),
            mock.patch.object(labels, "_refuse_linked_sheet") as refuse,
            self.assertRaises(frappe.PermissionError),
        ):
            labels.set_label("SS-1", "named")
        refuse.assert_not_called()

    def test_delete_asks_permission_before_it_refuses_a_linked_sheet(self):
        row = SimpleNamespace(sheet="SH-1", pinned=0)
        with (
            self._denied(),
            mock.patch.object(labels.frappe.db, "get_value", return_value=row),
            mock.patch.object(labels, "_refuse_linked_sheet") as refuse,
            mock.patch.object(labels.frappe, "delete_doc") as delete_doc,
            self.assertRaises(frappe.PermissionError),
        ):
            labels.delete("SS-1")
        refuse.assert_not_called()
        delete_doc.assert_not_called()


class ChildRowAuthority(unittest.TestCase):
    """`Sheet Snapshot` and `Sheet Op Log` guards, the Sheets twin of 77a877400.

    Build preserves both child doctypes after it links their parent sheet, so a
    surviving `DocShare` on one row is a way around `Drive Grant` for exactly
    the window `Sheet`'s own guards cover.
    """

    CHILD_QUERIES = (
        (permissions.sheet_snapshot_query, "Sheet Snapshot"),
        (permissions.sheet_op_log_query, "Sheet Op Log"),
    )

    def _roles(self, *roles):
        return mock.patch.object(permissions.frappe, "get_roles", return_value=["All", *roles])

    def _escape(self):
        return mock.patch.object(permissions.frappe.db, "escape", side_effect=lambda user: f"'{user}'")

    def test_both_child_lists_refuse_through_drive_not_through_raw_sql(self):
        # The app-local guard asked `parent.node IS NOT NULL`, which reads an
        # unset Link as linked, and raised `frappe.PermissionError`, which
        # `frappe.desk.notifications` and `desktop` swallow.
        for query, doctype in self.CHILD_QUERIES:
            with (
                self.subTest(doctype=doctype),
                self._roles(),
                self._escape(),
                mock.patch.object(permissions.drive, "refuse_shared_child_rows") as refuse,
            ):
                query("reader@example.com")
                refuse.assert_called_once_with(doctype, "Sheet", "sheet", "node", "reader@example.com")

    def test_both_child_predicates_read_an_unset_link_as_unlinked(self):
        # Two arms carry the test: the owner arm and the `DocShare` arm.
        for query, doctype in self.CHILD_QUERIES:
            with (
                self.subTest(doctype=doctype),
                self._roles(),
                self._escape(),
                mock.patch.object(permissions.drive, "refuse_shared_child_rows"),
            ):
                predicate = query("reader@example.com")
            self.assertEqual(predicate.count("`tabSheet`.`node` IS NULL OR `tabSheet`.`node` = ''"), 2)
            self.assertNotIn("IS NOT NULL", predicate)

    def test_only_the_administrator_skips_the_child_guards(self):
        # §4.9 grants a bypass to the Administrator and a Suite Admin, never to
        # a role. A `System Manager` holds full CRUD on both child doctypes, so
        # the old role bypass opened every migrated sheet's snapshot rows.
        with (
            self._roles("System Manager", "Suite Admin"),
            self._escape(),
            mock.patch.object(permissions.drive, "refuse_shared_child_rows") as refuse,
        ):
            predicate = permissions.sheet_snapshot_query("sm@example.com")
        refuse.assert_called_once()
        self.assertIn("`tabSheet`.`node` = ''", predicate)

        with (
            self._roles("System Manager", "Suite Admin"),
            mock.patch.object(permissions.frappe.db, "get_value", return_value="NODE-1"),
            mock.patch.object(permissions.drive, "refuse_shared_row") as refuse_row,
        ):
            self.assertFalse(
                permissions.sheet_snapshot_has_permission(
                    {"doctype": "Sheet Snapshot", "name": "SS-1", "sheet": "SH-1"},
                    "read",
                    "sm@example.com",
                )
            )
        refuse_row.assert_called_once_with("Sheet Snapshot", "SS-1", "read", "sm@example.com")

    def test_the_administrator_is_allowed_and_asks_the_database_nothing(self):
        with (
            self._roles(),
            mock.patch.object(permissions.drive, "refuse_shared_child_rows") as refuse,
            mock.patch.object(permissions.frappe.db, "get_value") as read,
        ):
            self.assertEqual(permissions.sheet_snapshot_query("Administrator"), "")
            self.assertTrue(
                permissions.sheet_snapshot_has_permission(
                    {"doctype": "Sheet Snapshot", "name": "SS-1", "sheet": "SH-1"},
                    "read",
                    "Administrator",
                )
            )
        refuse.assert_not_called()
        read.assert_not_called()

    def test_a_system_manager_keeps_the_unlinked_child_read(self):
        # Closing the linked side takes no legacy read away: `Sheet` still
        # answers Yes for an unlinked parent, and that is ticket 19's rule.
        with (
            self._roles("System Manager"),
            mock.patch.object(permissions.frappe.db, "get_value", return_value=""),
            mock.patch.object(permissions.frappe, "has_permission", return_value=True) as parent,
        ):
            self.assertTrue(
                permissions.sheet_snapshot_has_permission(
                    {"doctype": "Sheet Snapshot", "name": "SS-1", "sheet": "SH-1"},
                    "read",
                    "sm@example.com",
                )
            )
        parent.assert_called_once_with("Sheet", doc="SH-1", ptype="read", user="sm@example.com")


if __name__ == "__main__":
    unittest.main()
