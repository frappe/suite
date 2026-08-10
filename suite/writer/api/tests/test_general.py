# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

from unittest.mock import patch
from frappe.tests import IntegrationTestCase
from suite.writer.api.general import search


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
        mock_get_user_access.side_effect = lambda name: {
            "read": name == "doc1"
        }

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
