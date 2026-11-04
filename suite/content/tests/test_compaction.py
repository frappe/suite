import random
from collections.abc import Callable
from unittest.mock import patch

import pycrdt
from frappe.tests import UnitTestCase

from suite.content import compaction
from suite.content.compaction import CompactionFailed, compact, load_doc, same_content

PART_MAP = {"default": pycrdt.XmlFragment, "meta": pycrdt.Map}
DELETE_CHANCE = 0.3
MIN_KEPT_CHARS = 2
CONTINUATION_BIT = 0x80


def typing(seed: int, edits: int = 12, client_id: int = 7):
    rng = random.Random(seed)
    doc = pycrdt.Doc(client_id=client_id)
    updates: list[bytes] = []
    doc.observe(lambda event: updates.append(event.update))
    fragment = doc.get("default", type=pycrdt.XmlFragment)
    paragraph = fragment.children.append(pycrdt.XmlElement("paragraph"))
    text = paragraph.children.append(pycrdt.XmlText())
    for _ in range(edits):
        length = len(str(text))
        if length > MIN_KEPT_CHARS and rng.random() < DELETE_CHANCE:
            index = rng.randrange(length - 1)
            del text[index : index + 1]
        else:
            text.insert(rng.randint(0, length), rng.choice("abcdef"))

    return str(text), updates


def encoded_varuint(value: int) -> bytes:
    encoded = bytearray()
    while value >= CONTINUATION_BIT:
        encoded.append(value & 0x7F | CONTINUATION_BIT)
        value >>= 7

    return bytes(encoded + bytes([value]))


def encoded_insert(insert: tuple[int, int, tuple[int, int], tuple[int, int] | None, str]) -> bytes:
    client, clock, origin, right_origin, text = insert
    encoded = text.encode()
    info = 0x84
    origins = [origin]
    if right_origin:
        info |= 0x40
        origins.append(right_origin)

    out = (
        encoded_varuint(1)
        + encoded_varuint(1)
        + encoded_varuint(client)
        + encoded_varuint(clock)
        + bytes([info])
    )
    for origin_client, origin_clock in origins:
        out += encoded_varuint(origin_client) + encoded_varuint(origin_clock)

    return out + encoded_varuint(len(encoded)) + encoded


def crafted(*, insert=None, delete=None) -> bytes:
    out = encoded_varuint(0)
    if insert:
        out = encoded_insert(insert)

    if delete:
        client, clock, length = delete
        return (
            out
            + encoded_varuint(1)
            + encoded_varuint(client)
            + encoded_varuint(1)
            + encoded_varuint(clock)
            + encoded_varuint(length)
        )

    return out + encoded_varuint(0)


def text_of(state: bytes) -> str:
    fragment = load_doc([state]).get("default", type=pycrdt.XmlFragment)
    texts: list[str] = []
    for paragraph in fragment.children:
        texts.extend(str(text) for text in paragraph.children)

    return "".join(texts)


class TestCompaction(UnitTestCase):
    def refusal_reason(self, rows: list[bytes], target: str, disagreeing: Callable[..., tuple]) -> str:
        with patch.object(compaction, target, disagreeing), self.assertRaises(CompactionFailed) as failed:
            compact(None, rows, PART_MAP)

        return failed.exception.reason

    def test_rows_compact_into_the_text_that_was_typed(self):
        typed, rows = typing(seed=3)

        compacted = compact(None, rows, PART_MAP)

        self.assertTrue(compacted.integrated)
        self.assertEqual(text_of(compacted.state), typed)

    def test_a_chained_compaction_equals_a_direct_one(self):
        _typed, rows = typing(seed=5, edits=40)

        first = compact(None, rows[:15], PART_MAP)
        second = compact(first.state, rows[15:30], PART_MAP)
        chained = compact(second.state, rows[30:], PART_MAP)
        direct = compact(None, rows, PART_MAP)

        self.assertTrue(same_content(chained.state, direct.state, PART_MAP))

    def test_rows_out_of_order_still_compact_into_the_typed_text(self):
        # pycrdt leaves part of this shuffled history out of its first result
        typed, rows = typing(seed=0)
        random.Random(0).shuffle(rows)

        compacted = compact(None, rows, PART_MAP)

        self.assertTrue(compacted.report.get("short"))
        self.assertTrue(compacted.integrated)
        self.assertEqual(text_of(compacted.state), typed)

    def test_rows_waiting_on_a_missing_change_are_left_uncompacted(self):
        typed, rows = typing(seed=3)

        with self.assertRaises(CompactionFailed) as failed:
            compact(None, rows[:4] + rows[5:], PART_MAP)

        self.assertEqual(failed.exception.reason, "missing_dependency")

        compacted = compact(None, rows, PART_MAP)
        self.assertEqual(text_of(compacted.state), typed)

    def test_another_pycrdt_version_is_refused(self):
        _typed, rows = typing(seed=3)

        with patch.object(pycrdt, "__version__", "0.12.26"), self.assertRaises(CompactionFailed) as failed:
            compact(None, rows, PART_MAP)

        self.assertEqual(failed.exception.reason, "kernel_version")

    def test_a_row_pycrdt_panics_on_fails_the_compaction(self):
        _typed, rows = typing(seed=3)

        class Panic(BaseException):
            """pyo3's PanicException derives from BaseException, not Exception."""

        def panics(self, update):
            raise Panic

        with patch.object(pycrdt.Doc, "apply_update", panics), self.assertRaises(CompactionFailed) as failed:
            compact(None, rows, PART_MAP)

        self.assertEqual(failed.exception.reason, "unreadable")

    def test_a_root_the_product_does_not_write_is_refused(self):
        doc = pycrdt.Doc()
        doc.get("elsewhere", type=pycrdt.Text).insert(0, "x")

        with self.assertRaises(CompactionFailed) as failed:
            compact(None, [doc.get_update()], PART_MAP)

        self.assertEqual(failed.exception.reason, "unknown_root")

    def test_deleting_content_shrinks_the_compacted_state(self):
        doc = pycrdt.Doc()
        fragment = doc.get("default", type=pycrdt.XmlFragment)
        text = fragment.children.append(pycrdt.XmlText())
        text.insert(0, "x" * 20_000)
        full = compact(None, [doc.get_update()], PART_MAP).state
        del text[0:20_000]

        emptied = compact(full, [doc.get_update()], PART_MAP).state

        self.assertLess(len(emptied), len(full) // 10)

    def test_a_result_still_short_after_recompaction_is_kept_as_an_open_base_only(self):
        typed, rows = typing(seed=3)

        with patch.object(pycrdt.Doc, "get_update", lambda self, state=None: b"\x00\x00"):
            compacted = compact(None, rows, PART_MAP)

        self.assertFalse(compacted.integrated)
        self.assertEqual(text_of(compacted.state), typed)

    def test_a_row_that_splits_an_emoji_leaves_the_log_uncompacted(self):
        # "a😀b": the text node is clock 0, "a" clock 1, the emoji clocks 2 and 3, "b" clock 4
        doc = pycrdt.Doc(client_id=1)
        fragment = doc.get("default", type=pycrdt.XmlFragment)
        text = fragment.children.append(pycrdt.XmlText())
        text.insert(0, "a😀b")
        typed = doc.get_update()

        for name, row in (
            ("typing between its halves", crafted(insert=(2, 0, (1, 2), (1, 3), "x"))),
            ("deleting one half", crafted(delete=(1, 2, 1))),
        ):
            with self.subTest(name), self.assertRaises(CompactionFailed) as failed:
                compact(None, [typed, row], PART_MAP)

            self.assertEqual(failed.exception.reason, "cut_surrogate")

    def test_edits_beside_an_emoji_compact(self):
        doc = pycrdt.Doc(client_id=1)
        fragment = doc.get("default", type=pycrdt.XmlFragment)
        text = fragment.children.append(pycrdt.XmlText())
        text.insert(0, "a😀b")
        typed = doc.get_update()

        typing_after = crafted(insert=(2, 0, (1, 3), (1, 4), "x"))
        deleting = crafted(delete=(1, 2, 2))
        after = compact(None, [typed, typing_after], PART_MAP)
        removed = compact(None, [typed, deleting], PART_MAP)

        def text_in(state):
            loaded = load_doc([state])
            return str(loaded.get("default", type=pycrdt.XmlFragment))

        self.assertEqual(text_in(after.state), "a😀xb")
        self.assertEqual(text_in(removed.state), "ab")

    def test_a_row_the_strict_reader_refuses_leaves_the_log_uncompacted(self):
        _typed, rows = typing(seed=3)

        with self.assertRaises(CompactionFailed) as failed:
            malformed = rows[-1] + b"\x00"
            compact(None, [*rows, malformed], PART_MAP)

        self.assertEqual(failed.exception.reason, "malformed_row")

    def test_a_result_any_check_disagrees_with_is_refused(self):
        # Each check, made to disagree once, must refuse rather than install
        _typed, rows = typing(seed=3)

        real_fingerprint = compaction.fingerprint
        real_vector_and_deletes = compaction.vector_and_deletes
        for reason, target, call in (
            ("content_mismatch", "fingerprint", 2),
            ("reencode_mismatch", "fingerprint", 3),
            ("not_contained", "vector_and_deletes", 4),
        ):
            real_check = real_fingerprint if target == "fingerprint" else real_vector_and_deletes
            calls: list[int] = []

            def disagreeing(*args, real_check=real_check, call=call, calls=calls):
                calls.append(1)
                real_result = real_check(*args)
                if len(calls) == call:
                    return (*real_result[:-1], {"changed": True})

                return real_result

            with self.subTest(reason):
                self.assertEqual(self.refusal_reason(rows, target, disagreeing), reason)
