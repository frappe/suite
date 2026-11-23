import pycrdt
from frappe.tests import UnitTestCase

from suite.writer import content as writer_content
from suite.writer.content import files


def picture_state(*attributes: dict) -> bytes:
    doc = pycrdt.Doc()
    body = doc.get("default", type=pycrdt.XmlFragment)
    paragraph = body.children.append(pycrdt.XmlElement("paragraph"))
    for attrs in attributes:
        paragraph.children.append(pycrdt.XmlElement("image", attrs))

    return doc.get_update()


class TestFiles(UnitTestCase):
    def test_a_state_names_the_nodes_of_its_pictures_in_every_spelling(self):
        state = picture_state(
            {"src": "/api/method/writer.api.embed.get?id=one"},
            {"src": "https://x.example/api/method/suite.drive.api.embed.get_file_content?embed_name=two"},
            {"data-node": "three"},
        )
        self.assertEqual(writer_content.EDITOR.media.node_ids(state), {"one", "two", "three"})

    def test_a_removed_picture_is_no_longer_named(self):
        doc = pycrdt.Doc()
        doc.apply_update(picture_state({"data-node": "keep"}, {"data-node": "drop"}))
        del doc.get("default", type=pycrdt.XmlFragment).children[0].children[1]
        self.assertEqual(writer_content.EDITOR.media.node_ids(doc.get_update()), {"keep"})

    def test_a_state_whose_body_is_not_a_fragment_is_refused(self):
        doc = pycrdt.Doc()
        doc["default"] = pycrdt.Text("hello")
        with self.assertRaises(ValueError):
            writer_content.EDITOR.media.node_ids(doc.get_update())

    def test_a_copy_renames_a_bare_id_and_an_embed_url_and_leaves_the_rest(self):
        rule = writer_content.EDITOR.media.value_rewriter({"old": "new"})
        self.assertEqual(rule("old"), "new")
        self.assertEqual(
            rule("/api/method/writer.api.embed.get?id=old"),
            "/api/method/writer.api.embed.get?id=new",
        )
        self.assertEqual(rule("other"), "other")
        self.assertEqual(rule("old school"), "old school")

    def test_a_copy_renames_writer_html_as_the_html_copy_does(self):
        html = (
            '<p>See <img src="/api/method/writer.api.embed.get?id=old"></p>'
            '<img src="/api/method/drive.api.embed.get_file_content?embed_name=old"><img data-node="old">'
        )
        mapping = {"old": "new"}
        self.assertEqual(
            writer_content.EDITOR.media.value_rewriter(mapping)(html), files.remap_text(html, mapping)
        )

    def test_only_a_value_that_is_a_bare_id_is_renamed_unlike_the_html_copy(self):
        mapping = {"old": "new"}
        self.assertEqual(writer_content.EDITOR.media.value_rewriter(mapping)("old"), "new")
        self.assertEqual(files.remap_text("old", mapping), "old")
