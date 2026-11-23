"""Slides' declaration against the layer: what it admits, what it refuses, and what it leaves alone."""

import base64
from pathlib import Path

import frappe
import pycrdt
from frappe.tests import IntegrationTestCase

from suite import drive
from suite.content import capacity, editors, log, pushes, tables, updates
from suite.content.updates import encoded_string, encoded_uint
from suite.content.wire import PushHeader
from suite.slides import drive as slides_drive
from suite.slides.content import APP, EDITOR, SCHEMA
from suite.slides.content.tests.support import LoggedDeckCase
from suite.slides.tests.utils import make_presentation, node_of

CLIENT = 7
# Written by frontend/src/apps/slides/collab/features.test.ts from the real deck.ts and tiptapSetup
DECK_STATE = base64.b64decode(Path(__file__).with_name("deck_state.b64").read_text())
# The attributes R1014 names as what a list written by hand would miss, plus the deck's own shape
NAMES_A_DECK_WRITES = {
    "slides",
    "elements",
    "parent",
    "order",
    "frame",
    "text",
    "connectorStart",
    "poster",
    "crop",
    "colspan",
    "colwidth",
    "textAlign",
    "fontSize",
    "table",
    "tableCell",
    "textStyle",
    "link",
}


def admitted(payload: bytes, client_id: int = CLIENT):
    header = PushHeader(
        lineage="",
        sid="",
        seq_from=1,
        seq_to=1,
        client_id=client_id,
        seen_rev=0,
        schema=SCHEMA.version,
        shas=[],
        stage_id=None,
        is_final=False,
        restore=None,
        expected_user=None,
    )
    return pushes.admissible_row(EDITOR, header, payload)


def unique_deck():
    suffix = frappe.generate_hash(length=8)
    return make_presentation(f"Saved {suffix}")


def element_update(element: object, key: str = "element1", root: str = "elements") -> bytes:
    doc: pycrdt.Doc = pycrdt.Doc(client_id=CLIENT)
    entries = pycrdt.Map()
    doc[root] = entries
    entries[key] = element
    return doc.get_update()


class TestDeclaration(IntegrationTestCase):
    def assert_poison(self, payload: bytes) -> None:
        with self.assertRaises(log.Refusal) as refused:
            admitted(payload)

        self.assertEqual((refused.exception.status, refused.exception.body), (409, {"collab": "poison"}))

    def test_slides_is_registered_and_its_declaration_is_accepted(self):
        self.assertIs(editors.editors()[APP], EDITOR)
        self.assertIs(editors.for_type("Presentation"), EDITOR)
        self.assertEqual(editors.wrong_declarations(EDITOR), [])

    def test_a_real_deck_with_every_element_type_and_mark_is_admitted(self):
        admitted(DECK_STATE)

        names: set[str] = set()
        for struct in updates.parse(DECK_STATE).structs:
            names.update(struct.names)

        self.assertLessEqual(NAMES_A_DECK_WRITES, names)

    def test_a_plain_element_is_admitted(self):
        # The control for the refusals below: each differs from this by one thing
        admitted(element_update(pycrdt.Map({"order": "V"})))

    def test_a_key_outside_the_open_key_alphabet_is_refused(self):
        self.assert_poison(element_update(pycrdt.Map({"order": "V"}), key="GRÖSSE"))

    def test_an_undeclared_field_on_an_element_is_refused(self):
        self.assert_poison(element_update(pycrdt.Map({"nonsense": "V"})))

    def test_a_root_the_deck_does_not_have_is_refused(self):
        self.assert_poison(element_update(pycrdt.Map({"order": "V"}), root="stray"))

    def test_an_array_or_plain_text_under_an_element_is_refused(self):
        self.assert_poison(element_update(pycrdt.Map({"points": pycrdt.Array([1, 2])})))
        self.assert_poison(element_update(pycrdt.Map({"text": pycrdt.Text("typed")})))

    def test_json_content_is_refused(self):
        # A ContentJSON struct, ref 2, which only a client written by hand sends
        struct_info = bytes([1, 1]) + encoded_uint(CLIENT) + bytes([0, 2, 1])
        payload = (
            struct_info + encoded_string("elements") + encoded_uint(1) + encoded_string('"x"') + bytes([0])
        )
        with self.assertRaises(log.Refusal) as refused:
            admitted(payload)

        self.assertEqual((refused.exception.status, refused.exception.body), (400, {"collab": "malformed"}))


class TestLoggedDeck(LoggedDeckCase):
    def test_a_full_deck_gets_the_layers_document_full_refusal(self):
        node = self.new_deck()
        doc_table = tables.table(APP, "doc")
        frappe.db.sql(
            f"UPDATE `{doc_table}` SET `state_bytes` = %s WHERE `node` = %s", (capacity.STATE_MAX, node)
        )
        frappe.db.commit()

        def add_an_element(doc: pycrdt.Doc) -> None:
            elements = pycrdt.Map()
            doc["elements"] = elements
            elements["element1"] = pycrdt.Map({"order": "V"})

        self.assertEqual(self.push(node, add_an_element), (423, {"collab": "doc_full", "retry_ms": 300_000}))

    def test_a_save_changing_the_body_of_a_logged_deck_is_refused(self):
        node = self.new_deck()
        frappe.set_user("Administrator")
        docname = slides_drive.docname_for_node(node)
        frappe.db.set_value("Presentation", docname, "content", "stored", update_modified=False)
        deck = frappe.get_doc("Presentation", docname)
        deck.content = "changed"

        with self.assertRaises(drive.DriveConflict):
            deck.save(ignore_permissions=True)

        self.assertEqual(frappe.db.get_value("Presentation", docname, "content"), "stored")

    def test_a_stale_row_save_cannot_put_an_old_body_back(self):
        # R1010: a whole-row save loads the deck, a checkpoint writes a new body, and the save would undo it
        node = self.new_deck()
        frappe.set_user("Administrator")
        docname = slides_drive.docname_for_node(node)
        frappe.db.set_value("Presentation", docname, "content", "before", update_modified=False)
        stale = frappe.get_doc("Presentation", docname)
        frappe.db.set_value("Presentation", docname, "content", "checkpointed", update_modified=False)

        with self.assertRaises(drive.DriveConflict):
            stale.save(ignore_permissions=True)

        self.assertEqual(frappe.db.get_value("Presentation", docname, "content"), "checkpointed")


class TestRowsWithCollabOff(IntegrationTestCase):
    def test_a_deck_with_no_log_saves_a_changed_body(self):
        deck = unique_deck()
        deck.content = "changed"
        deck.save(ignore_permissions=True)

        self.assertEqual(frappe.db.get_value("Presentation", deck.name, "content"), "changed")

    def test_purging_a_deck_with_no_node_needs_no_content_tables(self):
        # R1013: a patch can reach this before after_migrate has made the tables
        deck = unique_deck().name
        node = node_of(deck)
        frappe.db.set_value("Presentation", deck, slides_drive.NODE_FIELD, None)
        frappe.db.commit()
        self.addCleanup(self.delete_node, node)
        self.hide_table("doc")
        self.hide_table("conversion")

        slides_drive.SPEC.on_purge(deck)

        self.assertFalse(frappe.db.exists("Presentation", deck))

    def hide_table(self, kind: str) -> None:
        name = tables.table(APP, kind)
        frappe.db.sql_ddl(f"RENAME TABLE `{name}` TO `{name}_hidden`")
        self.addCleanup(frappe.db.sql_ddl, f"RENAME TABLE `{name}_hidden` TO `{name}`")

    def delete_node(self, node: str) -> None:
        frappe.db.delete("Drive Node", node)
        frappe.db.commit()
