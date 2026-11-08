import pycrdt
from frappe.tests import UnitTestCase

from suite.content import compaction, updates
from suite.slides import content as slides_content

MEDIA = slides_content.EDITOR.media
PICTURES = {"image-src", "video-poster", "slide-background", "nested-poster", "attribute-src"}
COPIES = {name: f"copy-of-{name}" for name in PICTURES}


def box_on_slide(boxes: pycrdt.Map, box_id: str) -> pycrdt.Map:
    box = pycrdt.Map()
    boxes[box_id] = box
    box["parent"] = "slide1"
    return box


def shape_with_body(boxes: pycrdt.Map) -> None:
    body = pycrdt.XmlFragment()
    box_on_slide(boxes, "shape1")["text"] = body
    paragraph = body.children.append(pycrdt.XmlElement("paragraph"))
    paragraph.children.append(pycrdt.XmlElement("image", {"src": "attribute-src"}))
    words = paragraph.children.append(pycrdt.XmlText())
    words += "image-src"


def deck_with_pictures() -> bytes:
    doc: pycrdt.Doc = pycrdt.Doc()
    doc["slides"] = pycrdt.Map({"slide1": pycrdt.Map({"background": "slide-background"})})
    boxes = pycrdt.Map()
    doc["boxes"] = boxes
    box_on_slide(boxes, "image1")["src"] = "image-src"
    video = box_on_slide(boxes, "video1")
    video["poster"] = "video-poster"
    video["crop"] = {"deeper": [{"poster": "nested-poster"}]}
    shape_with_body(boxes)
    return doc.get_update()


def text_of(state: bytes) -> str:
    doc = compaction.load_doc([state])
    return str(doc.get("boxes", type=pycrdt.Map)["shape1"]["text"])


class TestDeckPictures(UnitTestCase):
    def test_a_deck_names_each_picture_wherever_it_is_held(self):
        self.assertLessEqual(PICTURES, MEDIA.node_ids(deck_with_pictures()))

    def test_item_keys_and_values_that_cannot_be_ids_are_not_counted(self):
        doc: pycrdt.Doc = pycrdt.Doc()
        doc["slides"] = pycrdt.Map({"slide1": pycrdt.Map({"background": "#ffffff"})})
        doc["boxes"] = pycrdt.Map()
        self.assertEqual(MEDIA.node_ids(doc.get_update()), set())

    def test_a_copy_renames_each_picture_wherever_it_is_held(self):
        renamed = updates.rewrite_values(deck_with_pictures(), MEDIA.value_rewriter(COPIES))
        found = MEDIA.node_ids(renamed)
        self.assertLessEqual(set(COPIES.values()), found)
        self.assertFalse(PICTURES & found)

    def test_text_equal_to_an_id_is_neither_counted_nor_renamed(self):
        doc: pycrdt.Doc = pycrdt.Doc()
        body = pycrdt.XmlFragment()
        doc["boxes"] = pycrdt.Map({"shape1": pycrdt.Map({"text": body})})
        paragraph = body.children.append(pycrdt.XmlElement("paragraph"))
        words = paragraph.children.append(pycrdt.XmlText())
        words += "image-src"
        self.assertNotIn("image-src", MEDIA.node_ids(doc.get_update()))

        renamed = updates.rewrite_values(deck_with_pictures(), MEDIA.value_rewriter(COPIES))
        self.assertIn(">image-src<", text_of(renamed))

    def test_a_stray_root_raises(self):
        doc: pycrdt.Doc = pycrdt.Doc()
        doc["stray"] = pycrdt.Map({"src": "image-src"})
        with self.assertRaises(compaction.CompactionFailed):
            MEDIA.node_ids(doc.get_update())

    def test_unreadable_bytes_raise(self):
        with self.assertRaises(BaseException):
            MEDIA.node_ids(b"\xff\xff not a state")
