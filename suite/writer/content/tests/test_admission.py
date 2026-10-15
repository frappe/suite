import json
import uuid
from unittest.mock import patch

import frappe
import pycrdt

from suite.composition import content as routes
from suite.suite_core.content import (
    documents,
    live,
)
from suite.writer import content as writer_content
from suite.writer.content.tests.support import (
    CheckpointCase,
    answer,
    call_route,
    push_body,
    typed_updates,
)


class TestWriterAdmission(CheckpointCase):
    """A push waits while it could take the next compaction past the cap (I19)."""

    def setUp(self):
        super().setUp()
        self.requested = []
        enqueue = patch.object(
            frappe, "enqueue", lambda method, **kwargs: self.requested.append(kwargs["doc_id"])
        )
        enqueue.start()
        self.addCleanup(enqueue.stop)

    def open_session(self, node: str) -> tuple[str, int]:
        sid = uuid.uuid4().hex
        session_body = json.dumps({"sid": sid}).encode()
        session = call_route(routes.sessions_post, node, body=session_body)
        client_id = answer(session)["client_id"]
        return sid, client_id

    def push(self, node: str, tab: tuple[str, int], seq: int, update: bytes):
        lineage = self.doc_row(node).lineage
        body = push_body(lineage, *tab, seq, 0, update)
        response = call_route(routes.updates_post, node, body=body)
        return response.status_code, answer(response)

    def edited_update(self, client_id: int, rows: list[bytes], edit) -> bytes:
        doc = pycrdt.Doc(client_id=client_id)
        for row in rows:
            doc.apply_update(row)

        before = doc.get_state()
        fragment = doc.get("default", type=pycrdt.XmlFragment)
        edit(fragment.children[0])
        return doc.get_update(before)

    def test_each_row_adds_its_bytes_and_each_word_it_splits_to_the_tail(self):
        node = self.new_document()
        first, second = self.open_session(node), self.open_session(node)
        abc, de = typed_updates(first[1], ["abc", "de"])
        inside = self.edited_update(second[1], [abc, de], lambda text: text.insert(1, "x"))

        for tab, seq, update in ((first, 1, abc), (first, 2, de), (second, 1, inside)):
            self.assertEqual(self.push(node, tab, seq, update)[0], 200)

        self.assertEqual(self.doc_row(node).tail_bound, len(abc) + len(de) + len(inside) + 32)
        self.compact(node)
        self.assertEqual(self.doc_row(node).tail_bound, 0)

    def test_a_push_that_could_take_the_state_past_the_cap_waits_for_a_compaction(self):
        node = self.new_document()
        tab = self.open_session(node)
        abc, de = typed_updates(tab[1], ["abc", "de"])
        self.assertEqual(self.push(node, tab, 1, abc)[0], 200)
        self.set_doc(node, state_bytes=writer_content.SPEC.max_state - len(abc) - len(de) + 1)
        self.requested.clear()

        self.assertEqual(self.push(node, tab, 2, de), (423, {"collab": "compacting", "retry_ms": 2000}))
        self.assertEqual((self.row_count(node), self.doc_row(node).tail_bound), (1, len(abc)))
        self.assertEqual(self.requested, [self.doc_row(node).id])

        self.set_doc(node, state_bytes=writer_content.SPEC.max_state - len(abc) - len(de))
        self.assertEqual(self.push(node, tab, 2, de)[0], 200)

    def test_a_document_at_the_cap_takes_deletes_and_nothing_that_adds(self):
        node = self.new_document()
        writing, deleting = self.open_session(node), self.open_session(node)
        abc, de = typed_updates(writing[1], ["abc", "de"])
        self.assertEqual(self.push(node, writing, 1, abc)[0], 200)
        self.set_doc(node, state_bytes=writer_content.SPEC.max_state)

        self.assertEqual(self.push(node, writing, 2, de), (423, {"collab": "doc_full", "retry_ms": 300_000}))
        removal = self.edited_update(deleting[1], [abc], lambda text: text.__delitem__(slice(1, 2)))
        self.assertEqual(self.push(node, deleting, 1, removal)[0], 200)
        self.assertEqual(self.row_count(node), 2)

    def test_a_compaction_that_frees_a_full_document_tells_its_live_room(self):
        node = self.new_document()
        tab = self.open_session(node)
        abc, de = typed_updates(tab[1], ["abc", "de"])
        self.assertEqual(self.push(node, tab, 1, abc)[0], 200)
        doc = self.doc_row(node)
        room = live.rooms(writer_content.ADAPTER, doc.id, doc.lineage)["keys"][0]
        self.set_doc(node, state_bytes=writer_content.SPEC.max_state)

        with patch("frappe.publish_realtime") as publish:
            self.compact(node)
            self.assertEqual(self.push(node, tab, 2, de)[0], 200)
            self.compact(node)

        control_messages = [
            (published.args[1]["kind"], published.kwargs["room"])
            for published in publish.call_args_list
            if published.args[0] == "suite_collab_ctl"
        ]
        self.assertEqual(control_messages, [("room", room)])

    def test_a_stale_push_to_a_full_document_is_told_it_is_stale(self):
        node = self.new_document()
        tab = self.open_session(node)
        abc, de = typed_updates(tab[1], ["abc", "de"])
        self.set_doc(node, state_bytes=writer_content.SPEC.max_state)
        ahead = push_body(self.doc_row(node).lineage, *tab, 1, 1, abc)

        self.assertEqual(self.push(node, tab, 2, de), (409, {"collab": "seq", "acked": 0}))
        response = call_route(routes.updates_post, node, body=ahead)
        self.assertEqual((response.status_code, answer(response)), (409, {"collab": "diverged"}))

    def test_with_no_tail_to_compact_a_push_that_does_not_fit_is_full(self):
        node = self.new_document()
        tab = self.open_session(node)
        [abc] = typed_updates(tab[1], ["abc"])
        self.set_doc(node, state_bytes=writer_content.SPEC.max_state - len(abc) + 1)

        self.assertEqual(self.push(node, tab, 1, abc), (423, {"collab": "doc_full", "retry_ms": 300_000}))
        self.assertEqual((self.row_count(node), self.requested), (0, []))

    def test_tails_stored_before_bounds_were_kept_count_their_bytes(self):
        node = self.new_document()
        tab = self.open_session(node)
        [abc] = typed_updates(tab[1], ["abc"])
        self.assertEqual(self.push(node, tab, 1, abc)[0], 200)
        self.set_doc(node, tail_bound=0)

        documents.ensure_tables()

        self.assertEqual(self.doc_row(node).tail_bound, len(abc))
