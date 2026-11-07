"""A file attached in Mail compose is private to the person who uploaded it.

Compose saves each attachment as a private framework `File` before the mail is
sent. Recipients never read that row: sending uploads the bytes to the mail
server, which delivers them as part of the message. So nobody but the uploader
may list, read, change or download it (issue #1085).
"""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import set_request
from frappe.utils.response import download_private_file
from werkzeug.exceptions import Forbidden

from suite.mail.api.mail import upload_file
from suite.mail.tests.fixtures import upload_request
from suite.tests.utils import ABSENT, ensure_user, restore_local

UPLOADER = "attachment-uploader@example.com"
OTHER = "attachment-other@example.com"


class TestAttachmentAccess(IntegrationTestCase):
    def setUp(self):
        for user in (UPLOADER, OTHER):
            ensure_user(user)
            frappe.get_doc("User", user).add_roles("Suite User")
        self.addCleanup(frappe.set_user, "Administrator")

        frappe.set_user(UPLOADER)
        with upload_request(b"payroll for March", "payroll.txt", folder="Home/Frappe Mail"):
            self.file = upload_file()
        self.addCleanup(frappe.delete_doc, "File", self.file.name, force=True, ignore_permissions=True)

        # Downloading streams the bytes against the current request, as `/private/files/` does.
        self.addCleanup(restore_local, "request", getattr(frappe.local, "request", ABSENT))
        set_request(method="GET", path=self.file.file_url)

    def test_the_uploader_can_list_and_download_the_attachment(self):
        frappe.set_user(UPLOADER)

        self.assertTrue(self.file.is_private)
        self.assertEqual(
            frappe.get_list("File", filters={"name": self.file.name}, pluck="name"), [self.file.name]
        )
        self.assertTrue(frappe.has_permission("File", "read", self.file.name))
        self.assertEqual(download_private_file(self.file.file_url).status_code, 200)

    def test_another_user_cannot_list_read_change_or_download_the_attachment(self):
        frappe.set_user(OTHER)

        self.assertEqual(frappe.get_list("File", filters={"name": self.file.name}, pluck="name"), [])
        for ptype in ("read", "write", "delete"):
            with self.subTest(ptype=ptype):
                self.assertFalse(frappe.has_permission("File", ptype, self.file.name))
        with self.assertRaises(Forbidden):
            download_private_file(self.file.file_url)
