import io
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.storage.blob import put_blob
from frappe.storage.driver import get_driver
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.drive._core.errors import DriveConflict, DriveForbidden, DriveOverQuota
from suite.drive._core.nodes import create_file, update
from suite.drive._core.principals import Principals
from suite.drive._core.quota import admit
from suite.drive._core.roles import EDIT
from suite.drive._core.roots import create_root
from suite.drive._core.versions import (
    DEFAULT_LADDER,
    _normalized_ladder,
    _pick_deletions,
    _require_version_node,
    _retention_bucket,
    _thin_node,
    delete_version,
    label_version,
    list_versions,
    restore_version,
    take_version,
    thin,
)
from suite.drive.jobs import thin_versions
from suite.hooks import scheduler_events
from suite.tests.utils import ensure_user

USER = "drive-version-user@example.com"
OTHER = "drive-version-other@example.com"


class TestVersionLadder(UnitTestCase):
    def test_every_default_boundary_uses_the_decided_tier(self):
        cases = {
            23.9999: ("all", 0),
            24: ("hour", 24),
            24.0001: ("hour", 24),
            24 * 7: ("day", 7),
            24 * 7 + 0.0001: ("day", 7),
            24 * 30: ("week", 4),
            24 * 30 + 0.0001: ("week", 4),
            24 * 90: ("week", 12),
            24 * 90 + 0.0001: None,
        }
        for age, expected in cases.items():
            with self.subTest(age=age):
                self.assertEqual(_retention_bucket(age, DEFAULT_LADDER), expected)

    def test_newest_row_survives_each_density_bucket(self):
        now = datetime(2026, 9, 6, 12)
        versions = [
            frappe._dict(name="all-a", creation=now - timedelta(hours=1)),
            frappe._dict(name="all-b", creation=now - timedelta(hours=23)),
            frappe._dict(name="hour-new", creation=now - timedelta(hours=25, minutes=5)),
            frappe._dict(name="hour-old", creation=now - timedelta(hours=25, minutes=55)),
            frappe._dict(name="day-new", creation=now - timedelta(days=8, hours=1)),
            frappe._dict(name="day-old", creation=now - timedelta(days=8, hours=20)),
            frappe._dict(name="week-new", creation=now - timedelta(days=40)),
            frappe._dict(name="week-old", creation=now - timedelta(days=41)),
            frappe._dict(name="expired", creation=now - timedelta(days=91)),
        ]

        removed = {row.name for row in _pick_deletions(versions, now, DEFAULT_LADDER)}

        self.assertEqual(removed, {"hour-old", "day-old", "week-old", "expired"})

    @patch("suite.drive.jobs.thin")
    def test_scheduler_adapter_delegates_to_core_thinner(self, core_thin):
        core_thin.return_value = {"deleted": 3}
        self.assertEqual(thin_versions(), {"deleted": 3})
        core_thin.assert_called_once_with()

    @patch("suite.drive._core.versions.frappe.log_error")
    @patch("suite.drive._core.versions.frappe.db.rollback")
    @patch("suite.drive._core.versions.frappe.db.commit")
    @patch(
        "suite.drive._core.versions._thin_node",
        side_effect=[
            {"scanned": 2, "deleted": 1, "released_bytes": 7},
            RuntimeError("boom"),
            {"scanned": 1, "deleted": 0, "released_bytes": 0},
        ],
    )
    @patch("suite.drive._core.versions.frappe.db.sql", return_value=["a", "b", "c"])
    @patch("suite.drive._core.versions.now_datetime", return_value=datetime(2026, 9, 6, 12))
    def test_thin_commits_each_node_and_isolates_one_failure(
        self, now, _sql, thin_one, commit, rollback, log_error
    ):
        self.assertEqual(
            thin(),
            {"nodes": 3, "scanned": 3, "deleted": 1, "released_bytes": 7, "failed": 1},
        )
        self.assertEqual(thin_one.call_count, 3)
        self.assertEqual(commit.call_count, 2)
        rollback.assert_called_once_with()
        log_error.assert_called_once()
        # One clock read for the whole pass: every node and the SQL cutoff share it.
        now.assert_called_once_with()
        self.assertEqual({call.args[1] for call in thin_one.call_args_list}, {now.return_value})
        self.assertEqual(
            _sql.call_args.args[1]["cutoff"],
            now.return_value - timedelta(hours=DEFAULT_LADDER["keep_all_hours"]),
        )

    def test_thinner_is_registered_once_as_a_daily_scheduler_event(self):
        registered = []
        for events in scheduler_events.values():
            if isinstance(events, dict):
                for schedule in events.values():
                    registered.extend(schedule)
            else:
                registered.extend(events)
        self.assertIn("suite.drive.jobs.thin_versions", scheduler_events["daily"])
        self.assertEqual(registered.count("suite.drive.jobs.thin_versions"), 1)

    def test_only_files_and_documents_have_versions(self):
        for kind in ("file", "document"):
            _require_version_node(frappe._dict(kind=kind))
        with self.assertRaises(DriveForbidden) as caught:
            _require_version_node(frappe._dict(kind="root"))
        self.assertIn("does not apply to a Drive root", str(caught.exception))
        for kind in ("folder", "link"):
            with self.subTest(kind=kind), self.assertRaises(DriveConflict):
                _require_version_node(frappe._dict(kind=kind))

    def test_configured_ladder_overrides_are_validated(self):
        self.assertEqual(_normalized_ladder({"keep_all_hours": 1})["keep_all_hours"], 1)
        with patch.dict(frappe.conf, {"drive_version_ladder": {"weekly_until_hours": 24 * 120}}):
            self.assertEqual(_normalized_ladder(None)["weekly_until_hours"], 24 * 120)
        bad_ladders = (
            {"nope": 1},
            {"keep_all_hours": -1},
            {"keep_all_hours": True},
            {"keep_all_hours": 999999},
            [],
        )
        for bad in bad_ladders:
            with self.subTest(ladder=bad), self.assertRaises(frappe.ValidationError):
                _normalized_ladder(bad)


class TestVersionWorkflows(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(USER)
        ensure_user(OTHER)

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self._blobs_before = set(frappe.get_all("File Blob", pluck="name"))
        self.root = create_root(kind="Personal", title="Version root", user=USER)
        self.admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        self.content_doc = frappe.get_doc(
            {"doctype": "ToDo", "description": f"Drive version fixture {self.root.name}"}
        ).insert(ignore_permissions=True)

    def tearDown(self):
        frappe.set_user("Administrator")
        nodes = tuple(
            frappe.db.sql(
                "SELECT name FROM `tabDrive Node` WHERE name = %s OR root = %s",
                (self.root.name, self.root.name),
                pluck=True,
            )
        )
        if nodes:
            for doctype in ("Drive Node Version", "Drive Grant", "Drive Activity"):
                frappe.db.delete(doctype, {"node": ["in", nodes]})
            frappe.db.delete("Drive Node", {"name": ["in", nodes]})
        frappe.db.delete("Drive Root", {"name": self.root.name})
        frappe.delete_doc("ToDo", self.content_doc.name, force=1, ignore_permissions=True)
        for blob in set(frappe.get_all("File Blob", pluck="name")) - self._blobs_before:
            frappe.delete_doc("File Blob", blob, force=1, ignore_permissions=True, ignore_missing=True)
        frappe.db.commit()
        super().tearDown()

    def _blob(self, content: bytes):
        return put_blob(io.BytesIO(content), is_private=True, filename="version.bin")

    def _file(self, content: bytes = b"head") -> str:
        blob = self._blob(content)
        return create_file(
            self.admin,
            self.root.name,
            "version.bin",
            blob=blob.name,
            size=blob.file_size,
            mime=blob.mime_type,
        )

    def _document(self) -> str:
        return (
            frappe.get_doc(
                {
                    "doctype": "Drive Node",
                    "title": "Document",
                    "parent": self.root.name,
                    "root": self.root.name,
                    "path": "",
                    "kind": "document",
                    "state": "Active",
                    "size": 0,
                    "mime": "frappe/fake",
                    "content_doctype": "ToDo",
                    "content_docname": self.content_doc.name,
                    "is_template": 0,
                }
            )
            .insert(ignore_permissions=True)
            .name
        )

    def _bytes(self, blob_name: str) -> bytes:
        blob = frappe.get_doc("File Blob", blob_name)
        with get_driver(blob.driver).read(blob.key, is_private=bool(blob.is_private)) as stream:
            return stream.read()

    def test_take_list_label_pin_delete_and_immutable_bytes(self):
        node = self._file(b"head")
        used_before = frappe.db.get_value("Drive Root", self.root.name, "used_bytes")

        seq = take_version(self.admin, node, kind="named", label="First")
        self.assertEqual(seq, 1)
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), used_before + 4)
        rows = list_versions(self.admin, node)
        self.assertEqual([(row.seq, row.kind, row.label) for row in rows], [(1, "named", "First")])

        label_version(self.admin, node, 1, label="Release", pinned=True)
        version = frappe.get_doc("Drive Node Version", rows[0].name)
        self.assertEqual((version.label, version.pinned), ("Release", 1))
        version.size = 99
        with self.assertRaises(frappe.ValidationError):
            version.save(ignore_permissions=True)
        version.reload()
        version.creation = version.creation - timedelta(seconds=1)
        with self.assertRaises(frappe.ValidationError):
            version.save(ignore_permissions=True)

        delete_version(self.admin, node, 1)
        self.assertFalse(frappe.db.exists("Drive Node Version", {"node": node, "seq": 1}))
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), used_before)

    def test_edit_can_take_and_label_but_only_manage_can_delete(self):
        node = self._file(b"head")
        frappe.get_doc({"doctype": "Drive Grant", "node": node, "principal": OTHER, "role": EDIT}).insert(
            ignore_permissions=True
        )
        editor = Principals(OTHER, (OTHER,), ("$PUBLIC",))

        seq = take_version(editor, node)
        label_version(editor, node, seq, label="Editor", pinned=True)
        with self.assertRaises(DriveForbidden):
            delete_version(editor, node, seq)

    def test_file_restore_captures_current_head_and_admits_only_restored_head(self):
        node = self._file(b"old")
        target_seq = take_version(self.admin, node, kind="named", label="old")
        replacement = self._blob(b"new-content")
        update(
            self.admin,
            node,
            blob=replacement.name,
            size=replacement.file_size,
            mime=replacement.mime_type,
        )
        used_before = frappe.db.get_value("Drive Root", self.root.name, "used_bytes")
        versions_before = frappe.db.count("Drive Node Version", {"node": node})

        captured = restore_version(self.admin, node, target_seq)

        head = frappe.db.get_value("Drive Node", node, ["blob", "size"], as_dict=True)
        target = frappe.db.get_value(
            "Drive Node Version", {"node": node, "seq": target_seq}, ["blob", "size"], as_dict=True
        )
        captured_row = frappe.db.get_value(
            "Drive Node Version", {"node": node, "seq": captured}, ["blob", "size"], as_dict=True
        )
        self.assertEqual((head.blob, head.size), (target.blob, target.size))
        self.assertEqual((captured_row.blob, captured_row.size), (replacement.name, len(b"new-content")))
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": node}), versions_before + 1)
        self.assertEqual(
            frappe.db.get_value("Drive Root", self.root.name, "used_bytes"),
            used_before + target.size,
        )

    def test_zero_byte_file_restore_skips_old_head_version(self):
        empty = self._blob(b"")
        node = create_file(
            self.admin,
            self.root.name,
            "empty.bin",
            blob=empty.name,
            size=empty.file_size,
            mime=empty.mime_type,
        )
        target = self._blob(b"old")
        frappe.get_doc(
            {
                "doctype": "Drive Node Version",
                "node": node,
                "seq": 1,
                "kind": "named",
                "actor": "Administrator",
                "size": target.file_size,
                "blob": target.name,
            }
        ).insert(ignore_permissions=True)
        admit(self.root.name, target.file_size)
        used_before = frappe.db.get_value("Drive Root", self.root.name, "used_bytes")

        self.assertEqual(restore_version(self.admin, node, 1), 0)

        self.assertEqual(frappe.db.count("Drive Node Version", {"node": node}), 1)
        self.assertEqual(frappe.db.get_value("Drive Node", node, "blob"), target.name)
        self.assertEqual(
            frappe.db.get_value("Drive Root", self.root.name, "used_bytes"),
            used_before + target.file_size,
        )

    def test_restore_quota_refusal_rolls_back_capture_and_head(self):
        node = self._file(b"old")
        target_seq = take_version(self.admin, node)
        replacement = self._blob(b"new")
        update(
            self.admin,
            node,
            blob=replacement.name,
            size=replacement.file_size,
            mime=replacement.mime_type,
        )
        before = frappe.db.get_value("Drive Root", self.root.name, "used_bytes")
        frappe.db.set_value("Drive Root", self.root.name, "quota_bytes", before + 2)
        count_before = frappe.db.count("Drive Node Version", {"node": node})

        with self.assertRaises(DriveOverQuota):
            restore_version(self.admin, node, target_seq)

        self.assertEqual(frappe.db.get_value("Drive Node", node, "blob"), replacement.name)
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": node}), count_before)
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), before)

    def test_content_callbacks_round_trip_bytes_and_charge_captures(self):
        node = self._document()
        content = {"body": b"one"}

        def version_bytes(docname):
            self.assertEqual(docname, self.content_doc.name)
            return io.BytesIO(content["body"]), "application/json"

        def restore(docname, stream):
            self.assertEqual(docname, self.content_doc.name)
            content["body"] = stream.read()

        spec = SimpleNamespace(doctype="ToDo", version_bytes=version_bytes, restore_version=restore)
        real_get_hooks = frappe.get_hooks

        def fake_hooks(key, *args, **kwargs):
            if key == "drive_content_types":
                return ("fake.spec",)
            return real_get_hooks(key, *args, **kwargs)

        with (
            patch("suite.drive._core.versions.frappe.get_hooks", side_effect=fake_hooks),
            patch("suite.drive._core.versions.get_attr", return_value=spec),
        ):
            first = take_version(self.admin, node, kind="milestone", label="One")
            content["body"] = b"two"
            captured = restore_version(self.admin, node, first)

        versions = {
            row.seq: row
            for row in frappe.get_all(
                "Drive Node Version", filters={"node": node}, fields=["seq", "blob", "size"]
            )
        }
        self.assertEqual(content["body"], b"one")
        self.assertEqual(self._bytes(versions[captured].blob), b"two")
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), 6)

    def test_concurrent_take_allocates_unique_monotonic_sequences(self):
        node = self._file(b"x")
        frappe.db.commit()
        site = frappe.local.site
        barrier = Barrier(4)

        def capture():
            frappe.init(site, force=True)
            frappe.connect()
            frappe.set_user("Administrator")
            try:
                barrier.wait(timeout=10)
                seq = take_version(self.admin, node)
                frappe.db.commit()
                return seq
            finally:
                frappe.destroy()

        with ThreadPoolExecutor(max_workers=4) as pool:
            sequences = [future.result(timeout=30) for future in [pool.submit(capture) for _ in range(4)]]

        frappe.db.rollback()
        self.assertEqual(sorted(sequences), [1, 2, 3, 4])
        self.assertEqual(
            frappe.get_all("Drive Node Version", filters={"node": node}, pluck="seq", order_by="seq"),
            [1, 2, 3, 4],
        )

    def test_thin_keeps_protected_versions_and_releases_removed_sizes(self):
        node = self._file(b"x")
        now = datetime(2026, 9, 6, 12)
        blob = frappe.db.get_value("Drive Node", node, "blob")
        cases = (
            (1, "auto", 0, now - timedelta(hours=25, minutes=5)),
            (2, "auto", 0, now - timedelta(hours=25, minutes=55)),
            (3, "auto", 0, now - timedelta(days=91)),
            (4, "auto", 1, now - timedelta(days=91)),
            (5, "named", 0, now - timedelta(days=91)),
            (6, "milestone", 0, now - timedelta(days=91)),
        )
        for seq, kind, pinned, creation in cases:
            version = frappe.get_doc(
                {
                    "doctype": "Drive Node Version",
                    "node": node,
                    "seq": seq,
                    "kind": kind,
                    "pinned": pinned,
                    "actor": "Administrator",
                    "size": 1,
                    "blob": blob,
                }
            ).insert(ignore_permissions=True)
            frappe.db.set_value(
                "Drive Node Version", version.name, "creation", creation, update_modified=False
            )
        admit(self.root.name, len(cases))
        used_before = frappe.db.get_value("Drive Root", self.root.name, "used_bytes")

        with patch("suite.drive._core.versions.now_datetime", return_value=now):
            result = thin()

        remaining = set(
            frappe.get_all("Drive Node Version", filters={"node": node}, pluck="seq", order_by="seq")
        )
        self.assertEqual(remaining, {1, 4, 5, 6})
        self.assertEqual(result, {"nodes": 1, "scanned": 3, "deleted": 2, "released_bytes": 2, "failed": 0})
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), used_before - 2)

    def test_trashed_node_keeps_history_management_but_refuses_content_writes(self):
        node = self._file(b"x")
        seq = take_version(self.admin, node)
        update(self.admin, node, state="Trashed")
        used_before = frappe.db.get_value("Drive Root", self.root.name, "used_bytes")

        self.assertEqual([row.seq for row in list_versions(self.admin, node)], [seq])
        # §8.8 opens a trashed node read-only, so nothing may write its bytes.
        with self.assertRaises(DriveForbidden):
            take_version(self.admin, node)
        with self.assertRaises(DriveForbidden):
            restore_version(self.admin, node, seq)

        # §9.1 gives label EDIT and delete MANAGE as their one condition, and
        # §7.1 makes deleting a version the way to free its bytes.
        label_version(self.admin, node, seq, label="kept", pinned=True)
        self.assertEqual(
            frappe.db.get_value("Drive Node Version", {"node": node, "seq": seq}, "label"), "kept"
        )
        size = frappe.db.get_value("Drive Node Version", {"node": node, "seq": seq}, "size")
        delete_version(self.admin, node, seq)
        self.assertFalse(frappe.db.exists("Drive Node Version", {"node": node, "seq": seq}))
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), used_before - size)

    def test_every_root_version_workflow_is_refused(self):
        root = self.root.name
        workflows = (
            ("list", lambda: list_versions(self.admin, root)),
            ("take", lambda: take_version(self.admin, root)),
            ("label", lambda: label_version(self.admin, root, 1, label="x", pinned=True)),
            ("delete", lambda: delete_version(self.admin, root, 1)),
            ("restore", lambda: restore_version(self.admin, root, 1)),
        )
        for name, call in workflows:
            with self.subTest(workflow=name):
                with self.assertRaises(DriveForbidden) as caught:
                    call()
                self.assertIn("does not apply to a Drive root", str(caught.exception))
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": root}), 0)
