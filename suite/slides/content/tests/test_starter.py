"""A starter presentation, such as the welcome kickoff, holds its slides the moment it is made."""

import json
import uuid
from unittest.mock import patch

import frappe
import pycrdt
from frappe.tests import UnitTestCase

from suite import content, drive
from suite.composition.welcome import _kickoff
from suite.content import checker, convert
from suite.slides import slide_row
from suite.slides.content import APP, CHECKER_BUILD, CONVERTER_BUILD, CONVERTER_VERSION
from suite.slides.content.conversion import SLIDE_COLUMNS, legacy_deck
from suite.slides.content.starter import deck_state
from suite.slides.content.tests.support import OWNER, LoggedDeckCase, delete_log, opened, owner_folder
from suite.slides.drive import DOCTYPE, docname_for_node

KICKOFF = [
    ["Company kickoff", "Where we are and where we are going"],
    ["This quarter", "Three outcomes we commit to"],
    ["Next steps", "Owners and dates"],
]


def kickoff() -> str:
    return _kickoff(drive.ensure_folder(owner_folder(), f"Starters {uuid.uuid4().hex[:8]}"))


def kickoff_slides() -> list[list[dict]]:
    made: list[list[list[dict]]] = []
    with patch("suite.slides.create_deck", lambda parent, title, slides: made.append(slides)):
        _kickoff("unused")

    return made[0]


def texts_by_slide(state: bytes) -> list[list[str]]:
    doc: pycrdt.Doc = pycrdt.Doc()
    doc.apply_update(state)
    slides = doc.get("slides", type=pycrdt.Map)
    elements = doc.get("elements", type=pycrdt.Map)
    ordered = sorted(elements.values(), key=lambda element: element["order"])
    shown: dict[str, list[str]] = {}
    for slide in sorted(slides.keys(), key=lambda key: slides[key]["order"]):
        texts = [plain_text(element["text"]) for element in ordered if element["parent"] == slide]
        shown[slide] = texts

    return list(shown.values())


def plain_text(fragment: pycrdt.XmlFragment) -> str:
    runs: list[str] = []
    for block in fragment.children:
        for text in block.children:
            runs.extend(run for run, _attributes in text.diff())

    return "".join(runs)


def deck_as_read(state: bytes) -> list[dict]:
    # every slide in order, its fields and its elements' fields, without the ids a write picks
    doc: pycrdt.Doc = pycrdt.Doc()
    doc.apply_update(state)
    slides = doc.get("slides", type=pycrdt.Map)
    elements = doc.get("elements", type=pycrdt.Map)
    read: list[dict] = []
    for key in sorted(slides.keys(), key=lambda key: slides[key]["order"]):
        read.append({"fields": dict(slides[key].items()), "elements": elements_on(elements, key)})

    return read


def elements_on(elements: pycrdt.Map, slide: str) -> dict[str, dict]:
    drawn: dict[str, dict] = {}
    for name, element in elements.items():
        if element["parent"] == slide:
            drawn[name] = element_as_read(element)

    return drawn


def element_as_read(element: pycrdt.Map) -> dict:
    fields = {name: value for name, value in element.items() if name not in {"parent", "text"}}
    blocks: list[tuple] = []
    for block in element["text"].children:
        blocks.append((block.tag, dict(block.attributes), [text.diff() for text in block.children]))

    return {**fields, "text": blocks}


class TestStarterWhileCollaborationIsOn(LoggedDeckCase):
    def test_the_kickoff_starter_holds_its_three_slides_as_soon_as_it_is_made(self):
        with patch("frappe.enqueue") as enqueue:
            node = kickoff()

        frappe.db.commit()
        self.addCleanup(delete_log, node)
        _header, state = opened(node)

        self.assertEqual(texts_by_slide(state), KICKOFF)
        enqueue.assert_not_called()


class TestStarterMatchesTheConverter(LoggedDeckCase):
    def setUp(self):
        super().setUp()
        if not (CONVERTER_BUILD.is_file() and CHECKER_BUILD.is_file()):
            self.skipTest("needs the built converter and checker bundles")

        job = patch.object(frappe.local, "job", frappe._dict(job_name="test_slides_starter"), create=True)
        job.start()
        self.addCleanup(job.stop)

    def test_the_encoded_kickoff_passes_the_checker(self):
        verdict = checker.judge(CHECKER_BUILD, deck_state(kickoff_slides()), [])

        self.assertEqual(verdict, checker.Verdict(None))

    def test_the_encoded_kickoff_reads_as_the_converter_writes_its_rows(self):
        slides = kickoff_slides()
        rows: list[frappe._dict] = []
        for elements in slides:
            rows.append(
                frappe._dict({"client_id": None, **dict.fromkeys(SLIDE_COLUMNS), **slide_row(elements)})
            )

        legacy = {**legacy_deck("starter", rows), "collab": 0}
        converted = convert.convert(CONVERTER_BUILD, CONVERTER_VERSION, legacy)

        self.assertIsInstance(converted, convert.Converted)
        self.assertEqual(deck_as_read(deck_state(slides)), deck_as_read(converted.state))


class TestStarterRefusesWhatTheKickoffDoesNotHold(UnitTestCase):
    def assert_refused(self, slides: list[list[dict]]) -> None:
        with self.assertRaises(ValueError):
            deck_state(slides)

    def test_a_duplicate_element_id_raises(self):
        slides = kickoff_slides()
        slides[1][0] = {**slides[1][0], "id": slides[0][0]["id"]}

        self.assert_refused(slides)

    def test_a_span_style_the_kickoff_does_not_use_raises(self):
        for style in ("opacity: 0.5", "line-height: 2", "font-weight: 700"):
            with self.subTest(style=style):
                slides = kickoff_slides()
                element = slides[0][0]
                slides[0][0] = {**element, "content": element["content"].replace('">', f'; {style};">', 1)}
                self.assert_refused(slides)

    def test_a_span_style_value_the_kickoff_does_not_use_raises(self):
        for used, other in (("Inter", "Georgia"), ("48px", "3em"), ("#171717FF", "red")):
            with self.subTest(other=other):
                slides = kickoff_slides()
                element = slides[0][0]
                slides[0][0] = {**element, "content": element["content"].replace(used, other)}
                self.assert_refused(slides)

    def test_an_element_field_the_kickoff_does_not_use_raises(self):
        for changed in ({"opacity": 50}, {"rotation": 15}, {"transform": "rotate(1deg)"}, {"zIndex": 2}):
            with self.subTest(changed=changed):
                slides = kickoff_slides()
                slides[0][0] = {**slides[0][0], **changed}
                self.assert_refused(slides)

    def test_the_kickoff_itself_encodes(self):
        self.assertEqual(texts_by_slide(deck_state(kickoff_slides())), KICKOFF)


class TestStarterWhileCollaborationIsOff(LoggedDeckCase):
    def test_the_kickoff_starter_writes_its_slides_as_rows(self):
        self.turn_off()
        frappe.set_user(OWNER)

        node = kickoff()

        rows = frappe.get_doc(DOCTYPE, docname_for_node(node)).slides
        texts = [[element["content"] for element in json.loads(row.elements)] for row in rows]
        self.assertIsNone(content.find(APP, node))
        self.assertEqual(len(texts), 3)
        for shown, (heading, body) in zip(texts, KICKOFF, strict=True):
            self.assertIn(heading, shown[0])
            self.assertIn(body, shown[1])
