# Copyright (c) 2026, Asif and Contributors
# See license.txt
"""Shape tests for ``list_sheets`` pagination, filtering and sorting.

DB-free (``suite.sheets.api.frappe`` is mocked, matching test_api_security.py):
they assert what the endpoint passes to ``get_list`` — the clamped window,
the whitelisted ORDER BY literal, the derived filters — and the shape of
the response. The order_by test is the important one: caller input must
never reach the SQL clause, only dict-mapped literals may.
"""

from __future__ import annotations

import unittest
from unittest import mock

ME = "alice@example.com"

_DEFAULT_ORDER = "`tabSheet`.`modified` desc"


class _ListSheetsBase(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("suite.sheets.api.frappe")
        self.frappe = patcher.start()
        self.addCleanup(patcher.stop)
        self.frappe.session.user = ME
        # The module calls frappe.utils.cint for clamping — give the mock a
        # real implementation so the arithmetic works.
        self.frappe.utils.cint.side_effect = _cint
        self.frappe.utils.now.return_value = "2026-07-23 12:00:00.000001"
        self.rows = [
            {"name": "SH-1", "title": "Mine", "modified": "2026-07-22 10:00:00", "owner": ME},
            {
                "name": "SH-2",
                "title": "Theirs",
                "modified": "2026-07-21 10:00:00",
                "owner": "bob@example.com",
            },
        ]
        self.frappe.get_list.side_effect = [self.rows, [{"total": 42}]]

    def call(self, **kwargs):
        from suite.sheets import api

        return api.list_sheets(**kwargs)

    def rows_kwargs(self):
        return self.frappe.get_list.call_args_list[0].kwargs

    def count_kwargs(self):
        return self.frappe.get_list.call_args_list[1].kwargs


class Defaults(_ListSheetsBase):
    def test_default_window_and_order(self):
        self.call()
        kw = self.rows_kwargs()
        self.assertEqual(kw["limit_start"], 0)
        self.assertEqual(kw["limit_page_length"], 50)
        self.assertEqual(kw["order_by"], _DEFAULT_ORDER)
        self.assertEqual(kw["filters"], {"trashed": 0})

    def test_response_shape_and_is_owner(self):
        res = self.call()
        self.assertEqual(res["total"], 42)
        # Server-clock `now` rides along so the client buckets recency in the
        # same timezone frame as `modified`.
        self.assertEqual(res["now"], "2026-07-23 12:00:00.000001")
        self.assertTrue(res["sheets"][0]["is_owner"])
        self.assertFalse(res["sheets"][1]["is_owner"])

    def test_count_uses_aggregate_with_same_filters(self):
        self.call(search="foo", owner_filter="mine")
        kw = self.count_kwargs()
        # Frappe 17 dict field syntax — string "count(...)" fields are rejected.
        self.assertEqual(kw["fields"], [{"COUNT": "*", "as": "total"}])
        self.assertEqual(kw["filters"], self.rows_kwargs()["filters"])


class OrderBy(_ListSheetsBase):
    def test_known_key_and_direction_map_to_literals(self):
        self.call(order_by="title", sort_dir="asc")
        self.assertEqual(self.rows_kwargs()["order_by"], "`tabSheet`.`title` asc")

    def test_direction_toggles_to_descending(self):
        self.call(order_by="title", sort_dir="desc")
        self.assertEqual(self.rows_kwargs()["order_by"], "`tabSheet`.`title` desc")

    def test_owner_sort_keeps_modified_tiebreak_in_both_directions(self):
        self.call(order_by="owner", sort_dir="asc")
        self.assertEqual(
            self.rows_kwargs()["order_by"],
            "`tabSheet`.`owner` asc, `tabSheet`.`modified` desc",
        )
        # desc flips only the owner term; the modified-desc tiebreak stays.
        self.frappe.get_list.reset_mock()
        self.frappe.get_list.side_effect = [self.rows, [{"total": 42}]]
        self.call(order_by="owner", sort_dir="desc")
        self.assertEqual(
            self.rows_kwargs()["order_by"],
            "`tabSheet`.`owner` desc, `tabSheet`.`modified` desc",
        )

    def test_unknown_order_by_falls_back_to_default(self):
        malicious = "modified desc; DROP TABLE `tabSheet`--"
        self.call(order_by=malicious)
        kw = self.rows_kwargs()
        self.assertEqual(kw["order_by"], _DEFAULT_ORDER)
        # The caller's string must not appear anywhere in the query kwargs.
        for call in self.frappe.get_list.call_args_list:
            self.assertNotIn(malicious, repr(call))

    def test_unknown_direction_falls_back_to_desc(self):
        # Direction is clamped to the "asc"/"desc" literals just like the
        # column — anything else can't reach the ORDER BY clause as free text.
        malicious = "asc; DROP TABLE `tabSheet`--"
        self.call(order_by="modified", sort_dir=malicious)
        kw = self.rows_kwargs()
        self.assertEqual(kw["order_by"], _DEFAULT_ORDER)
        for call in self.frappe.get_list.call_args_list:
            self.assertNotIn(malicious, repr(call))


class OwnerFilter(_ListSheetsBase):
    def test_mine(self):
        self.call(owner_filter="mine")
        self.assertEqual(self.rows_kwargs()["filters"]["owner"], ME)

    def test_shared(self):
        self.call(owner_filter="shared")
        self.assertEqual(self.rows_kwargs()["filters"]["owner"], ["!=", ME])

    def test_unknown_means_all(self):
        self.call(owner_filter="everything-please")
        self.assertNotIn("owner", self.rows_kwargs()["filters"])


class Search(_ListSheetsBase):
    """Two columns hold a title now, so the search reads both.

    Drive owns a linked sheet's title and `Sheet.title` is frozen there
    (§10.2), so the legacy column alone matched nothing written since the
    declaration was registered.
    """

    def test_the_legacy_column_is_still_searched(self):
        self.frappe.get_all.side_effect = [[], []]
        self.call(search="  foo  ")
        self.assertIn(["title", "like", "%foo%"], self.rows_kwargs()["or_filters"])
        self.assertNotIn("title", self.rows_kwargs()["filters"])

    def test_a_node_title_match_is_searched_by_sheet_id(self):
        self.frappe.get_all.side_effect = [["n1"], ["SH-9"]]
        self.call(search="foo")
        self.assertIn(["name", "in", ["SH-9"]], self.rows_kwargs()["or_filters"])

    def test_the_node_half_matches_on_drives_own_title(self):
        self.frappe.get_all.side_effect = [["n1"], ["SH-9"]]
        self.call(search="  foo  ")
        first = self.frappe.get_all.call_args_list[0]
        self.assertEqual(first.args[0], "Drive Node")
        self.assertEqual(first.kwargs["filters"]["title"], ["like", "%foo%"])
        self.assertEqual(first.kwargs["filters"]["content_doctype"], "Sheet")

    def test_no_node_match_still_names_an_id_rather_than_an_empty_set(self):
        # An empty `IN ()` is not portable: one backend reads it as match
        # nothing, another drops the clause and matches everything. An id no
        # sheet can carry says match nothing in one way.
        self.frappe.get_all.side_effect = [[], []]
        self.call(search="foo")
        self.assertIn(["name", "in", [""]], self.rows_kwargs()["or_filters"])

    def test_the_permission_query_still_runs_over_the_matched_ids(self):
        # `_sheets_titled_like` reads Drive's column with permissions off, so
        # the refusal has to come from somewhere: `get_list` on `Sheet`.
        self.frappe.get_all.side_effect = [["n1"], ["SH-9"]]
        self.call(search="foo")
        self.assertEqual(self.frappe.get_list.call_args_list[0].args[0], "Sheet")

    def test_the_count_is_taken_over_the_same_two_columns(self):
        self.frappe.get_all.side_effect = [["n1"], ["SH-9"]]
        self.call(search="foo")
        self.assertEqual(self.count_kwargs()["or_filters"], self.rows_kwargs()["or_filters"])

    def test_blank_search_adds_no_filter(self):
        self.call(search="   ")
        self.assertNotIn("title", self.rows_kwargs()["filters"])
        self.assertIsNone(self.rows_kwargs()["or_filters"])


class PublishedTitles(_ListSheetsBase):
    """A listed sheet is named by whichever store owns its name."""

    def test_a_linked_sheet_is_named_by_its_node(self):
        self.rows[0]["node"] = "n1"
        self.frappe.get_all.return_value = [{"name": "n1", "title": "Budget"}]
        rows = self.call()["sheets"]
        self.assertEqual(rows[0]["title"], "Budget")

    def test_a_legacy_sheet_keeps_the_title_on_its_own_row(self):
        self.rows[0]["node"] = None
        rows = self.call()["sheets"]
        self.assertEqual(rows[0]["title"], "Mine")
        self.frappe.get_all.assert_not_called()

    def test_the_node_id_is_not_published(self):
        # §6.8 keeps Drive's own ids off a legacy payload; the column is only
        # selected so the title can be resolved.
        self.rows[0]["node"] = "n1"
        self.frappe.get_all.return_value = [{"name": "n1", "title": "Budget"}]
        rows = self.call()["sheets"]
        for row in rows:
            self.assertNotIn("node", row)

    def test_a_node_that_answers_nothing_leaves_a_blank_name_not_a_stale_one(self):
        # The frozen column can hold whatever it held before activation. It is
        # not the sheet's name any more, so it is not shown as one.
        self.rows[0]["node"] = "n1"
        self.frappe.get_all.return_value = []
        rows = self.call()["sheets"]
        self.assertEqual(rows[0]["title"], "")


class WindowClamping(_ListSheetsBase):
    def test_limit_capped_at_100(self):
        self.call(limit=1000)
        self.assertEqual(self.rows_kwargs()["limit_page_length"], 100)

    def test_zero_limit_uses_default(self):
        self.call(limit=0)
        self.assertEqual(self.rows_kwargs()["limit_page_length"], 50)

    def test_negative_start_clamped_to_zero(self):
        self.call(start=-5)
        self.assertEqual(self.rows_kwargs()["limit_start"], 0)

    def test_string_params_from_http_are_coerced(self):
        # Whitelisted endpoints receive query params as strings.
        self.call(start="50", limit="25")
        kw = self.rows_kwargs()
        self.assertEqual(kw["limit_start"], 50)
        self.assertEqual(kw["limit_page_length"], 25)


def _cint(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


if __name__ == "__main__":
    unittest.main()
