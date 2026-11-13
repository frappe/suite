"""Upgrading an old `presentation/1` version of a converted deck for a restore in the editor (Q6)."""

import base64
import json
from io import BytesIO
from unittest.mock import call, patch

import frappe
import pycrdt

from suite import drive
from suite.content import scheduling
from suite.slides import drive as slides_drive
from suite.slides.api import versions
from suite.slides.content.tests.support import OWNER
from suite.slides.content.tests.test_conversion import ConversionCase, converted_deck, text_element
from suite.slides.tests.utils import share
from suite.tests.utils import ensure_user

READER = "slides-version-reader@example.com"


def kept_version(node: str) -> int:
    return next(row.seq for row in drive.list_versions(node)["rows"] if row.label == "Before collaboration")


def restored_deck(answer: dict) -> pycrdt.Doc:
    doc: pycrdt.Doc = pycrdt.Doc()
    doc.apply_update(base64.b64decode(answer["state"]))
    return doc


def element_texts(doc: pycrdt.Doc) -> list[str]:
    elements = doc.get("elements", type=pycrdt.Map)
    return sorted(str(elements[key]["text"]) for key in elements.keys())


class TestVersionConversion(ConversionCase):
    def setUp(self):
        super().setUp()
        frappe.cache.delete_value(versions.VERSION_SLOT, user=True)
        self.addCleanup(frappe.cache.delete_value, versions.VERSION_SLOT, user=True)

    def ask(self, node: str, seq: int) -> tuple[dict, list]:
        # As the page asks, outside a job
        frappe.set_user(OWNER)
        with patch.object(frappe.local, "job", None), patch.object(scheduling, "enqueue") as enqueue:
            answer = versions.convert_version(node, seq)

        return answer, enqueue.call_args_list

    def poll(self, node: str, seq: int) -> dict:
        answer, queued = self.ask(node, seq)
        self.assertEqual(answer, {"pending": True})
        job = call(
            "suite.slides.api.versions.run_version_conversion",
            f"suite-slides-convert-version-{node}-{seq}",
            timeout=300,
            node=node,
            seq=seq,
        )
        self.assertEqual(queued, [job])
        versions.run_version_conversion(node=node, seq=seq)
        answer, queued = self.ask(node, seq)
        self.assertEqual(queued, [])
        return answer

    def converted_with_version(self, *slides: list[dict]) -> tuple[str, int]:
        node = self.old_deck(*slides)
        self.assertEqual(self.convert(node), "converted")
        return node, kept_version(node)

    def test_the_version_from_before_collaboration_upgrades_to_the_deck_it_converted_to(self):
        # Both slides hold "same", so the second element gets a new id, the one the conversion gave it
        node, seq = self.converted_with_version(
            [text_element("same", content="<p>first</p>")],
            [text_element("same", content="<p>second</p>")],
        )
        live = converted_deck(node)

        restored = restored_deck(self.poll(node, seq))

        for root in ("slides", "elements"):
            restored_keys = set(restored.get(root, type=pycrdt.Map).keys())
            self.assertEqual(restored_keys, set(live.get(root, type=pycrdt.Map).keys()))

        texts = element_texts(restored)
        self.assertEqual(len(texts), 2)
        first, second = texts
        self.assertIn("first", first)
        self.assertIn("second", second)

    def test_an_older_version_upgrades_to_what_it_held_not_to_the_deck_now(self):
        node = self.old_deck([text_element("one", content="<p>then</p>")])
        seq = drive.take_version(node)
        frappe.db.set_value(
            "Slide",
            {"parent": slides_drive.docname_for_node(node)},
            "elements",
            json.dumps([text_element("one", content="<p>now</p>")]),
        )
        frappe.db.commit()
        self.assertEqual(self.convert(node), "converted")

        texts = element_texts(restored_deck(self.poll(node, seq)))

        self.assertEqual(len(texts), 1)
        self.assertIn("then", texts[0])

    def test_a_second_ask_before_the_job_runs_is_still_pending_and_queues_no_second_read(self):
        node, seq = self.converted_with_version([text_element("one")])
        self.ask(node, seq)

        with patch.object(drive, "read_version", side_effect=AssertionError("read again")):
            answer, _queued = self.ask(node, seq)

        self.assertEqual(answer, {"pending": True})

    def test_a_presentation_still_on_its_rows_is_refused_and_nothing_is_queued(self):
        node = self.old_deck([text_element("one")])
        seq = drive.take_version(node)
        frappe.db.commit()

        with self.assertRaises(frappe.ValidationError):
            self.ask(node, seq)

        self.assertIsNone(frappe.cache.get_value(versions.version_key("input", node, seq)))

    def test_a_reader_without_edit_is_refused(self):
        node, seq = self.converted_with_version([text_element("one")])
        ensure_user(READER)
        share(slides_drive.docname_for_node(node), READER)
        frappe.db.commit()
        frappe.set_user(READER)

        with self.assertRaises(drive.DriveError):
            versions.convert_version(node, seq)

        self.assertIsNone(frappe.cache.get_value(versions.version_key("input", node, seq)))

    def test_a_version_only_another_presentation_has_is_refused(self):
        node, _kept = self.converted_with_version([text_element("one")])
        other = self.old_deck([text_element("theirs")])
        held = {row.seq for row in drive.list_versions(node)["rows"]}
        missing = drive.take_version(other)
        while missing in held:
            missing = drive.take_version(other)

        frappe.db.commit()

        with self.assertRaises(drive.DriveNotFound):
            self.ask(node, missing)

        self.assertIsNone(frappe.cache.get_value(versions.version_key("input", node, missing)))

    def test_a_version_that_is_yjs_already_is_refused(self):
        node, _kept = self.converted_with_version([text_element("one")])
        seq = drive.take_version(node)
        frappe.db.commit()

        with self.assertRaisesRegex(frappe.ValidationError, "predates Drive history"):
            self.ask(node, seq)

    def test_stored_bytes_that_do_not_read_are_refused(self):
        node, seq = self.converted_with_version([text_element("one")])
        for raw in ("not json", json.dumps({"schema": "presentation/1", "slides": "x", "references": []})):
            with (
                self.subTest(raw=raw),
                patch.object(drive, "read_version", return_value=BytesIO(raw.encode())),
                self.assertRaises(frappe.ValidationError),
            ):
                self.ask(node, seq)

    def test_a_combined_version_is_refused_with_a_reason_the_owner_can_read(self):
        node = self.old_deck([text_element("one")])
        docname = slides_drive.docname_for_node(node)
        frappe.db.set_value("Presentation", docname, "is_composite", 1)
        seq = drive.take_version(node)
        frappe.db.set_value("Presentation", docname, "is_composite", 0)
        frappe.db.commit()
        self.assertEqual(self.convert(node), "converted")

        answer, queued = self.ask(node, seq)
        reason = "it was saved while this was a combined presentation, which has no slides of its own"
        self.assertEqual((answer, queued), ({"reason": reason}, []))

        frappe.set_user("Administrator")
        with patch.object(frappe.local, "job", None), patch.object(scheduling, "enqueue"):
            self.assertEqual(versions.convert_version(node, seq), {"reason": f"{reason} (combined)"})

    def test_a_version_whose_rows_do_not_parse_is_refused_with_a_reason_that_names_no_check(self):
        node = self.old_deck([text_element("one")])
        rows = {"parent": slides_drive.docname_for_node(node)}
        frappe.db.set_value("Slide", rows, "elements", '"not a list"')
        seq = drive.take_version(node)
        frappe.db.set_value("Slide", rows, "elements", json.dumps([text_element("one")]))
        frappe.db.commit()
        self.assertEqual(self.convert(node), "converted")

        reason = "some of its content can't be upgraded"
        self.assertEqual(self.poll(node, seq), {"reason": reason})

        frappe.set_user("Administrator")
        self.assertEqual(versions.convert_version(node, seq), {"reason": f"{reason} (check: elements)"})

    def test_a_crashed_job_answers_crashed_and_leaves_no_input(self):
        node, seq = self.converted_with_version([text_element("one")])
        self.ask(node, seq)

        with patch.object(versions.convert, "convert", side_effect=RuntimeError("boom")):
            versions.run_version_conversion(node=node, seq=seq)

        self.assertIsNone(frappe.cache.get_value(versions.version_key("input", node, seq)))
        reason = "the upgrade stopped before it finished"
        self.assertEqual(self.ask(node, seq), ({"reason": reason}, []))
        frappe.set_user("Administrator")
        self.assertEqual(versions.convert_version(node, seq), {"reason": f"{reason} (crashed)"})
