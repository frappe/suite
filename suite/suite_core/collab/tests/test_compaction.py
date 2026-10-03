import random
from unittest.mock import patch

import pycrdt
from frappe.tests import UnitTestCase

from suite.suite_core.collab.compaction import CompactionFailed, compact, load, same

ROOTS = {"default": pycrdt.XmlFragment, "meta": pycrdt.Map}


def typing(seed: int, edits: int = 12, client_id: int = 7):
    """A document typed into one paragraph, and the update each edit sent."""
    rnd = random.Random(seed)
    doc = pycrdt.Doc(client_id=client_id)
    updates = []
    doc.observe(lambda event: updates.append(event.update))
    paragraph = doc.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlElement("paragraph"))
    text = paragraph.children.append(pycrdt.XmlText())
    for _ in range(edits):
        length = len(str(text))
        if length > 2 and rnd.random() < 0.3:
            index = rnd.randrange(length - 1)
            del text[index : index + 1]
        else:
            text.insert(rnd.randint(0, length), rnd.choice("abcdef"))
    return str(text), updates


def number(value: int) -> bytes:
    out = bytearray()
    while value >= 0x80:
        out.append(value & 0x7F | 0x80)
        value >>= 7
    return bytes(out + bytes([value]))


def crafted(*, insert=None, delete=None) -> bytes:
    """A v1 row no editor would send. `insert` is (client, clock, origin, right_origin, text), `delete` is (client, clock, length)."""
    out = number(0)
    if insert:
        client, clock, origin, right, text = insert
        encoded = text.encode()
        out = number(1) + number(1) + number(client) + number(clock) + bytes([0x84 | (0x40 if right else 0)])
        for found in (origin, right) if right else (origin,):
            out += number(found[0]) + number(found[1])
        out += number(len(encoded)) + encoded
    if delete:
        client, clock, length = delete
        return out + number(1) + number(client) + number(1) + number(clock) + number(length)
    return out + number(0)


def text_of(state: bytes) -> str:
    fragment = load([state]).get("default", type=pycrdt.XmlFragment)
    return "".join(str(text) for paragraph in fragment.children for text in paragraph.children)


class TestCompaction(UnitTestCase):
    def test_rows_compact_into_the_text_that_was_typed(self):
        typed, rows = typing(seed=3)

        compacted = compact(None, rows, ROOTS)

        self.assertTrue(compacted.integrated)
        self.assertEqual(text_of(compacted.state), typed)

    def test_a_chained_compaction_equals_a_direct_one(self):
        _typed, rows = typing(seed=5, edits=40)

        first = compact(None, rows[:15], ROOTS)
        second = compact(first.state, rows[15:30], ROOTS)
        chained = compact(second.state, rows[30:], ROOTS)
        direct = compact(None, rows, ROOTS)

        self.assertTrue(same(chained.state, direct.state, ROOTS))

    def test_rows_out_of_order_still_compact_into_the_typed_text(self):
        # pycrdt leaves part of this shuffled history out of its first result
        typed, rows = typing(seed=0)
        random.Random(0).shuffle(rows)

        compacted = compact(None, rows, ROOTS)

        self.assertTrue(compacted.report.get("short"))
        self.assertTrue(compacted.integrated)
        self.assertEqual(text_of(compacted.state), typed)

    def test_rows_waiting_on_a_missing_change_are_left_uncompacted(self):
        typed, rows = typing(seed=3)

        with self.assertRaises(CompactionFailed) as failed:
            compact(None, rows[:4] + rows[5:], ROOTS)
        self.assertEqual(failed.exception.reason, "missing_dependency")

        self.assertEqual(text_of(compact(None, rows, ROOTS).state), typed)

    def test_another_pycrdt_version_is_refused(self):
        _typed, rows = typing(seed=3)

        with patch.object(pycrdt, "__version__", "0.12.26"), self.assertRaises(CompactionFailed) as failed:
            compact(None, rows, ROOTS)
        self.assertEqual(failed.exception.reason, "kernel_version")

    def test_a_row_pycrdt_panics_on_fails_the_compaction(self):
        _typed, rows = typing(seed=3)

        class Panic(BaseException):
            """pyo3's PanicException derives from BaseException, not Exception."""

        def panics(self, update):
            raise Panic

        with patch.object(pycrdt.Doc, "apply_update", panics), self.assertRaises(CompactionFailed) as failed:
            compact(None, rows, ROOTS)
        self.assertEqual(failed.exception.reason, "unreadable")

    def test_a_root_the_product_does_not_write_is_refused(self):
        doc = pycrdt.Doc()
        doc.get("elsewhere", type=pycrdt.Text).insert(0, "x")

        with self.assertRaises(CompactionFailed) as failed:
            compact(None, [doc.get_update()], ROOTS)
        self.assertEqual(failed.exception.reason, "unknown_root")

    def test_deleting_content_shrinks_the_compacted_state(self):
        doc = pycrdt.Doc()
        text = doc.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlText())
        text.insert(0, "x" * 20_000)
        full = compact(None, [doc.get_update()], ROOTS).state
        del text[0:20_000]

        emptied = compact(full, [doc.get_update()], ROOTS).state

        self.assertLess(len(emptied), len(full) // 10)

    def test_a_result_still_short_after_recompaction_is_kept_as_an_open_base_only(self):
        typed, rows = typing(seed=3)

        with patch.object(pycrdt.Doc, "get_update", lambda self, state=None: b"\x00\x00"):
            compacted = compact(None, rows, ROOTS)

        self.assertFalse(compacted.integrated)
        self.assertEqual(text_of(compacted.state), typed)

    def test_a_row_that_splits_an_emoji_leaves_the_log_uncompacted(self):
        # "a😀b": the text node is clock 0, "a" clock 1, the emoji clocks 2 and 3, "b" clock 4
        doc = pycrdt.Doc(client_id=1)
        doc.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlText()).insert(0, "a😀b")
        typed = doc.get_update()

        for name, row in (
            ("typing between its halves", crafted(insert=(2, 0, (1, 2), (1, 3), "x"))),
            ("deleting one half", crafted(delete=(1, 2, 1))),
        ):
            with self.subTest(name), self.assertRaises(CompactionFailed) as failed:
                compact(None, [typed, row], ROOTS)
            self.assertEqual(failed.exception.reason, "cut_surrogate")

    def test_edits_beside_an_emoji_compact(self):
        doc = pycrdt.Doc(client_id=1)
        doc.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlText()).insert(0, "a😀b")
        typed = doc.get_update()

        after = compact(None, [typed, crafted(insert=(2, 0, (1, 3), (1, 4), "x"))], ROOTS)
        removed = compact(None, [typed, crafted(delete=(1, 2, 2))], ROOTS)

        read = lambda state: str(load([state]).get("default", type=pycrdt.XmlFragment))  # noqa: E731
        self.assertEqual(read(after.state), "a😀xb")
        self.assertEqual(read(removed.state), "ab")

    def test_a_row_the_strict_reader_refuses_leaves_the_log_uncompacted(self):
        _typed, rows = typing(seed=3)

        with self.assertRaises(CompactionFailed) as failed:
            compact(None, [*rows, rows[-1] + b"\x00"], ROOTS)
        self.assertEqual(failed.exception.reason, "malformed_row")
