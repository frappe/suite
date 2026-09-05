from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.drive._core.access import add_creator_grant, chain_ids, effective_role
from suite.drive._core.errors import DriveConflict, DriveForbidden
from suite.drive._core.principals import Principals
from suite.drive._core.roles import EDIT, MANAGE, NONE, UPLOAD
from suite.drive._core.roots import (
    create_root,
    personal_root_for,
    reject_illegal_root_operation,
    validate_root_pair,
)


class TestRootCreationContract(UnitTestCase):
    @patch("suite.drive._core.roots.frappe.db.get_value")
    def test_personal_creation_locks_the_user_identity_row(self, get_value):
        from suite.drive._core.roots import _lock_identity

        _lock_identity("Personal", "user@example.com")
        get_value.assert_called_once_with("User", "user@example.com", "name", for_update=True)

    @patch("suite.drive._core.roots.frappe.db.get_value")
    def test_shared_creation_locks_one_stable_site_row(self, get_value):
        from suite.drive._core.roots import _lock_identity

        _lock_identity("Shared", None)
        get_value.assert_called_once_with("DocType", "Drive Root", "name", for_update=True)


class TestRootLifecycle(IntegrationTestCase):
    user = "Administrator"

    def setUp(self) -> None:
        super().setUp()
        self._root_nodes_before = set(
            frappe.get_all("Drive Node", filters={"kind": "root"}, pluck="name")
        )
        self._root_metadata_before = set(frappe.get_all("Drive Root", pluck="name"))

    def tearDown(self) -> None:
        frappe.set_user("Administrator")
        root_nodes = (
            set(frappe.get_all("Drive Node", filters={"kind": "root"}, pluck="name"))
            - self._root_nodes_before
        )
        root_metadata = set(frappe.get_all("Drive Root", pluck="name")) - self._root_metadata_before
        node_names = set(root_nodes)
        if root_nodes:
            node_names.update(
                frappe.get_all("Drive Node", filters={"root": ["in", tuple(root_nodes)]}, pluck="name")
            )
        if node_names:
            frappe.db.delete("Drive Grant", {"node": ["in", tuple(node_names)]})
            frappe.db.delete("Drive Activity", {"node": ["in", tuple(node_names)]})
            frappe.db.delete("Drive Node", {"name": ["in", tuple(node_names)]})
        if root_metadata:
            frappe.db.delete("Drive Root", {"name": ["in", tuple(root_metadata)]})
        super().tearDown()

    def _personal_root(self):
        return create_root(kind="Personal", title="My Drive", user=self.user)

    def _child(self, root: str, *, title: str = "Folder"):
        return frappe.get_doc(
            {
                "doctype": "Drive Node",
                "title": title,
                "parent": root,
                "root": root,
                "path": "",
                "kind": "folder",
                "state": "Active",
                "size": 0,
                "is_template": 0,
            }
        ).insert(ignore_permissions=True)

    def test_personal_root_is_one_atomic_pair_with_manage_anchor(self):
        original_user = frappe.session.user
        frappe.set_user("Guest")
        try:
            created = self._personal_root()
        finally:
            frappe.set_user(original_user)
        pair = validate_root_pair(created.name)

        self.assertEqual(pair.node.name, pair.root.name)
        self.assertEqual(pair.root.node, pair.node.name)
        self.assertEqual(pair.node.kind, "root")
        self.assertIsNone(pair.node.parent)
        self.assertIsNone(pair.node.root)
        self.assertEqual(pair.node.path, "")
        self.assertEqual(pair.node.owner, self.user)
        self.assertEqual(personal_root_for(self.user), created.name)
        self.assertEqual(
            frappe.db.get_value(
                "Drive Grant", {"node": created.name, "principal": self.user}, "role"
            ),
            MANAGE,
        )

    def test_shared_root_is_owned_by_administrator_with_general_upload(self):
        original_user = frappe.session.user
        frappe.set_user("Guest")
        try:
            created = create_root(kind="Shared", title="Shared")
        finally:
            frappe.set_user(original_user)
        pair = validate_root_pair(created.name)

        self.assertIsNone(pair.root.user)
        self.assertEqual(pair.node.owner, "Administrator")
        self.assertEqual(
            frappe.db.get_value(
                "Drive Grant", {"node": created.name, "principal": "$GENERAL"}, "role"
            ),
            UPLOAD,
        )

    def test_failure_after_node_insert_rolls_back_the_partial_pair(self):
        before = frappe.db.count("Drive Node", {"kind": "root"})
        with patch("suite.drive._core.roots._insert_root_metadata", side_effect=RuntimeError("stop")):
            with self.assertRaisesRegex(RuntimeError, "stop"):
                self._personal_root()
        self.assertEqual(frappe.db.count("Drive Node", {"kind": "root"}), before)

    def test_failure_after_metadata_insert_rolls_back_node_and_metadata(self):
        node_before = frappe.db.count("Drive Node", {"kind": "root"})
        root_before = frappe.db.count("Drive Root")
        with patch("suite.drive._core.roots._insert_anchor_grant", side_effect=RuntimeError("stop")):
            with self.assertRaisesRegex(RuntimeError, "stop"):
                self._personal_root()
        self.assertEqual(frappe.db.count("Drive Node", {"kind": "root"}), node_before)
        self.assertEqual(frappe.db.count("Drive Root"), root_before)

    def test_final_pair_validation_failure_rolls_back_the_grant_too(self):
        counts = {
            doctype: frappe.db.count(doctype)
            for doctype in ("Drive Node", "Drive Root", "Drive Grant")
        }
        with patch("suite.drive._core.roots.validate_root_pair", side_effect=RuntimeError("stop")):
            with self.assertRaisesRegex(RuntimeError, "stop"):
                self._personal_root()
        self.assertEqual(
            {doctype: frappe.db.count(doctype) for doctype in counts},
            counts,
        )

    def test_a_second_active_personal_root_is_rejected(self):
        self._personal_root()
        with self.assertRaises(DriveConflict):
            self._personal_root()

    def test_an_archived_personal_root_does_not_block_a_new_active_root(self):
        first = self._personal_root()
        metadata = frappe.get_doc("Drive Root", first.name)
        metadata.state = "Archived"
        metadata.save(ignore_permissions=True)

        second = self._personal_root()

        self.assertNotEqual(first.name, second.name)
        self.assertEqual(
            frappe.db.count(
                "Drive Root", {"user": self.user, "kind": "Personal", "state": "Active"}
            ),
            1,
        )

    def test_generic_root_node_creation_is_rejected(self):
        root = frappe.get_doc(
            {
                "doctype": "Drive Node",
                "title": "Bypass",
                "kind": "root",
                "path": "",
                "state": "Active",
                "size": 0,
                "is_template": 0,
            }
        )
        with self.assertRaises(frappe.ValidationError):
            root.insert(ignore_permissions=True)

    def test_generic_root_metadata_creation_is_rejected(self):
        node = frappe.get_doc(
            {
                "doctype": "Drive Node",
                "title": "Incomplete",
                "kind": "root",
                "path": "",
                "state": "Active",
                "size": 0,
                "is_template": 0,
            }
        )
        node.flags.drive_root_lifecycle = True
        node.insert(ignore_permissions=True)
        metadata = frappe.get_doc(
            {
                "doctype": "Drive Root",
                "node": node.name,
                "kind": "Personal",
                "user": self.user,
                "state": "Active",
            }
        )
        with self.assertRaises(frappe.ValidationError):
            metadata.insert(ignore_permissions=True)

    def test_metadata_rejects_a_non_root_node(self):
        root = self._personal_root()
        child = self._child(root.name)
        metadata = frappe.get_doc(
            {
                "doctype": "Drive Root",
                "node": child.name,
                "kind": "Shared",
                "state": "Active",
            }
        )
        metadata.flags.drive_root_lifecycle = True
        with self.assertRaises(frappe.ValidationError):
            metadata.insert(ignore_permissions=True)

    def test_duplicate_metadata_for_one_node_is_rejected(self):
        root = self._personal_root()
        duplicate = frappe.get_doc(
            {
                "doctype": "Drive Root",
                "node": root.name,
                "kind": "Personal",
                "user": self.user,
                "state": "Archived",
                "quota_bytes": 0,
            }
        )
        duplicate.flags.drive_root_lifecycle = True
        with self.assertRaises(frappe.DuplicateEntryError):
            duplicate.insert(ignore_permissions=True)

    def test_pair_validation_rejects_missing_or_mismatched_metadata(self):
        first = self._personal_root()
        frappe.db.delete("Drive Root", {"name": first.name})
        with self.assertRaises(frappe.ValidationError):
            validate_root_pair(first.name)

        second = create_root(kind="Shared", title="Shared")
        frappe.db.set_value("Drive Root", second.name, "node", first.name)
        with self.assertRaises(frappe.ValidationError):
            validate_root_pair(second.name)

    def test_pair_validation_rejects_unknown_metadata_kind_and_state(self):
        root = self._personal_root()
        frappe.db.set_value("Drive Root", root.name, "kind", "Unknown")
        with self.assertRaises(frappe.ValidationError):
            validate_root_pair(root.name)

        frappe.db.set_value("Drive Root", root.name, {"kind": "Personal", "state": "Unknown"})
        with self.assertRaises(frappe.ValidationError):
            validate_root_pair(root.name)

    def test_root_metadata_identity_is_immutable(self):
        root = self._personal_root()
        metadata = frappe.get_doc("Drive Root", root.name)
        metadata.kind = "Shared"
        metadata.user = None
        with self.assertRaises(frappe.ValidationError):
            metadata.save(ignore_permissions=True)
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc("Drive Root", root.name).on_trash()

    def test_root_tree_identity_cannot_be_moved_or_trashed(self):
        root = self._personal_root()
        node = frappe.get_doc("Drive Node", root.name)
        node.parent = root.name
        with self.assertRaises(frappe.ValidationError):
            node.save(ignore_permissions=True)
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc("Drive Node", root.name).on_trash()

        for operation in ("move", "copy", "trash", "restore", "purge"):
            with self.subTest(operation=operation):
                with self.assertRaises(DriveForbidden):
                    reject_illegal_root_operation({"kind": "root"}, operation)

    def test_direct_children_have_the_root_as_parent_and_an_empty_path(self):
        root = self._personal_root()
        child = self._child(root.name)
        grandchild = frappe.get_doc(
            {
                "doctype": "Drive Node",
                "title": "Nested",
                "parent": child.name,
                "root": root.name,
                "path": f"/{child.name}/",
                "kind": "folder",
                "state": "Active",
                "size": 0,
                "is_template": 0,
            }
        ).insert(ignore_permissions=True)

        self.assertEqual(child.parent, root.name)
        self.assertEqual(child.path, "")
        self.assertEqual(chain_ids(grandchild), [root.name, child.name, grandchild.name])

    def test_expired_positive_grants_for_own_and_open_principals_are_retained_but_inert(self):
        root = self._personal_root()
        frappe.db.delete("Drive Grant", {"node": root.name})
        cases = (
            (self.user, Principals(self.user, (self.user,), ("$PUBLIC",))),
            ("$GROUP:expired", Principals(self.user, (self.user, "$GROUP:expired"), ("$PUBLIC",))),
            ("$GENERAL", Principals(self.user, (self.user, "$GENERAL"), ("$PUBLIC",))),
            ("$PUBLIC", Principals("Guest", (), ("$PUBLIC",))),
            ("$LINK:expired", Principals("Guest", (), ("$PUBLIC", "$LINK:expired"))),
        )
        for index, (principal, principals) in enumerate(cases):
            child = self._child(root.name, title=f"Expired {index}")
            grant = frappe.get_doc(
                {
                    "doctype": "Drive Grant",
                    "node": child.name,
                    "principal": principal,
                    "role": EDIT,
                    "expires_on": "2000-01-01 00:00:00",
                }
            ).insert(ignore_permissions=True)
            self.assertTrue(frappe.db.exists("Drive Grant", grant.name))
            self.assertEqual(effective_role(child, principals), NONE)

    def test_expired_deny_is_inert_and_expiry_boundary_is_exclusive(self):
        root = self._personal_root()
        child = self._child(root.name)
        frappe.db.set_value(
            "Drive Grant", {"node": root.name, "principal": self.user}, "role", EDIT
        )
        deny = frappe.get_doc(
            {
                "doctype": "Drive Grant",
                "node": child.name,
                "principal": self.user,
                "role": NONE,
                "expires_on": "2026-09-05 12:00:00",
            }
        ).insert(ignore_permissions=True)
        principals = Principals(self.user, (self.user,), ("$PUBLIC",))

        with patch("suite.drive._core.access.now", return_value="2026-09-05 12:00:00"):
            self.assertEqual(effective_role(child, principals), EDIT)
        self.assertTrue(frappe.db.exists("Drive Grant", deny.name))

    def test_creator_gets_edit_when_only_upload_is_inherited(self):
        root = create_root(kind="Shared", title="Shared")
        child = self._child(root.name)
        principals = Principals(self.user, (self.user, "$GENERAL"), ("$PUBLIC",))

        self.assertTrue(add_creator_grant(child, pair_node(root.name), principals))
        self.assertEqual(
            frappe.db.get_value(
                "Drive Grant", {"node": child.name, "principal": self.user}, "role"
            ),
            EDIT,
        )

    def test_link_upload_does_not_create_a_creator_grant(self):
        root = create_root(kind="Shared", title="Shared")
        child = self._child(root.name)
        principals = Principals("Guest", (), ("$PUBLIC", "$LINK:abc"))

        self.assertFalse(
            add_creator_grant(child, pair_node(root.name), principals, via_link="$LINK:abc")
        )
        self.assertFalse(
            frappe.db.exists("Drive Grant", {"node": child.name, "principal": "$LINK:abc"})
        )

    def test_creator_gets_no_redundant_grant_when_parent_already_gives_edit(self):
        root = self._personal_root()
        child = self._child(root.name)
        principals = Principals(self.user, (self.user,), ("$PUBLIC",))

        self.assertFalse(add_creator_grant(child, pair_node(root.name), principals))
        self.assertFalse(
            frappe.db.exists("Drive Grant", {"node": child.name, "principal": self.user})
        )

    def test_schema_has_the_required_hot_path_indexes(self):
        expected = {
            "tabDrive Node": ("node_parent_page", "node_subtree", "node_content"),
            "tabDrive Root": ("root_owner", "root_kind"),
            "tabDrive Grant": ("grant_node_principal", "grant_principal"),
            "tabDrive Activity": ("activity_node_at",),
        }
        for table, names in expected.items():
            for name in names:
                with self.subTest(table=table, name=name):
                    self.assertTrue(frappe.db.has_index(table, name))

    def test_concurrent_personal_creation_leaves_one_pair_and_no_loser_orphans(self):
        user = frappe.db.sql(
            """
            SELECT u.name
            FROM `tabUser` u
            WHERE u.name != 'Guest'
              AND NOT EXISTS (
                SELECT 1 FROM `tabDrive Root` r
                WHERE r.user = u.name AND r.kind = 'Personal' AND r.state = 'Active'
              )
            ORDER BY u.name
            LIMIT 1
            """,
            pluck=True,
        )
        if not user:
            self.skipTest("No existing user without an Active Personal root is available")
        self._assert_concurrent_root(kind="Personal", user=user[0])

    def test_concurrent_shared_creation_leaves_one_pair_and_no_loser_orphans(self):
        if frappe.db.exists("Drive Root", {"kind": "Shared", "state": "Active"}):
            self.skipTest("The site already has an Active Shared root")
        self._assert_concurrent_root(kind="Shared", user=None)

    def _assert_concurrent_root(self, *, kind: str, user: str | None):
        """Two committed requests overlap; the identity-row lock admits exactly one."""
        site = frappe.local.site
        # The test runner keeps a connection-wide transaction across methods. No fixture
        # writes belong to this test, so end it before the two independent requests race.
        frappe.db.rollback()
        marker = f"Concurrent root {uuid4().hex}"
        barrier = Barrier(2)

        def attempt():
            frappe.init(site, force=True)
            frappe.connect()
            frappe.set_user("Administrator")
            try:
                barrier.wait(timeout=10)
                try:
                    created = create_root(kind=kind, title=marker, user=user)
                    frappe.db.commit()
                    return ("created", created.name)
                except DriveConflict:
                    frappe.db.rollback()
                    return ("conflict", None)
            finally:
                frappe.destroy()

        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = (pool.submit(attempt), pool.submit(attempt))
                results = [future.result(timeout=30) for future in futures]

            frappe.db.rollback()
            created_nodes = set(
                frappe.get_all(
                    "Drive Node", filters={"kind": "root", "title": marker}, pluck="name"
                )
            )
            created_roots = set(
                frappe.get_all("Drive Root", filters={"name": ["in", tuple(created_nodes)]}, pluck="name")
            )

            self.assertEqual(sorted(status for status, _name in results), ["conflict", "created"])
            returned = {name for status, name in results if status == "created"}
            self.assertEqual(created_nodes, returned)
            self.assertEqual(created_nodes, created_roots)
            self.assertEqual(len(created_nodes), 1)
            root_id = created_nodes.pop()
            validate_root_pair(root_id)
            self.assertEqual(frappe.db.count("Drive Grant", {"node": root_id}), 1)
        finally:
            frappe.db.rollback()
            cleanup = frappe.get_all("Drive Node", filters={"title": marker}, pluck="name")
            for root_id in cleanup:
                frappe.db.delete("Drive Grant", {"node": root_id})
                frappe.db.delete("Drive Root", {"name": root_id})
                frappe.db.delete("Drive Node", {"name": root_id})
            frappe.db.commit()


def pair_node(name: str) -> frappe._dict:
    return frappe.db.get_value(
        "Drive Node", name, ["name", "kind", "root", "path", "owner"], as_dict=True
    )
