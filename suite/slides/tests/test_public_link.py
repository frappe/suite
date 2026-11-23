"""A Drive share link opens a deck and its pictures for a guest (§6.3, §6.8).

`/d/<node>` sends the codes the browser holds in `X-Drive-Links`. The deck,
its access answer and the signed URLs of its media are all read through that
header; a guest without it is refused. The link is made through Drive's own
share route, as the share dialog makes it. Those Drive calls are whole requests,
which run on their own connection, so each side commits before the other reads.
"""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.tests.test_api import make_request
from frappe.utils import get_test_client

from suite import drive
from suite.slides.api import media
from suite.slides.doctype.presentation import presentation
from suite.slides.tests.utils import (
    PNG_1PX,
    link_header,
    make_presentation,
    node_of,
    unique_bytes,
    upload_request,
)
from suite.tests.utils import ensure_user, session_for

OWNER = "slides-link-owner@example.com"
DRIVE = "/api/suite/drive"
REFUSED = (frappe.PermissionError, drive.DriveError)


class TestDeckThroughAShareLink(IntegrationTestCase):
    CLIENT = get_test_client(use_cookies=False)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")

    def _send(self, method: str, path: str, *, headers: dict, body: dict | None = None):
        kwargs: dict = {"method": method, "headers": headers}
        if body is not None:
            kwargs["json"] = body
        response = make_request(target=self.CLIENT.open, args=(f"{DRIVE}/{path}",), kwargs=kwargs)
        frappe.db.rollback()
        return response

    def _as_owner(self, method: str, path: str, body: dict | None = None):
        return self._send(method, path, headers={"Cookie": f"sid={session_for(OWNER)}"}, body=body)

    def _purge(self, node: str):
        self._as_owner("PATCH", f"nodes/{node}", {"state": "Trashed"})
        self._as_owner("DELETE", f"nodes/{node}")

    def media_of(self, deck: str, *codes: str):
        """List a deck's media as a guest holding `codes`."""
        headers = {"X-Drive-Links": ",".join(codes)} if codes else {}
        return self._send("GET", f"nodes/{node_of(deck)}/media", headers=headers)

    def deck(self, **fields) -> str:
        deck = make_presentation(f"Linked {frappe.generate_hash(6)}", **fields).name
        frappe.db.commit()
        self.addCleanup(self._purge, node_of(deck))
        return deck

    def deck_with_a_picture(self):
        deck = self.deck()
        with upload_request(unique_bytes(PNG_1PX)):
            picture = media.add(deck)["file_url"]
        frappe.db.commit()
        return deck, picture

    def view_link(self, deck: str) -> str:
        response = self._as_owner("PUT", f"nodes/{node_of(deck)}/grants/$LINK", {"role": drive.READ})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.json["data"]["principal"].removeprefix("$LINK:")

    def test_a_guest_with_a_view_link_opens_the_deck_and_its_pictures(self):
        deck, picture = self.deck_with_a_picture()
        code = self.view_link(deck)

        listed = self.media_of(deck, code).json["data"]["media"]
        frappe.set_user("Guest")
        with link_header(code):
            opened = presentation.get_public_presentation(deck)
            access = presentation.get_editor_access(deck)
            stream, mime = drive.read_file(picture)

        self.assertEqual(opened["name"], deck)
        self.assertEqual(access, "view")
        self.assertEqual([row["node"] for row in listed], [picture])
        self.assertTrue(listed[0]["url"])
        self.assertTrue(stream.read())
        self.assertEqual(mime, "image/webp")

    def test_a_guest_with_view_links_opens_a_composite_deck_and_the_deck_it_shows(self):
        source, _picture = self.deck_with_a_picture()
        composite = self.deck(is_composite=1, reference_presentations=[{"presentation": source}])
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

        self.assertEqual(self.media_of(deck).status_code, 404)
        frappe.set_user("Guest")
        for name, read in (
            ("deck", lambda: presentation.get_public_presentation(deck)),
            ("picture", lambda: drive.read_file(picture)),
        ):
            with self.subTest(name), self.assertRaises(REFUSED):
                read()
        self.assertEqual(presentation.get_editor_access(deck), "none")
