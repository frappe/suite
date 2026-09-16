"""The legacy `api/list` surface, against the nodes it now answers about.

§11.7 forwards `files`, `shared`, `favourites`, `recents`, and `trash` into
`_core.nodes.children` and `_core.nodes.views`, so every fixture here is a
`Drive Node`. The suite this replaces built `File` rows and shared them with
`Drive Permission`. A `File` id names no node, so every call reached
`children` with a parent that is in no root and the module errored eight
times with `DriveNotFound` before it asserted anything.

`get_attachments` is the one name in `api/list` §11.7 retained on `File`.
`api/tests/test_files.py` covers it, beside the other `File` rules.
"""

import io

import frappe
from frappe.storage.blob import put_blob
from frappe.tests import IntegrationTestCase

from suite.drive._core import nodes as node_core
from suite.drive._core import quota
from suite.drive._core.activity import set_favourite, visit
from suite.drive._core.nodes import create_file, create_folder
from suite.drive._core.roots import personal_root_for, provision_personal_root
from suite.drive.api.files import update_access
from suite.drive.api.list import favourites, files, recents, shared, trash
from suite.drive.framework import principals_for
from suite.drive.tests.fixtures import drop_node_rows, drop_record_rows, nodes_in_root
from suite.drive.utils import GENERAL_USER
from suite.tests.utils import ensure_user

OWNER = "drive-list-owner@example.com"
VIEWER = "drive-list-viewer@example.com"


def pdf_bytes(seed: int) -> bytes:
    """Content `filetype.guess` calls `application/pdf`, unique per seed.

    `put_blob` deduplicates on the checksum, so two fixtures holding the same
    bytes are one blob. The seed keeps each file its own.
    """
    return b"%PDF-1.4\n%%\xe2\xe3\xcf\xd3\n" + str(seed).encode()


def png_bytes(seed: int) -> bytes:
    """The same, for `image/png`."""
    return b"\x89PNG\r\n\x1a\n" + str(seed).encode()


# Every column `get_query_data` published for one row, under the names the
# client reads. `slide_count` is not here: it is carried on a presentation row
# alone, because `DriveListRow.sizeLabel` switches on its presence.
LEGACY_ROW_COLUMNS = {
    "name",
    "file_name",
    "folder",
    "file_url",
    "file_size",
    "file_type",
    "is_folder",
    "content_doctype",
    "content_docname",
    "creation",
    "modified",
    "owner",
    "attached_to_doctype",
    "attached_to_name",
    "owner_full_name",
    "owner_image",
    "is_favourite",
    "accessed",
    "child_count",
    "share_count",
    "kind",
    "read",
    "write",
    "share",
    "comment",
    "upload",
    "type",
}


class LegacyListCase(IntegrationTestCase):
    """One `Drive Node` folder below the caller's own Personal root.

    The forwarders resolve an unnamed folder through `shims._home`, which is
    the root `after_user_insert` provisions, so the fixtures hang off that
    root rather than one made here.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        ensure_user(VIEWER)

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.home = personal_root_for(OWNER) or provision_personal_root(OWNER)
        provision_personal_root(VIEWER)
        self.owner = principals_for(OWNER)
        self.viewer = principals_for(VIEWER)
        self.nodes_before = nodes_in_root(self.home)
        self.blobs_before = set(frappe.get_all("File Blob", pluck="name"))
        self.folder = create_folder(self.owner, self.home, f"list-{frappe.generate_hash(6)}")

    def tearDown(self):
        frappe.set_user("Administrator")
        created = nodes_in_root(self.home) - self.nodes_before
        drop_record_rows(created)
        drop_node_rows(created)
        for blob in set(frappe.get_all("File Blob", pluck="name")) - self.blobs_before:
            frappe.delete_doc("File Blob", blob, force=1, ignore_permissions=True, ignore_missing=True)
        # The rows went out from under the counter, so recount rather than
        # leave the next case's quota reading the fixtures this one deleted.
        quota.recompute_usage(self.home)
        super().tearDown()

    def make_file(self, parent: str, title: str, content: bytes = b"drive bytes") -> str:
        """One node with bytes in it, through the workflow a route would use.

        A node's mime is its blob's, and `create_file` refuses any other
        value. `put_blob` sniffs the content and never reads the title
        (`frappe/storage/blob.py:64`), so a fixture that wants a legacy
        `file_kinds` family has to hand it bytes that family recognises -
        naming a file `.pdf` does not make it one.
        """
        blob = put_blob(io.BytesIO(content), is_private=True, filename=title)
        return create_file(
            self.owner,
            parent,
            title,
            blob=blob.name,
            size=blob.file_size,
            mime=blob.mime_type,
        )

    def seed(self, count: int, parent: str | None = None) -> list[str]:
        """Deterministic titles, so a failing run names the same rows twice."""
        parent = parent or self.folder
        return [self.make_file(parent, f"page-{index:02d}.txt") for index in range(count)]

    def share(self, node: str, user: str = VIEWER, **bits) -> None:
        with self.set_user(OWNER):
            update_access(node, "share", user=user, **bits)

    def deny(self, nodes) -> None:
        for node in nodes:
            self.share(node, deny=True)


class TestLegacyFolderPage(LegacyListCase):
    """`list.files` -> `GET /nodes/<id>/children`.

    `children` filters each row against the caller after the SQL window and
    advances its cursor by the raw window, so a page can come back short while
    rows remain. The old `get_query_data` had the same shape of problem and
    answered it the same way: walk raw windows until the page holds a full
    count of *visible* rows, and report `has_next` from the cursor, never from
    the row count - an empty page must not advertise the rows it was denied.
    """

    def _list(self, **kwargs):
        return files(entity_name=self.folder, paginated=True, **kwargs)

    # -- the paged envelope ------------------------------------------------

    def test_paginated_returns_envelope(self):
        self.seed(10)

        with self.set_user(OWNER):
            page = self._list(limit=2)

        self.assertEqual(set(page), {"rows", "has_next", "next_start"})

    def test_bare_list_without_paginated(self):
        """The opt-in must not change the shape for the callers that never page."""
        self.seed(10)

        with self.set_user(OWNER):
            result = files(entity_name=self.folder)

        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 10)

    def test_full_page_reports_more(self):
        self.seed(10)

        with self.set_user(OWNER):
            page = self._list(limit=4)

        self.assertEqual(len(page["rows"]), 4)
        self.assertTrue(page["has_next"])

    def test_exhausted_query_reports_end(self):
        self.seed(10)

        with self.set_user(OWNER):
            page = self._list(limit=50)

        self.assertEqual(len(page["rows"]), 10)
        self.assertFalse(page["has_next"])

    def test_an_unpaginated_call_with_no_limit_answers_the_whole_folder(self):
        """`folderTree.js` and `MoveDialog.vue` both call this way.

        The old body ran its query with no `LIMIT` on that branch. A default
        page here hides every child past the first hundred from the sidebar
        and from the move target list.
        """
        self.seed(10)
        for index in range(95):
            create_folder(self.owner, self.folder, f"bulk-{index:03d}")

        with self.set_user(OWNER):
            rows = files(entity_name=self.folder)

        self.assertEqual(len(rows), 105)

    def test_a_paginated_call_with_no_limit_stops_at_the_legacy_page(self):
        self.seed(10)
        for index in range(95):
            create_folder(self.owner, self.folder, f"bulk-{index:03d}")

        with self.set_user(OWNER):
            page = self._list()

        self.assertEqual(len(page["rows"]), 100)
        self.assertTrue(page["has_next"])
        self.assertEqual(page["next_start"], 100)

    # -- the rows the caller cannot see ------------------------------------

    def test_denied_rows_never_leak_through_has_next(self):
        """The security case. VIEWER can read the folder but every file in it
        is denied, so the page is legitimately empty. `has_next` must be
        False: reading it off the raw window would report True and turn the
        empty page into proof that files are there - an existence oracle over
        content the caller is explicitly denied.
        """
        seeded = self.seed(25)
        self.share(self.folder, read=True)
        self.deny(seeded)

        with self.set_user(VIEWER):
            page = self._list(limit=1)

        self.assertEqual(page["rows"], [])
        self.assertFalse(page["has_next"], "an empty page must not advertise hidden rows")

    def test_page_fills_past_denied_rows(self):
        """A window thinned by denies must still deliver a full page of
        visible rows rather than a short one, or the client is back to
        guessing."""
        seeded = self.seed(10)
        self.share(self.folder, read=True)
        self.deny(seeded[:3])

        with self.set_user(VIEWER):
            page = self._list(limit=5)

        self.assertEqual(len(page["rows"]), 5)
        self.assertTrue(page["has_next"])
        self.assertGreater(page["next_start"], 5, "should have scanned past the denied rows")

    def test_pages_cover_every_visible_row_exactly_once(self):
        """Walking pages the way the client does must reach all 7 visible files."""
        seeded = self.seed(10)
        self.share(self.folder, read=True)
        self.deny(seeded[:3])
        visible = set(seeded[3:])

        seen, start = [], 0
        with self.set_user(VIEWER):
            while True:
                page = self._list(start=start, limit=2)
                seen.extend(row["name"] for row in page["rows"])
                if not page["has_next"]:
                    break
                start = page["next_start"]

        self.assertCountEqual(seen, visible)

    def test_a_denied_child_is_absent_from_a_bare_list_too(self):
        seeded = self.seed(10)
        self.share(self.folder, read=True)
        self.deny(seeded[:3])

        with self.set_user(VIEWER):
            rows = files(entity_name=self.folder)

        self.assertCountEqual([row["name"] for row in rows], seeded[3:])

    # -- order -------------------------------------------------------------

    def mixed_times(self):
        """A folder and ten files, two of them edited outside today.

        Only the files carry `content_modified`: `_create_empty_node` inserts
        a folder without one. The old surface had the same pair - a folder had
        no `file_modified` either - and coalesced both the column it sorted by
        and the column it published, so the folder sorted by its own time
        rather than clumping at whichever end holds the nulls.
        """
        seeded = self.seed(10)
        folder = create_folder(self.owner, self.folder, "inner")
        frappe.db.set_value("Drive Node", seeded[0], "content_modified", "2020-01-01 00:00:00")
        frappe.db.set_value("Drive Node", seeded[1], "content_modified", "2030-01-01 00:00:00")
        return seeded, folder

    def test_pages_use_the_modified_value_returned_to_the_client(self):
        """A list sorted by a column it does not publish reads as unsorted.

        The old query ordered by `COALESCE(file_modified, modified)` and
        published that same value as `modified`. A node carries the pair as
        `content_modified` and `modified`, and `upload_file` stamps the first
        one from the client's own `file_modified`, so the two columns differ
        on every uploaded file.
        """
        seeded, folder = self.mixed_times()

        with self.set_user(OWNER):
            newest_first = self._list(limit=11, order_by="modified", ascending=False)
            oldest_first = self._list(limit=11, order_by="modified", ascending=True)

        descending = [str(row["modified"]) for row in newest_first["rows"]]
        ascending = [str(row["modified"]) for row in oldest_first["rows"]]
        self.assertEqual(descending, sorted(descending, reverse=True))
        self.assertEqual(ascending, sorted(ascending))
        self.assertEqual(newest_first["rows"][0]["name"], seeded[1])
        self.assertEqual(newest_first["rows"][-1]["name"], seeded[0])
        self.assertIn(folder, [row["name"] for row in newest_first["rows"][1:-1]])

    def test_the_toolbar_columns_reach_the_folder_sort(self):
        self.make_file(self.folder, "banana.txt", b"bb")
        self.make_file(self.folder, "apple.txt", b"a")
        self.make_file(self.folder, "cherry.txt", b"ccc")

        with self.set_user(OWNER):
            ascending = files(entity_name=self.folder, order_by="file_name")
            descending = files(entity_name=self.folder, order_by="file_name", ascending=False)
            by_size = files(entity_name=self.folder, order_by="file_size")

        self.assertEqual([row["file_name"] for row in ascending], ["apple.txt", "banana.txt", "cherry.txt"])
        self.assertEqual([row["file_name"] for row in descending], ["cherry.txt", "banana.txt", "apple.txt"])
        self.assertEqual([row["file_size"] for row in by_size], [1, 2, 3])

    def test_an_unknown_column_falls_back_instead_of_refusing(self):
        """The toolbar sends five column names and §11.4 keeps three.

        `_core.nodes.children` refuses a column it does not know, so a client
        clicking "Type" would meet a ValidationError where the old query
        silently sorted by `modified`.
        """
        seeded, _folder = self.mixed_times()

        with self.set_user(OWNER):
            rows = files(entity_name=self.folder, order_by="file_type", ascending=False)

        modified = [str(row["modified"]) for row in rows]
        self.assertEqual(len(rows), 11)
        self.assertEqual(modified, sorted(modified, reverse=True))
        self.assertEqual(rows[0]["name"], seeded[1])

    # -- filters -----------------------------------------------------------

    def test_file_kinds_selects_the_families_the_old_filter_selected(self):
        """§11.2 replaced the family filter with one `mime_prefix`, which can
        spell neither `Folder` nor two families at once, so the old vocabulary
        is applied to the page instead."""
        self.make_file(self.folder, "report.pdf", pdf_bytes(1))
        self.make_file(self.folder, "photo.png", png_bytes(1))
        inner = create_folder(self.owner, self.folder, "inner")

        with self.set_user(OWNER):
            pdfs = files(entity_name=self.folder, file_kinds=["PDF"])
            both = files(entity_name=self.folder, file_kinds=["PDF", "Image"])
            folders = files(entity_name=self.folder, file_kinds=["Folder"])

        self.assertEqual([row["file_name"] for row in pdfs], ["report.pdf"])
        self.assertCountEqual([row["file_name"] for row in both], ["report.pdf", "photo.png"])
        self.assertEqual([row["name"] for row in folders], [inner])

    def test_a_filtered_page_counts_matching_rows_not_children(self):
        """`start` and `limit` counted matching rows on the old surface: page
        two of a PDF-only folder began at the twenty-first PDF, not at the
        twenty-first child."""
        pdfs = []
        for index in range(4):
            self.make_file(self.folder, f"pad-{index}.bin", bytes([index]))
            pdfs.append(self.make_file(self.folder, f"doc-{index}.pdf", pdf_bytes(index)))

        with self.set_user(OWNER):
            page = self._list(file_kinds=["PDF"], start=1, limit=2)

        self.assertEqual([row["name"] for row in page["rows"]], pdfs[1:3])
        self.assertTrue(page["has_next"])
        self.assertEqual(page["next_start"], 3)

    def test_a_search_leaves_the_folder_and_searches_the_tree(self):
        term = frappe.generate_hash(8)
        inside = self.make_file(self.folder, f"{term}-inside.txt")
        outside = self.make_file(self.home, f"{term}-outside.txt")
        self.make_file(self.folder, "unrelated.txt")

        with self.set_user(OWNER):
            rows = files(entity_name=self.folder, search=term)

        self.assertCountEqual([row["name"] for row in rows], [inside, outside])

    # -- the payload -------------------------------------------------------

    def test_a_row_carries_the_columns_the_old_query_selected(self):
        node = self.make_file(self.folder, "payload.txt", b"twelve bytes")
        with self.set_user(OWNER):
            visit(self.owner, node)
            set_favourite(self.owner, node, True)

        with self.set_user(OWNER):
            rows = files(entity_name=self.folder)

        row = next(row for row in rows if row["name"] == node)
        self.assertEqual(set(row), LEGACY_ROW_COLUMNS)
        self.assertEqual(row["file_name"], "payload.txt")
        self.assertEqual(row["folder"], self.folder)
        # `create_file` takes the mime off the blob, and `put_blob` sniffs the
        # bytes rather than the name, so a text file is `application/
        # octet-stream`. The forwarder reports the node's own mime; nothing in
        # §11.7 chooses this one.
        self.assertEqual(row["file_type"], "Application")
        self.assertEqual(row["file_size"], 12)
        self.assertEqual(row["is_folder"], 0)
        self.assertIsNone(row["file_url"], "a managed file's storage key is not published")
        self.assertEqual(row["owner"], OWNER)
        self.assertEqual(row["kind"], "native")
        self.assertEqual(row["type"], "admin")
        self.assertTrue(row["read"] and row["write"] and row["share"])
        self.assertIsNotNone(row["is_favourite"])
        self.assertIsNotNone(row["accessed"])

    def test_a_folder_row_counts_only_the_children_the_caller_can_see(self):
        inner = create_folder(self.owner, self.folder, "inner")
        seeded = [self.make_file(inner, f"inner-{index}.txt") for index in range(3)]
        self.share(self.folder, read=True)
        self.deny(seeded[:1])

        with self.set_user(OWNER):
            owner_row = next(row for row in files(entity_name=self.folder) if row["name"] == inner)
        with self.set_user(VIEWER):
            viewer_row = next(row for row in files(entity_name=self.folder) if row["name"] == inner)

        self.assertEqual(owner_row["child_count"], 3)
        self.assertEqual(viewer_row["child_count"], 2)

    def test_the_share_marker_reads_the_nodes_own_grants(self):
        named = self.make_file(self.folder, "named.txt")
        published = self.make_file(self.folder, "published.txt")
        site_wide = self.make_file(self.folder, "site.txt")
        plain = self.make_file(self.folder, "plain.txt")
        self.share(named, read=True)
        self.share(published, user="", read=True)
        self.share(site_wide, user=GENERAL_USER, read=True)

        with self.set_user(OWNER):
            markers = {row["name"]: row["share_count"] for row in files(entity_name=self.folder)}

        self.assertEqual(markers[named], 1)
        self.assertEqual(markers[published], -2)
        self.assertEqual(markers[site_wide], -1)
        self.assertEqual(markers[plain], 0)


class TestLegacyViews(LegacyListCase):
    """The four discovery lists -> `GET /views/<name>`.

    §11.2 froze one order per view. The old `get_query_data` sorted `shared`,
    `favourites`, and `trash` by the column the toolbar names, so the shim
    sorts those three itself; `recents` keeps the view's order, because the
    old body dropped `order_by` there too.
    """

    def test_shared_lists_what_was_shared_with_the_caller(self):
        node = self.make_file(self.folder, "shared.txt")
        self.share(node, read=True)

        with self.set_user(VIEWER):
            rows = shared()

        self.assertIn(node, [row["name"] for row in rows])

    def test_shared_refuses_the_public_list(self):
        """`shared_type="public"` named a second list no view answers. A
        caller asking which of their files are published must not be handed
        the files other people shared with them."""
        with self.set_user(OWNER), self.assertRaises(frappe.ValidationError):
            shared(shared_type="public")

    def test_favourites_lists_the_marked_rows_and_carries_the_mark(self):
        node = self.make_file(self.folder, "starred.txt")
        other = self.make_file(self.folder, "plain.txt")
        with self.set_user(OWNER):
            set_favourite(self.owner, node, True)

            rows = favourites()

        names = [row["name"] for row in rows]
        self.assertIn(node, names)
        self.assertNotIn(other, names)
        self.assertIsNotNone(next(row for row in rows if row["name"] == node)["is_favourite"])

    def test_recents_lists_a_visit_and_carries_the_accessed_time(self):
        node = self.make_file(self.folder, "opened.txt")
        with self.set_user(OWNER):
            visit(self.owner, node)

            rows = recents()

        row = next(row for row in rows if row["name"] == node)
        self.assertIsNotNone(row["accessed"], "Recents.vue groups rows by the day they were opened")

    def test_trash_lists_the_trashed_root_only(self):
        inner = create_folder(self.owner, self.folder, "inner")
        buried = self.make_file(inner, "buried.txt")
        node_core.update(self.owner, inner, state="Trashed")

        with self.set_user(OWNER):
            names = [row["name"] for row in trash()]

        self.assertIn(inner, names)
        self.assertNotIn(buried, names, "§8.7 lists trash roots, not the subtree under one")

    def test_a_view_is_sorted_by_the_column_the_toolbar_names(self):
        first = self.make_file(self.folder, "banana.txt")
        second = self.make_file(self.folder, "apple.txt")
        with self.set_user(OWNER):
            set_favourite(self.owner, first, True)
            set_favourite(self.owner, second, True)

            rows = favourites(order_by="file_name")

        self.assertEqual(
            [row["file_name"] for row in rows if row["name"] in (first, second)],
            ["apple.txt", "banana.txt"],
        )

    def test_every_view_answers_the_same_paged_envelope(self):
        node = self.make_file(self.folder, "everywhere.txt")
        self.share(node, read=True)
        with self.set_user(OWNER):
            visit(self.owner, node)
            set_favourite(self.owner, node, True)

            for call in (favourites, recents, trash):
                with self.subTest(view=call.__name__):
                    page = call(paginated=True, limit=1)
                    self.assertEqual(set(page), {"rows", "has_next", "next_start"})
        with self.set_user(VIEWER):
            page = shared(paginated=True, limit=1)
        self.assertEqual(set(page), {"rows", "has_next", "next_start"})
