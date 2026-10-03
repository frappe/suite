"""Old page URLs reach their new routes (unified frontend spec §14.3).

Every case is a whole request through Frappe's WSGI application, so the
`before_request` entry in `hooks.py`, the lookups, and the 302 are all in the
path.
"""

import json

import frappe

from suite.composition import redirects
from suite.drive.http.tests.test_dispatch import OWNER, STRANGER, DriveHTTPCase
from suite.drive.tests.fixtures import add_legacy_route, drop_legacy_route

TEAM = "redirect-test-team"
SHEET = "redirect-test-sheet"
PRESENTATION = "redirect-test-deck"


class TestRedirectTable(DriveHTTPCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.addClassCleanup(cls.remove_old_rows)
        cls.remove_old_rows()  # a killed run leaves them behind
        # Raw rows: the lookups read one column, and a controller insert would
        # mint a second node through Drive.
        frappe.get_doc(
            {"doctype": "Sheet", "name": SHEET, "title": "Old sheet", "node": cls.document}
        ).db_insert()
        frappe.get_doc(
            {"doctype": "Presentation", "name": PRESENTATION, "title": "Old deck", "node": cls.document}
        ).db_insert()
        add_legacy_route(TEAM, cls.folder)
        frappe.db.commit()
        # The fixtures sit in the owner's Personal root: the owner may read
        # every node, and the stranger and a guest may read none.
        cls.owner_sid = cls.session_for(OWNER)
        cls.stranger_sid = cls.session_for(STRANGER)

    @classmethod
    def remove_old_rows(cls):
        frappe.db.rollback()
        frappe.db.delete("Sheet", {"name": SHEET})
        frappe.db.delete("Presentation", {"name": PRESENTATION})
        drop_legacy_route(TEAM)
        frappe.db.commit()

    def cases(self) -> list[tuple[str, str, str]]:
        """(row, old path, new path), one or more per row."""
        folder, file, document = self.folder, self.file, self.document
        return [
            ("/drive/inbox", "/drive/inbox", "/drive"),
            ("/drive/attachments", "/drive/attachments", "/drive"),
            ("/drive/attachments/:doctype", "/drive/attachments/ToDo", "/drive"),
            ("/drive/attachments/:doctype/:docname", "/drive/attachments/ToDo/todo-1", "/drive"),
            ("/drive/documents", "/drive/documents", "/drive/recent?type=document"),
            ("/drive/presentations", "/drive/presentations", "/drive/recent?type=presentation"),
            ("/writer", "/writer", "/drive/recent?type=document"),
            ("/sheets", "/sheets", "/drive/recent?type=spreadsheet"),
            ("/slides", "/slides", "/drive/recent?type=presentation"),
            ("/drive/recents", "/drive/recents", "/drive/recent"),
            ("/drive/favourites", "/drive/favourites", "/drive/starred"),
            ("/drive/shared", "/drive/shared", "/drive/shared-with-me"),
            ("/sheets/trash", "/sheets/trash", "/drive/trash"),
            ("/drive/d/:id", f"/drive/d/{folder}", f"/drive/f/{folder}"),
            ("/drive/w/:id", f"/drive/w/{document}", f"/d/{document}"),
            ("/writer/w/:id", f"/writer/w/{document}", f"/d/{document}"),
            ("/drive/g/:id", f"/drive/g/{folder}", f"/drive/f/{folder}"),
            ("/drive/g/:id", f"/drive/g/{file}", f"/d/{file}"),
            ("/drive/t/:team/:letter/:id", f"/drive/t/{TEAM}/f/{file}", f"/d/{file}"),
            ("/drive/folder/:id", f"/drive/folder/{folder}", f"/drive/f/{folder}"),
            ("/drive/document/:id", f"/drive/document/{document}", f"/d/{document}"),
            ("/drive/file/:id", f"/drive/file/{file}", f"/d/{file}"),
            ("/drive/t/:team", f"/drive/t/{TEAM}/", f"/drive/f/{folder}"),
            ("/drive/l/:token", "/drive/l/abc123", "/l/abc123"),
            ("/sheets/:docname", f"/sheets/{SHEET}", f"/d/{document}"),
            ("/slides/presentation/:docname", f"/slides/presentation/{PRESENTATION}", f"/d/{document}"),
            (
                "/slides/presentation/view/:docname",
                f"/slides/presentation/view/{PRESENTATION}",
                f"/d/{document}",
            ),
            ("/slides/slideshow/:docname", f"/slides/slideshow/{PRESENTATION}", f"/d/{document}"),
            ("/sheets/new", "/sheets/new", "/home"),
            ("/slides/presentation/new", "/slides/presentation/new", "/home"),
            ("/slides/not-permitted", "/slides/not-permitted", "/home"),
            ("/suite", "/suite", "/home"),
            ("/suite/start", "/suite/start", "/home"),
        ]

    GUEST = "guest"

    def open(self, path: str, *, query: dict | None = None, sid: str | None = None):
        sid = None if sid == self.GUEST else (sid or self.owner_sid)
        return self.drive("GET", path, query=query, sid=sid)

    def assertRedirect(self, response, location: str) -> None:
        self.assertEqual(response.status_code, 302, response.get_data(as_text=True)[:500])
        self.assertEqual(response.headers["Location"], location)

    def assertFallsThrough(self, response) -> None:
        self.assertNotIn(response.status_code, (301, 302, 303, 307, 308))
        self.assertNotIn("Location", response.headers)

    def test_every_old_path_answers_302_to_its_new_path(self):
        cases = self.cases()
        redirecting = {row.old for row in redirects.ROWS if row.new or row.lookup}
        self.assertEqual({row for row, _old, _new in cases}, redirecting)
        for _row, old, new in cases:
            with self.subTest(old=old):
                self.assertRedirect(self.open(old), new)

    def test_a_slug_and_a_trailing_slash_are_dropped_and_the_query_is_carried(self):
        self.assertRedirect(
            self.open(f"/slides/presentation/{PRESENTATION}/q3-review", query={"slide": "3"}),
            f"/d/{self.document}?slide=3",
        )
        self.assertRedirect(self.open(f"/drive/d/{self.folder}/reports/"), f"/drive/f/{self.folder}")
        self.assertRedirect(self.open("/sheets/new/"), "/home")

    def test_a_row_with_its_own_query_keeps_it_and_carries_the_other_keys(self):
        self.assertRedirect(
            self.open("/sheets", query={"x": "1", "type": "old"}),
            "/drive/recent?type=spreadsheet&x=1",
        )

    def test_a_lookup_the_caller_may_not_read_falls_through_like_a_missing_node(self):
        lookup_rows = {row.old for row in redirects.ROWS if row.lookup}
        cases = [(row, old) for row, old, _new in self.cases() if row in lookup_rows]
        self.assertEqual({row for row, _old in cases}, lookup_rows)
        for caller, sid in (("guest", self.GUEST), ("stranger", self.stranger_sid)):
            for _row, old in cases:
                with self.subTest(caller=caller, old=old):
                    self.assertFallsThrough(self.open(old, sid=sid))
        # The rows that need no node still answer anybody.
        self.assertRedirect(self.open("/sheets/new", sid=self.GUEST), "/home")

    def test_an_encoded_separator_falls_through(self):
        for old in (
            f"/slides/presentation/view%2F{PRESENTATION}",
            f"/slides/presentation/view%2f{PRESENTATION}",
            f"/drive/t/{TEAM}%5Cf%5C{self.file}",
        ):
            with self.subTest(old=old):
                self.assertFallsThrough(self.open(old))

    def test_a_lookup_that_finds_no_node_falls_through(self):
        for old in ("/sheets/no-such-sheet", "/drive/g/no-such-node", "/drive/t/no-such-team/"):
            with self.subTest(old=old):
                self.assertFallsThrough(self.open(old))

    def test_paths_with_no_row_stay_where_they_are(self):
        for old in (
            "/drive",
            "/drive/trash",
            f"/drive/f/{self.folder}",
            "/suite/setup",
            "/suite/load-error",
            "/mail",
        ):
            with self.subTest(old=old):
                self.assertFallsThrough(self.open(old))

    def test_the_client_copy_matches_the_table(self):
        self.assertEqual(json.loads(redirects.CLIENT_TABLE.read_text()), redirects.client_table())
