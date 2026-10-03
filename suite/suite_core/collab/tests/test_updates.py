import pycrdt
from frappe.tests import UnitTestCase

from suite.suite_core.collab.compaction import state_vector
from suite.suite_core.collab.updates import parse


def typed(text: str, client_id: int = 5) -> pycrdt.Doc:
    doc = pycrdt.Doc(client_id=client_id)
    doc.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlText()).insert(0, text)
    return doc


class TestParse(UnitTestCase):
    def test_clocks_and_deletes_match_pycrdts_own_reading(self):
        doc = typed("hello 😀 wörld 中文")
        del doc.get("default", type=pycrdt.XmlFragment).children[0][1:3]
        doc.get("meta", type=pycrdt.Map)["k"] = [1, "two", {"three": None}]

        update = parse(doc.get_update())

        ends = {}
        for struct in update.structs:
            ends[struct.client] = max(ends.get(struct.client, 0), struct.clock + struct.length)
        self.assertEqual(ends, state_vector(doc.get_state()))
        self.assertEqual(update.deletes, {5: [(2, 2)]})

    def test_an_emoji_is_two_clocks_split_only_in_its_middle(self):
        update = parse(typed("a😀b").get_update())

        [_text_node, string] = update.structs
        self.assertEqual((string.clock, string.length, string.pairs), (1, 4, [3]))

    def test_split_points_follow_origins_and_delete_ends(self):
        first = typed("ab")
        second = pycrdt.Doc(client_id=6)
        second.apply_update(first.get_update())
        before = second.get_state()
        text = second.get("default", type=pycrdt.XmlFragment).children[0]
        text.insert(1, "x")
        del text[2:3]

        update = parse(second.get_update(before))

        self.assertEqual(update.split_points(), {(5, 2), (5, 3)})

    def test_malformed_updates_are_refused(self):
        good = typed("abc").get_update()
        for bad in (good[:-1], good + b"\x00", b"\x01\x01", b"\xff" * 12):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                parse(bad)
