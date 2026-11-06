# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Attaching from Drive: each picked file becomes a private copy, attached as an upload would be."""

import io
from unittest import mock

import frappe
from frappe.tests import IntegrationTestCase

from suite import drive
from suite.mail.api import mail


class TestAttachDriveFiles(IntegrationTestCase):
    def _attach(self, *files: tuple[str, bytes]):
        contents = {f"node-{i}": data for i, (_, data) in enumerate(files)}
        with mock.patch.object(
            drive,
            "read_file",
            side_effect=lambda node: (io.BytesIO(contents[node]), "text/plain"),
        ):
            return mail.attach_drive_files(
                [{"node": f"node-{i}", "title": title} for i, (title, _) in enumerate(files)]
            )

    def test_each_file_becomes_a_private_copy_named_as_in_drive(self):
        attached = self._attach(("Invoice October.txt", b"Invoice for October"))

        self.assertEqual(len(attached), 1)
        file = frappe.get_doc("File", attached[0]["name"])
        self.assertEqual(file.file_name, "Invoice October.txt")
        self.assertTrue(file.is_private)
        self.assertEqual(file.folder, "Home/Frappe Mail")
        self.assertEqual(file.get_content(), "Invoice for October")
        self.assertEqual(attached[0]["file_url"], file.file_url)

    def test_a_file_too_large_to_mail_is_refused_by_name(self):
        too_large = b"x" * (mail.MAX_ATTACHMENT_SIZE + 1)

        with self.assertRaises(frappe.ValidationError) as refused:
            self._attach(("Backup.zip", too_large))

        self.assertIn("Backup.zip", str(refused.exception))

    def test_a_file_drive_refuses_is_refused_and_nothing_is_kept(self):
        files_before = frappe.db.count("File", {"file_name": "Secret.txt"})

        with (
            mock.patch.object(drive, "read_file", side_effect=frappe.PermissionError),
            self.assertRaises(frappe.PermissionError),
        ):
            mail.attach_drive_files([{"node": "node-0", "title": "Secret.txt"}])

        self.assertEqual(frappe.db.count("File", {"file_name": "Secret.txt"}), files_before)
