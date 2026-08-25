import frappe
from frappe.tests import IntegrationTestCase

from suite.drive.api.files import update_access
from suite.drive.api.list import files
from suite.drive.utils import create_drive_file, get_user_folder
from suite.drive.utils.files import FileManager
from suite.tests.utils import ensure_user

OWNER = "drive-list-owner@example.com"
VIEWER = "drive-list-viewer@example.com"


class TestDriveListPagination(IntegrationTestCase):
    """
    The dedupe and the permission filter in `get_query_data` run
    *after* LIMIT/OFFSET, so a raw SQL window can yield fewer visible rows than
    `limit` while rows still remain. The client used to infer end-of-list from the
    row count, which stranded the rest of the folder behind a dead scroll.

    The paginated path therefore walks raw windows until it has a full page of
    *visible* rows, and reports `has_next` from that — never from the raw count,
    which would otherwise turn an empty page into proof that hidden rows exist.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        ensure_user(VIEWER)
        with cls.set_user(OWNER):
            cls.home = get_user_folder(OWNER).name

    def setUp(self):
        frappe.flags.mute_drive_activity_log = True
        with self.set_user(OWNER):
            manager = FileManager()
            self.folder = create_drive_file(
                "list-pagination",
                self.home,
                "Folder",
                lambda file: manager.create_folder(file),
            )
            # Deterministic names so a failing run names the same rows every time.
            self.files = [self._make_file(i) for i in range(10)]

    def _make_file(self, index):
        return create_drive_file(
            f"page-{index:02d}.txt",
            self.folder.name,
            "Text",
            f"{self.folder.file_url}page-{index:02d}.txt",
            "text/plain",
            12,
        )

    def _list(self, **kwargs):
        return files(entity_name=self.folder.name, paginated=True, **kwargs)

    def _share_folder_denying(self, denied):
        with self.set_user(OWNER):
            update_access(self.folder.name, "share", cmd="share", user=VIEWER, read=True)
            for entity in denied:
                update_access(entity.name, "share", cmd="share", user=VIEWER, read=True, deny=True)

    def test_paginated_returns_envelope(self):
        with self.set_user(OWNER):
            page = self._list(limit=2)

        self.assertEqual(set(page), {"rows", "has_next", "next_start"})

    def test_bare_list_without_paginated(self):
        """The opt-in must not change the shape for the callers that never page."""
        with self.set_user(OWNER):
            result = files(entity_name=self.folder.name)

        self.assertIsInstance(result, list)

    def test_full_page_reports_more(self):
        with self.set_user(OWNER):
            page = self._list(limit=4)

        self.assertEqual(len(page["rows"]), 4)
        self.assertTrue(page["has_next"])

    def test_pages_use_the_modified_value_returned_to_the_client(self):
        with self.set_user(OWNER):
            frappe.db.set_value("File", self.files[0].name, "file_modified", "2020-01-01 00:00:00")
            frappe.db.set_value("File", self.files[1].name, "file_modified", "2030-01-01 00:00:00")
            page = self._list(limit=10, order_by="modified", ascending=False)

        modified = [row["modified"] for row in page["rows"]]
        self.assertEqual(modified, sorted(modified, reverse=True))

    def test_exhausted_query_reports_end(self):
        with self.set_user(OWNER):
            page = self._list(limit=50)

        self.assertEqual(len(page["rows"]), 10)
        self.assertFalse(page["has_next"])

    def test_denied_rows_never_leak_through_has_next(self):
        """
        The security case. VIEWER can read the folder but every file in it is
        denied, so the page is legitimately empty. `has_next` must be False:
        deriving it from the raw row count would report True and turn the empty
        page into proof that files are there — an existence oracle over content
        the caller is explicitly denied.
        """
        with self.set_user(OWNER):
            self.files.extend(self._make_file(i) for i in range(10, 25))
        self._share_folder_denying(self.files)

        with self.set_user(VIEWER):
            page = self._list(limit=1)

        self.assertEqual(page["rows"], [])
        self.assertFalse(page["has_next"], "an empty page must not advertise hidden rows")

    def test_page_fills_past_denied_rows(self):
        """
        A window thinned by denies must still deliver a full page of visible rows
        rather than a short one, or the client is back to guessing.
        """
        self._share_folder_denying(self.files[:3])

        with self.set_user(VIEWER):
            page = self._list(limit=5)

        self.assertEqual(len(page["rows"]), 5)
        self.assertTrue(page["has_next"])
        self.assertGreater(page["next_start"], 5, "should have scanned past the denied rows")

    def test_pages_cover_every_visible_row_exactly_once(self):
        """Walking pages the way the client does must reach all 7 visible files."""
        self._share_folder_denying(self.files[:3])
        visible = {f.name for f in self.files[3:]}

        seen, start = [], 0
        with self.set_user(VIEWER):
            while True:
                page = self._list(start=start, limit=2)
                seen.extend(r["name"] for r in page["rows"])
                if not page["has_next"]:
                    break
                start = page["next_start"]

        self.assertCountEqual(seen, visible)

    def tearDown(self):
        frappe.flags.mute_drive_activity_log = False
