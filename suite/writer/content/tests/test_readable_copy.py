import base64

import pycrdt
from frappe.tests import UnitTestCase

from suite.writer import content as writer_content


def linked_state() -> bytes:
    doc = pycrdt.Doc()
    body = doc.get("default", type=pycrdt.XmlFragment)
    paragraph = body.children.append(pycrdt.XmlElement("paragraph"))
    text = paragraph.children.append(pycrdt.XmlText())
    text.insert(0, "See ")
    text.insert(4, "the plan", {"link": {"href": "https://example.com/plan"}})
    body.children.append(pycrdt.XmlElement("image", {"src": "/private/files/chart.png"}))
    return doc.get_update()


HTML = '<p>See <a href="https://example.com/plan">the plan</a></p><img src="/private/files/chart.png">'


class TestReadableCopy(UnitTestCase):
    def test_a_copy_with_every_character_link_and_image_of_the_state_matches_it(self):
        self.assertTrue(writer_content.SPEC.check_copy(linked_state(), HTML, "See the plan"))

    def test_a_copy_missing_a_character_does_not_match(self):
        self.assertFalse(writer_content.SPEC.check_copy(linked_state(), HTML, "See the pan"))

    def test_a_copy_missing_a_link_or_an_image_does_not_match(self):
        no_link = '<p>See the plan</p><img src="/private/files/chart.png">'
        no_image = '<p>See <a href="https://example.com/plan">the plan</a></p>'
        for html in (no_link, no_image):
            with self.subTest(html=html):
                self.assertFalse(writer_content.SPEC.check_copy(linked_state(), html, "See the plan"))

    def test_an_old_body_converts_to_the_state_it_holds(self):
        doc = pycrdt.Doc()
        doc.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlText("kept"))
        old_body = base64.b64encode(doc.get_update()).decode()

        converted = pycrdt.Doc()
        converted.apply_update(writer_content.SPEC.convert(old_body))

        self.assertEqual(str(converted.get("default", type=pycrdt.XmlFragment)), "kept")
