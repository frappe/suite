"""Converting an old deck through the layer: the Slide rows it leaves and the deck it writes (ticket 51)."""

import json
import uuid
from unittest.mock import patch

import frappe
import frappe.client
import pycrdt
from frappe.model.document import Document

from suite import content, drive
from suite.composition.welcome import _kickoff
from suite.content import compaction, conversions, convert, log
from suite.drive._core import comments
from suite.drive.framework import principals_for
from suite.slides import content as slides_content
from suite.slides import drive as slides_drive
from suite.slides.api.slides import save_slides
from suite.slides.content import APP, CONVERTER_BUILD
from suite.slides.content.tests.support import OWNER, LoggedDeckCase, delete_log, opened, owner_folder
from suite.slides.doctype.presentation.presentation import apply_theme, get_public_presentation
from suite.slides.patches import move_file_media_to_drive


def text_element(element_id, **fields) -> dict:
    return {"id": element_id, "type": "text", "content": "<p>a</p>", "left": 10, "top": 20, **fields}


def table_element(element_id) -> dict:
    # As the editor saves a one-cell table
    cell = '<td colspan="1" rowspan="1"><p>a</p></td>'
    body = f'<colgroup><col style="min-width: 25px"></colgroup><tbody><tr>{cell}</tr></tbody>'
    return {"id": element_id, "type": "table", "content": f'<table style="min-width: 25px">{body}</table>'}


def left_of(element: pycrdt.Map) -> int | None:
    return element["frame"].get("left")


def elements_by_left(elements: pycrdt.Map) -> dict:
    return {left_of(elements[key]): elements[key] for key in elements.keys()}


def magic_move_keys(elements: pycrdt.Map) -> dict:
    # What the old view pairs elements across slides on, by each element's place
    return {left_of(elements[key]): elements[key].get("refId") or key for key in elements.keys()}


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
    def test_a_list_item_colour_converts_where_the_old_view_inherited_it(self):
        node = self.old_deck(
            [text_element("element", content='<ul><li style="color: red"><p>a</p></li></ul>')]
        )

        self.assertEqual(self.convert(node), "converted")

    def test_each_common_list_converts_as_the_editor_saves_it(self):
        # The editor puts each item's text in a paragraph, which the old view's marker is drawn on
        lists = {
            "bullets": "<ul><li><p>first point</p></li><li><p>second point</p></li></ul>",
            "numbers": "<ol><li><p>first point</p></li><li><p>second point</p></li></ol>",
            "nested": "<ul><li><p>first</p><ul><li><p>inner</p></li></ul></li><li><p>second</p></li></ul>",
            "marked item": "<ul><li><p><strong>first</strong> point</p></li><li><p>second <em>point</em></p></li></ul>",
        }
        for name, html in lists.items():
            with self.subTest(name):
                node = self.old_deck([text_element("element", content=html)])

                self.assertEqual(self.convert(node), "converted")

    def test_a_converted_deck_keeps_its_comments(self):
        node = self.old_deck([text_element("one")])
        reader = principals_for(OWNER)
        comments.create_thread(reader, node, "element", "Move this up")
        before = comments.threads(reader, node)

        self.assertEqual(self.convert(node), "converted")

        after = comments.threads(reader, node)
        self.assertEqual(after, before)
        self.assertEqual(after[0].comments[0].content, "Move this up")

    def test_a_deck_converts_keeping_its_rows_and_the_old_deck_as_a_version(self):
        node = self.old_deck([text_element("one")], [text_element("two")])
        before = self.rows(node)

        self.assertEqual(self.convert(node), "converted")

        self.assertEqual(self.rows(node), before)
        versions = drive.list_versions(node)["rows"]
        kept = next(row for row in versions if row.label == "Before collaboration")
        payload = json.loads(drive.read_version(node, kept.seq).read())
        held = [json.loads(slide["elements"]) for slide in payload["slides"]]
        self.assertEqual([[element["id"] for element in elements] for elements in held], [["one"], ["two"]])

    def test_a_converted_deck_keeps_its_old_version_with_no_edit_in_its_activity(self):
        node = self.old_deck([text_element("one")])

        self.assertEqual(self.convert(node), "converted")

        labels = [row.label for row in drive.list_versions(node)["rows"]]
        self.assertIn("Before collaboration", labels)
        self.assertFalse(frappe.db.exists("Drive Activity", {"node": node, "action": "edit"}))

    def test_the_deck_holds_every_slide_and_element_in_order_and_an_old_file_url(self):
        url = "/private/files/old-picture.png"
        node = self.old_deck(
            [text_element("one"), {"id": "pic", "type": "image", "src": url}], [text_element("two")]
        )
        self.assertEqual(self.convert(node), "converted")

        doc = converted_deck(node)
        slides = doc.get("slides", type=pycrdt.Map)
        elements = doc.get("elements", type=pycrdt.Map)
        self.assertEqual(set(slides.keys()), {"slide-0", "slide-1"})
        self.assertEqual(elements["one"]["parent"], "slide-0")
        self.assertEqual(elements["two"]["parent"], "slide-1")
        self.assertEqual(elements["pic"]["src"], url)
        self.assertLess(slides["slide-0"]["order"], slides["slide-1"]["order"])

    def test_a_repeated_id_is_repaired_and_a_connector_on_its_slide_follows(self):
        ends = {"start": {"elementId": "same"}, "end": {"elementId": "first"}}
        node = self.old_deck(
            [text_element("same"), text_element("first")],
            [text_element("same"), {"id": "line", "type": "shape", "connector": ends}],
            client_ids=["slide", "slide"],
        )
        self.assertEqual(self.convert(node), "converted")

        doc = converted_deck(node)
        slides = doc.get("slides", type=pycrdt.Map)
        elements = doc.get("elements", type=pycrdt.Map)
        self.assertEqual(len(slides), 2)
        self.assertEqual(len(elements), 4)
        self.assertEqual(elements["same"]["parent"], "slide")
        line = elements["line"]
        other_slide = line["parent"]
        self.assertNotEqual(other_slide, "slide")
        start = line["connectorStart"]["elementId"]
        self.assertNotEqual(start, "same")
        self.assertEqual(elements[start]["parent"], other_slide)
        # The end names an element on the first slide, whose id never changed
        self.assertEqual(line["connectorEnd"]["elementId"], "first")

    def test_a_magic_move_link_is_left_alone_when_an_id_is_repaired(self):
        node = self.old_deck(
            [text_element("same", refId="link")], [text_element("same", refId="link")], client_ids=["a", "b"]
        )
        self.assertEqual(self.convert(node), "converted")

        elements = converted_deck(node).get("elements", type=pycrdt.Map)
        self.assertEqual({elements[key]["refId"] for key in elements.keys()}, {"link"})

    def test_a_connector_stays_on_the_element_the_old_view_drew_it_to(self):
        # The old view takes the first element on the slide holding the id
        line = {"id": "line", "type": "shape", "connector": {"start": {"elementId": "dup"}, "end": None}}
        other = {**line, "id": "other", "connector": {"start": {"elementId": "twice"}, "end": None}}
        node = self.old_deck(
            [text_element("dup", left=1), text_element("dup", left=2), line],
            [text_element("twice", left=1)],
            [text_element("twice", left=3), text_element("twice", left=4), other],
        )
        self.assertEqual(self.convert(node), "converted")

        elements = converted_deck(node).get("elements", type=pycrdt.Map)
        self.assertEqual(left_of(elements[elements["line"]["connectorStart"]["elementId"]]), 1)
        self.assertEqual(left_of(elements[elements["other"]["connectorStart"]["elementId"]]), 3)

    def test_a_magic_move_pair_made_by_id_alone_still_pairs(self):
        # Magic Move pairs elements across slides on `refId || id`
        node = self.old_deck(
            [text_element("same", refId="same", left=1)],
            [text_element("same", left=2)],
            [text_element("alone", left=3), text_element("same", left=4)],
        )
        self.assertEqual(self.convert(node), "converted")

        elements = converted_deck(node).get("elements", type=pycrdt.Map)
        keys = magic_move_keys(elements)
        self.assertEqual(keys[1], keys[2])
        self.assertEqual(keys[2], keys[4])

    def test_a_repaired_element_gets_no_pair_it_did_not_have(self):
        # Two elements on one slide can't both be the element a pair tweens to
        node = self.old_deck([text_element("dup", left=1), text_element("dup", left=2)])
        self.assertEqual(self.convert(node), "converted")

        elements = converted_deck(node).get("elements", type=pycrdt.Map)
        keys = magic_move_keys(elements)
        self.assertNotEqual(keys[1], keys[2])

    def test_an_explicit_ref_id_on_a_repaired_element_stays(self):
        node = self.old_deck([text_element("same", left=1)], [text_element("same", refId="link", left=2)])
        self.assertEqual(self.convert(node), "converted")

        elements = converted_deck(node).get("elements", type=pycrdt.Map)
        by_left = elements_by_left(elements)
        self.assertEqual(by_left[2]["refId"], "link")
        self.assertNotIn("refId", by_left[1])

    def test_a_malformed_id_is_repaired_rather_than_leaving_the_deck_pending(self):
        bad_end = {"id": "line", "type": "shape", "connector": {"start": {"elementId": []}, "end": None}}
        node = self.old_deck(
            [text_element([], left=1), text_element({"a": 1}, left=2), text_element(None, left=3), bad_end]
        )
        self.assertEqual(self.convert(node), "converted")

        elements = converted_deck(node).get("elements", type=pycrdt.Map)
        self.assertEqual(len(elements), 4)
        self.assertTrue(all(isinstance(key, str) and key for key in elements.keys()))
        self.assertEqual(elements["line"]["connectorStart"]["elementId"], [])

    def test_a_connector_follows_an_element_with_a_number_for_an_id(self):
        line = {"id": "line", "type": "shape", "connector": {"start": {"elementId": 7}, "end": None}}
        node = self.old_deck([text_element(7, left=1), line])
        self.assertEqual(self.convert(node), "converted")

        elements = converted_deck(node).get("elements", type=pycrdt.Map)
        self.assertEqual(left_of(elements[elements["line"]["connectorStart"]["elementId"]]), 1)

    def test_a_deck_with_no_slides_converts(self):
        node = self.old_deck()
        self.assertEqual(self.convert(node), "converted")
        self.assertIsNotNone(log.find(APP, node))

    def test_a_refusal_leaves_the_rows_and_shows_its_reason_to_a_system_manager_only(self):
        for name, slides, detail in (
            ("html", [[text_element("element", content="<h1>a</h1>")]], "html"),
            ("element type", [[{"id": "element", "type": "chart"}]], "element_type"),
            ("setting", [[text_element("element", sparkle=True)]], "setting"),
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

    def test_a_table_that_would_lose_its_magic_move_key_is_refused(self):
        # A table pairs on its id alone, so giving this one a new id would break the pair
        table = table_element("same")
        node = self.old_deck([table], [table])

        self.assertEqual(self.convert(node), "check")
        self.assertIn("magic_move", conversions.conversion_status(APP, node)["reason"])
        self.assertIsNone(content.find(APP, node))

    def test_a_table_with_an_id_of_its_own_still_converts(self):
        table = table_element("only")
        node = self.old_deck([table], [text_element("element")])

        self.assertEqual(self.convert(node), "converted")

    def test_rows_that_do_not_parse_are_refused(self):
        node = self.old_deck([text_element("element")])
        frappe.db.set_value(
            "Slide", {"parent": slides_drive.docname_for_node(node)}, "elements", '"not a list"'
        )
        frappe.db.commit()

        self.assertEqual(self.convert(node), "check")
        self.assertIn("elements", conversions.conversion_status(APP, node)["reason"])

    def test_a_combined_deck_never_waits_to_convert(self):
        node = self.old_deck([text_element("element")])
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


def seen_only_by_a_locking_read(find):
    def read(app: str, node: str, for_update: bool = False):
        if for_update:
            return find(app, node, for_update=True)

        return None

    return read


class TestOldPathsOnAConvertedDeck(ConversionCase):
    def owned_row(self, node: str) -> Document:
        name = frappe.db.get_value("Slide", {"parent": slides_drive.docname_for_node(node)}, "name")
        frappe.set_user(OWNER)
        return frappe.get_doc("Slide", name)

    def test_a_slide_row_saved_on_its_own_is_refused_and_writes_nothing(self):
        node = self.old_deck([text_element("element")])
        self.convert(node)
        before = self.rows(node)
        row = self.owned_row(node)
        row.elements = "[]"

        with self.assertRaises(drive.DriveConflict):
            frappe.client.save(row.as_dict())

        frappe.db.rollback()
        self.assertEqual(self.rows(node), before)

    def test_a_converted_decks_row_saved_into_a_plain_deck_is_refused_and_moves_nothing(self):
        node = self.old_deck([text_element("element")])
        self.convert(node)
        before = self.rows(node)
        plain = self.old_deck([text_element("other")])
        row = self.owned_row(node)
        deck = frappe.get_doc("Presentation", slides_drive.docname_for_node(plain))
        deck.append("slides", row.as_dict())

        with self.assertRaises(drive.DriveConflict):
            frappe.client.save(deck.as_dict())

        frappe.db.rollback()
        self.assertEqual(self.rows(node), before)

    def test_a_plain_decks_row_saved_into_another_plain_deck_is_refused_and_moves_nothing(self):
        node = self.old_deck([text_element("element")])
        before = self.rows(node)
        plain = self.old_deck([text_element("other")])
        row = self.owned_row(node)
        deck = frappe.get_doc("Presentation", slides_drive.docname_for_node(plain))
        deck.append("slides", row.as_dict())

        with self.assertRaises(drive.DriveConflict):
            frappe.client.save(deck.as_dict())

        frappe.db.rollback()
        self.assertEqual(self.rows(node), before)

    def test_a_plain_deck_still_saves_its_own_rows_and_a_new_one(self):
        node = self.old_deck([text_element("element")])
        name = slides_drive.docname_for_node(node)
        own = frappe.db.get_value("Slide", {"parent": name}, "name")
        frappe.set_user(OWNER)
        deck = frappe.get_doc("Presentation", name)
        deck.slides[0].elements = "[]"
        deck.append("slides", {"client_id": "new", "elements": "[]"})

        frappe.client.save(deck.as_dict())

        frappe.set_user("Administrator")
        rows = frappe.get_all("Slide", {"parent": name}, ["name", "elements"], order_by="idx")
        self.assertEqual(len(rows), 2)
        self.assertEqual((rows[0].name, rows[0].elements), (own, "[]"))

    def named_rows(self, node: str) -> list[str]:
        return frappe.get_all(
            "Slide", {"parent": slides_drive.docname_for_node(node)}, pluck="name", order_by="idx"
        )

    def test_a_converted_decks_row_renamed_is_refused_and_keeps_its_name(self):
        node = self.old_deck([text_element("element")])
        self.convert(node)
        before = self.named_rows(node)
        row = self.owned_row(node)

        with self.assertRaises(drive.DriveConflict):
            frappe.client.rename_doc("Slide", row.name, f"{row.name}-renamed")

        frappe.db.rollback()
        self.assertEqual(self.named_rows(node), before)

    def test_a_plain_decks_row_merged_into_a_converted_decks_row_is_refused(self):
        node = self.old_deck([text_element("element")])
        self.convert(node)
        before = self.named_rows(node)
        plain = self.old_deck([text_element("other")])
        plain_rows = self.named_rows(plain)
        frappe.set_user(OWNER)

        with self.assertRaises(drive.DriveConflict):
            frappe.client.rename_doc("Slide", plain_rows[0], before[0], merge=True)

        frappe.db.rollback()
        self.assertEqual((self.named_rows(node), self.named_rows(plain)), (before, plain_rows))

    def test_a_parent_save_that_names_a_row_anew_is_refused_and_deletes_nothing(self):
        node = self.old_deck([text_element("element")])
        self.convert(node)
        before = self.named_rows(node)
        frappe.set_user(OWNER)
        deck = frappe.get_doc("Presentation", slides_drive.docname_for_node(node))
        deck.slides[0].name = "a-row-nobody-has"

        with self.assertRaises(drive.DriveConflict):
            frappe.client.save(deck.as_dict())

        frappe.db.rollback()
        self.assertEqual(self.named_rows(node), before)

    def test_an_old_tab_saving_a_theme_after_its_row_was_renamed_deletes_nothing(self):
        node = self.old_deck([text_element("element")])
        self.convert(node)
        before = self.named_rows(node)
        frappe.set_user(OWNER)
        deck = frappe.get_doc("Presentation", slides_drive.docname_for_node(node))
        # The rename is refused on its own, so it stands in for one that got past the fence
        frappe.db.set_value("Slide", before[0], "name", f"{before[0]}-renamed")
        renamed = self.named_rows(node)
        deck.theme = None

        with self.assertRaises(drive.DriveConflict):
            frappe.client.save(deck.as_dict())

        self.assertEqual(self.named_rows(node), renamed)

    def test_a_plain_decks_row_still_renames(self):
        node = self.old_deck([text_element("element")])
        [own] = self.named_rows(node)
        frappe.set_user(OWNER)

        frappe.client.rename_doc("Slide", own, f"{own}-renamed")

        self.assertEqual(self.named_rows(node), [f"{own}-renamed"])

    def test_a_parent_save_that_reorders_a_converted_decks_rows_is_refused(self):
        node = self.old_deck([text_element("first")], [text_element("second")])
        self.convert(node)
        before = self.named_rows(node)
        frappe.set_user(OWNER)
        deck = frappe.get_doc("Presentation", slides_drive.docname_for_node(node))
        deck.slides[0].idx = 999

        with self.assertRaises(drive.DriveConflict):
            frappe.client.save(deck.as_dict())

        frappe.db.rollback()
        self.assertEqual(self.named_rows(node), before)

    def test_a_plain_deck_still_reorders_its_rows(self):
        node = self.old_deck([text_element("first")], [text_element("second")])
        first, second = self.named_rows(node)
        frappe.set_user(OWNER)
        deck = frappe.get_doc("Presentation", slides_drive.docname_for_node(node))
        deck.slides[0].idx = 999

        frappe.client.save(deck.as_dict())

        self.assertEqual(self.named_rows(node), [second, first])

    def test_a_new_slide_row_is_refused_and_writes_nothing(self):
        node = self.old_deck([text_element("element")])
        self.convert(node)
        before = self.rows(node)
        row = self.owned_row(node)
        fresh = frappe.get_doc(
            doctype="Slide",
            parent=row.parent,
            parenttype="Presentation",
            parentfield="slides",
            client_id="new",
            elements="[]",
        )

        with self.assertRaises(drive.DriveConflict):
            fresh.insert()

        frappe.db.rollback()
        self.assertEqual(self.rows(node), before)

    def test_a_slide_row_deleted_on_its_own_is_refused_and_writes_nothing(self):
        node = self.old_deck([text_element("element")])
        self.convert(node)
        before = self.rows(node)
        row = self.owned_row(node)

        with self.assertRaises(drive.DriveConflict):
            frappe.delete_doc("Slide", row.name)

        frappe.db.rollback()
        self.assertEqual(self.rows(node), before)

    def test_the_client_delete_of_a_slide_row_is_refused_and_writes_nothing(self):
        node = self.old_deck([text_element("element")])
        self.convert(node)
        before = self.rows(node)
        row = self.owned_row(node)

        with self.assertRaises(drive.DriveConflict):
            frappe.client.delete("Slide", row.name)

        frappe.db.rollback()
        self.assertEqual(self.rows(node), before)

    def test_a_row_moved_off_or_onto_a_converted_deck_is_refused(self):
        waiting = self.old_deck([text_element("waiting")])
        done = self.old_deck([text_element("done")])
        self.convert(done)
        before = self.rows(waiting), self.rows(done)

        for from_node, to_node in ((done, waiting), (waiting, done)):
            row = self.owned_row(from_node)
            row.parent = slides_drive.docname_for_node(to_node)

            with self.assertRaises(drive.DriveConflict):
                row.save()

            frappe.db.rollback()

        self.assertEqual((self.rows(waiting), self.rows(done)), before)

    def test_a_row_of_a_deck_not_converted_still_saves_on_its_own(self):
        node = self.old_deck([text_element("element")])
        row = self.owned_row(node)
        row.elements = "[]"

        frappe.client.save(row.as_dict())

        [saved] = self.rows(node)
        self.assertEqual(saved.elements, "[]")

    def test_save_slides_is_refused_and_writes_nothing(self):
        node = self.old_deck([text_element("element")])
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
        waiting = self.old_deck([text_element("element")])
        moved: list[str] = []

        with patch.object(
            move_file_media_to_drive, "convert_deck", lambda docname, node, _: moved.append(node) or {}
        ):
            move_file_media_to_drive.execute()

        self.assertIn(waiting, moved)
        self.assertNotIn(converted_node, moved)

    def test_a_save_that_changes_a_slide_is_refused_and_writes_nothing(self):
        node = self.old_deck([text_element("element")])
        self.convert(node)
        before = self.rows(node)
        deck = frappe.get_doc("Presentation", slides_drive.docname_for_node(node))
        deck.slides[0].elements = "[]"

        with self.assertRaises(drive.DriveConflict):
            deck.save()

        self.assertEqual(self.rows(node), before)

    def test_turning_a_converted_deck_composite_is_refused(self):
        node = self.old_deck([text_element("element")])
        self.convert(node)
        deck = frappe.get_doc("Presentation", slides_drive.docname_for_node(node))
        deck.is_composite = 1

        with self.assertRaises(drive.DriveConflict):
            deck.save()

    def test_apply_theme_is_refused_on_a_converted_deck(self):
        node = self.old_deck([])
        self.convert(node)
        before = self.rows(node)

        with self.assertRaises(drive.DriveConflict):
            apply_theme(slides_drive.docname_for_node(node), "any theme")

        self.assertEqual(self.rows(node), before)

    def test_a_theme_alone_still_saves_on_a_converted_deck(self):
        node = self.old_deck([text_element("element")])
        self.convert(node)
        deck = frappe.get_doc("Presentation", slides_drive.docname_for_node(node))
        deck.theme = None

        deck.save()

    def test_a_write_decides_on_the_log_it_reads_under_the_lock(self):
        node = self.old_deck([text_element("element")])
        waiting = self.old_deck([text_element("element")])
        self.convert(node)
        docname = slides_drive.docname_for_node(node)
        before = self.rows(node)
        modified = str(frappe.db.get_value("Presentation", docname, "modified"))
        moved: list[str] = []

        # A conversion that landed after this transaction's snapshot shows only to a locking read
        with (
            patch.object(content, "find", seen_only_by_a_locking_read(content.find)),
            patch.object(
                move_file_media_to_drive, "convert_deck", lambda docname, node, _: moved.append(node) or {}
            ),
        ):
            with self.assertRaises(drive.DriveConflict):
                save_slides(docname, [{"client_id": "new", "elements": "[]"}], modified)

            move_file_media_to_drive.execute()

        self.assertEqual(self.rows(node), before)
        self.assertIn(waiting, moved)
        self.assertNotIn(node, moved)


class TestVersionsOfADeck(ConversionCase):
    def test_a_version_keeps_how_long_a_slide_waits(self):
        node = self.old_deck([text_element("element")])
        docname = slides_drive.docname_for_node(node)
        frappe.db.set_value("Slide", {"parent": docname}, "advance_after", 5)
        stored, _mime = slides_drive.version_bytes(docname)
        frappe.db.set_value("Slide", {"parent": docname}, "advance_after", None)

        slides_drive.restore_version(docname, stored)

        self.assertEqual(frappe.db.get_value("Slide", {"parent": docname}, "advance_after"), "5")


class TestDeckRoute(ConversionCase):
    def test_a_waiting_deck_says_it_waits(self):
        node = self.old_deck([text_element("element")])

        answer = get_public_presentation(slides_drive.docname_for_node(node))

        self.assertEqual(answer["conversion"]["state"], "pending")
        self.assertNotIn("is_converted", answer)

    def test_a_converted_deck_says_so(self):
        node = self.old_deck([text_element("element")])
        self.convert(node)

        answer = get_public_presentation(slides_drive.docname_for_node(node))

        self.assertTrue(answer["is_converted"])
        self.assertNotIn("conversion", answer)

    def test_every_check_refusal_records_a_reason(self):
        not_integrated = patch(
            "suite.slides.content.conversion.compaction.compact",
            return_value=frappe._dict(integrated=False),
        )
        failed = patch(
            "suite.slides.content.conversion.compaction.compact",
            side_effect=compaction.CompactionFailed("unreadable"),
        )
        unknown = patch(
            "suite.slides.content.conversion.slides_content.SCHEMA",
            **{"allows.return_value": False},
        )
        for name, patched in (("fallback", not_integrated), ("unreadable", failed), ("schema", unknown)):
            with self.subTest(name), patched:
                node = self.old_deck([text_element("element")])

                self.assertEqual(self.convert(node), "check")

                self.assertEqual(conversions.conversion_status(APP, node)["reason"], f"check: {name}")

    def test_the_built_converter_reads_a_document_body_and_keeps_whitespace(self):
        paragraph = {"type": "paragraph", "content": [{"type": "text", "text": "A  B"}]}
        node = self.old_deck(
            [
                text_element("doc", content={"type": "doc", "content": [paragraph]}),
                text_element("html", content="<p>A  B</p><hr>"),
            ]
        )

        self.assertEqual(self.convert(node), "converted")

    def test_only_a_system_manager_gets_the_reason_for_a_refusal(self):
        node = self.old_deck([text_element("element", content="<h1>a</h1>")])
        self.convert(node)
        docname = slides_drive.docname_for_node(node)

        self.assertEqual(get_public_presentation(docname)["conversion"]["reason"], "check: html")

        frappe.set_user(OWNER)
        self.assertEqual(get_public_presentation(docname)["conversion"], {"state": "refused"})

    def test_a_combined_deck_never_waits(self):
        node = self.old_deck([text_element("element")])
        docname = slides_drive.docname_for_node(node)
        frappe.db.set_value("Presentation", docname, "is_composite", 1)

        answer = get_public_presentation(docname)

        self.assertNotIn("conversion", answer)
        self.assertNotIn("is_converted", answer)


class TestStarterPresentation(ConversionCase):
    def test_the_kickoff_starter_opens_with_its_three_slides_while_collaboration_is_on(self):
        held: list[tuple[str, dict]] = []
        with patch("frappe.enqueue", lambda method, **kwargs: held.append((method, kwargs))):
            node = _kickoff(drive.ensure_folder(owner_folder(), f"Starters {uuid.uuid4().hex[:8]}"))

        frappe.db.commit()
        self.addCleanup(delete_log, node)
        for method, kwargs in held:
            frappe.get_attr(method)(node=kwargs["node"], slides=kwargs["slides"])

        doc = converted_deck(node)
        slides = doc.get("slides", type=pycrdt.Map)
        elements = doc.get("elements", type=pycrdt.Map)
        order = sorted(slides.keys(), key=lambda key: slides[key]["order"])
        drawn = {slide: list[str]() for slide in order}
        for key in sorted(elements.keys()):
            drawn[elements[key]["parent"]].append(str(elements[key]["text"]))

        self.assertEqual(len(drawn), 3)
        for texts, (heading, body) in zip(
            drawn.values(),
            [
                ("Company kickoff", "Where we are and where we are going"),
                ("This quarter", "Three outcomes we commit to"),
                ("Next steps", "Owners and dates"),
            ],
            strict=True,
        ):
            self.assertEqual(len(texts), 2)
            self.assertIn(body, texts[0])
            self.assertIn(heading, texts[1])
