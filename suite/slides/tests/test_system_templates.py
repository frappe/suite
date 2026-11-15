"""The shipped Light and Dark template decks (§8.10).

`seed_system_templates` runs from `after_install` and `after_migrate`, so the
site it runs on may already hold the decks. The seeded decks are left in place:
they are what every installed site has, not a fixture.
"""

import base64
import json
import re
from pathlib import Path
from unittest.mock import patch

import frappe
import pycrdt
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite import drive
from suite.content import checker
from suite.slides.content import CHECKER_BUILD
from suite.slides.content.conversion import check_state
from suite.slides.content.tests.support import (
    LoggedDeckCase,
    delete_log,
    opened,
    owner_folder,
    trash_template,
)
from suite.slides.doctype.presentation.presentation import get_templates
from suite.slides.install import _seed, seed_system_templates
from suite.slides.tests.utils import make_presentation
from suite.tests.utils import ensure_user

READER = "slides-template-reader@example.com"

# Written from the picker's contract, not from the seed: a shipped deck's
# layouts are drawn from the asset path keyed by its lowercased title.
EXPECTED = {
    "Light": {"background": "#FFFFFFFF", "thumbnail": "/assets/suite/slides/frontend/images/layouts/light/"},
    "Dark": {"background": "#000000FF", "thumbnail": "/assets/suite/slides/frontend/images/layouts/dark/"},
}


class TestSystemTemplates(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        ensure_user(READER)
        self.addCleanup(frappe.set_user, "Administrator")

    def test_seeding_twice_gives_every_user_one_light_and_one_dark_deck_of_seven_layouts(self):
        seed_system_templates()
        seed_system_templates()

        frappe.set_user(READER)
        shipped = [template for template in get_templates() if template["title"] in EXPECTED]

        self.assertEqual(sorted(template["title"] for template in shipped), ["Dark", "Light"])
        for template in shipped:
            with self.subTest(template=template["title"]):
                expected = EXPECTED[template["title"]]
                layouts = template["layouts"]
                self.assertEqual(len(layouts), 7)
                self.assertEqual({layout["background"] for layout in layouts}, {expected["background"]})
                self.assertEqual(
                    [layout["thumbnail"] for layout in layouts],
                    [f"{expected['thumbnail']}thumbnail-{index}.webp" for index in range(1, 8)],
                )
                deck = frappe.get_doc("Presentation", template["name"])
                self.assertFalse(
                    deck.theme, "a template names no theme; a deck made from it names the template"
                )
                self.assertEqual(deck.node_title, template["title"])

    def test_a_logged_out_visitor_sees_no_shipped_template(self):
        seed_system_templates()

        frappe.set_user("Guest")
        titles = {template["title"] for template in get_templates()}

        self.assertFalse(titles & set(EXPECTED))

    def test_a_deck_made_in_drive_starts_on_the_light_template(self):
        seed_system_templates()
        deck = make_presentation("Deck made in Drive")

        frappe.set_user(READER)
        templates = {template["name"]: template for template in get_templates()}
        theme = templates.get(deck.theme, {})

        self.assertEqual(theme.get("title"), "Light")
        self.assertEqual(len(theme.get("layouts", [])), 7)

    def test_a_template_made_in_drive_names_no_theme(self):
        seed_system_templates()

        template = make_presentation("Template made in Drive", is_template=True)

        self.assertFalse(template.theme)


SHIPPED_FILE = Path(frappe.get_app_path("suite", "slides", "templates", "system_templates.json"))
# Each of the seven layouts the picker offers, as its elements' kinds and the lines they show
LAYOUTS = [
    [],
    [("text", ["Title"])],
    [("text", ["Title"]), ("text", ["Subtitle"])],
    [("text", ["Title"])],
    [("text", ["Title"]), ("text", ["Subtitle"])],
    [
        ("text", ["Title"]),
        ("text", ["Insert first point here", "Insert second point here", "Insert third point here"]),
    ],
    [("text", ["Title"]), ("image", [])],
]
PLACEHOLDER = "/assets/suite/slides/frontend/images/layouts/placeholder.webp"
# The colour mark on each template's title text
TITLE_COLOR = {"Light": 'color="#000000FF"', "Dark": 'color="#FFFFFFFF"'}


def shipped() -> dict[str, bytes]:
    found = json.loads(SHIPPED_FILE.read_text(encoding="utf-8"))
    return {template["title"]: base64.b64decode(template["state"]) for template in found}


def read_deck(state: bytes) -> list[dict]:
    # each slide in order: its background and its elements' fields, in their order
    doc: pycrdt.Doc = pycrdt.Doc()
    doc.apply_update(state)
    slides = doc.get("slides", type=pycrdt.Map)
    elements = doc.get("elements", type=pycrdt.Map)
    ordered = sorted(elements.values(), key=lambda element: element["order"])
    read: list[dict] = []
    for key in sorted(slides.keys(), key=lambda key: slides[key]["order"]):
        on_slide = [dict(element.items()) for element in ordered if element["parent"] == key]
        read.append({"background": slides[key]["background"], "elements": on_slide})

    return read


def lines_of(element: dict) -> list[str]:
    if "text" not in element:
        return []

    markup = str(element["text"]).replace("</paragraph>", "\n")
    return [line for line in re.sub(r"<[^>]+>", "", markup).split("\n") if line]


def layouts_of(state: bytes) -> list[list[tuple[str, list[str]]]]:
    layouts: list[list[tuple[str, list[str]]]] = []
    for slide in read_deck(state):
        layouts.append([(element["type"], lines_of(element)) for element in slide["elements"]])

    return layouts


def keys_of(state: bytes) -> set[str]:
    kept: set[str] = set()
    for slide in read_deck(state):
        for element in slide["elements"]:
            kept.update(element)

    return kept


def title_markup(deck: list[dict]) -> str:
    # the second layout's one element is its title
    [title] = deck[1]["elements"]
    return str(title["text"])


class TestShippedTemplates(UnitTestCase):
    def test_light_and_dark_ship_as_ready_made_presentations(self):
        self.assertEqual(sorted(shipped()), ["Dark", "Light"])

    def test_each_shipped_template_passes_the_checker_and_the_layers_checks(self):
        if not CHECKER_BUILD.is_file():
            self.skipTest("needs the built checker bundle")

        job = patch.object(frappe.local, "job", frappe._dict(job_name="test_shipped_templates"), create=True)
        job.start()
        self.addCleanup(job.stop)
        for title, state in shipped().items():
            with self.subTest(template=title):
                self.assertEqual(checker.judge(CHECKER_BUILD, state, []), checker.Verdict(None))
                check_state(state)

    def test_each_shipped_template_shows_the_seven_layouts_in_its_colours(self):
        backgrounds = {"Light": "#FFFFFFFF", "Dark": "#000000FF"}
        for title, state in shipped().items():
            with self.subTest(template=title):
                deck = read_deck(state)
                self.assertEqual(layouts_of(state), LAYOUTS)
                self.assertEqual({slide["background"] for slide in deck}, {backgrounds[title]})
                self.assertIn(TITLE_COLOR[title], title_markup(deck))
                self.assertEqual(deck[6]["elements"][1]["src"], PLACEHOLDER)

    def test_no_shipped_element_keeps_the_old_editors_style_name_or_file_name(self):
        for title, state in shipped().items():
            with self.subTest(template=title):
                self.assertFalse(keys_of(state) & {"defaultStyle", "attachmentName"})


class TestSeedingWhileCollaborationIsOn(LoggedDeckCase):
    def test_a_seeded_template_starts_from_its_shipped_presentation(self):
        suffix = frappe.generate_hash(6)
        folder = drive.ensure_folder(owner_folder(), f"Seeded {suffix}")

        node = _seed(folder, "Dark")
        frappe.db.commit()
        self.addCleanup(trash_template, node)
        self.addCleanup(delete_log, node)
        _header, state = opened(node)

        self.assertEqual(layouts_of(state), LAYOUTS)
        self.assertIn(TITLE_COLOR["Dark"], title_markup(read_deck(state)))
