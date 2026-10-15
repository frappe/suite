import pycrdt
from frappe.tests import UnitTestCase

from suite.writer import content as writer_content


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
        self.assertEqual(writer_content.SPEC.file_values(state), {"one", "two", "three"})

    def test_a_removed_picture_is_no_longer_named(self):
        doc = pycrdt.Doc()
        doc.apply_update(picture_state({"data-node": "keep"}, {"data-node": "drop"}))
        del doc.get("default", type=pycrdt.XmlFragment).children[0].children[1]
        self.assertEqual(writer_content.SPEC.file_values(doc.get_update()), {"keep"})

    def test_a_state_whose_body_is_not_a_fragment_is_refused(self):
        doc = pycrdt.Doc()
        doc["default"] = pycrdt.Text("hello")
        with self.assertRaises(ValueError):
            writer_content.SPEC.file_values(doc.get_update())

    def test_a_copy_renames_a_bare_id_and_an_embed_url_and_leaves_the_rest(self):
        rule = writer_content.SPEC.rewrite_files({"old": "new"})
        self.assertEqual(rule("old"), "new")
        self.assertEqual(
            rule("/api/method/writer.api.embed.get?id=old"),
            "/api/method/writer.api.embed.get?id=new",
        )
        self.assertEqual(rule("other"), "other")
        self.assertEqual(rule("old school"), "old school")
