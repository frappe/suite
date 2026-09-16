# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.drive._core.access import grant, revoke
from suite.drive._core.activity import visit
from suite.drive._core.nodes import purge, update
from suite.drive._core.principals import Principals
from suite.drive._core.roles import EDIT, NONE, READ
from suite.tests.utils import ensure_user
from suite.writer.api import docs
from suite.writer.api.general import get_document_list, get_drive_file_meta, get_versions, search

USER = "writer-general-user@example.com"
OTHER = "writer-general-other@example.com"
THIRD = "writer-general-third@example.com"


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
    """The three legacy reads, against the row the product actually writes now.

    Ticket 29 registered `Writer Document`, so `writer.api.docs.create_document`
    is an adapter over `drive.create_document` and answers a `Drive Node` under
    the legacy `File` field names. The three reads the editor still calls -
    `get_document_list`, `get_versions`, and `search` - have to answer for that
    row, because it is the only kind of row a caller can create.

    Each read is scoped by `get_user_access`, which §11.7 pointed at the node.
    The author holds every bit on a document they wrote; a stranger holds none
    and is refused, not answered with an empty page.
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
        self.entity = frappe._dict(docs.create_document(title=f"General {frappe.generate_hash(6)}"))
        self.addCleanup(self._drop, self.entity.name)
        self.assertTrue(frappe.db.exists("Drive Node", self.entity.name), "the create is Drive-native now")
        self.assertFalse(frappe.db.exists("File", self.entity.name), "and it grows no backing File (§14.7)")

    @staticmethod
    def _drop(node: str):
        """Purge through Drive, which owns the document, its history, and its charge."""
        frappe.set_user("Administrator")
        if not frappe.db.exists("Drive Node", node):
            return
        admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        update(admin, node, state="Trashed")
        purge(admin, node)
        frappe.db.commit()

    def test_the_author_lists_the_document_they_just_created(self):
        """The list reads both stores, so a node-backed document is on it.

        The legacy query alone answered a page with the caller's newest
        documents missing from it, because they have no `File` row. The row is
        published under the legacy `File` field names the frontend reads."""
        frappe.response.pop("data", None)
        get_document_list()
        rows = {row["name"]: row for row in frappe.response["data"]}

        self.assertIn(self.entity.name, rows)
        row = rows[self.entity.name]
        self.assertEqual(row["read"], 1)
        self.assertEqual(row["write"], 1)
        self.assertEqual(row["type"], "admin", "the owner, by the rule that wrote the row")

    def test_the_author_reads_the_history_of_the_document_they_just_created(self):
        """A linked document's history is `Drive Node Version`, in the legacy shape.

        `new_version` refuses a linked row rather than growing a second, private
        history Drive cannot see, so the version is taken through Drive. The
        published row keeps the four keys the sidebar reads, and `snapshot` is
        the HTML Writer wrote into the version envelope."""
        document = frappe.get_doc("Writer Document", self.entity.content_docname)
        document.html = "<p>a draft</p>"
        document.save()
        document.drive_take_version(kind="named", label="first")

        versions = get_versions(self.entity.name)

        self.assertEqual([version["title"] for version in versions], ["first"])
        self.assertEqual(versions[0]["snapshot"], "<p>a draft</p>")
        self.assertEqual(versions[0]["manual"], 1)
        self.assertTrue(versions[0]["name"])
        self.assertTrue(versions[0]["creation"])

    def test_an_automatic_version_is_titled_by_the_minute_it_was_taken(self):
        """Legacy titled an automatic version with its timestamp and a manual one
        with the name its author gave it. `Drive Node Version` carries `label`,
        which is null for `kind = auto`, so the stamp is formatted here."""
        document = frappe.get_doc("Writer Document", self.entity.content_docname)
        document.html = "<p>one</p>"
        document.save()
        document.drive_take_version()

        version = get_versions(self.entity.name)[0]

        self.assertEqual(version["manual"], 0)
        self.assertEqual(
            version["title"], frappe.utils.get_datetime(version["creation"]).strftime("%Y-%m-%d %H:%M")
        )

    def test_the_history_is_published_oldest_first(self):
        """Drive pages versions newest first (§9.1); the sidebar reads the
        legacy order, which is the other one."""
        document = frappe.get_doc("Writer Document", self.entity.content_docname)
        for label in ("first", "second", "third"):
            document.html = f"<p>{label}</p>"
            document.save()
            document.drive_take_version(kind="named", label=label)

        self.assertEqual(
            [version["title"] for version in get_versions(self.entity.name)],
            ["first", "second", "third"],
        )
        self.assertEqual(
            [version["snapshot"] for version in get_versions(self.entity.name)],
            ["<p>first</p>", "<p>second</p>", "<p>third</p>"],
        )

    def test_a_stranger_is_still_refused_the_history(self):
        """A stranger is refused, not handed an empty history. The refusal is
        `get_user_access`'s, on the node."""
        frappe.set_user(OTHER)
        with self.assertRaises(frappe.PermissionError):
            get_versions(self.entity.name)

    def test_the_author_finds_the_document_they_just_created(self):
        """The search mapping reads both stores, so a hit on a node-backed
        document resolves to an id and survives the readability filter."""
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


class TestDocumentListShareCount(IntegrationTestCase):
    """Legacy published one number for "who is this shared with".

    -2 "anyone with the link", -1 "everyone on this site", otherwise the count
    of people it is shared with. `DocumentList.vue` reads it, so the node half
    has to answer the same three shapes off `Drive Grant`.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for user in (USER, OTHER, THIRD):
            ensure_user(user)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.entity = frappe._dict(docs.create_document(title=f"Shared {frappe.generate_hash(6)}"))
        self.addCleanup(self._drop, self.entity.name)

    @staticmethod
    def _drop(node: str):
        frappe.set_user("Administrator")
        if not frappe.db.exists("Drive Node", node):
            return
        admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        update(admin, node, state="Trashed")
        purge(admin, node)
        frappe.db.commit()

    def _share_count(self) -> int:
        frappe.set_user(USER)
        frappe.response.pop("data", None)
        get_document_list(limit=200)
        rows = {row["name"]: row for row in frappe.response["data"]}
        return rows[self.entity.name]["share_count"]

    def _grant(self, principal: str, role: int = READ):
        grant(self.entity.name, principal, role, Principals(USER, (USER, "$GENERAL"), ("$PUBLIC",)))

    def test_an_unshared_document_counts_nobody(self):
        self.assertEqual(self._share_count(), 0)

    def test_each_person_counts_once(self):
        self._grant(OTHER)
        self.assertEqual(self._share_count(), 1)
        self._grant(THIRD)
        self.assertEqual(self._share_count(), 2)

    def test_everyone_on_this_site_is_minus_one(self):
        self._grant(OTHER)
        self._grant("$GENERAL")
        self.assertEqual(self._share_count(), -1)

    def test_anyone_with_the_link_is_minus_two_and_wins(self):
        """`$PUBLIC` is granted first here on purpose: a `$GENERAL` row on the
        node is one of the owner's own principals, and the nearest one wins, so
        granting it first would leave the owner at Read and unable to grant
        again."""
        self._grant("$PUBLIC")
        self._grant(OTHER)
        self._grant("$GENERAL")
        self.assertEqual(self._share_count(), -2)

    def test_a_share_link_is_not_a_person(self):
        """A link is a credential, not somebody it is shared with, and legacy
        never counted one."""
        self._grant("$LINK", EDIT)
        self.assertEqual(self._share_count(), 0)

    def test_a_denial_is_not_a_share(self):
        """§5.10 keeps removal and denial apart: `role = 0` is a deny row, and
        counting it would report a document as shared with the one person it is
        explicitly kept from."""
        self._grant(OTHER, NONE)
        self.assertEqual(self._share_count(), 0)


class TestDocumentListPaging(IntegrationTestCase):
    """The list merges two stores in Python, so it pages them itself."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(USER)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.made = []
        for index in range(3):
            entity = frappe._dict(docs.create_document(title=f"Page {index} {frappe.generate_hash(6)}"))
            self.made.append(entity.name)
            self.addCleanup(self._drop, entity.name)

    @staticmethod
    def _drop(node: str):
        frappe.set_user("Administrator")
        if not frappe.db.exists("Drive Node", node):
            return
        admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        update(admin, node, state="Trashed")
        purge(admin, node)
        frappe.db.commit()

    def _page(self, start: int, limit: int):
        frappe.response.pop("data", None)
        frappe.response.pop("has_next_page", None)
        get_document_list(start=start, limit=limit)
        return [row["name"] for row in frappe.response["data"]], frappe.response["has_next_page"]

    def test_a_window_returns_that_many_rows_and_says_there_are_more(self):
        first, more = self._page(0, 2)
        self.assertEqual(len(first), 2)
        self.assertTrue(more)

    def test_the_next_window_does_not_repeat_the_first(self):
        first, _ = self._page(0, 2)
        second, _ = self._page(2, 2)
        self.assertFalse(set(first) & set(second), "one row is on one page")

    def test_every_document_the_caller_owns_is_reachable_by_paging(self):
        seen, start = [], 0
        while True:
            page, more = self._page(start, 2)
            seen += page
            if not more:
                break
            start += 2
        self.assertTrue(set(self.made) <= set(seen))

    def test_the_last_window_says_there_are_no_more(self):
        _, more = self._page(0, 500)
        self.assertFalse(more)


class TestDocumentListStaleRecent(IntegrationTestCase):
    """ "Recently opened" outlives access, so the list re-asks before it publishes.

    A `Drive Recent` row is a record of the past. Access is answered now. If
    the list trusted the first one it would name a document to somebody whose
    grant was taken away (§5.4).
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for user in (USER, OTHER):
            ensure_user(user)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.entity = frappe._dict(docs.create_document(title=f"Stale {frappe.generate_hash(6)}"))
        self.addCleanup(self._drop, self.entity.name)
        grant(self.entity.name, OTHER, READ, Principals(USER, (USER, "$GENERAL"), ("$PUBLIC",)))
        # Drive's own recorder, not a hand-written row: the point of the case
        # is that a genuine "recently opened" record does not outlive access.
        visit(Principals(OTHER, (OTHER, "$GENERAL"), ("$PUBLIC",)), self.entity.name)

    @staticmethod
    def _drop(node: str):
        frappe.set_user("Administrator")
        if not frappe.db.exists("Drive Node", node):
            return
        admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        update(admin, node, state="Trashed")
        purge(admin, node)
        frappe.db.commit()

    def _names_for_other(self) -> set[str]:
        frappe.set_user(OTHER)
        frappe.response.pop("data", None)
        get_document_list(limit=200)
        names = {row["name"] for row in frappe.response["data"]}
        frappe.set_user(USER)
        return names

    def test_a_document_opened_by_a_reader_is_in_their_list(self):
        self.assertIn(self.entity.name, self._names_for_other())

    def test_the_same_document_leaves_the_list_when_the_grant_is_taken_away(self):
        revoke(self.entity.name, OTHER, Principals(USER, (USER, "$GENERAL"), ("$PUBLIC",)))
        self.assertNotIn(self.entity.name, self._names_for_other())
