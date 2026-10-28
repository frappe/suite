import frappe

from suite import drive
from suite.drive._core.access import grant
from suite.drive._core.principals import Principals
from suite.writer.content.tests.support import READER, WRITER, CollabCase
from suite.writer.http import routes


class TestPublicReader(CollabCase):
    def test_a_public_reader_gets_the_document_without_its_old_comments(self):
        node = self.new_document()
        grant(node, "$PUBLIC", drive.READ, Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)))
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
