"""Retained transfer preserves versions, trash, grants and stable node identities."""

from io import BytesIO
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite import drive
from suite.drive._core.nodes import update
from suite.drive.framework import principals_for_request
from suite.suite_core.administration import update_user
from suite.tests.utils import ensure_user


class TestUserTransfer(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.enterContext(patch("suite.suite_core.utils.is_suite_cloud_configured", return_value=False))
        self.enterContext(
            patch("suite.drive._core.offboarding.is_suite_cloud_configured", return_value=False)
        )
        suffix = frappe.generate_hash(length=8)
        self.source_user = f"transfer-source-{suffix}@example.test"
        self.target_user = f"transfer-target-{suffix}@example.test"
        ensure_user(self.source_user)
        ensure_user(self.target_user)
        self.source = frappe.db.get_value(
            "Drive Root", {"kind": "Personal", "user": self.source_user}, "name"
        )
        self.target = frappe.db.get_value(
            "Drive Root", {"kind": "Personal", "user": self.target_user}, "name"
        )
        self.destination = drive.ensure_folder(self.target, "Transferred content")

    def test_versions_trash_and_explicit_grants_move_without_restoring_or_changing_links(self):
        visible = drive.store_file(self.source, "visible.txt", BytesIO(b"hello"))
        deleted = drive.store_file(self.source, "deleted.txt", BytesIO(b"goodbye"))
        drive.take_version(visible, kind="named", label="Retained version")
        update(principals_for_request(), deleted, state="Trashed")
        grants_before = frappe.get_all(
            "Drive Grant",
            filters={"node": ["in", [visible, deleted]]},
            fields=["name", "node", "principal", "role"],
        )
        update_user(self.source_user, enabled=False)
        preview = drive.preview_user_transfer(self.source_user, self.destination)
        self.assertEqual(preview["bytes"], 17)
        self.assertEqual(preview["item_count"], 2)
        result = drive.transfer_user_drive(
            self.source_user, self.destination, preview["fingerprint"], confirm_access=True
        )
        self.assertTrue(result["complete"], result)
        self.assertEqual(frappe.db.get_value("Drive Node", deleted, "state"), "Trashed")
        for node in (visible, deleted):
            self.assertEqual(frappe.db.get_value("Drive Node", node, "root"), self.target)
        self.assertTrue(drive.list_versions(visible)["rows"])
        self.assertEqual(
            frappe.get_all(
                "Drive Grant",
                filters={"node": ["in", [visible, deleted]]},
                fields=["name", "node", "principal", "role"],
            ),
            grants_before,
        )
        self.assertEqual(drive.get_storage_usage(self.source)["used_bytes"], 0)
        self.assertEqual(drive.get_storage_usage(self.target)["used_bytes"], 17)

    def test_an_active_user_cannot_be_transferred(self):
        with self.assertRaises(drive.DriveConflict):
            drive.preview_user_transfer(self.source_user, self.destination)

    def test_normal_user_cannot_preview_or_execute_a_retained_transfer(self):
        update_user(self.source_user, enabled=False)
        with self.set_user(self.target_user):
            with self.assertRaises(frappe.PermissionError):
                drive.preview_user_transfer(self.source_user, self.destination)
            with self.assertRaises(frappe.PermissionError):
                drive.transfer_user_drive(
                    self.source_user, self.destination, "untrusted", confirm_access=True
                )

    def test_changed_destination_grants_require_a_new_preview(self):
        update_user(self.source_user, enabled=False)
        preview = drive.preview_user_transfer(self.source_user, self.destination)
        frappe.get_doc(
            {
                "doctype": "Drive Grant",
                "node": self.destination,
                "principal": self.source_user,
                "role": drive.READ,
            }
        ).insert(ignore_permissions=True)
        with self.assertRaises(drive.DriveConflict):
            drive.transfer_user_drive(
                self.source_user,
                self.destination,
                preview["fingerprint"],
                confirm_access=True,
            )

    def test_a_failed_name_collision_is_retained_and_a_retry_does_not_duplicate_successes(self):
        drive.ensure_folder(self.source, "collision")
        moved = drive.ensure_folder(self.source, "unique")
        drive.ensure_folder(self.destination, "collision")
        update_user(self.source_user, enabled=False)
        preview = drive.preview_user_transfer(self.source_user, self.destination)
        result = drive.transfer_user_drive(
            self.source_user, self.destination, preview["fingerprint"], confirm_access=True
        )
        self.assertFalse(result["complete"])
        self.assertEqual(sum(row["success"] for row in result["results"]), 1)
        retry = drive.preview_user_transfer(self.source_user, self.destination)
        self.assertEqual(retry["item_count"], 1)
        self.assertEqual(frappe.db.count("Drive Node", {"name": moved, "root": self.target}), 1)
