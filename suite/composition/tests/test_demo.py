"""The Northwind demo data builds without a site, so a change in Writer or Mail shows up here."""

import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

import pycrdt

from suite.composition.demo import assets, content, mail
from suite.composition.demo.agenda import EVENTS
from suite.composition.demo.cast import EVERYONE, PEOPLE
from suite.content import copies
from suite.writer.content import DECLARED, EDITOR
from suite.writer.content.readable_copy import nodes

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
                fragment = read_body(content.body_state(html))
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
                self.assertTrue(EDITOR.readable_copy.is_html_complete(content.body_state(html), clean, text))

    def test_every_brand_image_and_uploaded_file_is_found(self):
        self.assertTrue((assets.BRAND / "northwind-icon.png").is_file())
        for person in PEOPLE:
            self.assertTrue((assets.BRAND / "avatars" / f"{person.key}.png").is_file())
        files = assets.uploaded_files()
        self.assertEqual(len(files), 6)
        self.assertTrue(all(files.values()))
        self.assertTrue(files["Equipment policy.pdf"].startswith(b"%PDF"))

    def test_mail_and_invitations_build_for_real_participants(self):
        now = datetime.now(ZoneInfo("UTC"))
        letters = [*mail.letters(now), *mail.invitations(now)]
        self.assertTrue(all(b"Message-ID" in letter.raw for letter in letters))
        one_off = [event for event in EVENTS if not event.rule and event.attendees]
        self.assertEqual(len(mail.invitations(now)), len(one_off))
        for letter in letters:
            self.assertLessEqual(set(letter.recipients) | letter.flagged, set(EVERYONE))
