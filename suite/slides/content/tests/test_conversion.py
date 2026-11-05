"""Converting an old deck through the layer: the Slide rows it leaves and the deck it writes (ticket 51)."""

import json
from unittest.mock import patch

import frappe
import pycrdt

from suite import drive
from suite.content import conversions, convert, log
from suite.drive._core import comments
from suite.drive.framework import principals_for
from suite.slides import drive as slides_drive
from suite.slides.api.slides import save_slides
from suite.slides.content import APP, CONVERTER_BUILD
from suite.slides.content.tests.support import OWNER, LoggedDeckCase, delete_log, opened
from suite.slides.doctype.presentation.presentation import get_public_presentation
from suite.slides.patches import move_file_media_to_drive


def text_box(box_id: str, **fields) -> dict:
    return {"id": box_id, "type": "text", "content": "<p>a</p>", "left": 10, "top": 20, **fields}


def converted_deck(node: str) -> pycrdt.Doc:
    _header, state = opened(node)
    doc: pycrdt.Doc = pycrdt.Doc()
    doc.apply_update(state)
    return doc


class ConversionCase(LoggedDeckCase):
    def setUp(self):
        super().setUp()
        if not CONVERTER_BUILD.is_file():
            self.skipTest("needs the built converter bundle")

        job = patch.object(frappe.local, "job", frappe._dict(job_name="test_slides_content"), create=True)
        job.start()
        self.addCleanup(job.stop)

    def old_deck(self, *slides: list[dict], client_ids: list[str] | None = None) -> str:
        # Held in Slide rows alone, as a deck from before collaboration is
        node = self.new_deck()
        delete_log(node)
        docname = slides_drive.docname_for_node(node)
        frappe.db.delete("Slide", {"parent": docname})
        for at, elements in enumerate(slides):
            client_id = f"slide-{at}"
            if client_ids:
                client_id = client_ids[at]

            row = frappe.get_doc(
                doctype="Slide",
                parent=docname,
                parenttype="Presentation",
                parentfield="slides",
                idx=at + 1,
                client_id=client_id,
                elements=json.dumps(elements),
            )
            row.db_insert()

        frappe.db.commit()
        return node

    def rows(self, node: str) -> list[dict]:
        docname = slides_drive.docname_for_node(node)
        return frappe.get_all(
            "Slide", filters={"parent": docname}, fields=["client_id", "elements"], order_by="idx"
        )

    def convert(self, node: str) -> str | None:
        frappe.set_user("Administrator")
        outcome = conversions.convert_document(APP, node)
        frappe.set_user("Administrator")
        return outcome


class TestConversion(ConversionCase):
    def test_a_converted_deck_keeps_its_comments(self):
        node = self.old_deck([text_box("one")])
        reader = principals_for(OWNER)
        comments.create_thread(reader, node, "box", "Move this up")
        before = comments.threads(reader, node)

        self.assertEqual(self.convert(node), "converted")

        after = comments.threads(reader, node)
        self.assertEqual(after, before)
        self.assertEqual(after[0].comments[0].content, "Move this up")

    def test_a_deck_converts_keeping_its_rows_and_the_old_deck_as_a_version(self):
        node = self.old_deck([text_box("one")], [text_box("two")])
        before = self.rows(node)

        self.assertEqual(self.convert(node), "converted")

        self.assertEqual(self.rows(node), before)
        versions = drive.list_versions(node)["rows"]
        kept = next(row for row in versions if row.label == "Before collaboration")
        payload = json.loads(drive.read_version(node, kept.seq).read())
        held = [json.loads(slide["elements"]) for slide in payload["slides"]]
        self.assertEqual([[box["id"] for box in boxes] for boxes in held], [["one"], ["two"]])

    def test_the_deck_holds_every_slide_and_box_in_order_and_an_old_file_url(self):
        url = "/private/files/old-picture.png"
        node = self.old_deck([text_box("one"), {"id": "pic", "type": "image", "src": url}], [text_box("two")])
        self.assertEqual(self.convert(node), "converted")

        doc = converted_deck(node)
        slides = doc.get("slides", type=pycrdt.Map)
        boxes = doc.get("boxes", type=pycrdt.Map)
        self.assertEqual(set(slides.keys()), {"slide-0", "slide-1"})
        self.assertEqual(boxes["one"]["parent"], "slide-0")
        self.assertEqual(boxes["two"]["parent"], "slide-1")
        self.assertEqual(boxes["pic"]["src"], url)
        self.assertLess(slides["slide-0"]["order"], slides["slide-1"]["order"])

    def test_a_repeated_id_is_repaired_and_a_connector_on_its_slide_follows(self):
        ends = {"start": {"elementId": "same"}, "end": {"elementId": "first"}}
        node = self.old_deck(
            [text_box("same"), text_box("first")],
            [text_box("same"), {"id": "line", "type": "shape", "connector": ends}],
            client_ids=["slide", "slide"],
        )
        self.assertEqual(self.convert(node), "converted")

        doc = converted_deck(node)
        slides = doc.get("slides", type=pycrdt.Map)
        boxes = doc.get("boxes", type=pycrdt.Map)
        self.assertEqual(len(slides), 2)
        self.assertEqual(len(boxes), 4)
        self.assertEqual(boxes["same"]["parent"], "slide")
        line = boxes["line"]
        other_slide = line["parent"]
        self.assertNotEqual(other_slide, "slide")
        start = line["connectorStart"]["elementId"]
        self.assertNotEqual(start, "same")
        self.assertEqual(boxes[start]["parent"], other_slide)
        # The end names a box on the first slide, whose id never changed
        self.assertEqual(line["connectorEnd"]["elementId"], "first")

    def test_a_magic_move_link_is_left_alone_when_an_id_is_repaired(self):
        node = self.old_deck(
            [text_box("same", refId="link")], [text_box("same", refId="link")], client_ids=["a", "b"]
        )
        self.assertEqual(self.convert(node), "converted")

        boxes = converted_deck(node).get("boxes", type=pycrdt.Map)
        self.assertEqual({boxes[key]["refId"] for key in boxes.keys()}, {"link"})

    def test_a_deck_with_no_slides_converts(self):
        node = self.old_deck()
        self.assertEqual(self.convert(node), "converted")
        self.assertIsNotNone(log.find(APP, node))

    def test_a_refusal_leaves_the_rows_and_shows_its_reason_to_a_system_manager_only(self):
        for name, slides, detail in (
            ("html", [[text_box("box", content="<h1>a</h1>")]], "html"),
            ("box type", [[{"id": "box", "type": "chart"}]], "box_type"),
            ("setting", [[text_box("box", sparkle=True)]], "setting"),
        ):
            with self.subTest(name):
                node = self.old_deck(*slides)
                before = self.rows(node)

                self.assertEqual(self.convert(node), "check")

                self.assertEqual(self.rows(node), before)
                self.assertIsNone(log.find(APP, node))
                status = conversions.conversion_status(APP, node)
                self.assertEqual(status["state"], "refused")
                self.assertIn(detail, status["reason"])

        frappe.set_user("slides-collab-owner@example.com")
        self.assertNotIn("reason", conversions.conversion_status(APP, node))

    def test_rows_that_do_not_parse_are_refused(self):
        node = self.old_deck([text_box("box")])
        frappe.db.set_value(
            "Slide", {"parent": slides_drive.docname_for_node(node)}, "elements", '"not a list"'
        )
        frappe.db.commit()

        self.assertEqual(self.convert(node), "check")
        self.assertIn("elements", conversions.conversion_status(APP, node)["reason"])

    def test_a_combined_deck_never_waits_to_convert(self):
        node = self.old_deck([text_box("box")])
        docname = slides_drive.docname_for_node(node)
        frappe.db.set_value("Presentation", docname, "is_composite", 1)
        frappe.db.commit()

        version = conversions.conversion_of(APP).version
        pending: list[str] = []
        page = convert.pending_page(APP, version, None)
        while page:
            pending += [row.node for row in page]
            page = convert.pending_page(APP, version, page[-1])

        self.assertNotIn(node, pending)
        self.assertIsNone(conversions.conversion_of(APP).read_old(node))


class TestOldPathsOnAConvertedDeck(ConversionCase):
    def test_save_slides_is_refused_and_writes_nothing(self):
        node = self.old_deck([text_box("box")])
        self.convert(node)
        docname = slides_drive.docname_for_node(node)
        before = self.rows(node)
        modified = str(frappe.db.get_value("Presentation", docname, "modified"))

        with self.assertRaises(drive.DriveConflict):
            save_slides(docname, [{"client_id": "new", "elements": "[]"}], modified)

        self.assertEqual(self.rows(node), before)

    def test_a_retry_of_the_media_patch_leaves_a_converted_decks_rows(self):
        converted_node = self.old_deck([{"id": "pic", "type": "image", "src": "/private/files/old.png"}])
        self.convert(converted_node)
        waiting = self.old_deck([text_box("box")])
        moved: list[str] = []

        with patch.object(
            move_file_media_to_drive, "convert_deck", lambda docname, node: moved.append(node) or {}
        ):
            move_file_media_to_drive.execute()

        self.assertIn(waiting, moved)
        self.assertNotIn(converted_node, moved)


class TestDeckRoute(ConversionCase):
    def test_a_waiting_deck_says_it_waits(self):
        node = self.old_deck([text_box("box")])

        answer = get_public_presentation(slides_drive.docname_for_node(node))

        self.assertEqual(answer["conversion"]["state"], "pending")
        self.assertNotIn("is_converted", answer)

    def test_a_converted_deck_says_so(self):
        node = self.old_deck([text_box("box")])
        self.convert(node)

        answer = get_public_presentation(slides_drive.docname_for_node(node))

        self.assertTrue(answer["is_converted"])
        self.assertNotIn("conversion", answer)

    def test_only_a_system_manager_gets_the_reason_for_a_refusal(self):
        node = self.old_deck([text_box("box", content="<h1>a</h1>")])
        self.convert(node)
        docname = slides_drive.docname_for_node(node)

        self.assertEqual(get_public_presentation(docname)["conversion"]["reason"], "check: html")

        frappe.set_user(OWNER)
        self.assertEqual(get_public_presentation(docname)["conversion"], {"state": "refused"})

    def test_a_combined_deck_never_waits(self):
        node = self.old_deck([text_box("box")])
        docname = slides_drive.docname_for_node(node)
        frappe.db.set_value("Presentation", docname, "is_composite", 1)

        answer = get_public_presentation(docname)

        self.assertNotIn("conversion", answer)
        self.assertNotIn("is_converted", answer)
