import frappe
from frappe.tests import IntegrationTestCase

from suite.drive._core.access import grant
from suite.drive._core.comments import (
    create_thread,
    delete_comment,
    edit_comment,
    reply,
    resolve,
    threads,
)
from suite.drive._core.errors import DriveForbidden, DriveNotFound
from suite.drive._core.nodes import update
from suite.drive._core.principals import Principals
from suite.drive._core.roles import COMMENT, READ
from suite.drive._core.roots import create_root
from suite.tests.utils import ensure_user

OWNER = "drive-comment-owner@example.com"
COMMENTER = "drive-commenter@example.com"
MENTIONED = "drive-mentioned@example.com"
OUTSIDER = "drive-comment-outsider@example.com"
LINK_A = "$LINK:" + "A" * 22
LINK_B = "$LINK:" + "B" * 22


class TestCommentWorkflows(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for user in (OWNER, COMMENTER, MENTIONED, OUTSIDER):
            ensure_user(user)

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        self.owner = Principals(OWNER, (OWNER,), ())
        self.commenter = Principals(COMMENTER, (COMMENTER,), ())
        self.outsider = Principals(OUTSIDER, (OUTSIDER,), ())
        self.root = create_root(kind="Personal", title="Comment root", user=OWNER)
        self.document = frappe.get_doc(
            {
                "doctype": "Drive Node",
                "title": "Document",
                "parent": self.root.name,
                "root": self.root.name,
                "path": "",
                "kind": "document",
                "state": "Active",
                "size": 0,
                "is_template": 0,
            }
        ).insert(ignore_permissions=True)
        grant(self.document.name, COMMENTER, COMMENT, self.admin)

    def tearDown(self):
        frappe.set_user("Administrator")
        nodes = (self.document.name, self.root.name)
        activity = tuple(frappe.get_all("Drive Activity", filters={"node": ["in", nodes]}, pluck="name"))
        if activity:
            frappe.db.delete("Drive Notification", {"activity": ["in", activity]})
        frappe.db.delete("Drive Comment", {"node": self.document.name})
        frappe.db.delete("Drive Comment Thread", {"node": self.document.name})
        frappe.db.delete("Drive Activity", {"node": ["in", nodes]})
        frappe.db.delete("Drive Grant", {"node": ["in", nodes]})
        frappe.db.delete("Drive Node", {"name": ["in", nodes]})
        frappe.db.delete("Drive Root", {"name": self.root.name})
        frappe.db.commit()
        super().tearDown()

    def test_anchor_replies_resolution_and_server_authorship(self):
        anchor = 'sheet-1:{"cell":"A1"}'
        thread = create_thread(self.commenter, self.document.name, anchor, "First", author_name="Forged")
        reply_id = reply(self.owner, thread, "Second")
        resolve(self.commenter, thread)

        result = threads(self.owner, self.document.name)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].anchor, anchor)
        self.assertTrue(result[0].resolved)
        self.assertEqual([row.content for row in result[0].comments], ["First", "Second"])
        self.assertEqual(result[0].comments[0].author, COMMENTER)
        self.assertIsNone(result[0].comments[0].author_name)
        self.assertEqual(result[0].comments[1].name, reply_id)
        self.assertEqual(
            frappe.db.count("Drive Activity", {"node": self.document.name, "action": "comment"}),
            3,
        )

    def test_author_can_edit_at_read_but_non_author_cannot(self):
        thread = create_thread(self.commenter, self.document.name, "anchor", "Original")
        comment = frappe.db.get_value("Drive Comment", {"thread": thread}, "name")
        grant(self.document.name, COMMENTER, READ, self.admin)

        edit_comment(self.commenter, comment, "Edited")
        self.assertEqual(frappe.db.get_value("Drive Comment", comment, "content"), "Edited")
        with self.assertRaises(DriveNotFound):
            edit_comment(self.outsider, comment, "No")

        grant(self.document.name, OUTSIDER, READ, self.admin)
        with self.assertRaises(DriveForbidden):
            delete_comment(self.outsider, comment)
        delete_comment(self.commenter, comment)
        self.assertFalse(frappe.db.exists("Drive Comment", comment))

    def test_guest_name_and_link_attribution_distinguish_guest_authors(self):
        grant(self.document.name, LINK_A, COMMENT, self.admin)
        grant(self.document.name, LINK_B, COMMENT, self.admin)
        guest_a = Principals("Guest", (), (LINK_A,))
        guest_b = Principals("Guest", (), (LINK_B,))
        thread = create_thread(guest_a, self.document.name, "opaque", "Guest text", author_name="Ada")
        comment = frappe.db.get_value("Drive Comment", {"thread": thread}, "name")

        row = frappe.db.get_value("Drive Comment", comment, ["author", "author_name"], as_dict=True)
        self.assertEqual((row.author, row.author_name), ("Guest", "Ada"))
        self.assertEqual(
            frappe.db.get_value(
                "Drive Activity",
                {"node": self.document.name, "action": "comment", "actor": "Guest"},
                "via_link",
            ),
            LINK_A,
        )
        with self.assertRaises(DriveForbidden):
            edit_comment(guest_b, comment, "Hijacked")
        edit_comment(guest_a, comment, "Still mine")

    def test_mentions_are_deduplicated_and_point_to_activity(self):
        thread = create_thread(
            self.commenter,
            self.document.name,
            "anchor",
            f"Hello @{MENTIONED} and @[{MENTIONED}]",
        )
        comment = frappe.db.get_value("Drive Comment", {"thread": thread}, ["name", "mentions"], as_dict=True)
        mentions = (
            frappe.parse_json(comment.mentions) if isinstance(comment.mentions, str) else comment.mentions
        )
        self.assertEqual(mentions, [MENTIONED])
        notification = frappe.db.get_value(
            "Drive Notification", {"to_user": MENTIONED}, ["activity", "read"], as_dict=True
        )
        self.assertIsNotNone(notification)
        self.assertEqual(notification.read, 0)
        activity = frappe.db.get_value(
            "Drive Activity", notification.activity, ["node", "detail"], as_dict=True
        )
        self.assertEqual(activity.node, self.document.name)
        self.assertEqual(frappe.parse_json(activity.detail)["comment"], comment.name)

    def test_unreadable_threads_are_hidden_and_trash_refuses_writes(self):
        thread = create_thread(self.owner, self.document.name, "anchor", "Before trash")
        comment = frappe.db.get_value("Drive Comment", {"thread": thread}, "name")
        with self.assertRaises(DriveNotFound):
            threads(self.outsider, self.document.name)

        update(self.admin, self.document.name, state="Trashed")
        self.assertEqual(len(threads(self.owner, self.document.name)), 1)
        with self.assertRaises(DriveForbidden):
            reply(self.owner, thread, "No reply")
        with self.assertRaises(DriveForbidden):
            resolve(self.owner, thread)
        with self.assertRaises(DriveForbidden):
            edit_comment(self.owner, comment, "No edit")
