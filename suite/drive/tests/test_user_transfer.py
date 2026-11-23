"""Retained transfer preserves versions, trash, grants and stable node identities."""

import json
from io import BytesIO
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite import drive
from suite.drive._core.nodes import update
from suite.drive.framework import principals_for_request
from suite.suite_core.administration import update_user
from suite.suite_core.storage import state, update_limits
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
        frappe.db.set_value(
            "User", self.source_user, {"first_name": "Leah", "last_name": "Kim", "full_name": "Leah Kim"}
        )
        self.destination = self.target

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
        preview = drive.preview_user_transfer(self.source_user, self.target_user)
        self.assertEqual(preview["folder_title"], "Leah Kim's files")
        self.assertFalse(
            frappe.db.exists("Drive Node", {"parent_node": self.target, "title": "Leah Kim's files"})
        )
        self.assertEqual(preview["bytes"], 17)
        self.assertEqual(preview["item_count"], 2)
        result = drive.transfer_user_drive(
            self.source_user, self.target_user, None, preview["fingerprint"], confirm_access=True
        )
        self.assertTrue(result["complete"], result)
        self.assertEqual(frappe.db.get_value("Drive Node", deleted, "state"), "Trashed")
        for node in (visible, deleted):
            self.assertEqual(frappe.db.get_value("Drive Node", node, "root"), self.target)
        folder = frappe.db.get_value("Drive Node", visible, "parent_node")
        self.assertEqual(
            frappe.db.get_value("Drive Node", folder, ["parent_node", "title"]),
            (self.target, "Leah Kim's files"),
        )
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
            drive.preview_user_transfer(self.source_user, self.target_user)

    def test_preview_reports_combined_over_cap_capacity_instead_of_refusing_review(self):
        drive.store_file(self.source, "retained.txt", BytesIO(b"hello"))
        drive.store_file(self.target, "existing.txt", BytesIO(b"abc"))
        drive.create_storage_reservation(self.target, "transfer-preview-reservation", 2)
        update_user(self.source_user, enabled=False)
        update_limits([self.target_user], 10)
        doc, _policy, _measurements = state(lock=True)
        doc.measurements = json.dumps({"personal": {self.target_user: 4}})
        doc.save(ignore_permissions=True)
        with patch("suite.drive._core.offboarding.is_suite_cloud_configured", return_value=True):
            preview = drive.preview_user_transfer(self.source_user, self.target_user)
        self.assertEqual(
            preview["destination_capacity"],
            {
                "stored_bytes": 3,
                "mail_bytes": 4,
                "reserved_bytes": 2,
                "current_bytes": 9,
                "projected_bytes": 14,
                "cap_bytes": 10,
                "buffer_bytes": 1,
                "effective_threshold_bytes": 11,
                "complete": True,
                "blocker": "personal_limit",
            },
        )
        with (
            patch("suite.suite_core.utils.is_suite_cloud_configured", return_value=True),
            patch("suite.drive._core.offboarding.is_suite_cloud_configured", return_value=True),
            self.assertRaises(drive.DriveOverQuota),
        ):
            drive.transfer_user_drive(
                self.source_user, self.target_user, None, preview["fingerprint"], confirm_access=True
            )

    def test_normal_user_cannot_preview_or_execute_a_retained_transfer(self):
        update_user(self.source_user, enabled=False)
        with self.set_user(self.target_user):
            with self.assertRaises(frappe.PermissionError):
                drive.preview_user_transfer(self.source_user, self.target_user)
            with self.assertRaises(frappe.PermissionError):
                drive.transfer_user_drive(
                    self.source_user, self.target_user, None, "untrusted", confirm_access=True
                )

    def test_missing_personal_mail_usage_is_visible_and_blocks_execution_not_preview(self):
        drive.store_file(self.source, "retained.txt", BytesIO(b"hello"))
        update_user(self.source_user, enabled=False)
        doc, _policy, _measurements = state(lock=True)
        doc.measurements = "{}"
        doc.save(ignore_permissions=True)
        with patch("suite.drive._core.offboarding.is_suite_cloud_configured", return_value=True):
            preview = drive.preview_user_transfer(self.source_user, self.target_user)
            capacity = preview["destination_capacity"]
            self.assertFalse(capacity["complete"])
            self.assertIsNone(capacity["current_bytes"])
            self.assertIsNone(capacity["projected_bytes"])
            self.assertEqual(capacity["blocker"], "unknown_usage")
            with self.assertRaises(drive.DriveOverQuota):
                drive.transfer_user_drive(
                    self.source_user, self.target_user, None, preview["fingerprint"], confirm_access=True
                )

    def test_a_mailbox_not_measured_since_it_changed_blocks_a_transfer_that_adds_bytes(self):
        drive.store_file(self.source, "retained.txt", BytesIO(b"hello"))
        update_user(self.source_user, enabled=False)
        doc, _policy, _measurements = state(lock=True)
        doc.measurements = json.dumps(
            {"personal": {self.target_user: None}, "site_mail": 0, "allowance": 10_000_000}
        )
        doc.save(ignore_permissions=True)
        with patch("suite.drive._core.offboarding.is_suite_cloud_configured", return_value=True):
            preview = drive.preview_user_transfer(self.source_user, self.target_user)
            self.assertEqual(preview["destination_capacity"]["blocker"], "unknown_usage")
            with self.assertRaises(drive.DriveOverQuota):
                drive.transfer_user_drive(
                    self.source_user, self.target_user, None, preview["fingerprint"], confirm_access=True
                )

    def test_execution_rechecks_a_lowered_cap_and_requires_access_confirmation(self):
        drive.store_file(self.source, "retained.txt", BytesIO(b"hello"))
        update_user(self.source_user, enabled=False)
        update_limits([self.target_user], 10)
        doc, _policy, _measurements = state(lock=True)
        doc.measurements = json.dumps({"personal": {self.target_user: 0}, "site_mail": 999, "allowance": 1})
        doc.save(ignore_permissions=True)
        with patch("suite.drive._core.offboarding.is_suite_cloud_configured", return_value=True):
            preview = drive.preview_user_transfer(self.source_user, self.target_user)
            self.assertIsNone(preview["destination_capacity"]["blocker"])
            with self.assertRaises(drive.DriveConflict):
                drive.transfer_user_drive(
                    self.source_user, self.target_user, None, preview["fingerprint"], confirm_access=False
                )
            update_limits([self.target_user], 4)
            with self.assertRaises(drive.DriveOverQuota):
                drive.transfer_user_drive(
                    self.source_user, self.target_user, None, preview["fingerprint"], confirm_access=True
                )
            update_limits([self.target_user], 5)
            with patch("suite.suite_core.utils.is_suite_cloud_configured", return_value=True):
                result = drive.transfer_user_drive(
                    self.source_user, self.target_user, None, preview["fingerprint"], confirm_access=True
                )
            self.assertTrue(result["complete"], result)

    def test_changed_destination_grants_require_a_new_preview(self):
        update_user(self.source_user, enabled=False)
        preview = drive.preview_user_transfer(self.source_user, self.target_user)
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
                self.target_user,
                None,
                preview["fingerprint"],
                confirm_access=True,
            )

    def test_a_failed_name_collision_is_retained_and_a_retry_does_not_duplicate_successes(self):
        drive.ensure_folder(self.source, "collision")
        moved = drive.ensure_folder(self.source, "unique")
        destination = drive.ensure_folder(self.target, "Leah Kim's files")
        collision = drive.ensure_folder(destination, "collision")
        update_user(self.source_user, enabled=False)
        preview = drive.preview_user_transfer(self.source_user, self.target_user)
        result = drive.transfer_user_drive(
            self.source_user, self.target_user, None, preview["fingerprint"], confirm_access=True
        )
        self.assertFalse(result["complete"])
        self.assertEqual(sum(row["success"] for row in result["results"]), 1)
        retry = drive.preview_user_transfer(self.source_user, self.target_user)
        self.assertEqual(retry["item_count"], 1)
        self.assertEqual(frappe.db.count("Drive Node", {"name": moved, "root": self.target}), 1)
        update(principals_for_request(), collision, title="Previous collision")
        result = drive.transfer_user_drive(
            self.source_user, self.target_user, None, retry["fingerprint"], confirm_access=True
        )
        self.assertTrue(result["complete"], result)
        self.assertEqual(frappe.db.count("Drive Node", {"parent_node": destination}), 3)

    def test_exactly_one_valid_destination_is_required(self):
        update_user(self.source_user, enabled=False)
        for person, shared in [
            (None, None),
            (self.target_user, self.target),
            (self.source_user, None),
            ("Guest", None),
            ("Administrator", None),
        ]:
            with self.subTest(person=person, shared=shared), self.assertRaises(drive.DriveConflict):
                drive.preview_user_transfer(self.source_user, person, shared)
        update_user(self.target_user, enabled=False)
        with self.assertRaises(drive.DriveConflict):
            drive.preview_user_transfer(self.source_user, self.target_user)

    def test_sixty_items_share_one_folder_across_batches(self):
        for number in range(60):
            drive.ensure_folder(self.source, f"Item {number}")
        update_user(self.source_user, enabled=False)
        for expected_complete in (False, True):
            preview = drive.preview_user_transfer(self.source_user, self.target_user)
            result = drive.transfer_user_drive(
                self.source_user, self.target_user, None, preview["fingerprint"], confirm_access=True
            )
            self.assertEqual(result["complete"], expected_complete)
        folders = frappe.get_all("Drive Node", filters={"parent_node": self.target}, pluck="name")
        self.assertEqual(len(folders), 1)
        self.assertEqual(frappe.db.count("Drive Node", {"parent_node": folders[0]}), 60)

    def test_shared_drive_transfer_and_admin_listing(self):
        from suite.api.admin_transfer import shared_drives_list
        from suite.drive._core.roots import create_root

        shared = frappe.db.get_value("Drive Root", {"kind": "Shared", "state": "Active"}, "name")
        if not shared:
            shared = create_root(kind="Shared", title="Transfer team").name
        frappe.db.set_value("Drive Node", shared, "title", "Transfer team")
        node = drive.ensure_folder(self.source, "Retained")
        update_user(self.source_user, enabled=False)
        preview = drive.preview_user_transfer(self.source_user, None, shared)
        self.assertEqual(preview["destination_title"], "Transfer team")
        self.assertIsNone(preview["destination_user"])
        self.assertIn({"id": shared, "title": "Transfer team"}, shared_drives_list())
        result = drive.transfer_user_drive(
            self.source_user, None, shared, preview["fingerprint"], confirm_access=True
        )
        self.assertTrue(result["complete"], result)
        folder = frappe.db.get_value("Drive Node", node, "parent_node")
        self.assertEqual(
            frappe.db.get_value("Drive Node", folder, ["parent_node", "title"]), (shared, "Leah Kim's files")
        )
        with self.set_user(self.target_user), self.assertRaises(frappe.PermissionError):
            shared_drives_list()
