import pycrdt
from frappe.tests import UnitTestCase

from suite.suite_core.content.compaction import load_doc, serialize, state_vector, vector_and_deletes
from suite.suite_core.content.updates import encoded_string, encoded_uint, parse, rewrite_values


def typed(text: str, client_id: int = 5) -> pycrdt.Doc:
    doc = pycrdt.Doc(client_id=client_id)
    fragment = doc.get("default", type=pycrdt.XmlFragment)
    paragraph = fragment.children.append(pycrdt.XmlText())
    paragraph.insert(0, text)
    return doc


class TestParse(UnitTestCase):
    def test_clocks_and_deletes_match_pycrdts_own_reading(self):
        doc = typed("hello 😀 wörld 中文")
        text = doc.get("default", type=pycrdt.XmlFragment).children[0]
        del text[1:3]
        doc.get("meta", type=pycrdt.Map)["k"] = [1, "two", {"three": None}]

        update = parse(doc.get_update())

        ends = {}
        for struct in update.structs:
            ends[struct.client] = max(ends.get(struct.client, 0), struct.clock + struct.length)
        self.assertEqual(ends, state_vector(doc.get_state()))
        self.assertEqual(update.deletes, {5: [(2, 2)]})

    def test_an_emoji_is_two_clocks_split_only_in_its_middle(self):
        doc = typed("a😀b")
        update = parse(doc.get_update())

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

        edit = second.get_update(before)
        update = parse(edit)

        self.assertEqual(update.split_points(), {(5, 2), (5, 3)})

    def test_a_row_names_its_roots_nodes_marks_attributes_and_map_keys_but_not_its_values(self):
        doc = pycrdt.Doc(client_id=5)
        body = doc.get("default", type=pycrdt.XmlFragment)
        paragraph = body.children.append(pycrdt.XmlElement("paragraph", {"textAlign": "left"}))
        text = paragraph.children.append(pycrdt.XmlText())
        marks = {
            "link": {"href": "https://x"},
            "comment--a1b2": {"id": "c1"},
        }
        text.insert(0, "hi", marks)
        doc.get("meta", type=pycrdt.Map)["firstTabLabel"] = {"value": "One"}

        names = parse(doc.get_update()).names

        self.assertEqual(
            names,
            {"default", "paragraph", "textAlign", "link", "href", "comment", "id", "meta", "firstTabLabel"},
        )

    def test_json_values_nested_deeper_than_a_hundred_levels_are_refused(self):
        def one_struct_holding(ref: int, content: bytes) -> bytes:
            return bytes([1, 1, 5, 0, ref, 1]) + encoded_string("t") + content + bytes([0])

        def nested(depth: int, inner: str) -> str:
            return "[" * depth + inner + "]" * depth

        def by_content_kind(text: str) -> dict[str, bytes]:
            return {
                "JSON": one_struct_holding(2, encoded_uint(1) + encoded_string(text)),
                "embed": one_struct_holding(5, encoded_string(text)),
                "format": one_struct_holding(6, encoded_string("bold") + encoded_string(text)),
            }

        # Only containers count: what the innermost one holds does not change its level
        for inner in ("", "1"):
            at_limit = by_content_kind(nested(100, inner))
            for kind, payload in at_limit.items():
                with self.subTest(kind, inner=inner):
                    self.assertEqual(parse(payload).structs[0].length, 1)

            for depth in (101, 200_000):
                past_limit = by_content_kind(nested(depth, inner))
                for kind, payload in past_limit.items():
                    with self.subTest(kind, inner=inner, depth=depth), self.assertRaises(ValueError):
                        parse(payload)

    def test_any_values_nested_deeper_than_a_hundred_levels_are_refused(self):
        def nested(depth: int, inner: bytes) -> bytes:
            value = bytes([117, 1]) * (depth - 1) + inner
            return bytes([1, 1, 5, 0, 8, 1]) + encoded_string("t") + bytes([1]) + value + bytes([0])

        # Arrays, then an innermost array that is empty, holds a number, or an object holding a number
        for inner in (
            bytes([117, 0]),
            bytes([117, 1, 125, 1]),
            bytes([118, 1]) + encoded_string("k") + bytes([125, 1]),
        ):
            at_limit = nested(100, inner)
            past_limit = nested(101, inner)
            with self.subTest(inner=inner):
                self.assertEqual(parse(at_limit).structs[0].length, 1)
                with self.assertRaises(ValueError):
                    parse(past_limit)

    def test_integers_past_what_yjs_holds_exactly_are_refused(self):
        def written(client=5, clock=0, origin=None) -> bytes:
            if origin:
                content = bytes([0x84]) + encoded_uint(origin[0]) + encoded_uint(origin[1])
            else:
                content = bytes([4, 1]) + encoded_string("t")
            return (
                bytes([1, 1])
                + encoded_uint(client)
                + encoded_uint(clock)
                + content
                + encoded_string("a")
                + bytes([0])
            )

        def deleted(client=5, clock=0, length=1) -> bytes:
            return (
                bytes([0, 1]) + encoded_uint(client) + bytes([1]) + encoded_uint(clock) + encoded_uint(length)
            )

        def any_integer(value: int) -> bytes:
            signed = bytes([0x80 | value & 0x3F]) + encoded_uint(value >> 6)
            return bytes([1, 1, 5, 0, 8, 1]) + encoded_string("t") + bytes([1, 125]) + signed + bytes([0])

        max_safe = 2**53 - 1
        cases = {
            "client": lambda value: written(client=value),
            "clock": lambda value: written(clock=value - 1),
            "origin client": lambda value: written(origin=(value, 0)),
            "origin clock": lambda value: written(origin=(5, value)),
            "delete client": lambda value: deleted(client=value),
            "delete clock": lambda value: deleted(clock=value - 1),
            "delete length": lambda value: deleted(length=value),
            "number": any_integer,
        }
        for case, build in cases.items():
            with self.subTest(case):
                parse(build(max_safe))
                for past in (max_safe + 1, 2**64):
                    with self.assertRaises(ValueError):
                        parse(build(past))

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
    image_attributes = {
        "src": "/embed.get?id=OLD",
        "data-node": "OLD",
        "alt": "x",
    }
    body.children.append(pycrdt.XmlElement("image", image_attributes))
    text = body.children.append(pycrdt.XmlText())
    text.insert(0, "the OLD text stays")
    text.format(0, 3, {"link": {"href": "/embed.get?id=OLD"}})
    text.insert_embed(len(str(text)), {"src": "OLD"})
    poster = {
        "src": "OLD",
        "sizes": ["OLD", 2],
        "keep": True,
    }
    doc.get("meta", type=pycrdt.Map)["poster"] = poster
    return doc


class TestRewriteValues(UnitTestCase):
    def test_values_are_rewritten_and_text_and_structs_are_not(self):
        doc = pictured()

        state = doc.get_update()
        rewritten_state = rewrite_values(state, swap)
        rewritten = load_doc([rewritten_state])

        self.assertEqual(vector_and_deletes(rewritten), vector_and_deletes(doc))
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
        first = pictured(5)
        second = pycrdt.Doc(client_id=6)
        second.apply_update(first.get_update())
        before = first.get_state()
        first_image = first.get("default", type=pycrdt.XmlFragment).children[0]
        second_image = second.get("default", type=pycrdt.XmlFragment).children[0]
        first_image.attributes["src"] = "/embed.get?id=OLD&a"
        second_image.attributes["src"] = "/embed.get?id=OLD&b"
        second_edit = second.get_update(before)
        first.apply_update(second_edit)

        state = first.get_update()
        rewritten = rewrite_values(state, swap)

        self.assertEqual(rewritten.count(b"OLD"), 1, "only the text still says OLD")
        reloaded = load_doc([rewritten])
        self.assertEqual(vector_and_deletes(reloaded), vector_and_deletes(first))

    def test_nothing_to_rewrite_keeps_every_byte_and_a_rerun_changes_nothing(self):
        state = pictured().get_update()

        self.assertEqual(rewrite_values(state, lambda value: value), state)

        once = rewrite_values(state, swap)
        self.assertEqual(rewrite_values(once, swap), once)

    def test_a_malformed_update_is_refused(self):
        truncated = pictured().get_update()[:-1]

        with self.assertRaises(ValueError):
            rewrite_values(truncated, swap)
