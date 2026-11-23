import pycrdt
from frappe.tests import UnitTestCase
from frappe.utils.html_utils import sanitize_html

from suite.content import copies
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
        self.assertTrue(
            writer_content.EDITOR.readable_copy.is_html_complete(linked_state(), HTML, "See the plan")
        )

    def test_a_copy_missing_a_character_does_not_match(self):
        self.assertFalse(
            writer_content.EDITOR.readable_copy.is_html_complete(linked_state(), HTML, "See the pan")
        )

    def test_a_copy_missing_a_link_or_an_image_does_not_match(self):
        no_link = '<p>See the plan</p><img src="/private/files/chart.png">'
        no_image = '<p>See <a href="https://example.com/plan">the plan</a></p>'
        for html in (no_link, no_image):
            with self.subTest(html=html):
                self.assertFalse(
                    writer_content.EDITOR.readable_copy.is_html_complete(linked_state(), html, "See the plan")
                )

    def test_cleans_a_copy_without_embeds_as_frappe_does(self):
        html = (
            '<h1 style="color: red; position: fixed; gap: 4px">Plan</h1>'
            '<p class="lead" data-id="1" onclick="steal()">See <a href="https://example.com" target="_blank">it</a>'
            ' <a href="javascript:steal()">this</a> <a href="mailto:ann@example.com">mail</a>'
            ' <img src="/files/chart.png" alt="Chart" width="10" onerror="steal()"> <img src="cid:part1"></p>'
            "<script>steal()</script><style>p { color: red }</style>"
            '<table><tr><td colspan="2" style="background-image: url(x)">Cell</td></tr></table>'
            '<svg><circle r="1"></circle></svg><object data="/x"></object><!-- note -->'
        )

        clean, _ = copies.cleaned(html)

        self.assertEqual(clean, sanitize_html(html))
