# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Attaching from Drive: each picked file becomes a private copy, attached as an upload would be."""

import io
from unittest import mock

import frappe
from frappe.tests import IntegrationTestCase

from suite import drive
from suite.mail.api import mail
from suite.mail.patches import add_attach_drive_files_rate_limit
from suite.suite_core.doctype.rate_limit.rate_limit import get_rate_limits

OWNER = "drive-attach-owner@example.com"
OUTSIDER = "drive-attach-outsider@example.com"

# The smallest well-formed PDF: Drive knows it as a PDF from its bytes, whatever its title says.
PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"


def _ensure_user(email: str) -> None:
    if not frappe.db.exists("User", email):
        frappe.get_doc(
            {
                "doctype": "User",
                "email": email,
                "first_name": email.split("@")[0],
                "enabled": 1,
                "new_password": "password",
            }
        ).insert(ignore_permissions=True)
    drive.personal_root_for(email) or drive.ensure_personal_root(email)


def _unique(title: str) -> str:
    stem, dot, extension = title.partition(".")
    return f"{stem} {frappe.generate_hash(length=8)}{dot}{extension}"


class TestAttachDriveFiles(IntegrationTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        _ensure_user(OWNER)
        _ensure_user(OUTSIDER)
        frappe.set_user(OWNER)

    def tearDown(self):
        frappe.set_user("Administrator")

    def _in_drive(self, title: str, content: bytes) -> str:
        """A file in the session user's own Drive."""
        return drive.store_file(drive.personal_root_for(frappe.session.user), title, io.BytesIO(content))

    def test_each_file_becomes_a_private_copy_named_as_in_drive(self):
        title = _unique("Invoice October.txt")
        node = self._in_drive(title, b"Invoice for October")

        attached = mail.attach_drive_files([node])

        self.assertEqual(len(attached), 1)
        file = frappe.get_doc("File", attached[0]["name"])
        self.assertEqual(file.file_name, title)
        self.assertTrue(file.is_private)
        self.assertEqual(file.folder, "Home/Frappe Mail")
        self.assertEqual(file.get_content(), "Invoice for October")
        self.assertEqual(attached[0]["file_url"], file.file_url)

    def test_a_title_with_no_extension_is_named_for_the_type_drive_knows(self):
        # The mail's attachment type is read off the file name, so "Invoice" alone would go out as
        # an unknown type.
        title = _unique("Invoice October")
        node = self._in_drive(title, PDF)

        attached = mail.attach_drive_files([node])

        self.assertEqual(attached[0]["file_name"], f"{title}.pdf")

    def test_a_file_too_large_to_mail_is_refused_by_name(self):
        title = _unique("Backup.zip")
        node = self._in_drive(title, b"x" * 17)

        with (
            mock.patch.object(mail, "MAX_ATTACHMENT_SIZE", 16),
            self.assertRaises(frappe.ValidationError) as refused,
        ):
            mail.attach_drive_files([node])

        self.assertIn(title, str(refused.exception))

    def test_files_too_large_together_are_refused_and_none_is_kept(self):
        titles = [_unique("Part one.txt"), _unique("Part two.txt")]
        nodes = [self._in_drive(title, b"x" * 20) for title in titles]

        with (
            mock.patch.object(mail, "MAX_DRIVE_ATTACHMENT_TOTAL", 30),
            self.assertRaises(frappe.ValidationError),
        ):
            mail.attach_drive_files(nodes)

        self.assertFalse(frappe.db.exists("File", {"file_name": ["in", titles]}))

    def test_a_file_someone_else_owns_is_refused_and_nothing_is_kept(self):
        others = _unique("Salaries.txt")
        theirs = self._in_drive(others, b"Salaries")
        frappe.set_user(OUTSIDER)
        own = _unique("Notes.txt")
        mine = self._in_drive(own, b"Notes")

        with self.assertRaises(drive.DriveError):
            mail.attach_drive_files([mine, theirs])

        self.assertFalse(frappe.db.exists("File", {"file_name": ["in", [own, others]]}))

    def test_an_existing_site_gets_a_limit_on_attaching_from_drive(self):
        method_path = "suite.mail.api.mail.attach_drive_files"
        frappe.set_user("Administrator")
        frappe.db.delete("Rate Limit", {"method_path": method_path})
        frappe.cache.hdel("rate_limits", method_path)

        add_attach_drive_files_rate_limit.execute()

        self.assertTrue(get_rate_limits(method_path))
