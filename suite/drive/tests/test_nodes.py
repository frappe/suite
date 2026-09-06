import io
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event, local
from unittest.mock import call, patch

import frappe
from frappe.storage.blob import put_blob
from frappe.tests import IntegrationTestCase, UnitTestCase
from frappe.utils import now_datetime

from suite.drive._core import nodes as node_workflows
from suite.drive._core.access import effective_role
from suite.drive._core.errors import (
    DriveConflict,
    DriveForbidden,
    DriveNotFound,
    DriveOverQuota,
)
from suite.drive._core.nodes import (
    _content_purge_callbacks,
    _purge_locked,
    _require_restore_actor,
    _subtree_charge,
    copy,
    create_file,
    create_folder,
    create_link,
    purge,
    update,
)
from suite.drive._core.principals import Principals
from suite.drive._core.roles import EDIT, UPLOAD
from suite.drive._core.roots import create_root
from suite.drive.jobs import purge_trashed_nodes
from suite.drive.tests.test_content import registered as registered_content
from suite.drive.tests.test_content import spec as content_spec
from suite.tests.utils import ensure_user

USER = "drive-lifecycle-user@example.com"
OTHER = "drive-lifecycle-other@example.com"
LINK_A = "$LINK:" + "A" * 22
LINK_B = "$LINK:" + "B" * 22


class TestNodeLifecycle(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(USER)
        ensure_user(OTHER)

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self._blobs_before = set(frappe.get_all("File Blob", pluck="name"))
        self.root = create_root(kind="Personal", title="Lifecycle A", user=USER)
        self.other_root = create_root(kind="Personal", title="Lifecycle B", user=OTHER)
        self.root_ids = (self.root.name, self.other_root.name)
        self.admin = Principals("Administrator", ("Administrator",), (), is_admin=True)

    def tearDown(self):
        frappe.set_user("Administrator")
        placeholders = ", ".join(["%s"] * len(self.root_ids))
        node_ids = tuple(
            frappe.db.sql(
                f"SELECT name FROM `tabDrive Node` WHERE name IN ({placeholders}) "
                f"OR root IN ({placeholders})",
                self.root_ids * 2,
                pluck=True,
            )
        )
        if node_ids:
            for doctype in ("Drive Node Version", "Drive Grant", "Drive Activity"):
                frappe.db.delete(doctype, {"node": ["in", node_ids]})
            frappe.db.delete("Drive Node", {"name": ["in", node_ids]})
        frappe.db.delete("Drive Root", {"name": ["in", self.root_ids]})
        for blob in set(frappe.get_all("File Blob", pluck="name")) - self._blobs_before:
            frappe.delete_doc("File Blob", blob, force=1, ignore_permissions=True, ignore_missing=True)
        frappe.db.commit()
        super().tearDown()

    def _blob(self, content: bytes = b"bytes"):
        return put_blob(io.BytesIO(content), is_private=True, filename="node.bin")

    def _file(self, parent: str, title: str = "node.bin", content: bytes = b"bytes") -> str:
        blob = self._blob(content)
        return create_file(
            self.admin,
            parent,
            title,
            blob=blob.name,
            size=blob.file_size,
            mime=blob.mime_type,
        )

    def test_create_folder_and_link_enforce_shapes_and_document_leaf_boundary(self):
        folder = create_folder(self.admin, self.root.name, "Folder")
        link = create_link(self.admin, folder, "Guide", url="https://example.test/guide")
        folder_row = frappe.db.get_value("Drive Node", folder, "*", as_dict=True)
        link_row = frappe.db.get_value("Drive Node", link, "*", as_dict=True)
        self.assertEqual((folder_row.kind, folder_row.path, folder_row.size), ("folder", "", 0))
        self.assertEqual(
            (link_row.kind, link_row.url, link_row.size), ("link", "https://example.test/guide", 0)
        )

        document = self._raw_document(folder)
        before = frappe.db.count("Drive Node", {"root": self.root.name})
        with self.assertRaises(DriveConflict):
            create_folder(self.admin, document, "Hidden folder")
        with self.assertRaises(DriveConflict):
            create_link(self.admin, document, "Hidden link", url="https://example.test")
        self.assertEqual(frappe.db.count("Drive Node", {"root": self.root.name}), before)

    def test_create_refuses_level_41(self):
        parent = self.root.name
        for depth in range(1, 41):
            parent = create_folder(self.admin, parent, f"Level {depth}")
        with self.assertRaises(DriveConflict):
            create_folder(self.admin, parent, "Level 41")

    def test_rename_refuses_active_collision_but_ignores_trashed_sibling(self):
        first = create_folder(self.admin, self.root.name, "One")
        second = create_folder(self.admin, self.root.name, "Two")
        with self.assertRaises(DriveConflict):
            update(self.admin, second, title="One")
        update(self.admin, first, state="Trashed")
        renamed = update(self.admin, second, title="One")
        self.assertEqual(renamed.title, "One")
        self.assertEqual(frappe.db.count("Drive Activity", {"node": second, "action": "rename"}), 1)

    def test_move_rewrites_active_and_independently_trashed_descendants(self):
        source = create_folder(self.admin, self.root.name, "Source")
        inner = create_folder(self.admin, source, "Inner")
        leaf = create_folder(self.admin, inner, "Leaf")
        destination = create_folder(self.admin, self.root.name, "Destination")
        update(self.admin, inner, state="Trashed")
        before_stamp = frappe.db.get_value("Drive Node", inner, ["trash_root", "trashed_at"], as_dict=True)

        update(self.admin, source, parent=destination)

        moved = frappe.db.get_value("Drive Node", source, ["parent", "path"], as_dict=True)
        inner_row = frappe.db.get_value(
            "Drive Node", inner, ["path", "state", "trash_root", "trashed_at"], as_dict=True
        )
        leaf_row = frappe.db.get_value("Drive Node", leaf, ["path", "state", "trash_root"], as_dict=True)
        self.assertEqual(moved.parent, destination)
        self.assertIn(f"/{destination}/{source}/", inner_row.path)
        self.assertEqual(
            (inner_row.state, inner_row.trash_root, inner_row.trashed_at),
            ("Trashed", inner, before_stamp.trashed_at),
        )
        self.assertEqual((leaf_row.state, leaf_row.trash_root), ("Trashed", inner))

    def test_move_refuses_cycle_and_quota_failure_rolls_back_every_write(self):
        source = create_folder(self.admin, self.root.name, "Source")
        child = create_folder(self.admin, source, "Child")
        with self.assertRaises(DriveConflict):
            update(self.admin, source, parent=child)
        self.assertEqual(frappe.db.get_value("Drive Node", source, "parent"), self.root.name)

        self._file(source, content=b"12345")
        frappe.db.set_value("Drive Root", self.other_root.name, "quota_bytes", 4)
        source_before = frappe.db.get_value("Drive Root", self.root.name, "used_bytes")
        activities_before = frappe.db.count("Drive Activity", {"node": source, "action": "move"})
        with self.assertRaises(DriveOverQuota):
            update(self.admin, source, parent=self.other_root.name)
        self.assertEqual(frappe.db.get_value("Drive Node", source, "parent"), self.root.name)
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), source_before)
        self.assertEqual(frappe.db.get_value("Drive Root", self.other_root.name, "used_bytes"), 0)
        self.assertEqual(
            frappe.db.count("Drive Activity", {"node": source, "action": "move"}), activities_before
        )

    def test_root_guards_refuse_ordinary_lifecycle_but_allow_rename(self):
        renamed = update(self.admin, self.root.name, title="Renamed root")
        self.assertEqual(renamed.title, "Renamed root")
        with self.assertRaises(DriveForbidden):
            update(self.admin, self.root.name, parent=self.other_root.name)
        with self.assertRaises(DriveForbidden):
            update(self.admin, self.root.name, state="Trashed")
        with self.assertRaises(DriveForbidden):
            copy(self.admin, self.root.name, self.other_root.name)
        with self.assertRaises(DriveForbidden):
            purge(self.admin, self.root.name)

    def test_move_keeps_direct_edit_grant_without_duplicate(self):
        shared = create_root(kind="Shared", title="Shared lifecycle")
        self.root_ids += (shared.name,)
        source = create_folder(self.admin, shared.name, "Source")
        destination = create_folder(self.admin, shared.name, "Destination")
        frappe.get_doc({"doctype": "Drive Grant", "node": source, "principal": USER, "role": EDIT}).insert(
            ignore_permissions=True
        )
        user = Principals(USER, (USER, "$GENERAL"), ("$PUBLIC",))

        update(user, source, parent=destination)

        self.assertEqual(frappe.db.count("Drive Grant", {"node": source, "principal": USER}), 1)
        self.assertEqual(
            frappe.db.get_value("Drive Grant", {"node": source, "principal": USER}, "role"), EDIT
        )

    def test_move_adds_edit_when_source_ancestor_authority_is_lost(self):
        source = create_folder(self.admin, self.root.name, "Source")
        destination = create_folder(self.admin, self.other_root.name, "Destination")
        frappe.get_doc(
            {"doctype": "Drive Grant", "node": self.other_root.name, "principal": USER, "role": 30}
        ).insert(ignore_permissions=True)
        user = Principals(USER, (USER,), ("$PUBLIC",))

        update(user, source, parent=destination)

        self.assertEqual(
            frappe.db.get_value("Drive Grant", {"node": source, "principal": USER}, "role"), EDIT
        )

    def test_move_and_descendant_create_serialize_without_tree_drift(self):
        source = create_folder(self.admin, self.root.name, "Source")
        descendant = create_folder(self.admin, source, "Descendant")
        destination = create_folder(self.admin, self.other_root.name, "Destination")
        frappe.db.commit()
        site = frappe.local.site
        barrier = Barrier(2)

        def move_tree():
            frappe.init(site, force=True)
            frappe.connect()
            frappe.set_user("Administrator")
            try:
                barrier.wait(timeout=10)
                update(self.admin, source, parent=destination)
                frappe.db.commit()
            finally:
                frappe.destroy()

        def create_child():
            frappe.init(site, force=True)
            frappe.connect()
            frappe.set_user("Administrator")
            try:
                barrier.wait(timeout=10)
                child = create_folder(self.admin, descendant, "Concurrent child")
                frappe.db.commit()
                return child
            finally:
                frappe.destroy()

        with ThreadPoolExecutor(max_workers=2) as pool:
            moved = pool.submit(move_tree)
            created = pool.submit(create_child)
            moved.result(timeout=30)
            child = created.result(timeout=30)

        frappe.db.rollback()
        child_row = frappe.db.get_value("Drive Node", child, ["root", "path"], as_dict=True)
        self.assertEqual(child_row.root, self.other_root.name)
        self.assertIn(f"/{destination}/{source}/{descendant}/", child_row.path)

    def test_move_and_descendant_create_do_not_reverse_node_lock_order(self):
        source = create_folder(self.admin, self.root.name, "Source")
        descendant = create_folder(self.admin, source, "Descendant")
        destination = create_folder(self.admin, self.other_root.name, "Destination")
        frappe.db.commit()
        site = frappe.local.site
        operation = local()
        create_parent_locked = Event()
        allow_create_ancestry = Event()
        original_node = node_workflows._node
        original_subtree = node_workflows._subtree

        def coordinated_node(node_id, *, for_update=False):
            row = original_node(node_id, for_update=for_update)
            if for_update and node_id == descendant and getattr(operation, "name", None) == "create":
                create_parent_locked.set()
                allow_create_ancestry.wait(timeout=1)
            return row

        def coordinated_subtree(node):
            if node.get("name") == source and getattr(operation, "name", None) == "move":
                create_parent_locked.wait(timeout=1)
                allow_create_ancestry.set()
            return original_subtree(node)

        def move_tree():
            frappe.init(site, force=True)
            frappe.connect()
            frappe.set_user("Administrator")
            operation.name = "move"
            try:
                update(self.admin, source, parent=destination)
                frappe.db.commit()
            finally:
                frappe.destroy()

        def create_child():
            frappe.init(site, force=True)
            frappe.connect()
            frappe.set_user("Administrator")
            operation.name = "create"
            try:
                child = create_folder(self.admin, descendant, "Concurrent child")
                frappe.db.commit()
                return child
            finally:
                frappe.destroy()

        with (
            patch.object(node_workflows, "_node", side_effect=coordinated_node),
            patch.object(node_workflows, "_subtree", side_effect=coordinated_subtree),
            ThreadPoolExecutor(max_workers=2) as pool,
        ):
            created = pool.submit(create_child)
            self.assertTrue(
                create_parent_locked.wait(timeout=10), "descendant create did not lock its parent"
            )
            moved = pool.submit(move_tree)
            moved.result(timeout=30)
            child = created.result(timeout=30)

        frappe.db.rollback()
        child_row = frappe.db.get_value("Drive Node", child, ["root", "path"], as_dict=True)
        self.assertEqual(child_row.root, self.other_root.name)
        self.assertIn(f"/{destination}/{source}/{descendant}/", child_row.path)

    def test_move_and_destination_create_do_not_reverse_node_lock_order(self):
        source = create_folder(self.admin, self.root.name, "Source")
        destination_ancestor = create_folder(self.admin, self.other_root.name, "Destination ancestor")
        destination = create_folder(self.admin, destination_ancestor, "Destination")
        frappe.db.commit()
        site = frappe.local.site
        operation = local()
        create_ancestor_locked = Event()
        move_destination_locked = Event()
        original_node = node_workflows._node

        def coordinated_node(node_id, *, for_update=False):
            row = original_node(node_id, for_update=for_update)
            if not for_update:
                return row
            if node_id == destination_ancestor and getattr(operation, "name", None) == "create":
                create_ancestor_locked.set()
                move_destination_locked.wait(timeout=1)
            elif node_id == destination and getattr(operation, "name", None) == "move":
                move_destination_locked.set()
                if not create_ancestor_locked.wait(timeout=10):
                    raise AssertionError("destination create did not reach its ancestor lock")
            return row

        def move_tree():
            frappe.init(site, force=True)
            frappe.connect()
            frappe.set_user("Administrator")
            operation.name = "move"
            try:
                update(self.admin, source, parent=destination)
                frappe.db.commit()
            finally:
                frappe.destroy()

        def create_child():
            frappe.init(site, force=True)
            frappe.connect()
            frappe.set_user("Administrator")
            operation.name = "create"
            try:
                child = create_folder(self.admin, destination, "Concurrent child")
                frappe.db.commit()
                return child
            finally:
                frappe.destroy()

        with (
            patch.object(node_workflows, "_node", side_effect=coordinated_node),
            ThreadPoolExecutor(max_workers=2) as pool,
        ):
            created = pool.submit(create_child)
            self.assertTrue(
                create_ancestor_locked.wait(timeout=10), "destination create did not lock its ancestor"
            )
            moved = pool.submit(move_tree)
            moved.result(timeout=30)
            child = created.result(timeout=30)

        frappe.db.rollback()
        self.assertEqual(frappe.db.get_value("Drive Node", source, "parent"), destination)
        child_row = frappe.db.get_value("Drive Node", child, ["root", "path"], as_dict=True)
        self.assertEqual(child_row.root, self.other_root.name)
        self.assertIn(f"/{destination_ancestor}/{destination}/", child_row.path)

    def test_cross_root_move_transfers_head_and_version_charge_once(self):
        source = create_folder(self.admin, self.root.name, "Source")
        file_node = self._file(source, content=b"12345")
        blob = frappe.db.get_value("Drive Node", file_node, "blob")
        frappe.get_doc(
            {
                "doctype": "Drive Node Version",
                "node": file_node,
                "seq": 1,
                "kind": "auto",
                "actor": "Administrator",
                "size": 5,
                "blob": blob,
            }
        ).insert(ignore_permissions=True)
        frappe.db.set_value("Drive Root", self.root.name, "used_bytes", 10)

        update(self.admin, source, parent=self.other_root.name)

        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), 0)
        self.assertEqual(frappe.db.get_value("Drive Root", self.other_root.name, "used_bytes"), 10)
        rows = frappe.get_all("Drive Node", filters={"name": ["in", (source, file_node)]}, fields=["root"])
        self.assertEqual({row.root for row in rows}, {self.other_root.name})

    def test_nested_trash_restore_preserves_earlier_independent_stamp(self):
        outer = create_folder(self.admin, self.root.name, "Outer")
        inner = create_folder(self.admin, outer, "Inner")
        inner_leaf = create_folder(self.admin, inner, "Inner leaf")
        outer_leaf = create_folder(self.admin, outer, "Outer leaf")
        update(self.admin, inner, state="Trashed")
        inner_stamp = frappe.db.get_value("Drive Node", inner, "trashed_at")
        update(self.admin, outer, state="Trashed")

        update(self.admin, outer, state="Active")

        self.assertEqual(frappe.db.get_value("Drive Node", outer, "state"), "Active")
        self.assertEqual(frappe.db.get_value("Drive Node", outer_leaf, "state"), "Active")
        inner_row = frappe.db.get_value(
            "Drive Node", inner, ["state", "trash_root", "trashed_at"], as_dict=True
        )
        self.assertEqual(
            (inner_row.state, inner_row.trash_root, inner_row.trashed_at), ("Trashed", inner, inner_stamp)
        )
        self.assertEqual(frappe.db.get_value("Drive Node", inner_leaf, "state"), "Trashed")

    def test_original_trasher_with_direct_edit_restores_in_place_without_parent_upload(self):
        shared = create_root(kind="Shared", title="Shared lifecycle")
        self.root_ids += (shared.name,)
        child = create_folder(self.admin, shared.name, "Child")
        frappe.get_doc({"doctype": "Drive Grant", "node": child, "principal": USER, "role": EDIT}).insert(
            ignore_permissions=True
        )
        user = Principals(USER, (USER,), ("$PUBLIC",))
        parent_row = frappe.db.get_value("Drive Node", shared.name, "*", as_dict=True)
        self.assertLess(effective_role(parent_row, user), UPLOAD)

        update(user, child, state="Trashed")
        restored = update(user, child, state="Active")

        self.assertEqual((restored.parent, restored.state), (shared.name, "Active"))
        self.assertEqual(
            frappe.db.count("Drive Activity", {"node": child, "action": "restore", "actor": USER}), 1
        )

    def test_missing_restore_destination_changes_nothing_then_selected_restore_reparents_and_dedupes(self):
        parent = create_folder(self.admin, self.root.name, "Parent")
        child = create_folder(self.admin, parent, "Report.txt")
        descendant = create_folder(self.admin, child, "Descendant")
        destination = create_folder(self.admin, self.root.name, "Destination")
        create_folder(self.admin, destination, "REPORT.TXT")
        create_folder(self.admin, destination, "report (2).TXT")
        update(self.admin, child, state="Trashed")
        update(self.admin, parent, state="Trashed")
        before = frappe.db.get_value(
            "Drive Node",
            child,
            ["parent", "path", "title", "state", "trash_root", "trashed_at"],
            as_dict=True,
        )
        activity_count = frappe.db.count("Drive Activity", {"node": child})

        with self.assertRaises(DriveConflict):
            update(self.admin, child, state="Active")
        self.assertEqual(
            frappe.db.get_value(
                "Drive Node",
                child,
                ["parent", "path", "title", "state", "trash_root", "trashed_at"],
                as_dict=True,
            ),
            before,
        )
        self.assertEqual(frappe.db.count("Drive Activity", {"node": child}), activity_count)

        restored = update(self.admin, child, parent=destination, state="Active")
        self.assertEqual(
            (restored.parent, restored.title, restored.state), (destination, "Report (3).txt", "Active")
        )
        self.assertIn(f"/{destination}/{child}/", frappe.db.get_value("Drive Node", descendant, "path"))
        self.assertEqual(frappe.db.get_value("Drive Node", parent, "state"), "Trashed")

    def test_restore_rejects_cross_root_destination_and_move_cannot_bypass_restore(self):
        parent = create_folder(self.admin, self.root.name, "Parent")
        child = create_folder(self.admin, parent, "Child")
        update(self.admin, child, state="Trashed")
        update(self.admin, parent, state="Trashed")
        snapshot = frappe.db.get_value("Drive Node", child, ["parent", "path", "state"], as_dict=True)
        with self.assertRaises(DriveConflict):
            update(self.admin, child, parent=self.other_root.name, state="Active")
        with self.assertRaises(DriveForbidden):
            update(self.admin, child, parent=self.root.name)
        self.assertEqual(
            frappe.db.get_value("Drive Node", child, ["parent", "path", "state"], as_dict=True), snapshot
        )

    def test_restore_by_another_edit_actor_requires_manage(self):
        shared = create_root(kind="Shared", title="Shared lifecycle")
        self.root_ids += (shared.name,)
        child = create_folder(self.admin, shared.name, "Child")
        for user in (USER, OTHER):
            frappe.get_doc({"doctype": "Drive Grant", "node": child, "principal": user, "role": EDIT}).insert(
                ignore_permissions=True
            )
        other = Principals(OTHER, (OTHER, "$GENERAL"), ("$PUBLIC",))
        user = Principals(USER, (USER, "$GENERAL"), ("$PUBLIC",))
        update(other, child, state="Trashed")
        with self.assertRaises(DriveForbidden):
            update(user, child, state="Active")
        self.assertEqual(frappe.db.get_value("Drive Node", child, "state"), "Trashed")

    def test_copy_skips_denied_subtree_and_copies_no_source_grants_or_versions(self):
        shared = create_root(kind="Shared", title="Shared lifecycle")
        self.root_ids += (shared.name,)
        source = create_folder(self.admin, shared.name, "Source")
        visible = create_folder(self.admin, source, "Visible")
        denied = create_folder(self.admin, source, "Denied")
        create_folder(self.admin, denied, "Denied child")
        frappe.get_doc({"doctype": "Drive Grant", "node": denied, "principal": USER, "role": 0}).insert(
            ignore_permissions=True
        )
        user = Principals(USER, (USER, "$GENERAL"), ("$PUBLIC",))

        copied = copy(user, source, shared.name)

        copied_rows = frappe.get_all("Drive Node", filters={"path": ["like", f"%/{copied}/%"]}, pluck="title")
        self.assertIn("Visible", copied_rows)
        self.assertNotIn("Denied", copied_rows)
        self.assertFalse(
            frappe.db.exists("Drive Grant", {"node": copied, "principal": ["in", ("Administrator",)]})
        )
        self.assertTrue(frappe.db.exists("Drive Grant", {"node": copied, "principal": USER, "role": EDIT}))
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": copied}), 0)
        self.assertTrue(visible)

    def test_copy_shares_file_blob_and_rolls_back_destination_quota_refusal(self):
        source = create_folder(self.admin, self.root.name, "Source")
        source_file = self._file(source, "data.bin", b"12345")
        create_link(self.admin, source, "Link", url="https://example.test")
        source_blob = frappe.db.get_value("Drive Node", source_file, "blob")
        frappe.db.set_value("Drive Root", self.other_root.name, "quota_bytes", 4)
        before_nodes = frappe.db.count("Drive Node", {"root": self.other_root.name})
        with self.assertRaises(DriveOverQuota):
            copy(self.admin, source, self.other_root.name)
        self.assertEqual(frappe.db.count("Drive Node", {"root": self.other_root.name}), before_nodes)
        self.assertEqual(frappe.db.get_value("Drive Root", self.other_root.name, "used_bytes"), 0)

        frappe.db.set_value("Drive Root", self.other_root.name, "quota_bytes", 5)
        copied = copy(self.admin, source, self.other_root.name)
        copied_file = frappe.db.get_value(
            "Drive Node", {"parent": copied, "title": "data.bin"}, ["blob", "owner"], as_dict=True
        )
        copied_link = frappe.db.get_value(
            "Drive Node", {"parent": copied, "title": "Link"}, ["url", "owner"], as_dict=True
        )
        self.assertEqual((copied_file.blob, copied_file.owner), (source_blob, "Administrator"))
        self.assertEqual((copied_link.url, copied_link.owner), ("https://example.test", "Administrator"))
        self.assertEqual(frappe.db.get_value("Drive Root", self.other_root.name, "used_bytes"), 5)

    def test_copy_preflights_document_and_media_boundaries_without_mutation(self):
        source = create_folder(self.admin, self.root.name, "Source")
        document = self._raw_document(source)
        media = self._file(document, "media.bin")
        hidden_folder = self._raw_folder(document, "Hidden media folder")
        ordinary = create_folder(self.admin, self.root.name, "Ordinary")
        before_nodes = frappe.db.count("Drive Node", {"root": self.root.name})
        before_usage = frappe.db.get_value("Drive Root", self.root.name, "used_bytes")
        with self.assertRaises(DriveConflict):
            copy(self.admin, source, self.root.name)
        with self.assertRaises(DriveConflict):
            update(self.admin, media, parent=self.root.name)
        with self.assertRaises(DriveConflict):
            update(self.admin, ordinary, parent=hidden_folder)
        self.assertEqual(frappe.db.count("Drive Node", {"root": self.root.name}), before_nodes)
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), before_usage)

    def test_purge_removes_references_releases_quota_and_leaves_blob(self):
        folder = create_folder(self.admin, self.root.name, "Purge")
        file_node = self._file(folder, content=b"charged")
        blob = frappe.db.get_value("Drive Node", file_node, "blob")
        size = frappe.db.get_value("Drive Node", file_node, "size")
        frappe.get_doc(
            {
                "doctype": "Drive Node Version",
                "node": file_node,
                "seq": 1,
                "kind": "auto",
                "actor": "Administrator",
                "size": size,
                "blob": blob,
            }
        ).insert(ignore_permissions=True)
        frappe.db.set_value("Drive Root", self.root.name, "used_bytes", size * 2)
        self.assertEqual(purge(self.admin, folder), 2)
        self.assertFalse(frappe.db.exists("Drive Node", folder))
        self.assertFalse(frappe.db.exists("Drive Node", file_node))
        self.assertFalse(frappe.db.exists("Drive Grant", {"node": ["in", (folder, file_node)]}))
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), 0)
        self.assertTrue(frappe.db.exists("File Blob", blob))
        self.assertEqual(size, len(b"charged"))

    def test_malformed_subtree_and_callback_failure_roll_back_without_drift(self):
        folder = create_folder(self.admin, self.root.name, "Malformed")
        child = create_folder(self.admin, folder, "Escaped")
        frappe.db.set_value("Drive Node", child, "path", "/escaped/", update_modified=False)
        with self.assertRaises(DriveConflict):
            update(self.admin, folder, state="Trashed")
        self.assertEqual(frappe.db.get_value("Drive Node", folder, "state"), "Active")
        self.assertEqual(frappe.db.get_value("Drive Node", child, "state"), "Active")

        frappe.db.set_value("Drive Node", child, "path", f"/{folder}/", update_modified=False)
        document = self._raw_document(folder)
        before_nodes = frappe.db.count("Drive Node", {"root": self.root.name})
        before_activity = frappe.db.count("Drive Activity", {"node": folder})

        def fail_callback(_name):
            raise RuntimeError("boom")

        with (
            patch(
                "suite.drive._core.nodes._content_purge_callbacks",
                return_value=[(fail_callback, "fake-content")],
            ),
            self.assertRaises(RuntimeError),
        ):
            purge(self.admin, folder)
        self.assertTrue(frappe.db.exists("Drive Node", document))
        self.assertEqual(frappe.db.count("Drive Node", {"root": self.root.name}), before_nodes)
        self.assertEqual(frappe.db.count("Drive Activity", {"node": folder}), before_activity)

    def test_doctype_rejects_invalid_template_kind_and_incomplete_trash_stamp(self):
        empty_file = frappe.get_doc(
            {
                "doctype": "Drive Node",
                "title": "Missing bytes",
                "parent": self.root.name,
                "root": self.root.name,
                "path": "",
                "kind": "file",
                "size": 0,
                "state": "Active",
            }
        ).insert(ignore_permissions=True)
        self.assertFalse(empty_file.blob)
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(
                {
                    "doctype": "Drive Node",
                    "title": "Partial bytes",
                    "parent": self.root.name,
                    "root": self.root.name,
                    "path": "",
                    "kind": "file",
                    "size": 1,
                    "state": "Active",
                }
            ).insert(ignore_permissions=True)
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(
                {
                    "doctype": "Drive Node",
                    "title": "Bad template",
                    "parent": self.root.name,
                    "root": self.root.name,
                    "path": "",
                    "kind": "folder",
                    "is_template": 1,
                    "state": "Active",
                }
            ).insert(ignore_permissions=True)
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(
                {
                    "doctype": "Drive Node",
                    "title": "Bad trash",
                    "parent": self.root.name,
                    "root": self.root.name,
                    "path": "",
                    "kind": "folder",
                    "state": "Trashed",
                    "trashed_at": now_datetime(),
                }
            ).insert(ignore_permissions=True)

    def _raw_document(self, parent: str) -> str:
        parent_row = frappe.db.get_value("Drive Node", parent, ["name", "kind", "root", "path"], as_dict=True)
        root = parent_row.name if parent_row.kind == "root" else parent_row.root
        path = "" if parent_row.kind == "root" else f"{parent_row.path or '/'}{parent_row.name}/"
        doc = frappe.get_doc(
            {
                "doctype": "Drive Node",
                "title": "Document",
                "parent": parent,
                "root": root,
                "path": path,
                "kind": "document",
                "content_doctype": "ToDo",
                "content_docname": "fake-content",
                "mime": "frappe/fake",
                "state": "Active",
            }
        ).insert(ignore_permissions=True, ignore_links=True)
        return doc.name

    def _raw_folder(self, parent: str, title: str) -> str:
        parent_row = frappe.db.get_value("Drive Node", parent, ["name", "root", "path"], as_dict=True)
        return (
            frappe.get_doc(
                {
                    "doctype": "Drive Node",
                    "title": title,
                    "parent": parent,
                    "root": parent_row.root,
                    "path": f"{parent_row.path or '/'}{parent_row.name}/",
                    "kind": "folder",
                    "state": "Active",
                }
            )
            .insert(ignore_permissions=True)
            .name
        )


class TestLifecyclePolicy(UnitTestCase):
    def test_optional_reference_without_doctype_metadata_is_ignored(self):
        with (
            patch("suite.drive._core.nodes.frappe.db.exists", return_value=False) as exists,
            patch("suite.drive._core.nodes.frappe.db.table_exists") as table_exists,
            patch("suite.drive._core.nodes.frappe.get_meta") as get_meta,
        ):
            node_workflows._delete_if_field("Drive Node Preview", "node", ("node",))

        exists.assert_called_once_with("DocType", "Drive Node Preview")
        table_exists.assert_not_called()
        get_meta.assert_not_called()

    def test_create_parent_locks_source_to_descendant_then_refreshes(self):
        snapshot = frappe._dict(name="descendant", root="root", path="/source/", kind="folder")
        refreshed = frappe._dict(name="descendant", root="root", path="/source/", kind="folder")
        with patch(
            "suite.drive._core.nodes._node",
            side_effect=[snapshot, frappe._dict(), frappe._dict(), frappe._dict(), refreshed],
        ) as node:
            self.assertIs(node_workflows._lock_create_parent("descendant"), refreshed)

        self.assertEqual(
            node.call_args_list,
            [
                call("descendant"),
                call("source", for_update=True),
                call("descendant", for_update=True),
                call("root", for_update=True),
                call("descendant", for_update=True),
            ],
        )

    def test_create_parent_refuses_a_changed_snapshot_before_locking_new_ancestry(self):
        snapshot = frappe._dict(name="descendant", root="root", path="/source/", kind="folder")
        refreshed = frappe._dict(
            name="descendant", root="other-root", path="/destination/source/", kind="folder"
        )
        with (
            patch(
                "suite.drive._core.nodes._node",
                side_effect=[snapshot, frappe._dict(), frappe._dict(), frappe._dict(), refreshed],
            ),
            self.assertRaises(DriveConflict),
        ):
            node_workflows._lock_create_parent("descendant")

    def test_create_parent_refuses_a_path_ancestor_that_no_longer_exists(self):
        snapshot = frappe._dict(name="descendant", root="root", path="/gone/", kind="folder")
        with (
            patch(
                "suite.drive._core.nodes._node",
                side_effect=[snapshot, DriveNotFound("Drive node gone was not found")],
            ),
            self.assertRaises(DriveConflict),
        ):
            node_workflows._lock_create_parent("descendant")

    def test_create_parent_still_reports_a_missing_parent_as_not_found(self):
        with (
            patch(
                "suite.drive._core.nodes._node",
                side_effect=DriveNotFound("Drive node ghost was not found"),
            ),
            self.assertRaises(DriveNotFound),
        ):
            node_workflows._lock_create_parent("ghost")

    def test_stored_position_refuses_a_parent_row_that_no_longer_exists(self):
        orphan = frappe._dict(name="orphan", root="root", path="", parent="ghost", kind="folder")
        with (
            patch(
                "suite.drive._core.nodes._node",
                side_effect=DriveNotFound("Drive node ghost was not found"),
            ),
            self.assertRaises(DriveConflict) as refused,
        ):
            node_workflows._validate_stored_position(orphan, for_update=True)
        self.assertIsInstance(refused.exception.__cause__, DriveNotFound)

    def test_purge_root_refuses_a_parent_row_that_no_longer_exists(self):
        orphan = frappe._dict(name="orphan", root="root", path="", parent="ghost", kind="folder")
        with (
            patch("suite.drive._core.nodes.root_for_node"),
            patch(
                "suite.drive._core.nodes._node",
                side_effect=DriveNotFound("Drive node ghost was not found"),
            ),
            self.assertRaises(DriveConflict),
        ):
            node_workflows._validate_purge_root(orphan)

    def test_deadlock_cleanup_preserves_the_original_error(self):
        deadlock = frappe.QueryDeadlockError("deadlock")

        def operation():
            try:
                raise deadlock
            except Exception as exc:
                node_workflows._rollback_savepoint("drive_create", exc)
                raise

        with (
            patch(
                "suite.drive._core.nodes.frappe.db.rollback",
                side_effect=[RuntimeError("savepoint no longer exists"), None],
            ) as rollback,
            self.assertRaises(frappe.QueryDeadlockError) as raised,
        ):
            operation()

        self.assertIs(raised.exception, deadlock)
        self.assertEqual(rollback.call_args_list, [call(save_point="drive_create"), call()])

    def test_subtree_charge_is_one_root_path_indexed_query(self):
        source = frappe._dict(name="folder", root="root", path="/ancestor/")
        with patch("suite.drive._core.nodes.frappe.db.sql", return_value=[[17]]) as sql:
            self.assertEqual(_subtree_charge(source), 17)

        sql.assert_called_once()
        query, params = sql.call_args.args
        normalized = " ".join(query.split())
        self.assertIn("FROM `tabDrive Node` n", normalized)
        self.assertIn("FROM `tabDrive Node Version` v", normalized)
        self.assertIn("WHERE s.root = %(root)s", normalized)
        self.assertNotIn("IN %(nodes)s", normalized)
        self.assertEqual(params, {"root": "root", "node": "folder", "prefix": "/ancestor/folder/%"})

    def test_guest_restore_privilege_requires_the_same_deciding_link(self):
        node = frappe._dict(name="node", trashed_at=now_datetime())
        activity = frappe._dict(actor="Guest", via_link=LINK_A)
        with (
            patch("suite.drive._core.nodes.frappe.db.get_value", return_value=activity),
            patch("suite.drive._core.nodes.require") as require,
        ):
            _require_restore_actor(node, Principals("Guest", (), (LINK_A,)), LINK_A)
            require.assert_not_called()
            _require_restore_actor(node, Principals("Guest", (), (LINK_B,)), LINK_B)
            require.assert_called_once_with(node, 50, Principals("Guest", (), (LINK_B,)))

    def test_content_callbacks_are_all_validated_before_purge(self):
        called = []
        valid = content_spec(doctype="Doc A", on_purge=called.append)
        rows = [
            frappe._dict(name="a", kind="document", path="", content_doctype="Doc A", content_docname="A"),
            frappe._dict(
                name="b", kind="document", path="/a/", content_doctype="Missing", content_docname="B"
            ),
        ]
        with registered_content(valid), self.assertRaises(DriveConflict):
            _content_purge_callbacks(rows)
        self.assertEqual(called, [])

    def test_purge_orders_notifications_before_activity_callbacks_and_nodes(self):
        events = []
        current = frappe._dict(name="rooted", root="root", kind="folder", path="")
        subtree = [
            current,
            frappe._dict(name="doc", parent="rooted", root="root", kind="document", path="/rooted/"),
        ]

        def callback(name):
            events.append(("callback", name))

        def deleted(doctype, field, values, **kwargs):
            events.append(("delete", doctype))

        with (
            patch("suite.drive._core.nodes._subtree", return_value=subtree),
            patch("suite.drive._core.nodes._validate_subtree"),
            patch("suite.drive._core.nodes._subtree_charge", return_value=12),
            patch("suite.drive._core.nodes._content_purge_callbacks", return_value=[(callback, "content")]),
            patch("suite.drive._core.nodes._record_activity"),
            patch("suite.drive._core.nodes.frappe.get_all", return_value=["activity"]),
            patch("suite.drive._core.nodes._delete_if_field", side_effect=deleted),
            patch(
                "suite.drive._core.nodes.frappe.db.delete",
                side_effect=lambda *args: events.append(("nodes", args[0])),
            ),
            patch(
                "suite.drive._core.nodes.release", side_effect=lambda *args: events.append(("release", args))
            ),
        ):
            self.assertEqual(_purge_locked(current, Principals("u", ("u",), ()), via_link=None), 2)

        self.assertLess(
            events.index(("delete", "Drive Notification")), events.index(("delete", "Drive Activity"))
        )
        self.assertLess(events.index(("delete", "Drive Activity")), events.index(("callback", "content")))
        self.assertLess(events.index(("callback", "content")), events.index(("nodes", "Drive Node")))
        self.assertEqual(events[-1], ("release", ("root", 12)))

    @patch("suite.drive.jobs.frappe.log_error")
    @patch("suite.drive.jobs.frappe.db.rollback")
    @patch("suite.drive.jobs.frappe.db.commit")
    @patch("suite.drive.jobs.purge_expired_trash_root", side_effect=[2, RuntimeError("boom"), 0])
    @patch("suite.drive.jobs.frappe.db.sql", return_value=["old-a", "old-b", "restored"])
    @patch("suite.drive.jobs.now_datetime", return_value=now_datetime())
    def test_daily_job_processes_each_trash_root_once_and_isolates_failures(
        self, _now, _sql, purge_one, commit, rollback, log_error
    ):
        self.assertEqual(purge_trashed_nodes(), {"roots": 1, "nodes": 2, "failed": 1})
        self.assertEqual(purge_one.call_count, 3)
        self.assertEqual(commit.call_count, 2)
        rollback.assert_called_once_with()
        log_error.assert_called_once()
