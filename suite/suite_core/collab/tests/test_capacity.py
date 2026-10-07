from datetime import datetime, timedelta

import frappe
import pycrdt
from frappe.tests import UnitTestCase

from suite.suite_core.collab import capacity
from suite.suite_core.collab.updates import parse

CAP = 4 * 2**20
NOW = datetime(2026, 10, 7, 12, 0)


def body(doc: pycrdt.Doc) -> pycrdt.XmlText:
    return doc.get("default", type=pycrdt.XmlFragment).children[0]


def written(text: str, client_id: int = 5) -> pycrdt.Doc:
    doc = pycrdt.Doc(client_id=client_id)
    doc.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlText()).insert(0, text)
    return doc


def edited(base: pycrdt.Doc, client_id: int, edit) -> bytes:
    """What a tab writing as `client_id` sends after making `edit` to `base`'s text."""
    tab = pycrdt.Doc(client_id=client_id)
    tab.apply_update(base.get_update())
    before = tab.get_state()
    edit(body(tab))
    return tab.get_update(before)


def row_bound(payload: bytes) -> int:
    return capacity.bound(parse(payload), len(payload))


def doc_row(state=0, tail=0, rows=1, next_at=None, last_ms=None):
    return frappe._dict(
        state_bytes=state,
        tail_bound=tail,
        tail_rows=rows,
        next_compaction_at=next_at,
        last_compaction_ms=last_ms,
    )


class TestBound(UnitTestCase):
    def test_typing_on_from_ones_own_text_costs_only_its_bytes(self):
        doc = written("ab")
        before = doc.get_state()
        body(doc).insert(2, "cd")
        payload = doc.get_update(before)

        self.assertEqual(row_bound(payload), len(payload))

    def test_typing_into_another_writers_word_costs_one_split(self):
        payload = edited(written("ab"), 6, lambda text: text.insert(1, "x"))

        self.assertEqual(row_bound(payload), len(payload) + 32)

    def test_deleting_from_the_middle_of_a_word_costs_a_split_at_each_end(self):
        payload = edited(written("abc"), 6, lambda text: text.__delitem__(slice(1, 2)))

        self.assertEqual(row_bound(payload), len(payload) + 64)

    def test_deleting_a_whole_word_splits_nothing_inside_it_but_still_names_its_ends(self):
        # The ends of a struct are positions other structs may have been cut at, so both still count
        payload = edited(written("abc"), 6, lambda text: text.__delitem__(slice(0, 3)))

        self.assertEqual(row_bound(payload), len(payload) + 64)


class TestAdmit(UnitTestCase):
    def setUp(self):
        self.adds = parse(written("x", 7).get_update())
        self.deletes = parse(edited(written("abc"), 6, lambda text: text.__delitem__(slice(1, 2))))

    def refusal(self, doc, update, bound):
        with self.assertRaises(capacity.Full) as raised:
            capacity.admit(doc, update, bound, NOW)
        return raised.exception.reason, raised.exception.retry_ms

    def test_a_push_that_fits_under_the_cap_with_the_tail_is_admitted(self):
        capacity.admit(doc_row(state=CAP - 300, tail=200), self.adds, 100, NOW)

    def test_a_push_one_byte_past_the_cap_waits_for_the_next_compaction(self):
        self.assertEqual(self.refusal(doc_row(state=CAP - 300, tail=200), self.adds, 101)[0], "compacting")

    def test_the_wait_runs_to_the_paced_compaction_plus_how_long_the_last_one_took(self):
        doc = doc_row(state=CAP - 10, tail=200, next_at=NOW + timedelta(seconds=3), last_ms=1500)

        self.assertEqual(self.refusal(doc, self.adds, 100), ("compacting", 4500))

    def test_with_no_compaction_timed_the_wait_is_one_expected_compaction(self):
        self.assertEqual(
            self.refusal(doc_row(state=CAP, tail=0, rows=1), self.deletes, CAP), ("compacting", 2000)
        )

    def test_a_document_at_the_cap_is_full_for_anything_that_adds(self):
        self.assertEqual(self.refusal(doc_row(state=CAP, tail=0, rows=5), self.adds, 1)[0], "doc_full")

    def test_a_push_that_no_compaction_can_make_room_for_is_full(self):
        self.assertEqual(
            self.refusal(doc_row(state=CAP - 100, tail=0, rows=0), self.adds, 101)[0], "doc_full"
        )

    def test_a_full_document_still_takes_deletes_up_to_half_a_mebibyte_past_the_cap(self):
        capacity.admit(doc_row(state=CAP, tail=0, rows=0), self.deletes, 512 * 2**10, NOW)

        self.assertEqual(
            self.refusal(doc_row(state=CAP, tail=0, rows=0), self.deletes, 512 * 2**10 + 1)[0], "doc_full"
        )

    def test_a_tail_of_twenty_thousand_rows_waits_for_a_compaction_however_small(self):
        capacity.admit(doc_row(rows=19_999), self.adds, 1, NOW)

        self.assertEqual(self.refusal(doc_row(rows=20_000), self.adds, 1)[0], "compacting")
