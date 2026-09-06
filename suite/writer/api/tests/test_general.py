# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.tests.utils import ensure_user
from suite.writer.api import docs
from suite.writer.api.general import get_document_list, get_drive_file_meta, get_versions, search

USER = "writer-general-user@example.com"
OTHER = "writer-general-other@example.com"


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


class TestLegacyDocumentReads(IntegrationTestCase):
    """The three reads built on `get_user_access`, against the row the product writes.

    `writer.api.docs.create_document` writes a `File` with no `Drive Node`:
    `Writer Document` is not in `drive_content_types`, so §10.2 keeps it on
    the legacy store until ticket 29 activates the type. §11.7 pointed
    `get_user_access` at `Drive Node`, which answers all-zeros for an id no
    node holds, and each of these three reads treats zeros as a denial.

    The suite that existed here patched `get_user_access` out, so it could
    not see any of this.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(USER)
        ensure_user(OTHER)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.entity = docs.create_document(title=f"General {frappe.generate_hash(6)}")
        self.addCleanup(self._drop, self.entity.name, self.entity.content_docname)
        self.assertFalse(frappe.db.exists("Drive Node", self.entity.name), "no node before Build")

    @staticmethod
    def _drop(entity: str, docname: str):
        frappe.set_user("Administrator")
        for doctype, name in (("File", entity), ("Writer Document", docname)):
            frappe.delete_doc(doctype, name, force=1, ignore_permissions=True, ignore_missing=True)

    def test_the_author_lists_the_document_they_just_created(self):
        """`get_document_list` drops a row whose `read` is 0, so the list came
        back without the document its caller had just written."""
        frappe.response.pop("data", None)
        get_document_list()
        rows = {row["name"]: row for row in frappe.response["data"]}

        self.assertIn(self.entity.name, rows)
        row = rows[self.entity.name]
        self.assertEqual(row["read"], 1)
        self.assertEqual(row["write"], 1)
        self.assertEqual(row["type"], "admin", "the owner, by the rule that wrote the row")

    def test_the_author_reads_the_history_of_the_document_they_just_created(self):
        """`get_versions` throws `PermissionError` on a zeroed `write`."""
        frappe.get_doc("Writer Document", self.entity.content_docname).new_version(
            "<p>a draft</p>", title="first"
        )
        titles = [version["title"] for version in get_versions(self.entity.name)]
        self.assertEqual(titles, ["first"])

    def test_a_stranger_is_still_refused_the_history(self):
        """The refusal is the old rule's, not a zeroed answer standing in for
        one. `get_user_access_for_user` decides it, as it always did."""
        frappe.set_user(OTHER)
        with self.assertRaises(frappe.PermissionError):
            get_versions(self.entity.name)

    def test_the_author_finds_the_document_they_just_created(self):
        """`search` drops a hit whose `read` is 0 and recounts the summary to
        zero, so the index found the document and the filter threw it away."""
        docname = self.entity.content_docname
        hits = {
            "results": [{"name": docname}],
            "summary": {
                "total_matches": 1,
                "returned_matches": 1,
                "filtered_matches": 1,
                "corrected_words": None,
                "corrected_query": None,
            },
        }
        with (
            patch("suite.writer.api.general.WriterSearch") as client,
            patch(
                "suite.writer.api.general.get_drive_file_meta",
                return_value={docname: {"name": self.entity.name, "title": "General"}},
            ),
        ):
            client.return_value.search.return_value = hits
            answer = search("general")

        self.assertEqual([hit["name"] for hit in answer["results"]], [self.entity.name])
        self.assertEqual(answer["summary"]["total_matches"], 1)

    def test_a_stranger_still_finds_nothing(self):
        """The index is unscoped, and the filter that scopes it still refuses."""
        docname = self.entity.content_docname
        frappe.set_user(OTHER)
        with (
            patch("suite.writer.api.general.WriterSearch") as client,
            patch(
                "suite.writer.api.general.get_drive_file_meta",
                return_value={docname: {"name": self.entity.name, "title": "General"}},
            ),
        ):
            client.return_value.search.return_value = {
                "results": [{"name": docname}],
                "summary": {
                    "total_matches": 1,
                    "returned_matches": 1,
                    "filtered_matches": 1,
                    "corrected_words": None,
                    "corrected_query": None,
                },
            }
            answer = search("general")

        self.assertEqual(answer["results"], [])
        self.assertEqual(answer["summary"]["total_matches"], 0)
