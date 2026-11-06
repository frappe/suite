import frappe

from suite import drive
from suite.writer.content.tests.drive_callback_case import share_as_writer
from suite.writer.content.tests.support import READER, WRITER, CollabCase
from suite.writer.http import routes


class TestPublicReader(CollabCase):
    def test_a_public_reader_gets_the_document_without_its_old_comments(self):
        node = self.new_document()
        share_as_writer(node, "$PUBLIC", drive.READ)
        name = frappe.db.get_value("Drive Node", node, "content_docname")
        frappe.db.set_value("Writer Document", name, "ycomments", "AAEC", update_modified=False)
        frappe.db.commit()

        frappe.set_user("Guest")
        public = routes.document(name)
        frappe.set_user(READER)
        signed_in = routes.document(name)

        self.assertEqual(public["name"], name)
        self.assertNotIn("ycomments", public)
        self.assertEqual(signed_in["ycomments"], "AAEC")
