from unittest.mock import MagicMock

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.drive._core.access import grant
from suite.drive._core.comments import (
    _locked_comment,
    _locked_thread,
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
from suite.tests.utils import ensure_user, stub_db

OWNER = "drive-comment-owner@example.com"
COMMENTER = "drive-commenter@example.com"
MENTIONED = "drive-mentioned@example.com"
OUTSIDER = "drive-comment-outsider@example.com"


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
        thread = create_thread(self.commenter, self.document.name, anchor, "First", author_name="Forged")[
            "thread"
        ]
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
        thread = create_thread(self.commenter, self.document.name, "anchor", "Original")["thread"]
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
        # §5.9 step 1 mints the token server-side, so the fixture asks for two
        # links with the bare `$LINK` spelling and reads back what it was given.
        # A caller-chosen token is refused, and the refusal is the point.
        link_a = grant(self.document.name, "$LINK", COMMENT, self.admin)["principal"]
        link_b = grant(self.document.name, "$LINK", COMMENT, self.admin)["principal"]
        self.assertNotEqual(link_a, link_b)
        # Two capability links on one node stay two rows. The borrowed-token
        # refusal reads other nodes only, so tightening it to one link per node
        # would take this attribution case with it.
        self.assertEqual(
            sorted(
                frappe.get_all(
                    "Drive Grant",
                    filters={"node": self.document.name, "principal": ["like", "$LINK:%"]},
                    pluck="principal",
                )
            ),
            sorted([link_a, link_b]),
        )
        guest_a = Principals("Guest", (), (link_a,))
        guest_b = Principals("Guest", (), (link_b,))
        thread = create_thread(guest_a, self.document.name, "opaque", "Guest text", author_name="Ada")[
            "thread"
        ]
        comment = frappe.db.get_value("Drive Comment", {"thread": thread}, "name")

        row = frappe.db.get_value("Drive Comment", comment, ["author", "author_name"], as_dict=True)
        self.assertEqual((row.author, row.author_name), ("Guest", "Ada"))
        self.assertEqual(
            frappe.db.get_value(
                "Drive Activity",
                {"node": self.document.name, "action": "comment", "actor": "Guest"},
                "via_link",
            ),
            link_a,
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
        )["thread"]
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
        thread = create_thread(self.owner, self.document.name, "anchor", "Before trash")["thread"]
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


class TestCommentLockOrder(UnitTestCase):
    """`nodes.purge` locks a Drive Node row and then deletes the comment rows
    beneath it. A comment write that locked its own row first would invert that
    order and deadlock against a concurrent purge."""

    def _locked_doctypes(self, target, name):
        seen = []

        def get_value(doctype, *args, **kwargs):
            if kwargs.get("for_update"):
                seen.append(doctype)
            if doctype == "Drive Node":
                return frappe._dict(
                    name="node-1", parent="p-1", root="r-1", path="/a", kind="document", state="Active"
                )
            if doctype == "Drive Comment Thread":
                return frappe._dict(
                    name="thread-1", node="node-1", resolved=0, resolved_by=None, resolved_at=None
                )
            return frappe._dict(
                name="comment-1", thread="thread-1", node="node-1", author="a@example.com", author_name=None
            )

        db = MagicMock()
        db.get_value.side_effect = get_value
        # `frappe.db` is a proxy for `frappe.local.db`, so swapping the local
        # keeps this test runnable without a database connection. `stub_db`
        # restores the previous binding, which `mock.patch` cannot do.
        with stub_db(db):
            target(name)
        return seen

    def test_the_node_is_locked_before_its_thread(self):
        self.assertEqual(
            self._locked_doctypes(_locked_thread, "thread-1"),
            ["Drive Node", "Drive Comment Thread"],
        )

    def test_the_node_is_locked_before_its_comment(self):
        self.assertEqual(
            self._locked_doctypes(_locked_comment, "comment-1"),
            ["Drive Node", "Drive Comment"],
        )

    def test_the_stub_leaves_the_database_binding_as_it_found_it(self):
        missing = object()
        before = getattr(frappe.local, "db", missing)

        self._locked_doctypes(_locked_thread, "thread-1")

        after = getattr(frappe.local, "db", missing)
        self.assertIs(after, before)
        if before is not missing:
            # The `frappe.db` proxy still resolves to the original connection, so
            # later integration tests run. Compare the object behind the proxy
            # instead of an attribute that framework versions may rename.
            proxy = frappe.db
            resolved = getattr(proxy, "_get_current_object", lambda: proxy)()
            self.assertIs(resolved, before)
