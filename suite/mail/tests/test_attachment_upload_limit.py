"""Mail compose refuses an attachment over the Mail limit (B25).

The limit is written here as a number on purpose: 25 MB is the product
decision, and the test fails if the code drifts from it.
"""

import frappe
from frappe.core.doctype.file.exceptions import MaxFileSizeReachedError
from frappe.tests import IntegrationTestCase

from suite.mail.api.account import get_user_info
from suite.mail.api.mail import upload_file
from suite.mail.tests.fixtures import upload_request

MB = 1024 * 1024
LIMIT = 25 * MB


class TestAttachmentUploadLimit(IntegrationTestCase):
    def setUp(self):
        frappe.set_user("Administrator")

    def test_an_attachment_at_the_limit_is_stored(self):
        with upload_request(b"x" * LIMIT, "at-the-limit.bin"):
            file = upload_file()
        self.addCleanup(frappe.delete_doc, "File", file.name, force=True, ignore_permissions=True)

        self.assertEqual(file.file_size, LIMIT)
        self.assertEqual(file.file_name, "at-the-limit.bin")

    def test_an_attachment_one_byte_over_the_limit_is_refused_by_name(self):
        before = frappe.db.count("File", {"file_name": "too-big.bin"})

        with upload_request(b"x" * (LIMIT + 1), "too-big.bin"):
            with self.assertRaises(MaxFileSizeReachedError) as refusal:
                upload_file()

        self.assertIn("too-big.bin", str(refusal.exception))
        self.assertIn("25 MB", str(refusal.exception))
        self.assertEqual(frappe.db.count("File", {"file_name": "too-big.bin"}), before)

    def test_a_chunked_upload_that_declares_more_than_the_limit_is_refused_at_its_first_chunk(self):
        with upload_request(
            b"x" * MB,
            "declared-too-big.bin",
            chunk_index="0",
            total_chunk_count="30",
            chunk_byte_offset="0",
            total_file_size=str(30 * MB),
        ):
            with self.assertRaises(MaxFileSizeReachedError):
                upload_file()

    def test_compose_is_told_the_limit(self):
        self.assertEqual(get_user_info().max_attachment_size, LIMIT)
