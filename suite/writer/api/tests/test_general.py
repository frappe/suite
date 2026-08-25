# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.writer.api.general import get_drive_file_meta, search


class IntegrationTestGetDriveFileMeta(IntegrationTestCase):
    """
    get_drive_file_meta caches {name: {title, file_id}} in Redis so repeat
    lookups (e.g. paginated search results) skip the DB.
    """

    def setUp(self):
        self.content_docname = f"test-writer-doc-{frappe.generate_hash(8)}"
        self.file_name = f"test-file-{frappe.generate_hash(8)}"
        self.row = {
            "name": self.file_name,
            "file_name": "Report.docx",
            "content_docname": self.content_docname,
        }

    def tearDown(self):
        frappe.cache().delete_value(f"search:drive_file:{self.content_docname}")
        super().tearDown()

    def test_second_lookup_is_served_from_cache(self):
        with patch("suite.writer.api.general.frappe.get_all", return_value=[self.row]) as mock_get_all:
            first = get_drive_file_meta([self.content_docname])
            self.assertEqual(mock_get_all.call_count, 1)

            second = get_drive_file_meta([self.content_docname])

            self.assertEqual(
                mock_get_all.call_count,
                1,
                "second lookup should be served from the Redis cache, not hit the DB again",
            )

        self.assertEqual(first, second)
        self.assertEqual(first[self.content_docname]["title"], "Report.docx")


class TestWriterSearch(IntegrationTestCase):
    @patch("suite.writer.api.general.WriterSearch")
    @patch("suite.writer.api.general.get_drive_file_meta")
    @patch("suite.writer.api.general.get_user_access")
    def test_search_summary_filters_unreadable_documents(
        self, mock_get_user_access, mock_get_meta, mock_writer_search
    ):
        mock_search_instance = mock_writer_search.return_value
        mock_search_instance.search.return_value = {
            "results": [{"name": "doc1"}, {"name": "doc2"}],
            "summary": {
                "total_matches": 10,
                "returned_matches": 10,
                "filtered_matches": 10,
                "corrected_words": ["secret"],
                "corrected_query": "secret query",
            },
        }

        mock_get_meta.return_value = {
            "doc1": {"name": "doc1", "title": "Readable Doc"},
            "doc2": {"name": "doc2", "title": "Secret Doc"},
        }

        # doc1 is readable, doc2 is unreadable
        mock_get_user_access.side_effect = lambda name: {"read": name == "doc1"}

        res = search("test")

        # Results should only contain readable doc1
        self.assertEqual(len(res["results"]), 1)
        self.assertEqual(res["results"][0]["name"], "doc1")

        # Summary counts must be updated to filtered count (1), not raw count (10)
        self.assertEqual(res["summary"]["total_matches"], 1)
        self.assertEqual(res["summary"]["returned_matches"], 1)
        self.assertEqual(res["summary"]["filtered_matches"], 1)

        # Corrections must be cleared to prevent word leaks
        self.assertIsNone(res["summary"]["corrected_words"])
        self.assertIsNone(res["summary"]["corrected_query"])
