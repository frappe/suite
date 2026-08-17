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
    Regression cover for F5: the dedupe and the permission filter in `get_query_data`
    run *after* LIMIT/OFFSET, so a full SQL window can come back with fewer rows than
    `limit` while rows still remain. The client used to infer end-of-list from the row
    count, which meant one filtered row permanently stopped infinite scroll and made
    the rest of the folder unreachable. `has_next` has to reflect the SQL window, not
    the row count.
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
                frappe.generate_hash(8),
                self.home,
                "Folder",
                lambda file: manager.create_folder(file),
            )
            self.files = [self._make_file() for _ in range(3)]

    def _make_file(self):
        return create_drive_file(
            f"{frappe.generate_hash(8)}.txt",
            self.folder.name,
            "Text",
            f"{self.folder.file_url}{frappe.generate_hash(8)}.txt",
            "text/plain",
            12,
        )

    def _list(self, **kwargs):
        return files(entity_name=self.folder.name, paginated=True, **kwargs)

    def test_paginated_returns_envelope(self):
        with self.set_user(OWNER):
            page = self._list(limit=2)

        self.assertIsInstance(page, dict)
        self.assertEqual(set(page), {"rows", "has_next"})

    def test_bare_list_without_paginated(self):
        """The opt-in must not change the shape for the callers that never page."""
        with self.set_user(OWNER):
            result = files(entity_name=self.folder.name)

        self.assertIsInstance(result, list)

    def test_full_window_reports_more(self):
        with self.set_user(OWNER):
            page = self._list(limit=2)

        self.assertEqual(len(page["rows"]), 2)
        self.assertTrue(page["has_next"])

    def test_short_window_reports_end(self):
        with self.set_user(OWNER):
            page = self._list(limit=10)

        self.assertEqual(len(page["rows"]), 3)
        self.assertFalse(page["has_next"])

    def test_filtered_row_does_not_end_the_list(self):
        """
        The actual F5 regression. VIEWER can read the folder but is denied one file,
        so a full SQL window of 3 yields 2 rows. Counting rows says "end of list" and
        strands the remaining files; `has_next` must still be True.
        """
        with self.set_user(OWNER):
            update_access(self.folder.name, "share", cmd="share", user=VIEWER, read=True)
            update_access(self.files[0].name, "share", cmd="share", user=VIEWER, read=True, deny=True)

        with self.set_user(VIEWER):
            page = self._list(limit=3)

        self.assertLess(len(page["rows"]), 3, "expected the deny row to shrink the window")
        self.assertTrue(page["has_next"], "a shrunken full window still has more rows")

    def test_pages_cover_every_visible_row(self):
        """Walking the pages the way the client does must reach all three files."""
        seen, start = [], 0
        with self.set_user(OWNER):
            while True:
                page = self._list(start=start, limit=2)
                seen.extend(r["name"] for r in page["rows"])
                if not page["has_next"]:
                    break
                start += 2

        self.assertCountEqual(seen, [f.name for f in self.files])

    def tearDown(self):
        frappe.flags.mute_drive_activity_log = False
