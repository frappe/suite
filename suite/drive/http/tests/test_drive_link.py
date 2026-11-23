"""`/l/<token>` opens the node a share link addresses (Drive §6.2, unified §10.1).

Two seams. `drive.node_url` is the one place the server spells a node's
address. The website route is tested as a whole request through Frappe's WSGI
application, so the rule in `hooks.py`, the page, and the redirect are all in
the path.
"""

from html import unescape

import frappe

from suite import drive
from suite.drive._core.access import grant
from suite.drive._core.nodes import create_link
from suite.drive._core.roles import READ
from suite.drive.http.tests.test_dispatch import OWNER, DriveHTTPCase

PAST = "2000-01-01 00:00:00"


class TestNodeUrl(DriveHTTPCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.link_node = create_link(cls.owner, cls.folder, "Site", url="https://example.com")
        frappe.db.commit()

    def test_a_container_opens_the_folder_route_and_anything_else_the_document_route(self):
        expected = {
            self.root.name: f"/drive/f/{self.root.name}",
            self.folder: f"/drive/f/{self.folder}",
            self.file: f"/d/{self.file}",
            self.document: f"/d/{self.document}",
            self.link_node: f"/d/{self.link_node}",
        }
        self.assertEqual({node: drive.node_url(node) for node in expected}, expected)

    def test_an_unknown_node_has_no_address(self):
        with self.assertRaises(drive.DriveNotFound):
            drive.node_url("no-such-node")


class TestShareLinkRoute(DriveHTTPCase):
    def link(self, node: str) -> tuple[dict, str]:
        created = grant(node, "$LINK", READ, self.owner)
        frappe.db.commit()
        self.addCleanup(self.revoke, created["name"])
        return created, created["principal"].removeprefix("$LINK:")

    def revoke(self, name: str) -> None:
        frappe.db.rollback()
        frappe.db.delete("Drive Grant", {"name": name})
        frappe.db.commit()

    def open(self, path: str):
        return self.drive("GET", path)

    def assertRedirect(self, response, location: str) -> None:
        self.assertEqual(response.status_code, 302, response.get_data(as_text=True))
        self.assertEqual(response.headers["Location"], location)

    def test_a_folder_link_opens_the_folder_with_the_token_in_the_fragment(self):
        _created, token = self.link(self.folder)
        self.assertRedirect(self.open(f"/l/{token}"), f"/drive/f/{self.folder}#link={token}")

    def test_a_file_link_opens_the_document_route_with_the_token_in_the_fragment(self):
        _created, token = self.link(self.file)
        self.assertRedirect(self.open(f"/l/{token}"), f"/d/{self.file}#link={token}")

    def test_the_old_address_is_sent_to_the_new_one(self):
        _created, token = self.link(self.file)
        # The composition redirect table answers before the page does.
        self.assertRedirect(self.open(f"/drive/l/{token}"), f"/l/{token}")

    def assertRefused(self, response, status: int) -> None:
        # The page answers, not Frappe's own not-found page for an unrouted path.
        self.assertEqual(response.status_code, status)
        self.assertIn("Link unavailable", response.get_data(as_text=True))

    def test_an_unknown_token_is_not_found_and_an_expired_one_is_gone(self):
        self.assertRefused(self.open(f"/l/{'a' * 22}"), 404)
        created, token = self.link(self.folder)
        frappe.db.set_value("Drive Grant", created["name"], "expires_on", PAST, update_modified=False)
        frappe.db.commit()
        self.assertRefused(self.open(f"/l/{token}"), 410)


class TestDeadLinkPage(DriveHTTPCase):
    """The page a refused link shows (unified frontend §10.11, ask S2)."""

    link = TestShareLinkRoute.link
    revoke = TestShareLinkRoute.revoke

    NOT_FOUND = "This link doesn't work. It may be mistyped, or its owner turned it off."
    EXPIRED = "This link has expired. Ask the person who shared it for a new one."
    UNKNOWN = f"/l/{'a' * 22}"

    def expired_link(self) -> str:
        created, token = self.link(self.folder)
        frappe.db.set_value("Drive Grant", created["name"], "expires_on", PAST, update_modified=False)
        frappe.db.commit()
        return f"/l/{token}"

    def page(self, path: str, status: int, *, sid: str | None = None) -> str:
        response = self.drive("GET", path, sid=sid)
        self.assertEqual(response.status_code, status)
        return unescape(response.get_data(as_text=True))

    def test_each_refusal_has_its_own_copy_and_no_node_details(self):
        missing = self.page(self.UNKNOWN, 404)
        self.assertIn(self.NOT_FOUND, missing)
        self.assertNotIn(self.EXPIRED, missing)

        expired = self.page(self.expired_link(), 410)
        self.assertIn(self.EXPIRED, expired)
        self.assertNotIn(self.NOT_FOUND, expired)
        self.assertNotIn("Folder", expired)
        self.assertNotIn(self.folder, expired)

    def test_a_visitor_without_a_session_gets_no_home_and_no_sign_in(self):
        body = self.page(self.UNKNOWN, 404)
        self.assertNotIn("Go to Home", body)
        self.assertNotIn("/login", body)
        self.assertNotIn("Sign in", body)

    def test_a_signed_in_visitor_can_go_to_home(self):
        sid = self.session_for(OWNER)
        expired = self.expired_link()
        for path, status in ((self.UNKNOWN, 404), (expired, 410)):
            with self.subTest(status=status):
                body = self.page(path, status, sid=sid)
                self.assertIn('<a class="home" href="/home">Go to Home</a>', body)
