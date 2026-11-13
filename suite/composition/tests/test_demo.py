"""The Northwind demo data builds without a site, so a change in Writer or Mail shows up here."""

import base64
import json
import unittest
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

import frappe
import pycrdt

from suite.composition.demo import assets, content, mail
from suite.composition.demo.agenda import EVENTS
from suite.composition.demo.cast import EVERYONE, PEOPLE
from suite.composition.demo.make_presentation_states import converted_states
from suite.content import checker, copies
from suite.slides.content import CHECKER_BUILD, CONVERTER_BUILD
from suite.slides.content.conversion import check_state
from suite.slides.tests.test_system_templates import lines_of, read_deck
from suite.writer.content import DECLARED, EDITOR
from suite.writer.content.readable_copy import nodes
from suite.writer.content.seed import body_state

BODIES = {
    "onboarding": content.ONBOARDING,
    "specification": content.PRODUCT_SPEC,
    "meeting": content.MEETING,
    "engineering": content.ENGINEERING,
    "design": content.DESIGN,
    "marketing": content.MARKETING,
    "personal": content.personal_note("Maya", "Product"),
}


def read_body(state: bytes) -> pycrdt.XmlFragment:
    doc: pycrdt.Doc = pycrdt.Doc()
    doc.apply_update(state)
    return doc.get("default", type=pycrdt.XmlFragment)


class TestDemoData(unittest.TestCase):
    def test_writer_bodies_use_only_what_the_editor_declares(self):
        for name, html in BODIES.items():
            with self.subTest(body=name):
                fragment = read_body(body_state(html))
                self.assertGreater(len(fragment.children), 0)
                for node in nodes(fragment):
                    if isinstance(node, pycrdt.XmlElement):
                        self.assertIn(node.tag, DECLARED["nodes"])
                    elif isinstance(node, pycrdt.XmlText):
                        for _run, marks in node.diff():
                            self.assertLessEqual(set(marks or ()), set(DECLARED["marks"]))

    def test_writer_readable_copies_hold_every_body(self):
        for name, html in BODIES.items():
            with self.subTest(body=name):
                clean, text = copies.cleaned(html)
                self.assertTrue(EDITOR.readable_copy.is_html_complete(body_state(html), clean, text))

    def test_every_brand_image_and_uploaded_file_is_found(self):
        self.assertTrue((assets.BRAND / "northwind-icon.png").is_file())
        for person in PEOPLE:
            self.assertTrue((assets.BRAND / "avatars" / f"{person.key}.png").is_file())
        files = assets.uploaded_files()
        self.assertEqual(len(files), 6)
        self.assertTrue(all(files.values()))
        self.assertTrue(files["Equipment policy.pdf"].startswith(b"%PDF"))

    def test_each_stalwart_account_gets_its_own_secret(self):
        payloads = [mail.account_payload(person, "domain") for person in PEOPLE]
        account_secrets = {payload["credentials"]["0"]["secret"] for payload in payloads}
        self.assertEqual(len(account_secrets), len(PEOPLE))

    def test_mail_and_invitations_build_for_real_participants(self):
        now = datetime.now(ZoneInfo("UTC"))
        letters = [*mail.letters(now), *mail.invitations(now)]
        self.assertTrue(all(b"Message-ID" in letter.raw for letter in letters))
        one_off = [event for event in EVENTS if not event.rule and event.attendees]
        self.assertEqual(len(mail.invitations(now)), len(one_off))
        for letter in letters:
            self.assertLessEqual(set(letter.recipients) | letter.flagged, set(EVERYONE))


# Each demo presentation's stored state, by its title
def stored_presentations() -> dict[str, bytes]:
    found = json.loads(assets.PRESENTATION_STATES.read_text(encoding="utf-8"))
    return {title: base64.b64decode(state) for title, state in found.items()}


# Every field a state draws, each element under its own id, with a slide's key and the slide an element names taken out
def rendered(state: bytes) -> dict:
    doc: pycrdt.Doc = pycrdt.Doc()
    doc.apply_update(state)
    slides = doc.get("slides", type=pycrdt.Map)
    elements = doc.get("elements", type=pycrdt.Map)
    on_slide: dict[str, list[dict]] = {}
    for element_id, element in sorted(elements.items(), key=lambda item: item[1]["order"]):
        on_slide.setdefault(element["parent"], []).append({"id": element_id, **plain(element)})

    drawn: list[dict] = []
    for key in sorted(slides.keys(), key=lambda key: slides[key]["order"]):
        drawn.append({**plain(slides[key]), "elements": on_slide.get(key, [])})

    return {"roots": sorted(doc.keys()), "slides": drawn}


# One slide or element's fields as plain values, its own place and parent left out
def plain(entry: pycrdt.Map) -> dict:
    fields: dict = {}
    for name, value in entry.items():
        if name in {"order", "parent"}:
            continue

        if isinstance(value, pycrdt.XmlFragment):
            value = xml_tree(value)

        fields[name] = value

    return fields


# Rich text as its tags, attributes, runs and marks, since its markup lists attributes in no set order
def xml_tree(node: pycrdt.XmlFragment | pycrdt.XmlElement | pycrdt.XmlText):
    if isinstance(node, pycrdt.XmlText):
        return node.diff()

    children = [xml_tree(child) for child in node.children]
    if isinstance(node, pycrdt.XmlElement):
        return {"tag": node.tag, "attributes": dict(node.attributes), "children": children}

    return children


# Each slide's elements, as their kinds and the lines they show
def shown_slides(state: bytes) -> list[list[tuple[str, list[str]]]]:
    shown: list[list[tuple[str, list[str]]]] = []
    for slide in read_deck(state):
        shown.append([(element["type"], lines_of(element)) for element in slide["elements"]])

    return shown


# What each slide of a story shows: an accent, heading, body, card, callout, and numbered footer
def story_slides(story: list[tuple[str, str, str]]) -> list[list[tuple[str, list[str]]]]:
    slides: list[list[tuple[str, list[str]]]] = []
    for number, (heading, body, callout) in enumerate(story, 1):
        footer = f"NORTHWIND LABS     /     {number:02}"
        slides.append(
            [
                ("shape", []),
                ("text", heading.splitlines()),
                ("text", body.splitlines()),
                ("shape", []),
                ("text", [callout]),
                ("text", [footer]),
            ]
        )

    return slides


class TestDemoPresentations(unittest.TestCase):
    def test_both_presentations_ship_as_ready_made_states(self):
        self.assertEqual(
            sorted(stored_presentations()), ["Beacon collections launch", "Q3 review and Q4 priorities"]
        )

    def test_each_stored_presentation_passes_the_checker_and_the_layers_checks(self):
        if not CHECKER_BUILD.is_file():
            self.skipTest("needs the built checker bundle")

        job = patch.object(frappe.local, "job", frappe._dict(job_name="test_demo_presentations"), create=True)
        job.start()
        self.addCleanup(job.stop)
        for title, state in stored_presentations().items():
            with self.subTest(presentation=title):
                self.assertEqual(checker.judge(CHECKER_BUILD, state, []), checker.Verdict(None))
                check_state(state)

    def test_each_stored_presentation_is_what_its_rows_convert_to_today(self):
        if not CONVERTER_BUILD.is_file():
            self.skipTest("needs the built converter bundle")

        self.maxDiff = None
        fresh = converted_states()
        for title, state in stored_presentations().items():
            with self.subTest(presentation=title):
                self.assertEqual(rendered(state), rendered(fresh[title]))

    def test_each_stored_presentation_shows_its_story_slide_by_slide(self):
        stories = {"Q3 review and Q4 priorities": assets.REVIEW, "Beacon collections launch": assets.LAUNCH}
        for title, state in stored_presentations().items():
            with self.subTest(presentation=title):
                self.assertEqual({slide["background"] for slide in read_deck(state)}, {"#102D29FF"})
                self.assertEqual(shown_slides(state), story_slides(stories[title]))
