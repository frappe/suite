# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import unittest
from unittest.mock import patch

from suite.mail import bounces


class ReportsPastTheFirstPage(unittest.TestCase):
    def _reports(self, pages: list[list[str]], wanted: list[str]) -> tuple[dict, int]:
        def query(_account, _filter, position=0, limit=50):
            return {"ids": pages[position // limit] if position // limit < len(pages) else []}

        def messages(_account, ids):
            return [{"id": id, "thread_id": f"t-{id}"} for id in ids]

        with (
            patch.object(bounces, "query_message_ids", side_effect=query) as queried,
            patch.object(bounces, "get_messages", side_effect=messages),
            patch.object(bounces, "dsn_blob_id", side_effect=lambda message: message["id"]),
            patch.object(bounces, "fetch_blobs", side_effect=lambda _a, ids: dict.fromkeys(ids, b"")),
            patch.object(
                bounces,
                "read_report",
                side_effect=lambda message, _blob: {"original_envelope_id": message["id"]},
            ),
            patch.object(bounces, "BOUNCE_PAGE", 2),
        ):
            return bounces.get_reports("account", wanted, "2026-01-01T00:00:00Z"), queried.call_count

    def test_an_older_bounce_on_a_later_page_is_found(self):
        reports, _ = self._reports([["a", "b"], ["c"]], ["c"])
        self.assertEqual(reports["c"][0]["thread_id"], "t-c")

    def test_the_search_stops_once_every_envelope_has_a_report(self):
        reports, queries = self._reports([["a", "b"], ["c", "d"]], ["a"])
        self.assertEqual((list(reports), queries), (["a"], 1))
