"""The published node shape, and the coercion that stands in for annotations."""

import unittest
from datetime import datetime

import frappe
from frappe.tests import UnitTestCase

from suite.drive.http import shapes
from suite.drive.http.tests import ensure_local_context


def setUpModule():
    ensure_local_context()


STORED = frappe._dict(
    {
        "name": "n1",
        "title": "Report",
        "kind": "file",
        "parent": "f1",
        "path": "r1/f1/n1",
        "root": "r1",
        "state": "Active",
        "size": 1234,
        "mime": "application/pdf",
        "url": None,
        "content_doctype": None,
        "content_docname": None,
        "is_template": 0,
        "owner": "a@example.com",
        "creation": datetime(2026, 1, 2, 3, 4, 5, 678901),
        "modified": datetime(2026, 1, 2, 3, 4, 6),
        "content_modified": datetime(2026, 1, 2, 3, 4, 7),
        "trash_root": None,
        "trashed_at": None,
        "blob": "blob-secret",
        "modified_by": "b@example.com",
    }
)


VERSION = frappe._dict(
    {
        "name": "v1",
        "node": "n1",
        "seq": 3,
        "kind": "named",
        "label": "Before the rewrite",
        "pinned": 1,
        "actor": "a@example.com",
        "size": 4096,
        "creation": datetime(2026, 1, 2, 3, 4, 5, 678901),
        "blob": "blob-secret",
    }
)

ACTIVITY = frappe._dict(
    {
        "name": "act1",
        "node": "n1",
        "action": "share_add",
        "actor": "a@example.com",
        "at": datetime(2026, 1, 2, 3, 4, 5, 678901),
        "via_link": "$LINK:tok",
        "client": "davfs2/1.6",
        "detail": {"principal": "b@example.com", "new_role": 20},
    }
)

GRANT = frappe._dict(
    {
        "name": "g1",
        "node": "n1",
        "principal": "b@example.com",
        "role": 20,
        "expires_on": datetime(2026, 3, 1, 9, 8, 7, 654321),
        "has_password": 1,
        "password_hash": "$2b$12$hash",
        "url": None,
    }
)

COMMENT = frappe._dict(
    {
        "name": "c1",
        "thread": "t1",
        "node": "n1",
        "content": "Fix the total",
        "author": "Guest",
        "author_name": "Priya",
        "mentions": ["a@example.com"],
        "creation": datetime(2026, 1, 2, 3, 4, 5, 678901),
        "modified": datetime(2026, 1, 2, 3, 4, 6),
    }
)

THREAD = frappe._dict(
    {
        "name": "t1",
        "node": "n1",
        "anchor": "block-7",
        "resolved": 1,
        "resolved_by": "a@example.com",
        "resolved_at": datetime(2026, 1, 3, 4, 5, 6),
        "creation": datetime(2026, 1, 2, 3, 4, 5, 678901),
        "comments": [COMMENT],
    }
)


class TestNodeShape(UnitTestCase):
    def test_the_shape_publishes_exactly_the_declared_fields(self):
        self.assertEqual(
            sorted(shapes.node_shape(STORED)),
            sorted(
                [
                    "name",
                    "title",
                    "kind",
                    "parent",
                    "root",
                    "state",
                    "size",
                    "mime",
                    "url",
                    "content_doctype",
                    "content_docname",
                    "is_template",
                    "owner",
                    "creation",
                    "modified",
                    "content_modified",
                ]
            ),
        )

    def test_the_shape_withholds_tree_bookkeeping_and_storage_ids(self):
        answer = shapes.node_shape(STORED)
        for withheld in ("path", "trash_root", "trashed_at", "blob", "modified_by"):
            self.assertNotIn(withheld, answer)

    def test_a_root_node_reports_its_own_id_as_its_root(self):
        root_row = frappe._dict(
            {**STORED, "name": "r1", "kind": "root", "parent": None, "root": None, "path": ""}
        )
        self.assertEqual(shapes.node_shape(root_row)["root"], "r1")
        self.assertEqual(shapes.node_shape(STORED)["root"], "r1")

    def test_times_are_published_to_the_second(self):
        answer = shapes.node_shape(STORED)
        self.assertEqual(answer["creation"], "2026-01-02 03:04:05")
        self.assertEqual(answer["modified"], "2026-01-02 03:04:06")
        self.assertEqual(answer["content_modified"], "2026-01-02 03:04:07")

    def test_an_absent_time_is_null_not_an_empty_string(self):
        self.assertIsNone(shapes.stamp(None))
        self.assertIsNone(shapes.stamp(""))

    def test_a_missing_size_reads_as_zero(self):
        answer = shapes.node_shape(frappe._dict({**STORED, "size": None}))
        self.assertEqual(answer["size"], 0)

    def test_a_list_row_and_a_detail_row_are_the_same_shape(self):
        # One serialiser answers both, so this is the guarantee, not a sample.
        detail = shapes.node_shape(STORED)
        listed = shapes.node_shape(STORED)
        self.assertEqual(detail, listed)


class TestVersionShape(UnitTestCase):
    def test_the_shape_publishes_exactly_the_declared_fields(self):
        self.assertEqual(
            sorted(shapes.version_shape(VERSION)),
            sorted(["name", "node", "seq", "kind", "label", "pinned", "actor", "size", "creation"]),
        )

    def test_the_shape_withholds_the_storage_id(self):
        # The bytes are reached through the version content route, never by name.
        self.assertNotIn("blob", shapes.version_shape(VERSION))

    def test_a_missing_sequence_or_size_reads_as_zero(self):
        answer = shapes.version_shape(frappe._dict({**VERSION, "seq": None, "size": None}))
        self.assertEqual(answer["seq"], 0)
        self.assertEqual(answer["size"], 0)

    def test_times_are_published_to_the_second(self):
        self.assertEqual(shapes.version_shape(VERSION)["creation"], "2026-01-02 03:04:05")


class TestActivityShape(UnitTestCase):
    def test_the_shape_publishes_exactly_the_declared_columns(self):
        self.assertEqual(
            sorted(shapes.activity_shape(ACTIVITY)),
            sorted(["name", "node", "action", "actor", "at", "via_link", "client", "detail"]),
        )

    def test_a_missing_detail_is_an_empty_mapping_not_null(self):
        answer = shapes.activity_shape(frappe._dict({**ACTIVITY, "detail": None}))
        self.assertEqual(answer["detail"], {})

    def test_times_are_published_to_the_second(self):
        self.assertEqual(shapes.activity_shape(ACTIVITY)["at"], "2026-01-02 03:04:05")


class TestNotificationShape(UnitTestCase):
    def test_the_shape_withholds_the_recipient(self):
        # The route is scoped to the caller, so `to_user` can only be the caller.
        row = frappe._dict({"name": "no1", "to_user": "a@example.com", "activity": ACTIVITY})
        self.assertNotIn("to_user", shapes.notification_shape(row))

    def test_the_activity_is_nested_through_the_activity_shape(self):
        row = frappe._dict(
            {"name": "no1", "read": 0, "creation": datetime(2026, 1, 2, 3, 4, 5), "activity": ACTIVITY}
        )
        answer = shapes.notification_shape(row)
        self.assertEqual(answer["activity"], shapes.activity_shape(ACTIVITY))
        self.assertEqual(answer["creation"], "2026-01-02 03:04:05")

    def test_a_missing_activity_still_yields_a_mapping(self):
        answer = shapes.notification_shape(frappe._dict({"name": "no1", "activity": None}))
        self.assertIsInstance(answer["activity"], dict)
        self.assertIsNone(answer["activity"]["node"])


class TestGrantShape(UnitTestCase):
    def test_the_shape_never_publishes_the_password_hash(self):
        self.assertNotIn("password_hash", shapes.grant_shape(GRANT))

    def test_has_password_is_published_as_a_bool(self):
        self.assertIs(shapes.grant_shape(GRANT)["has_password"], True)
        cleared = shapes.grant_shape(frappe._dict({**GRANT, "has_password": 0}))
        self.assertIs(cleared["has_password"], False)

    def test_a_url_appears_only_when_the_row_carries_one(self):
        self.assertNotIn("url", shapes.grant_shape(GRANT))
        linked = shapes.grant_shape(frappe._dict({**GRANT, "url": "/drive/l/tok"}))
        self.assertEqual(linked["url"], "/drive/l/tok")

    def test_the_expiry_is_published_to_the_second(self):
        self.assertEqual(shapes.grant_shape(GRANT)["expires_on"], "2026-03-01 09:08:07")
        never = shapes.grant_shape(frappe._dict({**GRANT, "expires_on": None}))
        self.assertIsNone(never["expires_on"])


EXPLANATION = frappe._dict(
    {
        "role": 20,
        "source": "grant",
        "rows": [
            frappe._dict(
                {
                    "node": "f1",
                    "depth": 1,
                    "principal": "b@example.com",
                    "role": 20,
                    "expires_on": datetime(2026, 3, 1, 9, 8, 7),
                    "pass": 1,
                    "held": 1,
                    "winner": 1,
                }
            ),
            frappe._dict(
                {
                    "node": "r1",
                    "depth": 0,
                    "principal": "team@example.com",
                    "role": 10,
                    "expires_on": None,
                    "pass": 2,
                    "held": 0,
                    "winner": 0,
                }
            ),
        ],
    }
)


class TestExplainShape(UnitTestCase):
    def test_the_shape_publishes_exactly_the_declared_keys(self):
        self.assertEqual(sorted(shapes.explain_shape(EXPLANATION)), ["role", "rows", "source"])

    def test_every_row_carries_its_node_principal_and_verdict(self):
        for row in shapes.explain_shape(EXPLANATION)["rows"]:
            self.assertEqual(
                sorted(row),
                sorted(["node", "depth", "principal", "role", "expires_on", "pass", "held", "winner"]),
            )
        first = shapes.explain_shape(EXPLANATION)["rows"][0]
        self.assertEqual(first["node"], "f1")
        self.assertEqual(first["principal"], "b@example.com")
        self.assertEqual(first["expires_on"], "2026-03-01 09:08:07")

    def test_an_empty_explanation_survives(self):
        admin = frappe._dict({"role": 40, "source": "site admin", "rows": []})
        self.assertEqual(shapes.explain_shape(admin)["rows"], [])
        self.assertEqual(shapes.explain_shape(frappe._dict({}))["rows"], [])

    def test_held_and_winner_are_published_as_bools(self):
        rows = shapes.explain_shape(EXPLANATION)["rows"]
        self.assertIs(rows[0]["held"], True)
        self.assertIs(rows[0]["winner"], True)
        self.assertIs(rows[1]["held"], False)
        self.assertIs(rows[1]["winner"], False)


class TestThreadShape(UnitTestCase):
    def test_resolved_is_published_as_a_bool(self):
        self.assertIs(shapes.thread_shape(THREAD)["resolved"], True)
        open_thread = shapes.thread_shape(frappe._dict({**THREAD, "resolved": 0}))
        self.assertIs(open_thread["resolved"], False)

    def test_a_thread_with_no_comments_publishes_an_empty_list(self):
        answer = shapes.thread_shape(frappe._dict({**THREAD, "comments": None}))
        self.assertEqual(answer["comments"], [])

    def test_the_comments_are_nested_through_the_comment_shape(self):
        self.assertEqual(shapes.thread_shape(THREAD)["comments"], [shapes.comment_shape(COMMENT)])

    def test_mentions_are_always_a_list(self):
        self.assertEqual(shapes.comment_shape(COMMENT)["mentions"], ["a@example.com"])
        none = shapes.comment_shape(frappe._dict({**COMMENT, "mentions": None}))
        self.assertEqual(none["mentions"], [])
        tupled = shapes.comment_shape(frappe._dict({**COMMENT, "mentions": ("a@example.com",)}))
        self.assertEqual(tupled["mentions"], ["a@example.com"])


class TestCoercion(UnitTestCase):
    def refused(self, call, *args, **kwargs):
        with self.assertRaises(frappe.ValidationError):
            call(*args, **kwargs)

    def test_text_accepts_absent_and_string_only(self):
        self.assertIsNone(shapes.text(None, "x"))
        self.assertEqual(shapes.text("a", "x"), "a")
        for bad in (1, True, [], {}, 1.5):
            self.refused(shapes.text, bad, "x")

    def test_required_text_refuses_blank(self):
        self.assertEqual(shapes.required_text(" a ", "x"), " a ")
        for bad in (None, "", "   "):
            self.refused(shapes.required_text, bad, "x")

    def test_whole_reads_a_query_string_digit(self):
        self.assertEqual(shapes.whole(None, "x", 60), 60)
        self.assertEqual(shapes.whole("", "x", 60), 60)
        self.assertEqual(shapes.whole("25", "x", 60), 25)
        self.assertEqual(shapes.whole(25, "x", 60), 25)
        for bad in (True, False, "-1", "1.5", "1e3", "abc", [1]):
            self.refused(shapes.whole, bad, "x", 60)

    def test_flag_reads_the_spellings_a_query_string_can_carry(self):
        for value in ("1", "true", "TRUE", "yes", "on", True):
            self.assertIs(shapes.flag(value, "x", False), True)
        for value in ("0", "false", "no", "off", False):
            self.assertIs(shapes.flag(value, "x", True), False)
        self.assertIs(shapes.flag(None, "x", True), True)
        for bad in ("maybe", 1, []):
            self.refused(shapes.flag, bad, "x", False)

    def test_expansions_accepts_only_the_three_named(self):
        self.assertEqual(shapes.expansions(None), frozenset())
        self.assertEqual(shapes.expansions("access, preview"), frozenset({"access", "preview"}))
        self.assertEqual(shapes.expansions(",,"), frozenset())
        for bad in ("grants", "access,grants", 1):
            self.refused(shapes.expansions, bad)

    def test_identifiers_are_bounded_distinct_and_ordered(self):
        self.assertEqual(shapes.identifiers(["b", "a", "b"], "nodes"), ("b", "a"))
        for bad in (None, [], "n1", ["", "a"], [1], [None]):
            self.refused(shapes.identifiers, bad, "nodes")
        self.refused(shapes.identifiers, [f"n{i}" for i in range(shapes.MAX_BATCH_NODES + 1)], "nodes")

    def test_a_batch_is_capped_at_one_page(self):
        biggest = [f"n{i}" for i in range(shapes.MAX_BATCH_NODES)]
        self.assertEqual(len(shapes.identifiers(biggest, "nodes")), shapes.MAX_BATCH_NODES)

    def test_a_patch_takes_only_the_fields_node_patch_takes(self):
        self.assertEqual(shapes.patch({"title": "a"}, "patch"), {"title": "a"})
        for bad in (None, {}, [], "state=Trashed", {"blob": "x"}, {"title": "a", "size": 1}):
            self.refused(shapes.patch, bad, "patch")


class TestRecordCoercion(UnitTestCase):
    def refused(self, call, *args, **kwargs):
        with self.assertRaises(frappe.ValidationError):
            call(*args, **kwargs)

    def test_a_sequence_is_a_whole_number_above_zero(self):
        self.assertEqual(shapes.sequence(3, "seq"), 3)
        self.assertEqual(shapes.sequence("3", "seq"), 3)
        for bad in (None, "", 0, "0", -1, True, False, "abc", "1.5"):
            self.refused(shapes.sequence, bad, "seq")

    def test_a_name_list_accepts_an_empty_list(self):
        # Clearing an already-empty badge is an answer of zero, not a 400.
        self.assertEqual(shapes.name_list([], "notifications"), ())

    def test_a_name_list_is_distinct_and_keeps_its_order(self):
        self.assertEqual(shapes.name_list(["b", "a", "b"], "notifications"), ("b", "a"))

    def test_a_name_list_refuses_a_bad_type_or_a_blank_item(self):
        for bad in (None, "no1", {"a": 1}, ["", "a"], ["  "], [1], [None]):
            self.refused(shapes.name_list, bad, "notifications")

    def test_a_name_list_is_capped_at_one_page(self):
        biggest = [f"no{i}" for i in range(shapes.MAX_BATCH_NODES)]
        self.assertEqual(len(shapes.name_list(biggest, "notifications")), shapes.MAX_BATCH_NODES)
        self.refused(shapes.name_list, [*biggest, "one-more"], "notifications")


if __name__ == "__main__":
    unittest.main()
