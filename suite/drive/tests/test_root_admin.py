from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase

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
