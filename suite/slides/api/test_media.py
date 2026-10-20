"""`suite.slides.api.media`: a deck's pictures are Drive media nodes below the deck.

The case that matters is the public link: a guest who can read the deck must
get a signed URL for every picture it shows (T3-21). The refusals pin who may
add media at all.
"""

from contextlib import contextmanager
from io import BytesIO

import frappe
from frappe.tests import IntegrationTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite import drive
from suite.slides import drive as slides_drive
from suite.slides.api import media
from suite.slides.tests.utils import PNG_1PX, make_presentation, make_public, node_of, share, unique_bytes
from suite.tests.utils import ensure_user

OWNER = "slides-media-owner@example.com"
READER = "slides-media-reader@example.com"


@contextmanager
def upload_request(content: bytes, filename: str, mimetype: str = "image/png"):
    builder = EnvironBuilder(
        path="/api/method/suite.slides.api.media.add",
        method="POST",
        data={"file": (BytesIO(content), filename, mimetype)},
    )
    frappe.local.request = Request(builder.get_environ())
    try:
        yield
    finally:
        del frappe.local.request


class TestSlidesMedia(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        ensure_user(READER)

    def setUp(self):
        super().setUp()
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.deck = make_presentation(f"Media {frappe.generate_hash(6)}")

    def upload(self, filename="banner.png", mimetype="image/png", content=None):
        with upload_request(content or unique_bytes(PNG_1PX), filename, mimetype):
            return media.add(self.deck.name)

    def test_a_public_link_guest_can_read_an_uploaded_picture(self):
        content = unique_bytes(PNG_1PX)
        picture = self.upload(content=content)["file_url"]
        make_public(self.deck.name)

        frappe.set_user("Guest")
        stream, mime = drive.read_file(picture)

        self.assertEqual(stream.read(), content)
        self.assertEqual(mime, "image/png")

    def test_the_picture_lives_below_the_deck_and_counts_as_used_once_shown(self):
        picture = self.upload()["file_url"]
        slide = self.deck.slides[0]
        frappe.db.set_value(
            "Slide", slide.name, "elements", frappe.as_json([{"type": "image", "src": picture}])
        )

        self.assertEqual(frappe.db.get_value("Drive Node", picture, "parent_node"), node_of(self.deck.name))
        self.assertIn(picture, slides_drive.used_nodes(self.deck.name))

    def test_a_reader_cannot_add_media(self):
        share(self.deck.name, READER)

        frappe.set_user(READER)
        with self.assertRaises(drive.DriveForbidden):
            self.upload()

    def test_a_file_that_is_not_a_picture_or_video_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            self.upload("notes.txt", "text/plain")
