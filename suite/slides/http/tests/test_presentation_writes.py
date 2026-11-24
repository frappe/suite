import base64
import gzip
import json
import os
import re
import uuid
from collections.abc import Iterable
from unittest.mock import patch

import frappe
import pycrdt
from frappe.utils.synchronization import filelock

from suite import drive
from suite.content import checker, compaction, convert
from suite.slides import content as slides_content
from suite.slides.content.agent import SlidesRefused, WriteBusy, WriteRefused
from suite.slides.content.tests.support import LoggedDeckCase, call_route, delete_log, opened, owner_folder
from suite.slides.drive import docname_for_node
from suite.slides.http import routes as slides_routes
from suite.slides.tests.utils import share, trash_node
from suite.tests.utils import ensure_user

READER = "slides-agent-reader@example.com"
OUTSIDER = "slides-agent-outsider@example.com"
ATTRIBUTE = re.compile(r' \w+="[^"]*"')


def in_order(items: Iterable[tuple[str, pycrdt.Map]]) -> list[tuple[str, pycrdt.Map]]:
    return sorted(items, key=lambda pair: (pair[1].get("order") or "", pair[0]))


def on_slide(elements: pycrdt.Map, slide_id: str) -> list[tuple[str, pycrdt.Map]]:
    return [(key, item) for key, item in elements.items() if item.get("parent") == slide_id]


def element_fields(item: pycrdt.Map) -> dict:
    # The text's attributes are left out, so a test reads the words and marks
    fields = {key: value for key, value in item.items() if key not in {"order", "parent"}}
    if "text" in fields:
        fields["text"] = ATTRIBUTE.sub("", str(fields["text"]))

    return fields


def title_slide(text: str = "Plan for <strong>today</strong>", **fields) -> dict:
    return {
        "background": "#FFFFFFFF",
        "elements": [{"type": "text", "left": 80, "top": 200, "content": f"<p>{text}</p>"}],
        **fields,
    }


def shape_slide() -> dict:
    return {"transition": "Fade", "elements": [box_shape(), line_from_box()]}


def box_shape() -> dict:
    return {
        "id": "box",
        "type": "shape",
        "shapeType": "rectangle",
        "left": 100,
        "top": 100,
        "width": 300,
        "height": 200,
        "fillColor": "#EEEEEEFF",
        "strokeColor": "#595959FF",
        "strokeWidth": 2,
        "content": "<p>Inside</p>",
    }


def line_from_box() -> dict:
    return {
        "type": "shape",
        "shapeType": "line",
        "left": 400,
        "top": 200,
        "width": 200,
        "height": 2,
        "strokeWidth": 2,
        "connector": {"route": "straight", "start": {"elementId": "box", "anchor": "right"}, "end": None},
    }


class TestPresentationWrites(LoggedDeckCase):
    def setUp(self):
        super().setUp()
        if not checker.usable_node(convert.NODE_MIN) or not slides_content.CONVERTER_BUILD.is_file():
            reason = f"needs Node and the built bundle at {slides_content.CONVERTER_BUILD}; run bench build"
            # A skip in CI would leave the job green with agents unable to write
            if os.environ.get("CI"):
                self.fail(reason)

            self.skipTest(reason)

        self.folder = owner_folder()

    def create(self, slides: list[dict], title: str | None = None) -> str:
        title = title or f"Agent {uuid.uuid4().hex[:8]}"
        node = slides_routes.presentation_create(self.folder, title, slides)["name"]
        self.addCleanup(trash_node, node)
        self.addCleanup(delete_log, node)
        return node

    def deck_of(self, node: str) -> list[dict]:
        # The presentation a tab opens: each slide's fields and its elements' fields and text, in order
        _header, state = opened(node)
        return self.slides_in(state)

    def slides_in(self, state: bytes) -> list[dict]:
        doc = compaction.load_doc([state])
        slides = doc.get("slides", type=pycrdt.Map)
        elements = doc.get("elements", type=pycrdt.Map)
        deck: list[dict] = []
        for slide_id, slide in in_order(slides.items()):
            fields = dict(slide.items())
            del fields["order"]
            on_this = in_order(on_slide(elements, slide_id))
            fields["elements"] = [element_fields(item) for _id, item in on_this]
            deck.append(fields)

        return deck

    def texts_of(self, node: str) -> list[list[str]]:
        return [[element.get("text") for element in slide["elements"]] for slide in self.deck_of(node)]

    def kept_versions(self, node: str) -> list[dict]:
        return [row for row in drive.list_versions(node)["rows"] if row["kind"] == "milestone"]

    def version_texts(self, node: str, seq: int) -> list[list[str]]:
        with drive.read_version(node, seq) as stream:
            state = gzip.decompress(base64.b64decode(json.loads(stream.read())["state"]))

        deck = self.slides_in(state)
        return [[element.get("text") for element in slide["elements"]] for slide in deck]

    def assert_created_nothing(self, title: str) -> None:
        self.assertFalse(frappe.db.exists("Drive Node", {"parent_node": self.folder, "title": title}))

    def test_a_new_presentation_holds_the_slides_in_order(self):
        node = self.create([title_slide(), shape_slide()])

        title, shapes = self.deck_of(node)
        self.assertEqual(title["background"], "#FFFFFFFF")
        (text,) = title["elements"]
        self.assertEqual(text["type"], "text")
        self.assertEqual(text["text"], "<paragraph>Plan for <bold>today</bold></paragraph>")
        self.assertEqual((text["frame"]["left"], text["frame"]["top"]), (80, 200))
        self.assertEqual(shapes["transition"], "Fade")
        box, line = shapes["elements"]
        self.assertEqual(
            (box["shapeType"], box["frame"]["width"], box["text"]),
            ("rectangle", 300, "<paragraph>Inside</paragraph>"),
        )
        # The line's connector holds on to the box under the id it was given
        self.assertEqual(line["connectorStart"], {"elementId": "box", "anchor": "right"})

    def test_a_write_answers_the_presentation_and_the_rev_it_made(self):
        title = f"Agent {uuid.uuid4().hex[:8]}"
        node = self.create([title_slide()], title)

        first = slides_routes.presentation_write(node, [title_slide("Second")], "replace")
        second = slides_routes.presentation_write(node, [title_slide("Third")], "replace")

        self.assertEqual(
            (first["name"], first["title"], first["parent_node"], first["content_doctype"]),
            (node, title, self.folder, "Presentation"),
        )
        # Each write is a push of its own, so the rev it answers moves on
        self.assertGreater(second["rev"], first["rev"])

    def test_replace_leaves_only_the_new_slides(self):
        node = self.create([title_slide("First"), shape_slide()])

        slides_routes.presentation_write(node, [title_slide("Only this")], "replace")

        self.assertEqual(self.texts_of(node), [["<paragraph>Only this</paragraph>"]])

    def test_a_replace_keeps_a_version_of_what_a_person_made(self):
        node = self.create([title_slide("First")])

        def add_slide(doc: pycrdt.Doc) -> None:
            doc.get("slides", type=pycrdt.Map)["by-hand"] = pycrdt.Map({"order": "z"})

        status, _body = self.push(node, add_slide)
        self.assertEqual(status, 200)

        slides_routes.presentation_write(node, [title_slide("Only this")], "replace")

        (kept,) = self.kept_versions(node)
        self.assertEqual(kept["label"], "Before a replace from JSON")
        self.assertEqual(self.version_texts(node, kept["seq"]), [["<paragraph>First</paragraph>"], []])

    def test_a_replace_that_can_keep_no_version_writes_nothing(self):
        node = self.create([title_slide("First")])
        full = drive.DriveOverQuota("The drive is full")

        with (
            patch.object(drive, "take_version", side_effect=full),
            self.assertRaisesRegex(WriteRefused, "No version could be kept"),
        ):
            slides_routes.presentation_write(node, [title_slide("Only this")], "replace")

        self.assertEqual(self.texts_of(node), [["<paragraph>First</paragraph>"]])

    def test_slides_the_converter_refuses_create_nothing(self):
        cases = {
            "a field no element has": [{"elements": [{"type": "text", "content": "<p>x</p>", "wobble": 1}]}],
            "html the editor can't keep": [
                {"elements": [{"type": "text", "content": "<p>x</p><iframe></iframe>"}]}
            ],
            "a type no element has": [{"elements": [{"type": "chart"}]}],
        }
        for case, slides in cases.items():
            with self.subTest(case), self.assertRaisesRegex(SlidesRefused, "A presentation can't keep"):
                slides_routes.presentation_create(self.folder, "Agent refused", slides)

        self.assert_created_nothing("Agent refused")

    def test_slides_that_are_not_slides_name_what_is_wrong(self):
        cases = [
            ("slides must be a list", "nothing"),
            ("slides must be a list", []),
            ("Slide 1 is not an object", ["slide"]),
            ("a slide has no place for: notes", [{"notes": "x"}]),
            ("elements must be a list of objects", [{"elements": ["text"]}]),
            ("Leave it out to get a new one", [{"id": "a slide", "elements": []}]),
        ]
        for message, slides in cases:
            with self.subTest(message), self.assertRaisesRegex(SlidesRefused, message):
                slides_routes.presentation_create(self.folder, "Agent refused", slides)

        self.assert_created_nothing("Agent refused")

    def test_a_refused_replace_leaves_the_presentation_as_it_was(self):
        node = self.create([title_slide("First")])

        with self.assertRaises(SlidesRefused):
            slides_routes.presentation_write(node, [{"elements": [{"type": "chart"}]}], "replace")

        self.assertEqual(self.texts_of(node), [["<paragraph>First</paragraph>"]])
        self.assertEqual(self.kept_versions(node), [])

    def test_a_reader_cannot_write(self):
        ensure_user(READER)
        node = self.create([title_slide("First")])
        share(docname_for_node(node), READER, drive.READ)
        frappe.db.commit()
        frappe.set_user(READER)

        with self.assertRaises(drive.DriveForbidden):
            slides_routes.presentation_write(node, [title_slide("Second")], "replace")

        frappe.set_user("Administrator")
        self.assertEqual(self.texts_of(node), [["<paragraph>First</paragraph>"]])

    def test_an_outsider_finds_no_presentation(self):
        ensure_user(OUTSIDER)
        node = self.create([title_slide("First")])
        frappe.set_user(OUTSIDER)

        with self.assertRaises(drive.DriveNotFound):
            slides_routes.presentation_write(node, [title_slide("Second")], "replace")

        with self.assertRaises((drive.DriveNotFound, drive.DriveForbidden)):
            slides_routes.presentation_create(self.folder, "Agent refused", [title_slide()])

        frappe.set_user("Administrator")
        self.assert_created_nothing("Agent refused")

    def test_a_node_that_is_not_a_presentation_answers_not_found(self):
        with self.assertRaises(drive.DriveNotFound):
            slides_routes.presentation_write(self.folder, [title_slide()], "replace")

    def test_a_combined_presentation_refuses_the_write(self):
        node = self.create([title_slide("First")])
        frappe.db.set_value("Presentation", docname_for_node(node), "is_composite", 1)
        frappe.db.commit()

        with self.assertRaisesRegex(WriteRefused, "combined"):
            slides_routes.presentation_write(node, [title_slide("Second")], "replace")

        self.assertEqual(self.texts_of(node), [["<paragraph>First</paragraph>"]])

    def test_a_mode_other_than_replace_writes_nothing(self):
        node = self.create([title_slide("First")])

        with self.assertRaisesRegex(drive.DriveError, "mode must be"):
            slides_routes.presentation_write(node=node, slides=[title_slide("Second")], mode="prepend")

        self.assertEqual(self.texts_of(node), [["<paragraph>First</paragraph>"]])

    def test_a_busy_converter_answers_busy_and_creates_nothing(self):
        with (
            filelock(checker.LOCK),
            patch.object(checker, "REQUEST_WAIT_S", 0.2),
            self.assertRaises(WriteBusy),
        ):
            slides_routes.presentation_create(self.folder, "Agent refused", [title_slide()])

        self.assert_created_nothing("Agent refused")

    def test_a_user_past_the_write_limit_waits_and_another_user_does_not(self):
        ensure_user(OUTSIDER)
        frappe.cache.delete_keys("rl:suite.slides")
        self.addCleanup(frappe.cache.delete_keys, "rl:suite.slides")

        def write():
            # Refused for its mode, so the count is all it costs
            slides_routes.presentation_write("no node", [title_slide()], "prepend")

        for _write in range(slides_routes.WRITES_A_MINUTE):
            with self.assertRaises(drive.DriveError):
                call_route(lambda _node: write(), "")

        with self.assertRaises(frappe.RateLimitExceededError):
            call_route(lambda _node: write(), "")

        frappe.set_user(OUTSIDER)
        with self.assertRaises(drive.DriveError):
            call_route(lambda _node: write(), "")

    def test_a_tab_edits_what_an_agent_wrote(self):
        node = self.create([title_slide("First")])
        _header, state = opened(node)
        (element_id,) = compaction.load_doc([state]).get("elements", type=pycrdt.Map).keys()

        def type_into(doc: pycrdt.Doc) -> None:
            text = doc.get("elements", type=pycrdt.Map)[element_id]["text"]
            text.children[0].children[0].insert(5, " typed")

        status, _body = self.push(node, type_into)
        self.assertEqual(status, 200)

        self.assertEqual(self.texts_of(node), [["<paragraph>First typed</paragraph>"]])

    def test_a_read_written_back_makes_the_same_presentation(self):
        node = self.create([title_slide("First"), shape_slide()])
        before = self.deck_of(node)
        read = slides_routes.presentation_read(node)

        slides_routes.presentation_write(node, read["slides"], "replace")

        self.assertEqual(self.deck_of(node), before)
        self.assertEqual(slides_routes.presentation_read(node), read)

    def test_a_read_names_every_slide_and_element_by_its_id(self):
        node = self.create([title_slide("First"), shape_slide()])
        _header, state = opened(node)
        doc = compaction.load_doc([state])

        read = slides_routes.presentation_read(node)["slides"]

        slide_ids = [slide_id for slide_id, _slide in in_order(doc.get("slides", type=pycrdt.Map).items())]
        self.assertEqual([slide["id"] for slide in read], slide_ids)
        element_ids: set[str] = set()
        for slide in read:
            element_ids |= {element["id"] for element in slide["elements"]}

        self.assertEqual(element_ids, set(doc.get("elements", type=pycrdt.Map).keys()))
        # The line still holds on to the box by the id the write gave it
        _box, line = read[1]["elements"]
        self.assertEqual(line["connector"]["start"], {"elementId": "box", "anchor": "right"})

    def test_a_read_holds_what_a_tab_typed(self):
        node = self.create([title_slide("First")])
        _header, state = opened(node)
        (element_id,) = compaction.load_doc([state]).get("elements", type=pycrdt.Map).keys()

        def type_into(doc: pycrdt.Doc) -> None:
            text = doc.get("elements", type=pycrdt.Map)[element_id]["text"]
            text.children[0].children[0].insert(5, " typed")

        status, _body = self.push(node, type_into)
        self.assertEqual(status, 200)

        (slide,) = slides_routes.presentation_read(node)["slides"]
        (element,) = slide["elements"]
        self.assertIn("First typed", element["content"])

    def test_a_reader_reads_and_an_outsider_finds_nothing(self):
        ensure_user(READER)
        ensure_user(OUTSIDER)
        node = self.create([title_slide("First")])
        share(docname_for_node(node), READER, drive.READ)
        frappe.db.commit()

        frappe.set_user(READER)
        (slide,) = slides_routes.presentation_read(node)["slides"]
        self.assertIn("First", slide["elements"][0]["content"])

        frappe.set_user(OUTSIDER)
        with self.assertRaises(drive.DriveNotFound):
            slides_routes.presentation_read(node)

    def test_a_combined_presentation_has_nothing_to_read(self):
        node = self.create([title_slide("First")])
        frappe.db.set_value("Presentation", docname_for_node(node), "is_composite", 1)
        frappe.db.commit()

        with self.assertRaisesRegex(WriteRefused, "combined"):
            slides_routes.presentation_read(node)

    def test_every_element_the_guide_shows_is_kept(self):
        # An element's example is a block that opens on its id or type
        blocks = re.findall(r'```json\n(\{ "(?:id|type)".*?)```', slides_routes.AGENT_GUIDE.read_text(), re.S)
        elements = [json.loads(block) for block in blocks]
        self.assertEqual(sorted(element["type"] for element in elements), ["shape", "shape", "table", "text"])

        node = self.create([{"elements": elements}])

        (slide,) = self.deck_of(node)
        self.assertEqual(len(slide["elements"]), len(elements))
