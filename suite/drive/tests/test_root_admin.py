from unittest.mock import MagicMock, patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.drive._core.activity import discard_personal_records, notify_users, record, set_favourite, visit
from suite.drive._core.errors import DriveConflict, DriveForbidden
from suite.drive._core.principals import Principals
from suite.drive._core.quota import create_storage_reservation
from suite.drive._core.roots import (
    _delete_existing_reference,
    archive_personal_root,
    create_root,
    personal_root_for,
    purge_root,
    update_root,
)
from suite.tests.utils import stub_db


class TestRootAdministrationContract(UnitTestCase):
    def test_non_admin_cannot_change_or_purge_a_root(self):
        caller = Principals("member@example.com", ("member@example.com",), ())
        with self.assertRaises(DriveForbidden):
            update_root("root", caller, quota_bytes=1)
        with self.assertRaises(DriveForbidden):
            purge_root("root", caller)

    @patch("suite.drive._core.nodes._delete_if_field")
    @patch("suite.drive._core.roots.frappe.db.exists", return_value=False)
    def test_orphan_table_without_doctype_metadata_is_ignored(self, _exists, delete_reference):
        _delete_existing_reference("Drive Node Preview", "node", ("node",))

        delete_reference.assert_not_called()


class TestRootPurgeLockOrder(UnitTestCase):
    """Purge takes the same lock order as every other Drive tree workflow.

    `_lock_tree_chains` locks descendants shallowest first and the root node
    last, then the workflow locks `Drive Root`. A purge that took the root
    first would deadlock against a concurrent upload or move inside the same
    archived root instead of waiting for it.
    """

    ROOT = "archived-root-node"

    def _locked(self):
        locked = []
        node = frappe._dict(
            name=self.ROOT,
            title="My Drive",
            parent=None,
            root=None,
            path="",
            kind="root",
            blob=None,
            size=0,
            mime=None,
            url=None,
            content_doctype=None,
            content_docname=None,
            state="Active",
            trashed_at=None,
            trash_root=None,
            is_template=0,
            owner="leaver@example.com",
        )
        metadata = frappe._dict(
            name=self.ROOT,
            node=self.ROOT,
            kind="Personal",
            user="leaver@example.com",
            state="Archived",
            quota_bytes=0,
            used_bytes=0,
        )

        def get_value(doctype, *args, **kwargs):
            if kwargs.get("for_update"):
                locked.append(doctype)
            return node if doctype == "Drive Node" else metadata

        def sql(query, *args, **kwargs):
            if "FOR UPDATE" in query:
                locked.append("descendants")
            return []

        db = MagicMock()
        db.get_value.side_effect = get_value
        db.sql.side_effect = sql
        admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        with stub_db(db):
            with patch(
                "suite.drive._core.roots._validate_root_descendants",
                side_effect=RuntimeError("stop after locking"),
            ):
                with self.assertRaisesRegex(RuntimeError, "stop after locking"):
                    purge_root(self.ROOT, admin)
        return locked

    def test_descendants_lock_before_the_root_node_and_its_metadata(self):
        self.assertEqual(self._locked(), ["descendants", "Drive Node", "Drive Root"])


class TestRootAdministration(IntegrationTestCase):
    user = "Administrator"

    def setUp(self):
        super().setUp()
        self.before_roots = set(frappe.get_all("Drive Root", pluck="name"))
        self.admin = Principals("Administrator", ("Administrator",), (), is_admin=True)

    def tearDown(self):
        frappe.set_user("Administrator")
        roots = set(frappe.get_all("Drive Root", pluck="name")) - self.before_roots
        for root in roots:
            node_ids = tuple(frappe.get_all("Drive Node", filters={"root": root}, pluck="name"))
            all_nodes = (*node_ids, root)
            frappe.db.delete("Drive Node Version", {"node": ["in", all_nodes]})
            frappe.db.delete("Drive Activity", {"node": ["in", all_nodes]})
            frappe.db.delete("Drive Grant", {"node": ["in", all_nodes]})
            frappe.db.delete("Drive Storage Reservation", {"root": root})
            frappe.db.delete("Drive Node", {"name": ["in", all_nodes]})
            frappe.db.delete("Drive Root", root)
        super().tearDown()

    def _root(self):
        return create_root(kind="Personal", title="My Drive", user=self.user)

    def _folder(self, root):
        return frappe.get_doc(
            {
                "doctype": "Drive Node",
                "title": f"Folder {uuid4().hex[:8]}",
                "parent": root,
                "root": root,
                "path": "",
                "kind": "folder",
                "state": "Active",
                "size": 0,
                "is_template": 0,
            }
        ).insert(ignore_permissions=True)

    def test_archive_changes_metadata_only_and_a_new_root_gets_fresh_identity(self):
        first = self._root()
        child = self._folder(first.name)
        frappe.db.set_value("Drive Root", first.name, "used_bytes", 123, update_modified=False)
        grant_count = frappe.db.count("Drive Grant", {"node": ["in", (first.name, child.name)]})

        archived = archive_personal_root(self.user)

        self.assertEqual(archived, first.name)
        self.assertEqual(frappe.db.get_value("Drive Root", first.name, "state"), "Archived")
        self.assertEqual(frappe.db.get_value("Drive Root", first.name, "used_bytes"), 123)
        self.assertTrue(frappe.db.exists("Drive Node", child.name))
        self.assertEqual(
            frappe.db.count("Drive Grant", {"node": ["in", (first.name, child.name)]}), grant_count
        )
        second = self._root()
        self.assertNotEqual(second.name, first.name)
        self.assertEqual(personal_root_for(self.user), second.name)

    def test_admin_quota_update_and_active_purge_guard(self):
        root = self._root()
        changed = update_root(root.name, self.admin, quota_bytes=987)
        self.assertEqual(changed.quota_bytes, 987)
        with self.assertRaises(DriveForbidden):
            purge_root(root.name, self.admin)

    def test_archived_purge_removes_descendants_references_and_pair(self):
        root = self._root()
        child = self._folder(root.name)
        frappe.get_doc(
            {
                "doctype": "Drive Grant",
                "node": child.name,
                "principal": "$GENERAL",
                "role": 10,
            }
        ).insert(ignore_permissions=True)
        create_storage_reservation(root.name, f"purge:{uuid4().hex}", 9)
        archive_personal_root(self.user)

        result = purge_root(root.name, self.admin)

        self.assertEqual(result.purged, 2)
        self.assertFalse(frappe.db.exists("Drive Node", root.name))
        self.assertFalse(frappe.db.exists("Drive Node", child.name))
        self.assertFalse(frappe.db.exists("Drive Root", root.name))
        self.assertFalse(frappe.db.exists("Drive Grant", {"node": ["in", (root.name, child.name)]}))
        self.assertFalse(frappe.db.exists("Drive Storage Reservation", {"root": root.name}))

    def test_purge_failure_rolls_back_descendants_references_and_pair(self):
        root = self._root()
        child = self._folder(root.name)
        archive_personal_root(self.user)
        real_delete = frappe.db.delete

        def fail_at_metadata(doctype, *args, **kwargs):
            if doctype == "Drive Root":
                raise RuntimeError("injected purge failure")
            return real_delete(doctype, *args, **kwargs)

        with patch("suite.drive._core.roots.frappe.db.delete", side_effect=fail_at_metadata):
            with self.assertRaisesRegex(RuntimeError, "injected purge failure"):
                purge_root(root.name, self.admin)

        self.assertTrue(frappe.db.exists("Drive Root", root.name))
        self.assertTrue(frappe.db.exists("Drive Node", root.name))
        self.assertTrue(frappe.db.exists("Drive Node", child.name))

    def test_corrupt_descendant_position_refuses_purge_without_mutation(self):
        root = self._root()
        child = self._folder(root.name)
        archive_personal_root(self.user)
        frappe.db.set_value("Drive Node", child.name, "path", "/wrong", update_modified=False)

        with self.assertRaises(DriveConflict):
            purge_root(root.name, self.admin)

        self.assertTrue(frappe.db.exists("Drive Root", root.name))
        self.assertTrue(frappe.db.exists("Drive Node", child.name))


class TestUserOffboarding(IntegrationTestCase):
    user = "Administrator"

    def test_delete_and_recreate_email_archives_old_identity_and_provisions_a_new_one(self):
        email = f"drive-offboard-{uuid4().hex}@example.com"
        created_roots = []
        try:
            user = frappe.get_doc(
                {
                    "doctype": "User",
                    "email": email,
                    "first_name": "Drive Offboard",
                    "enabled": 1,
                    "new_password": uuid4().hex,
                }
            )
            user.flags.skip_drive_setup = True
            user.insert(ignore_permissions=True)
            first = personal_root_for(email)
            created_roots.append(first)
            self.assertTrue(first)

            frappe.delete_doc("User", email, ignore_permissions=True, force=True)
            self.assertEqual(frappe.db.get_value("Drive Root", first, "state"), "Archived")
            self.assertTrue(frappe.db.exists("Drive Node", first))

            replacement = frappe.get_doc(
                {
                    "doctype": "User",
                    "email": email,
                    "first_name": "Drive Recreated",
                    "enabled": 1,
                    "new_password": uuid4().hex,
                }
            )
            replacement.flags.skip_drive_setup = True
            replacement.insert(ignore_permissions=True)
            second = personal_root_for(email)
            created_roots.append(second)

            self.assertTrue(second)
            self.assertNotEqual(first, second)
            self.assertEqual(frappe.db.get_value("Drive Root", first, "state"), "Archived")
        finally:
            frappe.set_user("Administrator")
            if frappe.db.exists("User", email):
                frappe.delete_doc("User", email, ignore_permissions=True, force=True)
            for root in filter(None, created_roots):
                frappe.db.delete("Drive Storage Reservation", {"root": root})
                frappe.db.delete("Drive Grant", {"node": root})
                frappe.db.delete("Drive Root", root)
                frappe.db.delete("Drive Node", root)

    def test_offboarding_discards_private_records_and_keeps_attributed_ones(self):
        email = f"drive-private-{uuid4().hex}@example.com"
        created_roots = []
        try:
            user = frappe.get_doc(
                {
                    "doctype": "User",
                    "email": email,
                    "first_name": "Drive Private",
                    "enabled": 1,
                    "new_password": uuid4().hex,
                }
            )
            user.flags.skip_drive_setup = True
            user.insert(ignore_permissions=True)
            root = personal_root_for(email)
            created_roots.append(root)
            leaver = Principals(email, (email,), ())

            visit(leaver, root)
            set_favourite(leaver, root, True)
            activity = record(leaver, root, "create", detail={"kind": "root"})
            notify_users(activity, (email,))
            self.assertTrue(frappe.db.exists("Drive Recent", {"user": email}))
            self.assertTrue(frappe.db.exists("Drive Favourite", {"user": email}))
            self.assertTrue(frappe.db.exists("Drive Notification", {"to_user": email}))

            frappe.delete_doc("User", email, ignore_permissions=True, force=True)

            self.assertFalse(frappe.db.exists("Drive Recent", {"user": email}))
            self.assertFalse(frappe.db.exists("Drive Favourite", {"user": email}))
            self.assertFalse(frappe.db.exists("Drive Notification", {"to_user": email}))
            # Attributed history and specified access outlive the person.
            self.assertEqual(frappe.db.get_value("Drive Activity", activity, "actor"), email)
            self.assertTrue(frappe.db.exists("Drive Grant", {"node": root, "principal": email}))
            self.assertEqual(frappe.db.get_value("Drive Root", root, "state"), "Archived")

            replacement = frappe.get_doc(
                {
                    "doctype": "User",
                    "email": email,
                    "first_name": "Drive Replacement",
                    "enabled": 1,
                    "new_password": uuid4().hex,
                }
            )
            replacement.flags.skip_drive_setup = True
            replacement.insert(ignore_permissions=True)
            created_roots.append(personal_root_for(email))

            self.assertFalse(frappe.db.exists("Drive Recent", {"user": email}))
            self.assertFalse(frappe.db.exists("Drive Favourite", {"user": email}))
            self.assertFalse(frappe.db.exists("Drive Notification", {"to_user": email}))
        finally:
            frappe.set_user("Administrator")
            if frappe.db.exists("User", email):
                frappe.delete_doc("User", email, ignore_permissions=True, force=True)
            discard_personal_records(email)
            for root in filter(None, created_roots):
                activities = frappe.get_all("Drive Activity", filters={"node": root}, pluck="name")
                if activities:
                    frappe.db.delete("Drive Notification", {"activity": ["in", tuple(activities)]})
                frappe.db.delete("Drive Recent", {"node": root})
                frappe.db.delete("Drive Favourite", {"node": root})
                frappe.db.delete("Drive Activity", {"node": root})
                frappe.db.delete("Drive Storage Reservation", {"root": root})
                frappe.db.delete("Drive Grant", {"node": root})
                frappe.db.delete("Drive Root", root)
                frappe.db.delete("Drive Node", root)

    def test_discarding_private_records_is_idempotent_and_needs_a_user(self):
        email = f"drive-idempotent-{uuid4().hex}@example.com"
        self.assertEqual(
            discard_personal_records(email),
            {"Drive Recent": 0, "Drive Favourite": 0, "Drive Notification": 0},
        )
        with self.assertRaises(frappe.ValidationError):
            discard_personal_records("")
