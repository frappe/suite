"""A Drive share link opens a deck and its pictures for a guest (§6.3, §6.8).

`/d/<node>` sends the codes the browser holds in `X-Drive-Links`. The deck,
its access answer and the signed URLs of its media are all read through that
header; a guest without it is refused. The link is made through Drive's own
share route, as the share dialog makes it.
"""

from contextlib import contextmanager
from io import BytesIO

import frappe
from frappe.tests import IntegrationTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite import drive
from suite.drive.http import routes as drive_routes
from suite.slides.api import media
from suite.slides.doctype.presentation import presentation
from suite.slides.tests.utils import PNG_1PX, make_presentation, node_of, unique_bytes
from suite.tests.utils import ensure_user

OWNER = "slides-link-owner@example.com"
REFUSED = (frappe.PermissionError, drive.DriveError)


@contextmanager
def request(path: str, **kwargs):
    previous = getattr(frappe.local, "request", None)
    frappe.local.request = Request(EnvironBuilder(path=path, **kwargs).get_environ())
    try:
        yield
    finally:
        frappe.local.request = previous


def link_header(*codes: str):
    """Carry link codes in `X-Drive-Links`, as the `/d/` surface does."""
    return request("/api/method/get_public_presentation", headers={"X-Drive-Links": ",".join(codes)})


class TestDeckThroughAShareLink(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)

    def setUp(self):
        super().setUp()
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")

    def deck_with_a_picture(self, **fields):
        deck = make_presentation(f"Linked {frappe.generate_hash(6)}", **fields)
        upload = {"file": (BytesIO(unique_bytes(PNG_1PX)), "banner.png", "image/png")}
        with request("/api/method/suite.slides.api.media.add", method="POST", data=upload):
            picture = media.add(deck.name)["file_url"]
        return deck.name, picture

    def view_link(self, deck: str) -> str:
        grant = drive_routes.node_put_grant(node=node_of(deck), principal="$LINK", role=drive.READ)
        return grant["principal"].removeprefix("$LINK:")

    def test_a_guest_with_a_view_link_opens_the_deck_and_its_pictures(self):
        deck, picture = self.deck_with_a_picture()
        code = self.view_link(deck)

        frappe.set_user("Guest")
        with link_header(code):
            opened = presentation.get_public_presentation(deck)
            access = presentation.get_editor_access(deck)
            listed = drive_routes.node_media(node=node_of(deck))["media"]
            stream, mime = drive.read_file(picture)

        self.assertEqual(opened["name"], deck)
        self.assertEqual(access, "view")
        self.assertEqual([row["node"] for row in listed], [picture])
        self.assertTrue(listed[0]["url"])
        self.assertTrue(stream.read())
        self.assertTrue(mime.startswith("image/"))

    def test_a_guest_with_view_links_opens_a_composite_deck_and_the_deck_it_shows(self):
        source, _picture = self.deck_with_a_picture()
        composite = make_presentation(
            f"Composite {frappe.generate_hash(6)}",
            is_composite=1,
            reference_presentations=[{"presentation": source}],
        ).name
        codes = (self.view_link(composite), self.view_link(source))

        frappe.set_user("Guest")
        with link_header(*codes):
            opened = presentation.get_composite_presentation(composite)

        self.assertEqual(opened["name"], composite)
        self.assertEqual([row["readable"] for row in opened["references"]], [True])
        self.assertEqual({slide.parent for slide in opened["slides"]}, {source})

    def test_a_guest_without_the_link_is_refused_the_deck_and_its_pictures(self):
        deck, picture = self.deck_with_a_picture()
        self.view_link(deck)

        frappe.set_user("Guest")
        for name, read in (
            ("deck", lambda: presentation.get_public_presentation(deck)),
            ("media list", lambda: drive_routes.node_media(node=node_of(deck))),
            ("picture", lambda: drive.read_file(picture)),
        ):
            with self.subTest(name), self.assertRaises(REFUSED):
                read()
        self.assertEqual(presentation.get_editor_access(deck), "none")
