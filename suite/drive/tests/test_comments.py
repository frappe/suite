import inspect
import json
import pathlib
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.drive._core import comments
from suite.drive._core.access import grant
from suite.drive._core.comments import (
    _locked_comment,
    _locked_thread,
    create_thread,
    delete_comment,
    edit_comment,
    reanchor_threads,
    reply,
    resolve,
    threads,
)
from suite.drive._core.errors import DriveConflict, DriveForbidden, DriveNotFound
from suite.drive._core.nodes import update
from suite.drive._core.principals import Principals
from suite.drive._core.roles import COMMENT, READ
from suite.drive._core.roots import create_root
from suite.drive.http import routes
from suite.drive.patches.build import comments as build_comments
from suite.drive.tests.fixtures import ensure_rootless_user
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
        ensure_rootless_user(OWNER)
        self.root = create_root(kind="Personal", title="Comment root", user=OWNER)
        self.document = frappe.get_doc(
            {
                "doctype": "Drive Node",
                "title": "Document",
                "parent_node": self.root.name,
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
        opened = create_thread(self.commenter, self.document.name, anchor, "First", author_name="Forged")
        thread = opened.name
        # A write answers the row it made, as the list would show it.
        self.assertEqual([row.content for row in opened.comments], ["First"])
        replied = reply(self.owner, thread, "Second")
        reply_id = replied.name
        self.assertEqual((replied.thread, replied.content, replied.author), (thread, "Second", OWNER))
        self.assertTrue(resolve(self.commenter, thread).resolved)

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

    def test_a_resent_thread_or_reply_answers_the_first_and_writes_nothing(self):
        first = create_thread(self.commenter, self.document.name, "anchor", "Hello", client_id="t-1")
        again = create_thread(self.commenter, self.document.name, "anchor", "Hello", client_id="t-1")
        replied = reply(self.owner, first.name, "Hi", client_id="r-1")
        replied_again = reply(self.owner, first.name, "Hi", client_id="r-1")

        self.assertEqual((again.name, replied_again.name), (first.name, replied.name))
        listed = threads(self.owner, self.document.name)
        self.assertEqual([row.content for row in listed[0].comments], ["Hello", "Hi"])
        self.assertEqual(len(listed), 1)
        self.assertEqual(
            frappe.db.count("Drive Activity", {"node": self.document.name, "action": "comment"}),
            2,
        )

    def test_a_resend_with_other_words_is_refused_and_writes_nothing(self):
        first = create_thread(self.commenter, self.document.name, "anchor", "Hello", client_id="t-1")
        reply(self.owner, first.name, "Hi", client_id="r-1")

        with self.assertRaises(DriveConflict):
            create_thread(self.commenter, self.document.name, "anchor", "Goodbye", client_id="t-1")

        with self.assertRaises(DriveConflict):
            reply(self.owner, first.name, "Bye", client_id="r-1")

        listed = threads(self.owner, self.document.name)
        self.assertEqual([[row.content for row in thread.comments] for thread in listed], [["Hello", "Hi"]])
        self.assertEqual(
            frappe.db.count("Drive Activity", {"node": self.document.name, "action": "comment"}),
            2,
        )

    def test_words_that_look_like_tags_are_kept_and_resend_cleanly(self):
        words = "Replace <name> & <b>this</b> with yours"
        first = create_thread(self.commenter, self.document.name, "anchor", words, client_id="t-1")
        replied = reply(self.owner, first.name, words, client_id="r-1")
        again = create_thread(self.commenter, self.document.name, "anchor", words, client_id="t-1")
        replied_again = reply(self.owner, first.name, words, client_id="r-1")

        self.assertEqual((again.name, replied_again.name), (first.name, replied.name))
        listed = threads(self.owner, self.document.name)
        self.assertEqual([row.content for row in listed[0].comments], [words, words])

    def test_an_edit_stores_the_words_as_a_post_does(self):
        words = "Replace <name> & <b>this</b> with yours"
        posted = create_thread(self.commenter, self.document.name, "one", words)
        edited = create_thread(self.commenter, self.document.name, "two", "Draft")
        edit_comment(self.commenter, edited.comments[0].name, words)

        posted_words = frappe.db.get_value("Drive Comment", posted.comments[0].name, "content")
        edited_words = frappe.db.get_value("Drive Comment", edited.comments[0].name, "content")
        self.assertEqual((posted_words, edited_words), (words, words))

    def test_words_made_only_of_tags_post_and_reply_as_an_edit_saves_them(self):
        words = "<name> <br>"
        posted = create_thread(self.commenter, self.document.name, "anchor", words)
        reply(self.owner, posted.name, words)

        listed = threads(self.owner, self.document.name)
        self.assertEqual([row.content for row in listed[0].comments], [words, words])

    def test_blank_words_are_refused_at_post_and_reply(self):
        posted = create_thread(self.commenter, self.document.name, "anchor", "First")
        for post in (
            lambda: create_thread(self.commenter, self.document.name, "anchor", " \n "),
            lambda: reply(self.owner, posted.name, " \n "),
        ):
            with self.subTest(post=post), self.assertRaises(frappe.ValidationError):
                post()

        listed = threads(self.owner, self.document.name)
        self.assertEqual([len(thread.comments) for thread in listed], [1])

    def test_words_over_64_kb_are_refused_at_post_reply_and_edit(self):
        longest = "é" * 32_767 + "x"
        too_long = "é" * 32_768
        posted = create_thread(self.commenter, self.document.name, "anchor", longest)
        reply(self.commenter, posted.name, longest)
        for post in (
            lambda: create_thread(self.commenter, self.document.name, "anchor", too_long),
            lambda: reply(self.commenter, posted.name, too_long),
            lambda: edit_comment(self.commenter, posted.comments[0].name, too_long),
        ):
            with self.subTest(post=post), self.assertRaisesRegex(frappe.ValidationError, "64 KB"):
                post()

        listed = threads(self.owner, self.document.name)
        self.assertEqual([row.content for row in listed[0].comments], [longest, longest])
        self.assertEqual(len(listed), 1)

    def test_a_reply_id_used_in_another_thread_is_refused(self):
        one = create_thread(self.commenter, self.document.name, "one", "First").name
        two = create_thread(self.commenter, self.document.name, "two", "Second").name
        reply(self.commenter, one, "Answer", client_id="r-1")

        with self.assertRaises(DriveConflict):
            reply(self.commenter, two, "Answer", client_id="r-1")

        _first, second = threads(self.owner, self.document.name)
        self.assertEqual(len(second.comments), 1)

    def test_writes_without_a_client_id_never_collide(self):
        create_thread(self.commenter, self.document.name, "anchor", "Same")
        create_thread(self.commenter, self.document.name, "anchor", "Same")

        self.assertEqual(len(threads(self.owner, self.document.name)), 2)

    def test_a_malformed_client_id_is_refused(self):
        for client_id in ("", "has space", "x" * 65, 7):
            with self.subTest(client_id=client_id), self.assertRaises(frappe.ValidationError):
                create_thread(self.commenter, self.document.name, "anchor", "Text", client_id=client_id)

    def test_the_database_keeps_a_client_id_unique_per_node(self):
        create_thread(self.commenter, self.document.name, "anchor", "Text", client_id="t-1")

        with self.assertRaises(frappe.UniqueValidationError):
            frappe.get_doc(
                {
                    "doctype": "Drive Comment Thread",
                    "node": self.document.name,
                    "anchor": "other",
                    "client_id": "t-1",
                }
            ).insert(ignore_permissions=True)

    def test_each_comment_write_tells_the_content_app_after_it_commits(self):
        heard: list[str] = []
        with self.content_app(heard.append):
            thread = create_thread(self.commenter, self.document.name, "anchor", "First", client_id="t-1")
            create_thread(self.commenter, self.document.name, "anchor", "First", client_id="t-1")
            answer = reply(self.owner, thread.name, "Second")
            resolve(self.owner, thread.name)
            resolve(self.owner, thread.name)
            edit_comment(self.owner, answer.name, "Edited")
            delete_comment(self.owner, answer.name)
            self.assertEqual(heard, [])
            frappe.db.commit()

        self.assertEqual(heard, [self.document.name] * 5)

    def test_a_refused_comment_write_tells_nothing(self):
        heard: list[str] = []
        with self.content_app(heard.append):
            with self.assertRaises(DriveNotFound):
                create_thread(self.outsider, self.document.name, "anchor", "No")

            frappe.db.commit()

        self.assertEqual(heard, [])

    def test_a_failing_content_app_leaves_the_comment_written(self):
        def fail(node):
            raise RuntimeError("down")

        with self.content_app(fail):
            thread = create_thread(self.commenter, self.document.name, "anchor", "Kept")
            frappe.db.commit()

        self.assertTrue(frappe.db.exists("Drive Comment Thread", thread.name))

    def test_reanchoring_moves_only_the_anchor(self):
        thread = create_thread(self.commenter, self.document.name, "old", "First").name
        reply(self.owner, thread, "Second")
        resolve(self.commenter, thread)
        fields = ["resolved", "resolved_by", "resolved_at", "creation", "modified", "modified_by"]
        before = frappe.db.get_value("Drive Comment Thread", thread, fields, as_dict=True)
        [listed_before] = threads(self.owner, self.document.name)
        activity = frappe.db.count("Drive Activity", {"node": self.document.name})

        moved = reanchor_threads(self.owner, self.document.name, {thread: "new"})

        after = frappe.db.get_value("Drive Comment Thread", thread, fields, as_dict=True)
        [listed] = threads(self.owner, self.document.name)
        self.assertEqual([(row.name, row.anchor) for row in moved], [(thread, "new")])
        self.assertEqual((after, listed.anchor, listed.comments), (before, "new", listed_before.comments))
        self.assertEqual(frappe.db.count("Drive Activity", {"node": self.document.name}), activity)

    def test_reanchoring_tells_the_content_app_once_and_an_empty_move_nothing(self):
        thread = create_thread(self.commenter, self.document.name, "old", "First").name
        heard: list[str] = []
        with self.content_app(heard.append):
            reanchor_threads(self.owner, self.document.name, {})
            frappe.db.commit()
            self.assertEqual(heard, [])
            reanchor_threads(self.owner, self.document.name, {thread: "new"})
            self.assertEqual(heard, [])
            frappe.db.commit()

        self.assertEqual(heard, [self.document.name])

    def test_reanchoring_needs_edit_access(self):
        thread = create_thread(self.commenter, self.document.name, "old", "First").name

        with self.assertRaises(DriveForbidden):
            reanchor_threads(self.commenter, self.document.name, {thread: "new"})

        self.assertEqual(frappe.db.get_value("Drive Comment Thread", thread, "anchor"), "old")

    def test_a_thread_of_another_node_refuses_the_whole_move(self):
        other = frappe.copy_doc(self.document).insert(ignore_permissions=True)
        self.addCleanup(frappe.db.delete, "Drive Node", {"name": other.name})
        self.addCleanup(frappe.db.delete, "Drive Comment Thread", {"node": other.name})
        self.addCleanup(frappe.db.delete, "Drive Comment", {"node": other.name})
        mine = create_thread(self.owner, self.document.name, "mine", "First").name
        theirs = create_thread(self.owner, other.name, "theirs", "First").name

        with self.assertRaises(DriveNotFound):
            reanchor_threads(self.owner, self.document.name, {mine: "new", theirs: "new"})

        anchors = [frappe.db.get_value("Drive Comment Thread", name, "anchor") for name in (mine, theirs)]
        self.assertEqual(anchors, ["mine", "theirs"])

    def test_reanchoring_takes_at_most_one_batch_of_threads(self):
        anchors = {f"thread-{index}": "anchor" for index in range(201)}

        with self.assertRaisesRegex(frappe.ValidationError, "at most 200"):
            reanchor_threads(self.owner, self.document.name, anchors)

    def test_the_reanchor_route_refuses_anchors_that_are_not_text(self):
        thread = create_thread(self.owner, self.document.name, "old", "First").name
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")

        with self.assertRaisesRegex(frappe.ValidationError, "anchors"):
            routes.node_threads_reanchor(node=self.document.name, anchors={thread: 7})

        self.assertEqual(frappe.db.get_value("Drive Comment Thread", thread, "anchor"), "old")

    @contextmanager
    def content_app(self, threads_changed):
        frappe.db.set_value("Drive Node", self.document.name, "content_doctype", "Comment Test Doc")
        app = SimpleNamespace(threads_changed=threads_changed)
        with patch.object(comments.content, "registry", return_value={"Comment Test Doc": app}):
            yield

    def test_author_can_edit_at_read_but_non_author_cannot(self):
        thread = create_thread(self.commenter, self.document.name, "anchor", "Original").name
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

    def test_deleting_the_last_comment_removes_its_thread(self):
        thread = create_thread(self.commenter, self.document.name, "anchor", "Only one").name
        kept = create_thread(self.commenter, self.document.name, "other", "First").name
        reply(self.owner, kept, "Second")
        first_of_kept, second_of_kept = [
            row.name for row in threads(self.owner, self.document.name)[1].comments
        ]
        only = frappe.db.get_value("Drive Comment", {"thread": thread}, "name")

        delete_comment(self.commenter, only)
        delete_comment(self.commenter, first_of_kept)

        listed = threads(self.owner, self.document.name)
        self.assertEqual([row.name for row in listed], [kept])
        self.assertEqual([row.name for row in listed[0].comments], [second_of_kept])
        self.assertFalse(frappe.db.exists("Drive Comment Thread", thread))
        # The history keeps both deletions, the removed thread's included.
        deletions = frappe.get_all(
            "Drive Activity",
            filters={"node": self.document.name, "action": "comment"},
            pluck="detail",
        )
        self.assertIn(thread, {frappe.parse_json(detail).get("thread") for detail in deletions})

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
        thread = create_thread(guest_a, self.document.name, "opaque", "Guest text", author_name="Ada").name
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
        ).name
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

    def test_an_edit_notifies_only_the_people_it_adds(self):
        thread = create_thread(self.commenter, self.document.name, "anchor", f"Hi @[{MENTIONED}]").name
        comment = frappe.db.get_value("Drive Comment", {"thread": thread}, "name")

        edit_comment(self.commenter, comment, f"Hi @[{MENTIONED}] and @[{OWNER}]")
        edit_comment(self.commenter, comment, f"Hi @[{MENTIONED}] and @[{OWNER}], fixed")
        edit_comment(self.commenter, comment, f"Hi @[{OWNER}]")

        activity = frappe.get_all(
            "Drive Activity", filters={"node": self.document.name, "action": "comment"}, pluck="name"
        )
        notified = frappe.get_all(
            "Drive Notification", filters={"activity": ["in", activity]}, pluck="to_user"
        )
        self.assertEqual(sorted(notified), sorted([MENTIONED, OWNER]))
        self.assertEqual(len(activity), 4)

    def test_unreadable_threads_are_hidden_and_trash_refuses_writes(self):
        thread = create_thread(self.owner, self.document.name, "anchor", "Before trash").name
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
                    name="node-1", parent_node="p-1", root="r-1", path="/a", kind="document", state="Active"
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


class TestMigratedCommentOrdering(UnitTestCase):
    """Migration preserves tied timestamps, so runtime reads need full ties."""

    def test_threads_and_comments_use_the_frozen_migration_tie_breakers(self):
        node = frappe._dict(name="node-1", kind="document", state="Active")
        thread = frappe._dict(
            name="thread-1",
            node="node-1",
            anchor="A1",
            resolved=0,
            resolved_by=None,
            resolved_at=None,
            creation=None,
        )
        comment = frappe._dict(
            name="comment-1",
            thread="thread-1",
            node="node-1",
            content="one",
            author="Guest",
            author_name=None,
            mentions=[],
            idx=1,
            creation=None,
            modified=None,
        )
        with (
            patch("suite.drive._core.comments._comment_node", return_value=node),
            patch("suite.drive._core.comments.require"),
            patch("suite.drive._core.comments.frappe.get_all", side_effect=[[thread], [comment]]) as read,
        ):
            result = threads(Principals("reader@example.com", (), ()), "node-1")

        orders = [call.kwargs["order_by"] for call in read.call_args_list]
        self.assertEqual(orders, ["creation asc, name asc", "creation asc, idx asc, name asc"])
        self.assertEqual(result[0].comments[0].name, "comment-1")

    def test_comment_order_carries_the_source_position_build_stores_in_idx(self):
        # Build writes the source entry position into `idx`
        # (`patches/build/comments.py`), and a migrated thread routinely holds
        # several entries at one `creation`. Without `idx` between the two keys
        # they read back ordered by a sha256 id.
        source = pathlib.Path(build_comments.__file__).read_text()
        self.assertIn('"idx": index', source)
        self.assertIn("idx asc", inspect.getsource(comments._thread_views))

    def test_the_comment_columns_build_orders_by_exist_on_the_shipped_doctype(self):
        doctypes = pathlib.Path(comments.__file__).parents[1] / "doctype"
        for name in ("drive_comment", "drive_comment_thread"):
            meta = json.loads((doctypes / name / f"{name}.json").read_text())
            with self.subTest(doctype=name):
                # Not child tables, so nothing at runtime writes `idx`: a native
                # row keeps the 0 `init_valid_columns` leaves and the key is
                # inert for it.
                self.assertFalse(meta.get("istable"))
