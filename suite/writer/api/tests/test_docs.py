"""`suite.writer.api.docs`, against the documents ticket 29 made Drive-native.

`create_document` is an adapter over `drive.create_document`
(`test_ticket29_create_document` pins its contract with no database). These
cases are the two the mocks cannot answer: that the whole create is one
transaction on a real site, and that `save_comments` reaches the controller
rather than a `File` that is not there.
"""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.drive._core.access import grant
from suite.drive._core.errors import DriveForbidden, DriveNotFound
from suite.drive._core.nodes import purge, update
from suite.drive._core.principals import Principals
from suite.drive._core.roles import READ
from suite.tests.utils import ensure_user
from suite.writer.api.docs import create_document, save_comments

USER = "writer-docs-user@example.com"
OTHER = "writer-docs-other@example.com"

TEMPLATE_BODY = "<p>a template</p>"


def _admin() -> Principals:
    return Principals("Administrator", ("Administrator",), (), is_admin=True)


class TestCreateDocumentOnSite(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(USER)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        self._before = self._nodes()

    def tearDown(self):
        frappe.set_user("Administrator")
        for node in self._nodes() - self._before:
            update(_admin(), node, state="Trashed")
            purge(_admin(), node)
        frappe.db.commit()
        super().tearDown()

    @staticmethod
    def _nodes() -> set[str]:
        return set(frappe.get_all("Drive Node", filters={"content_doctype": "Writer Document"}, pluck="name"))

    @staticmethod
    def _documents() -> set[str]:
        return set(frappe.get_all("Writer Document", pluck="name"))

    def _template(self) -> str:
        template = frappe.get_doc(
            {
                "doctype": "Writer Template",
                "title": f"Template {frappe.generate_hash(6)}",
                "content": TEMPLATE_BODY,
            }
        ).insert()
        self.addCleanup(frappe.delete_doc, "Writer Template", template.name, force=1, ignore_permissions=True)
        return template.name

    def test_a_document_and_its_node_are_written_together(self):
        answer = create_document(title="Kickoff")

        node = frappe.db.get_value(
            "Drive Node", answer["name"], ("kind", "title", "content_docname"), as_dict=True
        )
        self.assertEqual(node.kind, "document")
        self.assertEqual(node.title, "Kickoff")
        self.assertEqual(answer["file_name"], "Kickoff")
        self.assertEqual(answer["content_docname"], node.content_docname)
        self.assertEqual(frappe.db.get_value("Writer Document", node.content_docname, "node"), answer["name"])

    def test_a_template_is_recorded_on_the_new_document(self):
        template = self._template()

        answer = create_document(title="From Template", template=template)

        settings = frappe.parse_json(
            frappe.db.get_value("Writer Document", answer["content_docname"], "settings")
        )
        self.assertEqual(settings["template"], template)
        self.assertTrue(settings["collab"])

    def test_a_template_that_does_not_exist_leaves_no_node_and_no_document(self):
        """The workflow closes its own savepoint before the template write, so
        the adapter holds a savepoint around both: a refused template must not
        leave the half-made document a caller never asked for."""
        nodes, documents = self._nodes(), self._documents()

        with self.assertRaises(frappe.DoesNotExistError):
            create_document(title="Doomed", template="no-such-template")

        self.assertEqual(self._nodes(), nodes)
        self.assertEqual(self._documents(), documents)

    def test_a_template_the_caller_cannot_read_leaves_no_node_and_no_document(self):
        """A template the caller may not read must not be named in `settings`:
        the editor fetches the body from it. The check runs before the write
        and its refusal rolls the whole create back."""
        template = self._template()
        nodes, documents = self._nodes(), self._documents()

        with patch("suite.writer.api.docs.frappe.has_permission", return_value=False):
            with self.assertRaises(frappe.PermissionError):
                create_document(title="Doomed", template=template)

        self.assertEqual(self._nodes(), nodes)
        self.assertEqual(self._documents(), documents)

    def test_a_rolled_back_create_leaves_the_root_charge_where_it_was(self):
        """The rollback is one savepoint, so the byte accounting goes back with
        the rows (§8.3)."""
        create_document(title="Charge baseline")
        root = frappe.db.get_value("Drive Root", {"kind": "Personal", "user": USER}, "name")
        before = frappe.db.get_value("Drive Root", root, "used_bytes")

        with self.assertRaises(frappe.DoesNotExistError):
            create_document(title="Doomed", template="no-such-template")

        self.assertEqual(frappe.db.get_value("Drive Root", root, "used_bytes"), before)


class TestSaveComments(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(USER)
        ensure_user(OTHER)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.document = frappe._dict(create_document(title=f"Comments {frappe.generate_hash(6)}"))
        self.addCleanup(self._purge, self.document.name)

    @staticmethod
    def _purge(node: str):
        frappe.set_user("Administrator")
        if not frappe.db.exists("Drive Node", node):
            return
        update(_admin(), node, state="Trashed")
        purge(_admin(), node)
        frappe.db.commit()

    def test_a_linked_document_is_refused_by_name_not_by_a_missing_file(self):
        """§8.11 moves comments to `Drive Node Comment` and the controller
        refuses this call. Reading the `File` first turned that documented
        refusal into `DoesNotExistError`, which names the wrong thing."""
        with self.assertRaises(frappe.ValidationError) as refusal:
            save_comments(self.document.content_docname, "")

        self.assertNotIsInstance(refusal.exception, frappe.DoesNotExistError)
        self.assertIn("Drive comments", str(refusal.exception))
        self.assertFalse(frappe.db.get_value("Writer Document", self.document.content_docname, "ycomments"))

    def test_a_stranger_is_not_told_the_document_exists(self):
        """The refusal by name comes after the COMMENT check, so it is not an
        existence oracle for a document the caller holds nothing on (§5.4)."""
        frappe.set_user(OTHER)
        with self.assertRaises(DriveNotFound):
            save_comments(self.document.content_docname, "")

    def test_a_reader_cannot_comment(self):
        """COMMENT is the level the legacy `user_has_permission(file, "comment")`
        named, and a Read grant is below it."""
        grant(self.document.name, OTHER, READ, _admin())
        frappe.db.commit()

        frappe.set_user(OTHER)
        with self.assertRaises(DriveForbidden):
            save_comments(self.document.content_docname, "")
