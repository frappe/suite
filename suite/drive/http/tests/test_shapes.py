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


if __name__ == "__main__":
    unittest.main()
