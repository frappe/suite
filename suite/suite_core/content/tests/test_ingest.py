from unittest.mock import patch

import pycrdt
from frappe.tests import UnitTestCase

from suite.suite_core.content import ingest, updates
from suite.suite_core.content.updates import encoded_string, encoded_uint


def typed(cid: int, texts: list[str]) -> list[bytes]:
    doc = pycrdt.Doc(client_id=cid)
    seen = doc.get_state()
    text = doc.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlText())
    updates = []
    for each in texts:
        text.insert(len(str(text)), each)
        updates.append(doc.get_update(seen))
        seen = doc.get_state()
    return updates


def one_struct(ref: int, content: bytes, client: int = 5) -> bytes:
    """An update with one struct of content `ref` in the root array "t", written by `client` at clock 0."""
    return (
        bytes([1, 1]) + encoded_uint(client) + bytes([0, ref, 1]) + encoded_string("t") + content + bytes([0])
    )


ANY_TRUE = one_struct(8, encoded_uint(1) + bytes([120]))


def editor(version: int = 1, features: dict[str, int] | None = None) -> ingest.EditorSchema:
    """An editor that writes paragraphs and bold, the way y-prosemirror stores them."""
    return ingest.EditorSchema(
        version,
        features or {},
        content_refs=frozenset({0, 1, 4, 6, 7, 8}),
        shared_types=frozenset({3, 6}),
        nodes=frozenset({"paragraph"}),
        marks=frozenset({"bold"}),
    )


def written(build) -> updates.Update:
    """The update `build` makes in a fresh document as client 5."""
    doc = pycrdt.Doc(client_id=5)
    build(doc)
    return ingest.check(doc.get_update(), 5).update


class TestIngest(UnitTestCase):
    def test_a_tabs_own_typing_passes_with_the_clocks_it_adds(self):
        first, second = typed(5, ["ab", "cd"])

        # One clock for the text node, then one per character
        self.assertEqual((ingest.check(first, 5).clock_from, ingest.check(first, 5).clock_to), (0, 3))
        self.assertEqual((ingest.check(second, 5).clock_from, ingest.check(second, 5).clock_to), (3, 5))

    def test_a_delete_only_row_passes(self):
        doc = pycrdt.Doc(client_id=5)
        doc.apply_update(typed(6, ["abc"])[0])
        before = doc.get_state()
        del doc.get("default", type=pycrdt.XmlFragment).children[0][0:1]

        row = ingest.check(doc.get_update(before), 5)

        self.assertEqual((row.update.structs, row.update.deletes), ([], {6: [(1, 1)]}))

    def test_the_hand_built_struct_is_a_real_update(self):
        doc = pycrdt.Doc()
        doc.apply_update(ANY_TRUE)

        self.assertEqual(doc.get("t", type=pycrdt.Array).to_py(), [True])
        self.assertEqual(ingest.check(ANY_TRUE, 5).clock_to, 1)

    def test_rows_no_tab_of_this_writer_could_send_are_malformed(self):
        first, _second, third = typed(5, ["a", "b", "c"])
        cases = {
            "another client's typing": typed(6, ["a"])[0],
            "two writers": pycrdt.merge_updates(first, typed(6, ["a"])[0]),
            "a gap in the clocks": pycrdt.merge_updates(first, third),
            "unreadable": first[:-1],
            "empty": pycrdt.Doc().get_update(),
            "a delete set that deletes nothing": bytes([0, 1]) + encoded_uint(5) + bytes([0]),
            "JSON content": one_struct(2, encoded_uint(1) + encoded_string('"x"')),
            "binary content": one_struct(3, encoded_uint(1) + b"\x00"),
            "a subdocument": one_struct(9, encoded_string("guid") + bytes([118, 0])),
        }
        for case, payload in cases.items():
            with self.subTest(case), self.assertRaises(ValueError):
                ingest.check(payload, 5)

    def test_a_row_may_hold_only_names_declared_at_or_below_its_stamp(self):
        schema = editor(2, {"paragraph": 1, "callout": 2})

        self.assertTrue(schema.allows(set(), 1))
        self.assertTrue(schema.allows({"paragraph"}, 1))
        self.assertTrue(schema.allows({"paragraph", "callout"}, 2))
        self.assertFalse(schema.allows({"paragraph", "callout"}, 1))
        self.assertFalse(schema.allows({"marquee"}, 2))

    def test_a_row_may_make_only_the_shared_types_the_editor_makes(self):
        schema = editor()
        doc = pycrdt.Doc(client_id=5)
        doc.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlElement("paragraph"))
        element_row = doc.get_update()
        rows = {}
        for name, shared in (("a map", pycrdt.Map()), ("a text", pycrdt.Text("x"))):
            before = doc.get_state()
            doc.get("t", type=pycrdt.Array).append(shared)
            rows[name] = doc.get_update(before)

        self.assertTrue(schema.could_write(ingest.check(element_row, 5).update))
        self.assertTrue(schema.could_write(ingest.check(typed(5, ["a"])[0], 5).update))
        for name, row in rows.items():
            with self.subTest(name):
                self.assertFalse(schema.could_write(ingest.check(row, 5).update))

    def test_a_row_may_use_each_name_only_in_its_role_and_hold_no_embed(self):
        schema = editor()

        def node(name):
            return lambda doc: doc.get("default", type=pycrdt.XmlFragment).children.append(
                pycrdt.XmlElement(name)
            )

        def marked(key):
            def build(doc):
                text = doc.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlText())
                text.insert(0, "x", {key: {}})

            return build

        self.assertTrue(schema.could_write(written(node("paragraph"))))
        self.assertTrue(schema.could_write(written(marked("bold"))))
        wrong = {
            "a mark name as a node": written(node("bold")),
            "a node name as a mark": written(marked("paragraph")),
            "an overlapping mark's key": written(marked("bold--abc")),
            "an embed": ingest.check(one_struct(5, encoded_string("{}")), 5).update,
        }
        for case, update in wrong.items():
            with self.subTest(case):
                self.assertFalse(schema.could_write(update))

    def test_a_row_over_the_size_cap_is_malformed(self):
        [payload] = typed(5, ["abc"])

        with patch.object(ingest, "MAX_BYTES", len(payload)):
            ingest.check(payload, 5)
        with patch.object(ingest, "MAX_BYTES", len(payload) - 1), self.assertRaises(ValueError):
            ingest.check(payload, 5)
