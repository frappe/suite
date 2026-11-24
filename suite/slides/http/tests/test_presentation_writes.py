import base64
import gzip
import html
import io
import json
import os
import re
import time
import uuid
from collections.abc import Iterable
from unittest.mock import patch

import frappe
import pycrdt
from frappe.app import make_form_dict
from frappe.handler import execute_cmd
from frappe.tests.test_api import make_request
from frappe.utils import get_test_client
from frappe.utils.synchronization import filelock
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite import content, drive
from suite.content import checker, compaction, convert, jobs
from suite.slides import content as slides_content
from suite.slides.content import agent
from suite.slides.content.agent import SlidesRefused, WriteBusy, WriteRefused
from suite.slides.content.tests.support import (
    OWNER,
    LoggedDeckCase,
    call_route,
    delete_log,
    opened,
    owner_folder,
)
from suite.slides.drive import DOCTYPE, docname_for_node, readable_templates
from suite.slides.http import routes as slides_routes
from suite.slides.tests.utils import share, trash_node
from suite.tests.utils import ensure_user, session_for

READER = "slides-agent-reader@example.com"
OUTSIDER = "slides-agent-outsider@example.com"
EDITOR = "slides-agent-editor@example.com"
ATTRIBUTE = re.compile(r' \w+="[^"]*"')
WORDS = re.compile(r">[^<]*<")
PLACEHOLDER_WORDS = ("Title", "Subtitle", "Insert first point here")
# An opening with no end, which a scan from each start to a missing end reads again and again
UNCLOSED = ("<tr>", "<td>", "<td ", "<p>", "<")
# Seconds the checks may take on such HTML; a scan from each start takes tens
CHECK_SECONDS = 2


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


def picture_slide(src: str) -> dict:
    return {"elements": [{"type": "image", "src": src, "left": 0, "top": 0, "width": 400, "height": 300}]}


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


def unworded(slide: dict) -> dict:
    # A slide as a layout gives it: no ids, no words, and no picture in its frame
    elements: list[dict] = []
    for element in slide["elements"]:
        shape = {key: value for key, value in element.items() if key not in {"id", "src", "attachmentName"}}
        if "content" in shape:
            shape["content"] = WORDS.sub("><", shape["content"])

        elements.append(shape)

    return {**{key: value for key, value in slide.items() if key != "id"}, "elements": elements}


def filled_in(layout: dict, picture: str) -> dict:
    # Words for every text of the layout, a line for each of a list's points, and the picture
    filling: dict = {"texts": []}
    for element in layout["elements"]:
        if element["type"] == "image":
            filling["picture"] = picture
        elif "<li" in element["content"]:
            filling["texts"].append(["Point"] * element["content"].count("<li"))
        else:
            filling["texts"].append("Words")

    return filling


def every_layout(layouts: list[dict], picture: str) -> list[dict]:
    slides: list[dict] = []
    for number, layout in enumerate(layouts, start=1):
        slides.append({"layout": number, **filled_in(layout, picture)})

    return slides


def long_html_slides(unit: str) -> dict[str, tuple[dict, str]]:
    # About 250 KB of `unit` in each place an agent can send HTML, and what the element should then hold
    filler = unit * (250_000 // len(unit))
    in_row = f"<table><tr>{filler}</tr></table>"
    table = {"type": "table", "left": 80, "top": 120, "width": 400}
    text = {"type": "text", "left": 80, "top": 200, "content": filler}
    return {
        "a table": ({"elements": [{**table, "content": filler}]}, filler),
        "a table's row": ({"elements": [{**table, "content": in_row}]}, in_row),
        "a text": ({"elements": [text]}, filler),
        "a layout's words": ({"layout": 2, "texts": [filler]}, html.escape(filler, quote=False)),
    }


def words_of(markup: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", markup))


def points_of(markup: str) -> list[str]:
    return re.findall(r"<li[\s>].*?</li>", markup, re.S)


class TestPresentationWrites(LoggedDeckCase):
    CLIENT = get_test_client(use_cookies=False)

    def setUp(self):
        super().setUp()
        if not checker.usable_node(convert.NODE_MIN) or not slides_content.CONVERTER_BUILD.is_file():
            reason = f"needs Node and the built bundle at {slides_content.CONVERTER_BUILD}; run bench build"
            # A skip in CI would leave the job green with agents unable to write
            if os.environ.get("CI"):
                self.fail(reason)

            self.skipTest(reason)

        self.folder = owner_folder()

    def create(self, slides: list[dict], title: str | None = None, template: str | None = None) -> str:
        title = title or f"Agent {uuid.uuid4().hex[:8]}"
        node = slides_routes.presentation_create(self.folder, title, slides, template)["name"]
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

    def stored_picture(self, parent: str) -> str:
        with patch.object(frappe, "enqueue"):
            picture = drive.store_file(parent, "picture.png", io.BytesIO(uuid.uuid4().bytes))

        frappe.db.commit()
        return picture

    def picture_of(self, node: str) -> str:
        (slide,) = self.deck_of(node)
        (picture,) = slide["elements"]
        return picture["src"]

    def layouts(self, title: str) -> list[dict]:
        # The template's slides as a read gives them, converted first as opening it would
        (template,) = (row for row in readable_templates() if row["title"] == title)
        if not content.find(slides_content.APP, template["node"]):
            jobs.convert_one(slides_content.APP, template["node"])
            frappe.db.commit()
            frappe.set_user(OWNER)

        return slides_routes.presentation_read(template["node"])["slides"]

    def assert_created_nothing(self, title: str) -> None:
        self.assertFalse(frappe.db.exists("Drive Node", {"parent_node": self.folder, "title": title}))

    def refusal_sent(self, path: str, body: dict) -> str:
        # A whole request on its own connection, so the message is the one an agent reads after Frappe cleans it
        frappe.db.commit()
        sid = session_for(OWNER)
        kwargs = {"method": "POST", "headers": {"Cookie": f"sid={sid}"}, "json": body}
        response = make_request(target=self.CLIENT.open, args=(f"/api/suite/slides/{path}",), kwargs=kwargs)
        frappe.db.rollback()
        self.assertEqual(response.status_code, 422, response.get_data(as_text=True))
        (error,) = response.json["errors"]
        self.assertEqual(error["type"], "SlidesRefused")
        return error["message"]

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

    def test_replace_overwrites_the_slides_and_returns_the_updated_presentation(self):
        title = f"Agent {uuid.uuid4().hex[:8]}"
        node = self.create([title_slide("First"), shape_slide()], title)

        first = slides_routes.presentation_write(node, [title_slide("Second")], "replace")

        self.assertEqual(self.texts_of(node), [["<paragraph>Second</paragraph>"]])
        self.assertEqual(
            (first["name"], first["title"], first["parent_node"], first["content_doctype"]),
            (node, title, self.folder, "Presentation"),
        )

        second = slides_routes.presentation_write(node, [title_slide("Third")], "replace")

        self.assertGreater(second["rev"], first["rev"])

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
            ("Slide 1 in this call is not an object", ["slide"]),
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
        (slide,) = slides_routes.presentation_read(node)["slides"]
        share(docname_for_node(node), READER, drive.READ)
        frappe.db.commit()
        frappe.set_user(READER)

        with self.assertRaises(drive.DriveForbidden):
            slides_routes.presentation_write(node, [title_slide("Second")], "replace")

        with self.assertRaises(drive.DriveForbidden):
            slides_routes.presentation_slide_write(node, slide["id"], title_slide("Second"))

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

    def test_an_unknown_mode_writes_nothing(self):
        node = self.create([title_slide("First")])

        with self.assertRaisesRegex(drive.DriveError, "mode must be"):
            slides_routes.presentation_write(node=node, slides=[title_slide("Second")], mode="prepend")

        self.assertEqual(self.texts_of(node), [["<paragraph>First</paragraph>"]])

    def test_append_adds_slides_after_the_last_and_leaves_the_rest(self):
        node = self.create([title_slide("First"), title_slide("Second")])
        before = slides_routes.presentation_read(node)["slides"]

        slides_routes.presentation_write(node, [title_slide("Third"), title_slide("Fourth")], "append")

        after = slides_routes.presentation_read(node)["slides"]
        self.assertEqual(after[:2], before)
        self.assertEqual(
            self.texts_of(node),
            [[f"<paragraph>{word}</paragraph>"] for word in ("First", "Second", "Third", "Fourth")],
        )
        # Nothing was removed, so nothing needs a version
        self.assertEqual(self.kept_versions(node), [])

    def test_append_lands_after_a_slide_a_tab_added_last(self):
        node = self.create([title_slide("First")])

        def add_slide(doc: pycrdt.Doc) -> None:
            doc.get("slides", type=pycrdt.Map)["by-hand"] = pycrdt.Map({"order": "z"})

        status, _body = self.push(node, add_slide)
        self.assertEqual(status, 200)

        slides_routes.presentation_write(node, [title_slide("Appended")], "append")

        self.assertEqual(
            self.texts_of(node), [["<paragraph>First</paragraph>"], [], ["<paragraph>Appended</paragraph>"]]
        )

    def test_an_appended_copy_of_a_slide_gets_ids_of_its_own(self):
        node = self.create([shape_slide()])
        (copied,) = slides_routes.presentation_read(node)["slides"]

        slides_routes.presentation_write(node, [copied], "append")

        first, copy = slides_routes.presentation_read(node)["slides"]
        self.assertNotEqual(copy["id"], first["id"])
        (box, line) = first["elements"]
        (copy_box, copy_line) = copy["elements"]
        self.assertEqual(box["id"], "box")
        self.assertNotIn(copy_box["id"], {"box", line["id"]})
        # Magic Move pairs the copy's box with the box it copies
        self.assertEqual(copy_box["refId"], "box")
        # Each line holds on to the box on its own slide
        self.assertEqual(line["connector"]["start"]["elementId"], "box")
        self.assertEqual(copy_line["connector"]["start"]["elementId"], copy_box["id"])

    def test_a_tab_edit_made_while_an_append_converts_stays(self):
        node = self.create([title_slide("First")])
        _header, state = opened(node)
        (element_id,) = compaction.load_doc([state]).get("elements", type=pycrdt.Map).keys()
        read_ids = agent.current_doc

        def type_into(doc: pycrdt.Doc) -> None:
            text = doc.get("elements", type=pycrdt.Map)[element_id]["text"]
            text.children[0].children[0].insert(5, " typed")

        def read_then_type(at: str) -> pycrdt.Doc:
            doc = read_ids(at)
            status, _body = self.push(node, type_into)
            self.assertEqual(status, 200)
            return doc

        with patch.object(agent, "current_doc", read_then_type):
            slides_routes.presentation_write(node, [title_slide("Appended")], "append")

        self.assertEqual(
            self.texts_of(node), [["<paragraph>First typed</paragraph>"], ["<paragraph>Appended</paragraph>"]]
        )

    def test_an_append_whose_id_a_tab_took_meanwhile_answers_busy(self):
        node = self.create([title_slide("First")])
        read_ids = agent.current_doc

        def add_slide(doc: pycrdt.Doc) -> None:
            doc.get("slides", type=pycrdt.Map)["taken-meanwhile"] = pycrdt.Map({"order": "z"})

        def read_then_add(at: str) -> pycrdt.Doc:
            doc = read_ids(at)
            status, _body = self.push(node, add_slide)
            self.assertEqual(status, 200)
            return doc

        with patch.object(agent, "current_doc", read_then_add), self.assertRaises(WriteBusy):
            slides_routes.presentation_write(node, [title_slide("Appended", id="taken-meanwhile")], "append")

        self.assertEqual(self.texts_of(node), [["<paragraph>First</paragraph>"], []])

    def test_a_slide_write_changes_that_slide_alone(self):
        node = self.create([title_slide("First"), shape_slide(), title_slide("Third")])
        first, shapes, third = slides_routes.presentation_read(node)["slides"]
        box, _line = shapes["elements"]

        written = {**shapes, "transition": "None", "elements": [{**box, "content": "<p>Changed</p>"}]}
        slides_routes.presentation_slide_write(node, shapes["id"], written)

        after = slides_routes.presentation_read(node)["slides"]
        self.assertEqual((after[0], after[2]), (first, third))
        self.assertEqual(after[1]["id"], shapes["id"])
        self.assertEqual(after[1]["transition"], "None")
        (changed,) = after[1]["elements"]
        self.assertEqual(changed["id"], "box")
        self.assertIn("Changed", changed["content"])
        self.assertEqual(self.kept_versions(node), [])

    def test_a_tab_edit_to_another_slide_made_while_a_slide_write_converts_stays(self):
        node = self.create([title_slide("First"), title_slide("Second")])
        first, second = slides_routes.presentation_read(node)["slides"]
        (typed_in,) = first["elements"]
        read_ids = agent.current_doc

        def type_into(doc: pycrdt.Doc) -> None:
            text = doc.get("elements", type=pycrdt.Map)[typed_in["id"]]["text"]
            text.children[0].children[0].insert(5, " typed")

        def read_then_type(at: str) -> pycrdt.Doc:
            doc = read_ids(at)
            status, _body = self.push(node, type_into)
            self.assertEqual(status, 200)
            return doc

        with patch.object(agent, "current_doc", read_then_type):
            slides_routes.presentation_slide_write(node, second["id"], title_slide("Changed"))

        self.assertEqual(
            self.texts_of(node), [["<paragraph>First typed</paragraph>"], ["<paragraph>Changed</paragraph>"]]
        )

    def test_a_slide_write_gives_an_id_another_slide_holds_a_new_one(self):
        node = self.create([shape_slide(), title_slide("Second")])
        shapes, second = slides_routes.presentation_read(node)["slides"]

        borrowed = {"elements": [{**box_shape(), "content": "<p>Borrowed</p>"}]}
        slides_routes.presentation_slide_write(node, second["id"], borrowed)

        shapes_after, second_after = slides_routes.presentation_read(node)["slides"]
        self.assertEqual(shapes_after, shapes)
        (element,) = second_after["elements"]
        self.assertNotEqual(element["id"], "box")
        self.assertIn("Borrowed", element["content"])

    def test_a_slide_write_to_a_slide_not_there_writes_nothing(self):
        node = self.create([title_slide("First")])

        with self.assertRaises(drive.DriveNotFound):
            slides_routes.presentation_slide_write(node, "no-such-slide", title_slide("Second"))

        self.assertEqual(self.texts_of(node), [["<paragraph>First</paragraph>"]])

    def test_a_slide_write_naming_another_id_writes_nothing(self):
        node = self.create([title_slide("First"), title_slide("Second")])
        first, second = slides_routes.presentation_read(node)["slides"]

        with self.assertRaisesRegex(SlidesRefused, "id must be the one the path names"):
            slides_routes.presentation_slide_write(node, first["id"], {**second, "id": second["id"]})

        self.assertEqual(slides_routes.presentation_read(node)["slides"], [first, second])

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
        node = self.create([title_slide()])
        # The guide's placeholders stand for files uploaded to the presentation
        picture = self.stored_picture(node)
        video = self.stored_picture(node)
        filled = [block.replace("<picture id>", picture).replace("<video id>", video) for block in blocks]
        elements = [json.loads(block) for block in filled]
        self.assertEqual(
            sorted(element["type"] for element in elements),
            ["image", "shape", "shape", "table", "text", "video"],
        )

        slides_routes.presentation_write(node, [{"elements": elements}], "replace")

        (slide,) = self.deck_of(node)
        self.assertEqual(len(slide["elements"]), len(elements))

    def test_every_layout_slide_the_guide_shows_writes_its_words_and_picture(self):
        blocks = re.findall(r'```json\n(\{ "layout".*?)```', slides_routes.AGENT_GUIDE.read_text(), re.S)
        node = self.create([title_slide()])
        picture = self.stored_picture(node)
        slides = [json.loads(block.replace("<picture id>", picture)) for block in blocks]
        self.assertEqual([slide["layout"] for slide in slides], [3, 6, 7])

        slides_routes.presentation_write(node, slides, "replace")

        written = slides_routes.presentation_read(node)["slides"]
        self.assertEqual(
            [words_of(element["content"]) for element in written[0]["elements"]],
            ["Plan for today", "What we ship this week"],
        )
        self.assertEqual(
            [words_of(point) for point in points_of(written[1]["elements"][1]["content"])],
            ["Ship the editor", "Hire two people", "Plan the launch"],
        )
        self.assertEqual(written[1]["transition"], "Fade")
        self.assertEqual([element.get("src") for element in written[2]["elements"]], [None, picture])

    def test_a_picture_uploaded_to_the_presentation_keeps_its_id(self):
        node = self.create([title_slide("First")])
        picture = self.stored_picture(node)

        slides_routes.presentation_write(node, [picture_slide(picture)], "replace")

        self.assertEqual(self.picture_of(node), picture)

    def test_a_picture_another_presentation_holds_is_copied_under_this_one(self):
        other = self.create([title_slide("Other")])
        picture = self.stored_picture(other)
        node = self.create([title_slide("First")])

        slides_routes.presentation_write(node, [picture_slide(picture)], "replace")

        copied = self.picture_of(node)
        self.assertNotEqual(copied, picture)
        self.assertEqual(frappe.db.get_value("Drive Node", copied, "parent_node"), node)
        # The other presentation keeps its own file
        self.assertEqual(frappe.db.get_value("Drive Node", picture, "parent_node"), other)

    def test_a_picture_named_by_a_link_writes_nothing(self):
        node = self.create([title_slide("First")])

        for src in ("https://example.com/logo.png", "/private/files/logo.png"):
            with self.subTest(src), self.assertRaisesRegex(SlidesRefused, "names a picture by a link"):
                slides_routes.presentation_write(node, [picture_slide(src)], "replace")

        self.assertEqual(self.texts_of(node), [["<paragraph>First</paragraph>"]])

    def test_a_picture_the_writer_cannot_read_writes_nothing(self):
        ensure_user(EDITOR)
        hidden = self.stored_picture(self.create([title_slide("Hidden")]))
        node = self.create([title_slide("First")])
        share(docname_for_node(node), EDITOR, drive.EDIT)
        frappe.db.commit()
        frappe.set_user(EDITOR)

        # A file kept from the writer answers as one that isn't there
        for src in (hidden, "no-such-file"):
            with (
                self.subTest(src),
                self.assertRaisesRegex(SlidesRefused, "isn't there or that you can't read"),
            ):
                slides_routes.presentation_write(node, [picture_slide(src)], "append")

        frappe.set_user("Administrator")
        self.assertEqual(self.texts_of(node), [["<paragraph>First</paragraph>"]])
        self.assertFalse(frappe.db.exists("Drive Node", {"parent_node": node, "kind": "file"}))

    def test_a_picture_no_presentation_holds_writes_nothing(self):
        node = self.create([title_slide("First")])
        loose = self.stored_picture(self.folder)
        self.addCleanup(trash_node, loose)

        with self.assertRaisesRegex(SlidesRefused, "no presentation holds"):
            slides_routes.presentation_write(node, [picture_slide(loose)], "replace")

        self.assertEqual(self.texts_of(node), [["<paragraph>First</paragraph>"]])
        self.assertEqual(self.kept_versions(node), [])

        with self.assertRaisesRegex(SlidesRefused, "no presentation holds"):
            slides_routes.presentation_create(self.folder, "Agent refused", [picture_slide(loose)])

        # The refusal comes once the presentation is made, and the request rolls it back
        frappe.db.rollback()
        self.assert_created_nothing("Agent refused")

    def test_each_layout_writes_as_the_template_holds_it(self):
        for title in ("Light", "Dark"):
            with self.subTest(title):
                layouts = self.layouts(title)
                node = self.create([title_slide()], template=title)
                picture = self.stored_picture(node)
                slides_routes.presentation_write(node, every_layout(layouts, picture), "replace")

                written = slides_routes.presentation_read(node)["slides"]
                self.assertEqual(len(written), 7)
                self.assertEqual(
                    [unworded(slide) for slide in written], [unworded(slide) for slide in layouts]
                )

    def test_a_picture_layout_holds_the_picture_where_its_placeholder_was(self):
        _first, *_rest, picture_layout = self.layouts("Light")
        _title, placeholder = picture_layout["elements"]
        node = self.create([title_slide()])
        picture = self.stored_picture(node)

        team = {"layout": 7, "texts": ["Team"]}
        slides_routes.presentation_write(node, [{**team, "picture": picture}, team], "replace")

        with_picture, without = slides_routes.presentation_read(node)["slides"]
        (image,) = [element for element in with_picture["elements"] if element["type"] == "image"]
        frame = ("left", "top", "width", "height")
        self.assertEqual([image[key] for key in frame], [placeholder[key] for key in frame])
        self.assertEqual(image["src"], picture)
        # With no picture the placeholder is never written
        self.assertEqual([element["type"] for element in without["elements"]], ["text"])

    def test_a_list_of_words_gives_a_point_each_in_the_first_points_style(self):
        *_others, points_layout, _picture_layout = self.layouts("Light")
        _title, placeholder = points_layout["elements"]
        first_point, *_more = points_of(placeholder["content"])

        node = self.create([{"layout": 6, "texts": ["Plan", ["One", "Two", "Three", "Four"]]}])

        (slide,) = slides_routes.presentation_read(node)["slides"]
        _title, points = slide["elements"]
        written = points_of(points["content"])
        self.assertEqual([words_of(point) for point in written], ["One", "Two", "Three", "Four"])
        self.assertEqual({WORDS.sub("><", point) for point in written}, {WORDS.sub("><", first_point)})

    def test_a_text_left_out_leaves_its_element_out(self):
        node = self.create(
            [
                {"layout": 3, "texts": ["Only a title"]},
                {"layout": 3, "texts": [None, "Only a subtitle"]},
                {"layout": 3, "texts": ["", ""]},
                {"layout": 6, "texts": ["Points", ["", "One"]]},
                {"layout": 7},
            ]
        )

        slides = slides_routes.presentation_read(node)["slides"]
        self.assertEqual(
            [[words_of(element["content"]) for element in slide["elements"]] for slide in slides],
            [["Only a title"], ["Only a subtitle"], [], ["Points", "One"], []],
        )
        written = json.dumps(slides)
        for words in PLACEHOLDER_WORDS:
            self.assertNotIn(words, written)

    def test_a_layouts_words_are_plain_text(self):
        node = self.create([{"layout": 2, "texts": ["<b>x</b> & y"]}])

        (slide,) = slides_routes.presentation_read(node)["slides"]
        (title,) = slide["elements"]
        self.assertEqual(words_of(title["content"]), "<b>x</b> & y")
        self.assertNotIn("<b>", title["content"])

    def test_a_layout_slide_that_cannot_be_laid_out_names_why(self):
        whole = "Slide 1 in this call's layout must be a whole number from 1 to 7"
        cases = [
            (whole, [{"layout": 8}]),
            (whole, [{"layout": 0}]),
            (whole, [{"layout": 2.0}]),
            (whole, [{"layout": "2"}]),
            (whole, [{"layout": True}]),
            (
                "Slide 2 in this call: layout 3 holds 2 texts, and 3 were sent",
                [title_slide(), {"layout": 3, "texts": ["a", "b", "c"]}],
            ),
            (
                "Slide 1 in this call: layout 2 holds 1 text, and 2 were sent",
                [{"layout": 2, "texts": ["a", "b"]}],
            ),
            ("Slide 1 in this call: layout 2 holds no picture", [{"layout": 2, "picture": "a-picture"}]),
            ("Slide 1 in this call names a layout and elements", [{"layout": 2, "elements": []}]),
            ("texts must be a list of words", [{"layout": 2, "texts": "Title"}]),
            ("texts must be a list of words", [{"layout": 2, "texts": [3]}]),
        ]
        for message, slides in cases:
            with self.subTest(slides), self.assertRaisesRegex(SlidesRefused, message):
                slides_routes.presentation_create(self.folder, "Agent refused", slides)

        with self.assertRaisesRegex(
            SlidesRefused, "No template you can use is called Neon. These are: .*Light"
        ):
            slides_routes.presentation_create(self.folder, "Agent refused", [{"layout": 2}], "Neon")

        self.assert_created_nothing("Agent refused")

    def test_a_presentation_takes_layouts_from_the_template_it_was_made_on(self):
        templates = {row["title"]: row["name"] for row in readable_templates()}
        dark = self.create([{"layout": 2, "texts": ["Dark"]}], template="Dark")
        light = self.create([{"layout": 2, "texts": ["Light"]}])

        slides_routes.presentation_write(dark, [{"layout": 2, "texts": ["Later"]}], "append")

        self.assertEqual(
            [slide["background"] for slide in slides_routes.presentation_read(dark)["slides"]],
            ["#000000FF", "#000000FF"],
        )
        (slide,) = slides_routes.presentation_read(light)["slides"]
        self.assertEqual(slide["background"], "#FFFFFFFF")
        # A tab's "Add slide" takes the same template
        self.assertEqual(
            frappe.db.get_value("Presentation", docname_for_node(dark), "theme"), templates["Dark"]
        )
        self.assertEqual(
            frappe.db.get_value("Presentation", docname_for_node(light), "theme"), templates["Light"]
        )

    def test_a_call_mixes_layout_slides_and_slide_json(self):
        _blank, title_layout, *_rest = self.layouts("Light")

        node = self.create(
            [title_slide("Raw"), {"layout": 2, "texts": ["Laid out"], "id": "chosen", "transition": "Fade"}]
        )

        raw, laid_out = slides_routes.presentation_read(node)["slides"]
        self.assertEqual(words_of(raw["elements"][0]["content"]), "Raw")
        self.assertEqual(laid_out["id"], "chosen")
        self.assertEqual(laid_out["transition"], "Fade")
        self.assertEqual(
            {**unworded(laid_out), "transition": title_layout["transition"]}, unworded(title_layout)
        )
        # Each slide made from a layout gets element ids of its own
        self.assertNotEqual(laid_out["elements"][0]["id"], title_layout["elements"][0]["id"])

    def test_a_slide_write_from_a_layout_keeps_the_slides_id_and_place(self):
        node = self.create([title_slide("First"), title_slide("Second"), title_slide("Third")])
        first, second, third = slides_routes.presentation_read(node)["slides"]

        slides_routes.presentation_slide_write(node, second["id"], {"layout": 2, "texts": ["Laid out"]})

        after = slides_routes.presentation_read(node)["slides"]
        self.assertEqual((after[0], after[2]), (first, third))
        self.assertEqual(after[1]["id"], second["id"])
        self.assertEqual([words_of(element["content"]) for element in after[1]["elements"]], ["Laid out"])

    def test_a_slide_write_with_no_elements_writes_nothing(self):
        node = self.create([title_slide("First")])
        (first,) = slides_routes.presentation_read(node)["slides"]

        with self.assertRaisesRegex(SlidesRefused, r'Send the whole slide.*"elements": \[\] empties it'):
            slides_routes.presentation_slide_write(node, first["id"], {"transition": "Fade"})

        self.assertEqual(slides_routes.presentation_read(node)["slides"], [first])
        slides_routes.presentation_slide_write(node, first["id"], {"elements": []})
        self.assertEqual(self.texts_of(node), [[]])

    def test_a_slide_with_no_elements_is_a_blank_slide_elsewhere(self):
        node = self.create([{"background": "#FFFFFFFF"}])

        slides_routes.presentation_write(node, [{"transition": "Fade"}], "append")

        self.assertEqual(self.texts_of(node), [[], []])

    def test_a_refused_element_is_named_by_its_slide_and_place(self):
        odd = {"id": "odd", "type": "text", "content": "<p>x</p><iframe></iframe>"}
        cases = [
            (
                r"Slide 2 in this call, element 2 \(text, id odd\): its HTML holds what the editor can't keep: the iframe tag$",
                [title_slide(), {"elements": [title_slide()["elements"][0], odd]}],
            ),
            (
                r"Slide 1 in this call, element 1 \(chart\): its type must be",
                [{"elements": [{"type": "chart"}]}],
            ),
            (
                r"Slide 1 in this call, element 1 \(text\): it holds a field.* no place for: wobble$",
                [{"elements": [{"type": "text", "content": "<p>x</p>", "wobble": 1}]}],
            ),
            (
                r"element 1 \(table\): its HTML holds .*Use the table form in the agent guide",
                [
                    {
                        "elements": [
                            {
                                "type": "table",
                                "content": "<table><caption>x</caption><tr><td>x</td></tr></table>",
                            }
                        ]
                    }
                ],
            ),
        ]
        for message, slides in cases:
            with self.subTest(message), self.assertRaisesRegex(SlidesRefused, message):
                slides_routes.presentation_create(self.folder, "Agent refused", slides)

        self.assert_created_nothing("Agent refused")

    def test_a_refused_tag_is_named_in_the_answer_an_agent_reads(self):
        for tag in ("script", "iframe"):
            title = f"Agent {tag} {uuid.uuid4().hex[:8]}"
            slides = [{"elements": [{"type": "text", "content": f"<p>x</p><{tag}></{tag}>"}]}]
            with self.subTest(tag):
                message = self.refusal_sent(
                    "presentations", {"parent": self.folder, "title": title, "slides": slides}
                )

                self.assertTrue(
                    message.endswith(
                        f"element 1 (text): its HTML holds what the editor can't keep: the {tag} tag"
                    ),
                    message,
                )
                self.assert_created_nothing(title)

    def test_a_refused_value_names_its_field(self):
        text = {"type": "text", "content": "<p>x</p>", "lineHeight": 1.5}
        cases = {
            "connector": {**text, "connector": "straight"},
            "editorMetadata": {**text, "editorMetadata": {"wobble": 1}},
        }
        for field, element in cases.items():
            with self.subTest(field), self.assertRaisesRegex(SlidesRefused, f"no place for: {field}$"):
                slides_routes.presentation_create(self.folder, "Agent refused", [{"elements": [element]}])

        self.assert_created_nothing("Agent refused")

    def test_a_link_the_editor_drops_or_a_handler_writes_nothing(self):
        cases = {
            "javascript": "javascript:alert(1)",
            "spaced javascript": " java\tscript:alert(1)",
            "data": "data:text/html,hi",
            "an unknown scheme": "intent:plans",
            "an empty href": "",
            "a href of spaces": " \t",
        }
        for case, href in cases.items():
            slides = [title_slide(f'<a href="{href}">Plans</a>')]
            with self.subTest(case), self.assertRaisesRegex(SlidesRefused, "holds a link the editor drops"):
                slides_routes.presentation_create(self.folder, "Agent refused", slides)

        with self.assertRaisesRegex(SlidesRefused, "holds onclick, an attribute the editor leaves out"):
            slides_routes.presentation_create(
                self.folder, "Agent refused", [title_slide('<span onclick="steal()">Plans</span>')]
            )

        self.assert_created_nothing("Agent refused")

    def test_a_link_the_editor_keeps_is_written(self):
        node = self.create(
            [title_slide('<a href="#goals">Goals</a> and <a href="mailto:a@example.com">mail</a>')]
        )

        (slide,) = slides_routes.presentation_read(node)["slides"]
        (text,) = slide["elements"]
        self.assertIn('href="#goals"', text["content"])
        self.assertIn('href="mailto:a@example.com"', text["content"])

    def test_a_plain_table_is_written_in_the_editors_form(self):
        plain = (
            "<table><tr><th>Goal</th><th>Owner</th></tr><tr><td>Ship</td><td><p>Aanya</p></td></tr></table>"
        )
        node = self.create(
            [{"elements": [{"type": "table", "left": 80, "top": 120, "width": 400, "content": plain}]}]
        )

        (slide,) = slides_routes.presentation_read(node)["slides"]
        (table,) = slide["elements"]
        self.assertIn('<table style="width: 400px', table["content"])
        self.assertEqual(re.findall(r'colwidth="(\d+)"', table["content"]), ["200"] * 4)
        self.assertEqual(words_of(table["content"]), "GoalOwnerShipAanya")

    def test_a_plain_table_keeps_the_whole_width_when_it_does_not_divide_evenly(self):
        cases = [
            (
                401,
                "<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>",
                ["201", "200"],
            ),
            (800, "<table><tr><td>A</td><td>B</td><td>C</td></tr></table>", ["267", "267", "266"]),
        ]
        for width, plain, columns in cases:
            element = {"type": "table", "left": 80, "top": 120, "width": width, "content": plain}
            with self.subTest(width):
                node = self.create([{"elements": [element]}])

                (slide,) = slides_routes.presentation_read(node)["slides"]
                (table,) = slide["elements"]
                self.assertIn(f'<table style="width: {width}px', table["content"])
                self.assertEqual(re.findall(r'<col style="width: (\d+)px', table["content"]), columns)
                self.assertEqual(
                    re.findall(r'colwidth="(\d+)"', table["content"]), columns * (plain.count("<tr>"))
                )

    def test_a_plain_table_with_a_heading_keeps_its_heading_cells(self):
        plain = (
            "<table><thead><tr><th>Goal</th><th>Owner</th></tr></thead>"
            "<tbody><tr><td>Ship</td><td>Aanya</td></tr></tbody></table>"
        )
        node = self.create(
            [{"elements": [{"type": "table", "left": 80, "top": 120, "width": 300, "content": plain}]}]
        )

        (slide,) = slides_routes.presentation_read(node)["slides"]
        (table,) = slide["elements"]
        self.assertEqual(re.findall(r"<(th|td)\b", table["content"]), ["th", "th", "td", "td"])
        self.assertEqual(re.findall(r'colwidth="(\d+)"', table["content"]), ["150"] * 4)

    def test_a_table_read_and_written_back_reads_the_same(self):
        plain = "<table><tr><td>Goal</td><td>Owner</td></tr><tr><td>Ship</td><td>Aanya</td></tr></table>"
        node = self.create(
            [{"elements": [{"type": "table", "left": 80, "top": 120, "width": 400, "content": plain}]}]
        )
        slides = slides_routes.presentation_read(node)["slides"]

        slides_routes.presentation_write(node, slides, "replace")

        (slide,) = slides_routes.presentation_read(node)["slides"]
        self.assertEqual(slide["elements"], slides[0]["elements"])

    def test_a_plain_table_with_no_whole_width_writes_nothing(self):
        plain = "<table><tr><th>Name</th><th>Score</th></tr><tr><td>Asha</td><td>9</td></tr></table>"
        widths = {"missing": {}, "0": {"width": 0}, "below 0": {"width": -5}, "a float": {"width": 2.5}}
        widths |= {"a string": {"width": "400"}, "a bool": {"width": True}}
        for case, width in widths.items():
            title = f"Agent width {uuid.uuid4().hex[:8]}"
            slides = [{"elements": [{"type": "table", "left": 80, "top": 120, **width, "content": plain}]}]
            with self.subTest(case):
                message = self.refusal_sent(
                    "presentations", {"parent": self.folder, "title": title, "slides": slides}
                )

                self.assertIn(
                    "Slide 1 in this call, element 1 (table): its width must be a whole number", message
                )
                self.assert_created_nothing(title)

    def test_a_table_in_the_editors_form_keeps_a_width_of_any_kind(self):
        guide_form = (
            '<table style="width: 400px"><colgroup><col style="width: 200px"><col style="width: 200px"></colgroup>'
            '<tbody><tr><th colwidth="200"><p>Goal</p></th><th colwidth="200"><p>Owner</p></th></tr>'
            '<tr><td colwidth="200"><p>Ship</p></td><td colwidth="200"><p>Aanya</p></td></tr></tbody></table>'
        )
        element = {"type": "table", "left": 80, "top": 120, "width": 400.5, "content": guide_form}
        node = self.create([{"elements": [element]}])

        (slide,) = slides_routes.presentation_read(node)["slides"]
        (table,) = slide["elements"]
        self.assertEqual(table["width"], 400.5)
        self.assertEqual(words_of(table["content"]), "GoalOwnerShipAanya")

    def test_a_table_with_no_rows_writes_nothing(self):
        cases = {
            "bare": ("<table></table>", {"width": 400}),
            "with its parts": (
                "<TABLE> <thead></thead><tbody>\n</tbody><tfoot></tfoot></table >",
                {"width": 400},
            ),
            "with no width": ("<table></table>", {}),
        }
        for case, (table, width) in cases.items():
            title = f"Agent rows {uuid.uuid4().hex[:8]}"
            slides = [{"elements": [{"type": "table", "left": 80, "top": 120, **width, "content": table}]}]
            with self.subTest(case):
                message = self.refusal_sent(
                    "presentations", {"parent": self.folder, "title": title, "slides": slides}
                )

                self.assertIn("Slide 1 in this call, element 1 (table): its table holds no rows", message)
                self.assert_created_nothing(title)

    def test_an_empty_table_element_read_and_written_back_reads_the_same(self):
        empty = {
            "type": "table",
            "left": 80,
            "top": 120,
            "width": 400,
            "content": '<p style="line-height: 1.5;"></p>',
        }
        node = self.create([{"elements": [empty]}])
        slides = slides_routes.presentation_read(node)["slides"]

        slides_routes.presentation_write(node, slides, "replace")

        (slide,) = slides_routes.presentation_read(node)["slides"]
        self.assertEqual(slide["elements"], slides[0]["elements"])

    def test_a_table_with_a_caption_writes_nothing(self):
        table = "<table><caption>Q1</caption><tr><td>Plan</td></tr></table>"
        element = {"type": "table", "left": 80, "top": 120, "width": 400, "content": table}

        with self.assertRaisesRegex(SlidesRefused, r"element 1 \(table\)"):
            slides_routes.presentation_create(self.folder, "Agent refused", [{"elements": [element]}])

        self.assert_created_nothing("Agent refused")

    def test_a_table_row_with_no_cells_writes_nothing(self):
        for table in ("<table><tr></tr></table>", "<table><tr><td>Goal</td></tr><tr> </tr></table>"):
            element = {"type": "table", "left": 80, "top": 120, "width": 400, "content": table}
            with (
                self.subTest(table),
                self.assertRaisesRegex(
                    SlidesRefused, r"element 1 \(table\): a row of its table holds no cells"
                ),
            ):
                slides_routes.presentation_create(self.folder, "Agent refused", [{"elements": [element]}])

        self.assert_created_nothing("Agent refused")

    def test_a_table_with_more_than_plain_rows_is_left_for_the_converter(self):
        cases = {
            "a nested table": (
                "<table><tr><td><table><tr><td>A</td></tr></table></td><td>B</td></tr></table>"
            ),
            "cells with no end tag": "<table><tr><td>A<td>B</tr></table>",
            "a row with no end tag": "<table><tr><td>A</td></table>",
            "a cell with a width": '<table><tr><td colwidth="90">A</td><td>B</td></tr></table>',
            "a row with attributes": '<table><tr class="first"><td>A</td></tr></table>',
        }
        for case, table in cases.items():
            element = {"type": "table", "left": 80, "top": 120, "width": 400, "content": table}
            with self.subTest(case):
                self.assertIs(agent.in_table_form("element 1 (table)", element), element)
                self.assert_not_rewritten(element)

    def assert_not_rewritten(self, element: dict) -> None:
        # The converter keeps or refuses the table, but never as the agent's rewrite
        try:
            node = self.create([{"elements": [element]}])
        except SlidesRefused:
            return

        (slide,) = slides_routes.presentation_read(node)["slides"]
        self.assertNotIn('style="width: 400px"', slide["elements"][0]["content"])

    def test_long_unclosed_html_is_checked_at_once_and_left_for_the_converter(self):
        # The checks before the converter, which read the HTML once; the converter's own time is not timed here
        layouts = self.layouts("Light")
        answers: dict[str, str] = {}
        for unit in UNCLOSED:
            for place, (slide, kept) in long_html_slides(unit).items():
                answers[f"{unit} in {place}"] = self.checked_answer(slide, kept, layouts)

        self.assertEqual(answers, dict.fromkeys(answers, "kept"))

    def checked_answer(self, slide: dict, kept: str, layouts: list[dict]) -> str:
        started = time.monotonic()
        try:
            rows, _pictures = agent.slide_rows([slide], ["Slide 1"], lambda: layouts)
        except SlidesRefused:
            return "refused"
        finally:
            took = time.monotonic() - started

        if took >= CHECK_SECONDS:
            return f"{took:.1f} s"

        markups = [element.get("content") or "" for element in json.loads(rows[0].elements)]
        return "kept" if any(kept in markup for markup in markups) else "changed"

    def test_a_table_whose_rows_differ_writes_nothing(self):
        uneven = "<table><tr><td>Goal</td><td>Owner</td></tr><tr><td>Ship</td></tr></table>"
        guide_form = (
            '<table style="width: 400px"><colgroup><col style="width: 200px"><col style="width: 200px"></colgroup>'
            '<tbody><tr><td colwidth="200"><p>Goal</p></td><td colwidth="200"><p>Owner</p></td></tr>'
            '<tr><td colspan="1" rowspan="1" colwidth="200"><p>Ship</p></td></tr></tbody></table>'
        )
        zero_span = '<table><tr><td colspan="0">A</td><td>B</td></tr><tr><td>C</td></tr></table>'
        cases = {"plain": uneven, "the editor's form": guide_form, "a cell spanning 0 columns": zero_span}
        for case, markup in cases.items():
            element = {"type": "table", "left": 80, "top": 120, "width": 400, "content": markup}
            with (
                self.subTest(case),
                self.assertRaisesRegex(
                    SlidesRefused, r"element 1 \(table\): its rows hold different numbers of cells"
                ),
            ):
                slides_routes.presentation_create(self.folder, "Agent refused", [{"elements": [element]}])

        self.assert_created_nothing("Agent refused")

    def test_an_empty_slide_writes_nothing(self):
        node = self.create([title_slide("First")])

        with self.assertRaisesRegex(SlidesRefused, r'Slide 1 in this call is empty: send "elements": \[\]'):
            slides_routes.presentation_write(node, [{}], "append")

        self.assertEqual(self.texts_of(node), [["<paragraph>First</paragraph>"]])
        slides_routes.presentation_write(node, [{"elements": []}], "append")
        self.assertEqual(self.texts_of(node), [["<paragraph>First</paragraph>"], []])

    def test_a_title_past_the_drive_limit_names_the_limit(self):
        with self.assertRaisesRegex(drive.DriveError, "title must be 140 characters or fewer"):
            slides_routes.presentation_create(self.folder, "x" * 141, [title_slide()])

        self.assert_created_nothing("x" * 141)
        self.create([title_slide()], "x" * 140)

    def test_a_refused_element_in_a_slide_write_is_named_by_the_slides_id(self):
        node = self.create([title_slide("First")])
        (first,) = slides_routes.presentation_read(node)["slides"]

        with self.assertRaisesRegex(SlidesRefused, rf"Slide {first['id']}, element 1 \(chart\)"):
            slides_routes.presentation_slide_write(node, first["id"], {"elements": [{"type": "chart"}]})

        self.assertEqual(slides_routes.presentation_read(node)["slides"], [first])

    def test_a_picture_with_no_file_writes_nothing(self):
        node = self.create([title_slide("First")])
        no_src = r"Slide 1 in this call, element 1 \((image|video)\) has no src"
        cases = [
            (no_src, {"type": "image"}),
            (no_src, {"type": "image", "src": None}),
            (no_src, {"type": "video", "src": ""}),
            (r"element 1 \(video\)'s poster is empty", {"type": "video", "src": "a-video", "poster": ""}),
            ("names a video by a link", {"type": "video", "src": "https://example.com/talk.mp4"}),
        ]
        for message, element in cases:
            with self.subTest(element), self.assertRaisesRegex(SlidesRefused, message):
                slides_routes.presentation_write(node, [{"elements": [element]}], "replace")

        self.assertEqual(self.texts_of(node), [["<paragraph>First</paragraph>"]])

    def test_a_picture_not_there_is_named_with_no_paste_words(self):
        node = self.create([title_slide("First")])
        picture = self.stored_picture(node)
        frappe.local.message_log: list[dict] = []

        slides = [
            picture_slide(picture),
            {"elements": [{**picture_slide("no-such-file")["elements"][0], "id": "gone"}]},
        ]
        with self.assertRaisesRegex(
            SlidesRefused,
            r"Slide 2 in this call, element 1 \(image, id gone\) names no-such-file, a file that isn't there",
        ):
            slides_routes.presentation_write(node, slides, "replace")

        # The answer carries the refusal alone, and none of a paste's words
        (logged,) = frappe.local.message_log
        self.assertIn("(image, id gone) names no-such-file", logged["message"])
        self.assertEqual(self.texts_of(node), [["<paragraph>First</paragraph>"]])

    def test_a_slide_write_with_an_id_that_is_not_text_writes_nothing(self):
        node = self.create([title_slide("First")])
        (slide,) = slides_routes.presentation_read(node)["slides"]

        for given in ([], {}):
            with (
                self.subTest(given),
                self.assertRaisesRegex(SlidesRefused, "id must be the one the path names"),
            ):
                slides_routes.presentation_slide_write(node, slide["id"], {"id": given, "elements": []})

        self.assertEqual(slides_routes.presentation_read(node)["slides"], [slide])

    def test_a_background_is_a_hex_colour_alone(self):
        node = self.create([title_slide("First")])

        with self.assertRaisesRegex(SlidesRefused, "background must be a colour like #FFFFFF"):
            slides_routes.presentation_write(
                node, [title_slide("Second", background="#fff url(https://x/p.png)")], "replace"
            )

        self.assertEqual(self.texts_of(node), [["<paragraph>First</paragraph>"]])
        kept = [title_slide("Second", background=colour) for colour in ("#fff", "#FFFFFF", "#ffffff80")]
        slides_routes.presentation_write(node, kept, "replace")
        written = slides_routes.presentation_read(node)["slides"]
        self.assertEqual([slide["background"] for slide in written], ["#fff", "#FFFFFF", "#ffffff80"])

    def test_a_picture_copy_the_drive_has_no_room_for_writes_nothing(self):
        other = self.create([title_slide("Other")])
        picture = self.stored_picture(other)
        node = self.create([title_slide("First")])
        root = drive.ensure_personal_root(OWNER)
        quota, used = frappe.db.get_value("Drive Root", root, ["quota_bytes", "used_bytes"])
        frappe.db.set_value("Drive Root", root, "quota_bytes", used)
        self.addCleanup(frappe.db.commit)
        self.addCleanup(frappe.db.set_value, "Drive Root", root, "quota_bytes", quota)

        with self.assertRaises(drive.DriveOverQuota):
            slides_routes.presentation_write(node, [picture_slide(picture)], "replace")

        self.assertFalse(frappe.db.exists("Drive Node", {"parent_node": node, "kind": "file"}))
        frappe.db.rollback()
        self.assertEqual(self.texts_of(node), [["<paragraph>First</paragraph>"]])

    def test_a_layouts_words_keep_their_words_whatever_the_spaces(self):
        texts = ["Plan\nfor\ttoday", ["  two  spaces", " leading", "trailing ", "a\nnewline"]]

        node = self.create([{"layout": 6, "texts": texts}])

        (slide,) = slides_routes.presentation_read(node)["slides"]
        title, points = slide["elements"]
        self.assertEqual(words_of(title["content"]).split(), ["Plan", "for", "today"])
        self.assertEqual(
            [words_of(point).split() for point in points_of(points["content"])],
            [["two", "spaces"], ["leading"], ["trailing"], ["a", "newline"]],
        )

    def test_a_template_the_user_cannot_read_is_not_offered_and_creates_nothing(self):
        ensure_user(OUTSIDER)
        secret = f"Secret {uuid.uuid4().hex[:8]}"
        template = drive.create_document(self.folder, secret, content_doctype=DOCTYPE, is_template=True)
        self.addCleanup(trash_node, template)
        self.addCleanup(delete_log, template)
        folder = frappe.db.get_value("Drive Root", drive.ensure_personal_root(OUTSIDER), "node")
        frappe.db.commit()
        frappe.set_user(OUTSIDER)

        with self.assertRaisesRegex(SlidesRefused, f"No template you can use is called {secret}") as refused:
            slides_routes.presentation_create(folder, "Agent refused", [{"layout": 2}], secret)

        _refusal, listed = str(refused.exception).split("These are: ")
        offered = listed.split(", ")
        self.assertIn("Light", offered)
        self.assertNotIn(secret, offered)
        self.assertFalse(frappe.db.exists("Drive Node", {"parent_node": folder, "title": "Agent refused"}))

    def test_a_template_the_user_can_edit_takes_a_write_and_gives_its_new_layouts(self):
        title = f"Template {uuid.uuid4().hex[:8]}"
        template = drive.create_document(self.folder, title, content_doctype=DOCTYPE, is_template=True)
        self.addCleanup(trash_node, template)
        self.addCleanup(delete_log, template)

        slides_routes.presentation_write(template, [title_slide("Cover", background="#123456")], "replace")
        node = self.create([{"layout": 1, "texts": ["Kickoff"]}], template=title)

        (slide,) = slides_routes.presentation_read(node)["slides"]
        (text,) = slide["elements"]
        self.assertEqual((slide["background"], words_of(text["content"])), ("#123456", "Kickoff"))

    def test_a_trashed_presentation_takes_no_write(self):
        # Trashed here, so not through `create`, whose cleanup trashes it again
        node = slides_routes.presentation_create(self.folder, "Agent trashed", [title_slide("First")])["name"]
        self.addCleanup(delete_log, node)
        (slide,) = slides_routes.presentation_read(node)["slides"]
        trash_node(node)
        frappe.db.commit()
        frappe.set_user(OWNER)
        log = content.find(slides_content.APP, node)

        writes = {
            "replace": lambda: slides_routes.presentation_write(node, [title_slide("Second")], "replace"),
            "append": lambda: slides_routes.presentation_write(node, [title_slide("Second")], "append"),
            "one slide": lambda: slides_routes.presentation_slide_write(
                node, slide["id"], title_slide("Second")
            ),
        }
        for case, write in writes.items():
            with self.subTest(case), self.assertRaises(drive.DriveForbidden):
                write()

        self.assertEqual(content.find(slides_content.APP, node), log)

    def test_a_guest_with_no_key_reaches_no_data_route(self):
        node = self.create([title_slide("First")])
        (slide,) = slides_routes.presentation_read(node)["slides"]
        log = content.find(slides_content.APP, node)
        calls = {
            "presentation_create": (
                "POST",
                {"json": {"parent": self.folder, "title": "Agent refused", "slides": [title_slide()]}},
            ),
            "presentation_write": (
                "POST",
                {"json": {"node": node, "slides": [title_slide("Second")], "mode": "replace"}},
            ),
            "presentation_slide_write": (
                "POST",
                {"json": {"node": node, "slide_id": slide["id"], "slide": title_slide("Second")}},
            ),
            "presentation_read": ("GET", {"query_string": {"node": node}}),
        }
        self.addCleanup(setattr, frappe.local, "request", getattr(frappe.local, "request", None))
        frappe.set_user("Guest")
        for name, (method, sent) in calls.items():
            path = f"/api/method/suite.slides.http.routes.{name}"
            frappe.local.request = Request(EnvironBuilder(path=path, method=method, **sent).get_environ())
            make_form_dict(frappe.local.request)
            with self.subTest(name), self.assertRaises(frappe.PermissionError):
                execute_cmd(path.removeprefix("/api/method/"))

        frappe.set_user(OWNER)
        self.assertEqual(content.find(slides_content.APP, node), log)
        self.assert_created_nothing("Agent refused")

    def test_slides_or_elements_sent_with_one_id_each_get_their_own(self):
        node = self.create([title_slide("First")])
        twice = [{**title_slide("One"), "id": "same"}, {**title_slide("Two"), "id": "same"}]

        slides_routes.presentation_write(node, twice, "replace")

        one, two = slides_routes.presentation_read(node)["slides"]
        self.assertNotEqual(one["id"], two["id"])
        self.assertEqual(
            self.texts_of(node), [["<paragraph>One</paragraph>"], ["<paragraph>Two</paragraph>"]]
        )

        element = {"type": "text", "left": 0, "top": 0, "content": "<p>x</p>", "id": "same-element"}
        elements = [element, {**element, "content": "<p>y</p>"}]
        slides_routes.presentation_write(node, [{"background": "#FFFFFFFF", "elements": elements}], "replace")

        (slide,) = slides_routes.presentation_read(node)["slides"]
        first, second = slide["elements"]
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(self.texts_of(node), [["<paragraph>x</paragraph>", "<paragraph>y</paragraph>"]])
