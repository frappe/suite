"""Reading a presentation's doc back as the old JSON, through the built converter."""

import pycrdt
from frappe.tests import UnitTestCase

from suite.content import convert
from suite.slides.content import CONVERTER_BUILD, CONVERTER_VERSION
from suite.slides.content.converter import deck_json

LEGACY = {
    "collab": 0,
    "slides": [
        {
            "id": "first",
            "background": "#112233",
            "elements": [
                {"id": "title", "type": "text", "content": "<p><strong>Hi</strong></p>", "left": 10},
                {"id": "picture", "type": "image", "src": "/private/files/cat.png", "zIndex": 2},
            ],
        },
        {"id": "second", "transition": "fade", "elements": []},
    ],
}


class TestDeckJson(UnitTestCase):
    def setUp(self):
        if not CONVERTER_BUILD.is_file():
            self.skipTest("needs the built converter bundle")

    def test_answers_the_slides_a_log_makes_with_their_ids(self):
        answer = convert.convert(CONVERTER_BUILD, CONVERTER_VERSION, LEGACY)
        assert isinstance(answer, convert.Converted)
        doc: pycrdt.Doc = pycrdt.Doc()
        doc.apply_update(answer.state)
        slides = doc.get("slides", type=pycrdt.Map)
        before = doc.get_state()
        slides["second"]["background"] = "#445566"
        row = doc.get_update(before)

        deck = deck_json(answer.state, [row])

        self.assertEqual([slide["id"] for slide in deck["slides"]], ["first", "second"])
        first, second = deck["slides"]
        self.assertEqual([element["id"] for element in first["elements"]], ["title", "picture"])
        self.assertEqual(first["background"], "#112233")
        self.assertIn("<strong>Hi</strong>", first["elements"][0]["content"])
        self.assertEqual(first["elements"][1]["src"], "/private/files/cat.png")
        # The row after the checkpoint counts
        self.assertEqual(
            second, {"id": "second", "transition": "fade", "background": "#445566", "elements": []}
        )

    def test_answers_no_slides_for_an_empty_log(self):
        self.assertEqual(deck_json(None, []), {"slides": []})
