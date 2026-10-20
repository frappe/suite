"""`move_file_media_to_drive`: a deck's File-backed pictures become media nodes below it."""

import frappe
from frappe.tests import IntegrationTestCase

from suite.slides.patches.move_file_media_to_drive import convert_deck
from suite.slides.tests.utils import make_presentation, make_private_image, node_of
from suite.tests.utils import ensure_user

OWNER = "slides-media-patch@example.com"


class TestMoveFileMediaToDrive(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        ensure_user(OWNER)
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.deck = make_presentation(f"Legacy media {frappe.generate_hash(6)}")
        self.file = make_private_image(self.deck.name)
        self.slide = self.deck.slides[0].name

    def write_body(self, background, elements):
        frappe.db.set_value(
            "Slide", self.slide, {"background": background, "elements": frappe.as_json(elements)}
        )

    def body(self):
        row = frappe.db.get_value("Slide", self.slide, ["background", "elements"], as_dict=True)
        return row.background, frappe.parse_json(row.elements)

    def test_every_legacy_url_in_the_body_becomes_one_media_node_below_the_deck(self):
        url = self.file.file_url
        self.write_body(
            url, [{"type": "image", "src": url}, {"type": "video", "src": "/files/gone.mp4", "poster": url}]
        )

        frappe.set_user("Administrator")
        convert_deck(self.deck.name, node_of(self.deck.name))

        background, elements = self.body()
        picture = elements[0]["src"]
        self.assertEqual(frappe.db.get_value("Drive Node", picture, "parent_node"), node_of(self.deck.name))
        self.assertEqual(background, picture)
        self.assertEqual(elements[1]["poster"], picture)
        # a URL with no File behind it is left for the legacy read path
        self.assertEqual(elements[1]["src"], "/files/gone.mp4")

    def test_a_second_run_finds_nothing_left_to_convert(self):
        self.write_body("#ffffffff", [{"type": "image", "src": self.file.file_url}])

        frappe.set_user("Administrator")
        convert_deck(self.deck.name, node_of(self.deck.name))
        _, converted = self.body()

        self.assertEqual(convert_deck(self.deck.name, node_of(self.deck.name)), {})
        self.assertEqual(self.body()[1], converted)
