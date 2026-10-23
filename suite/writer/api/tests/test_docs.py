"""`suite.writer.api.docs.save_comments`, on a real site.

`save_comments` is checked against real grants, because the role it needs is
Drive's rule.
"""

import base64

import frappe
import pycrdt
from frappe.tests import IntegrationTestCase

from suite import drive
from suite.drive._core.access import grant
from suite.drive._core.nodes import purge, update
from suite.drive._core.principals import Principals
from suite.tests.utils import ensure_user
from suite.writer.api.docs import save_comments

USER = "writer-docs-user@example.com"
OTHER = "writer-docs-other@example.com"
READER = "writer-docs-reader@example.com"


def _admin() -> Principals:
    return Principals("Administrator", ("Administrator",), (), is_admin=True)


def _new_document(title: str) -> frappe._dict:
    """One Writer document in the caller's personal root, as Drive creates it."""
    user = frappe.session.user
    root = drive.personal_root_for(user) or drive.ensure_personal_root(user)
    node = drive.create_document(root, title, content_doctype="Writer Document")
    return frappe._dict(name=node, content_docname=frappe.db.get_value("Drive Node", node, "content_docname"))


def _comment_blob(threads: dict) -> str:
    """The base64 Yjs update the editor posts: a `comments` map of threads by id."""
    document = pycrdt.Doc()
    document["comments"] = comments = pycrdt.Map()
    for key, value in threads.items():
        comments[key] = value
    return base64.b64encode(document.get_update()).decode("ascii")


class TestSaveComments(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(USER)
        ensure_user(OTHER)
        ensure_user(READER)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.document = _new_document(f"Comments {frappe.generate_hash(6)}")
        self.addCleanup(self._purge, self.document.name)
        grant(self.document.name, OTHER, drive.COMMENT, _admin())
        grant(self.document.name, READER, drive.READ, _admin())
        frappe.db.commit()

    @staticmethod
    def _purge(node: str):
        frappe.set_user("Administrator")
        update(_admin(), node, state="Trashed")
        purge(_admin(), node)
        frappe.db.commit()

    def _stored(self) -> str | None:
        return frappe.db.get_value("Writer Document", self.document.content_docname, "ycomments")

    def test_a_mention_in_an_inline_comment_notifies_that_person_once(self):
        thread = {
            "id": "thread-1",
            "owner": OTHER,
            "text": f'<p>Please check <span data-type="mention" data-id="{READER}">@Reader</span></p>',
            "mentions": [{"value": READER, "label": "Reader"}],
            "replies": [],
            "creation": 1_700_000_000_000,
        }
        frappe.set_user(OTHER)
        save_comments(self.document.content_docname, _comment_blob({"thread-1": thread}))
        self.assertEqual(self._notified(), [READER])

        # Saving the same comment again, resolved, mentions nobody new.
        save_comments(
            self.document.content_docname, _comment_blob({"thread-1": {**thread, "resolved": True}})
        )
        self.assertEqual(self._notified(), [READER])

        # A reply that mentions the owner reaches the owner, not the reader again.
        reply = {"id": "reply-1", "owner": OTHER, "text": "<p>@User</p>", "mentions": [{"value": USER}]}
        save_comments(
            self.document.content_docname,
            _comment_blob({"thread-1": {**thread, "replies": [reply]}}),
        )
        self.assertEqual(sorted(self._notified()), sorted([READER, USER]))
        activity = frappe.get_all(
            "Drive Activity", filters={"node": self.document.name, "action": "comment"}, pluck="detail"
        )
        self.assertEqual(
            sorted(frappe.parse_json(detail)["comment"] for detail in activity), ["reply-1", "thread-1"]
        )

    def _notified(self) -> list[str]:
        """Who the document's comments notified; sharing it notified people too."""
        activity = frappe.get_all(
            "Drive Activity", filters={"node": self.document.name, "action": "comment"}, pluck="name"
        )
        return frappe.get_all(
            "Drive Notification", filters={"activity": ["in", activity or [""]]}, pluck="to_user"
        )

    def test_a_commenter_saves_inline_comments_and_a_reader_is_refused(self):
        frappe.set_user(OTHER)
        save_comments(self.document.content_docname, "AQID")
        self.assertEqual(self._stored(), "AQID")

        frappe.set_user(READER)
        with self.assertRaises(drive.DriveForbidden):
            save_comments(self.document.content_docname, "BAUG")
        self.assertEqual(self._stored(), "AQID")
