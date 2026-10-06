import pycrdt
from frappe.tests import UnitTestCase

from suite.suite_core.collab.compaction import load, serialize, snapshot, state_vector
from suite.suite_core.collab.updates import encoded_string, encoded_uint, parse, rewrite_values


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

    def test_values_nested_deeper_than_a_hundred_levels_are_refused(self):
        def holding(ref: int, content: bytes) -> bytes:
            return bytes([1, 1, 5, 0, ref, 1]) + encoded_string("t") + content + bytes([0])

        def nested(depth: int) -> str:
            return "[" * depth + "]" * depth

        def kinds(text: str) -> dict[str, bytes]:
            return {
                "JSON": holding(2, encoded_uint(1) + encoded_string(text)),
                "embed": holding(5, encoded_string(text)),
                "format": holding(6, encoded_string("bold") + encoded_string(text)),
            }

        for kind, payload in kinds(nested(101)).items():
            with self.subTest(kind):
                self.assertEqual(parse(payload).structs[0].length, 1)
        for depth in (102, 200_000):
            for kind, payload in kinds(nested(depth)).items():
                with self.subTest(kind, depth=depth), self.assertRaises(ValueError):
                    parse(payload)

    def test_malformed_updates_are_refused(self):
        good = typed("abc").get_update()
        for bad in (good[:-1], good + b"\x00", b"\x01\x01", b"\xff" * 12):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                parse(bad)


def swap(value: str) -> str:
    return value.replace("OLD", "NEW")


def pictured(client_id: int = 5) -> pycrdt.Doc:
    """Every kind of value a remap must reach, and text that names the same id."""
    doc = pycrdt.Doc(client_id=client_id)
    body = doc.get("default", type=pycrdt.XmlFragment)
    body.children.append(
        pycrdt.XmlElement("image", {"src": "/embed.get?id=OLD", "data-node": "OLD", "alt": "x"})
    )
    text = body.children.append(pycrdt.XmlText())
    text.insert(0, "the OLD text stays")
    text.format(0, 3, {"link": {"href": "/embed.get?id=OLD"}})
    text.insert_embed(len(str(text)), {"src": "OLD"})
    doc.get("meta", type=pycrdt.Map)["poster"] = {"src": "OLD", "sizes": ["OLD", 2], "keep": True}
    return doc


class TestRewriteValues(UnitTestCase):
    def test_values_are_rewritten_and_text_and_structs_are_not(self):
        doc = pictured()

        rewritten = load([rewrite_values(doc.get_update(), swap)])

        self.assertEqual(snapshot(rewritten), snapshot(doc))
        body = rewritten.get("default", type=pycrdt.XmlFragment)
        image, text = body.children
        self.assertEqual(dict(image.attributes), {"src": "/embed.get?id=NEW", "data-node": "NEW", "alt": "x"})
        self.assertEqual(
            serialize(text)["text"],
            [
                {"insert": "the", "attributes": {"link": {"href": "/embed.get?id=NEW"}}},
                {"insert": " OLD text stays"},
                {"insert": {"src": "NEW"}},
            ],
        )
        self.assertEqual(
            rewritten.get("meta", type=pycrdt.Map)["poster"],
            {"src": "NEW", "sizes": ["NEW", 2], "keep": True},
        )

    def test_concurrent_overwrites_leave_no_old_id_outside_the_text(self):
        first, second = pictured(5), pycrdt.Doc(client_id=6)
        second.apply_update(first.get_update())
        before = first.get_state()
        first.get("default", type=pycrdt.XmlFragment).children[0].attributes["src"] = "/embed.get?id=OLD&a"
        second.get("default", type=pycrdt.XmlFragment).children[0].attributes["src"] = "/embed.get?id=OLD&b"
        first.apply_update(second.get_update(before))

        state = first.get_update()
        rewritten = rewrite_values(state, swap)

        self.assertEqual(rewritten.count(b"OLD"), 1, "only the text still says OLD")
        self.assertEqual(snapshot(load([rewritten])), snapshot(first))

    def test_nothing_to_rewrite_keeps_every_byte_and_a_rerun_changes_nothing(self):
        state = pictured().get_update()

        self.assertEqual(rewrite_values(state, lambda value: value), state)
        once = rewrite_values(state, swap)
        self.assertEqual(rewrite_values(once, swap), once)

    def test_a_malformed_update_is_refused(self):
        with self.assertRaises(ValueError):
            rewrite_values(pictured().get_update()[:-1], swap)
