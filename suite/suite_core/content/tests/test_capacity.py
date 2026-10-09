from datetime import datetime, timedelta
from unittest.mock import patch

import frappe
import pycrdt
from frappe.tests import UnitTestCase

from suite.suite_core.content import capacity
from suite.suite_core.content.updates import parse

STATE_CAP = 4 * 2**20
NOW = datetime(2026, 10, 7, 12, 0)


def first_text(doc: pycrdt.Doc) -> pycrdt.XmlText:
    return doc.get("default", type=pycrdt.XmlFragment).children[0]


def written_doc(text: str, client_id: int = 5) -> pycrdt.Doc:
    doc = pycrdt.Doc(client_id=client_id)
    fragment = doc.get("default", type=pycrdt.XmlFragment)
    paragraph = fragment.children.append(pycrdt.XmlText())
    paragraph.insert(0, text)
    return doc


def edit_payload(base: pycrdt.Doc, client_id: int, edit) -> bytes:
    """What a tab writing as `client_id` sends after making `edit` to `base`'s text."""
    tab = pycrdt.Doc(client_id=client_id)
    tab.apply_update(base.get_update())
    before = tab.get_state()
    edit(first_text(tab))
    return tab.get_update(before)


def row_bound(payload: bytes) -> int:
    update = parse(payload)
    return capacity.row_bound(update, len(payload))


def doc_row(state_bytes=0, tail_bound=0, tail_rows=1, next_at=None, last_ms=None):
    return frappe._dict(
        state_bytes=state_bytes,
        tail_bound=tail_bound,
        tail_rows=tail_rows,
        next_compaction_at=next_at,
        last_compaction_ms=last_ms,
    )


class TestBound(UnitTestCase):
    def test_typing_on_from_ones_own_text_costs_only_its_bytes(self):
        doc = written_doc("ab")
        before = doc.get_state()
        first_text(doc).insert(2, "cd")
        payload = doc.get_update(before)

        self.assertEqual(row_bound(payload), len(payload))

    def test_typing_into_another_writers_word_costs_one_split(self):
        payload = edit_payload(written_doc("ab"), 6, lambda text: text.insert(1, "x"))

        self.assertEqual(row_bound(payload), len(payload) + 32)

    def test_deleting_from_the_middle_of_a_word_costs_a_split_at_each_end(self):
        payload = edit_payload(written_doc("abc"), 6, lambda text: text.__delitem__(slice(1, 2)))

        self.assertEqual(row_bound(payload), len(payload) + 64)

    def test_deleting_a_whole_word_splits_nothing_inside_it_but_still_names_its_ends(self):
        # The ends of a struct are positions other structs may have been cut at, so both still count
        payload = edit_payload(written_doc("abc"), 6, lambda text: text.__delitem__(slice(0, 3)))

        self.assertEqual(row_bound(payload), len(payload) + 64)


class TestAdmit(UnitTestCase):
    def setUp(self):
        self.adds = parse(written_doc("x", 7).get_update())
        delete_payload = edit_payload(written_doc("abc"), 6, lambda text: text.__delitem__(slice(1, 2)))
        self.deletes = parse(delete_payload)

    def refusal(self, doc, update, bound):
        with self.assertRaises(capacity.Full) as raised:
            capacity.admit(doc, update, bound, NOW)
        return raised.exception.reason, raised.exception.retry_ms

    def test_a_push_that_fits_under_the_cap_with_the_tail_is_admitted(self):
        capacity.admit(doc_row(state_bytes=STATE_CAP - 300, tail_bound=200), self.adds, 100, NOW)

    def test_a_push_one_byte_past_the_cap_waits_for_the_next_compaction(self):
        doc = doc_row(state_bytes=STATE_CAP - 300, tail_bound=200)
        reason = self.refusal(doc, self.adds, 101)[0]

        self.assertEqual(reason, "compacting")

    def test_the_wait_runs_to_the_paced_compaction_plus_how_long_the_last_one_took(self):
        doc = doc_row(
            state_bytes=STATE_CAP - 10, tail_bound=200, next_at=NOW + timedelta(seconds=3), last_ms=1500
        )

        self.assertEqual(self.refusal(doc, self.adds, 100), ("compacting", 4500))

    def test_with_no_compaction_timed_the_wait_is_one_expected_compaction(self):
        doc = doc_row(state_bytes=STATE_CAP, tail_bound=0, tail_rows=1)

        self.assertEqual(self.refusal(doc, self.deletes, STATE_CAP), ("compacting", 2000))

    def test_a_document_at_the_cap_is_full_for_anything_that_adds(self):
        doc = doc_row(state_bytes=STATE_CAP, tail_bound=0, tail_rows=5)
        reason = self.refusal(doc, self.adds, 1)[0]

        self.assertEqual(reason, "doc_full")

    def test_a_push_that_no_compaction_can_make_room_for_is_full(self):
        doc = doc_row(state_bytes=STATE_CAP - 100, tail_bound=0, tail_rows=0)
        reason = self.refusal(doc, self.adds, 101)[0]

        self.assertEqual(reason, "doc_full")

    def test_a_full_document_still_takes_deletes_up_to_half_a_mebibyte_past_the_cap(self):
        capacity.admit(
            doc_row(state_bytes=STATE_CAP, tail_bound=200, tail_rows=1), self.deletes, 512 * 2**10 - 200, NOW
        )

        doc = doc_row(state_bytes=STATE_CAP, tail_bound=200, tail_rows=1)
        reason = self.refusal(doc, self.deletes, 512 * 2**10 - 199)[0]
        self.assertEqual(reason, "compacting")

    def test_a_delete_is_never_full_for_good_however_far_past_the_cap(self):
        capacity.admit(
            doc_row(state_bytes=STATE_CAP + 2**20, tail_bound=0, tail_rows=0), self.deletes, 2**20, NOW
        )

    def test_a_tail_of_twenty_thousand_rows_waits_for_a_compaction_however_small(self):
        capacity.admit(doc_row(tail_rows=19_999), self.adds, 1, NOW)

        reason = self.refusal(doc_row(tail_rows=20_000), self.adds, 1)[0]
        self.assertEqual(reason, "compacting")


class TestEditMax(UnitTestCase):
    def edit_max(self, packet: int) -> int:
        with patch.object(frappe.db, "sql", return_value=[[packet]]):
            return capacity.edit_max()

    def test_a_database_that_takes_big_packets_allows_four_mebibyte_changes(self):
        self.assertEqual(self.edit_max(64 * 2**20), 4 * 2**20)

    def test_a_small_packet_allows_half_of_what_is_left_after_a_mebibyte(self):
        # Escaping can double a change's bytes, and the statement around them needs room too
        self.assertEqual(self.edit_max(4 * 2**20), 1536 * 2**10)
