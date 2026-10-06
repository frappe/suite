from unittest.mock import patch

import frappe
import pycrdt

from suite.suite_core.collab import compaction, kernel, quarantine, suspect
from suite.writer import collab as writer_collab
from suite.writer.collab import routes
from suite.writer.collab.tests import test_quarantine
from suite.writer.collab.tests.test_checkpoints import WRITER, CheckpointCase
from suite.writer.collab.tests.test_collab import answer
from suite.writer.collab.tests.test_kernel import BUNDLE, paragraph

JUDGE = "suite.writer.collab.judge"


class Pen(test_quarantine.Tab):
    """A tab that edits the body itself, so its rows hold paragraphs as the editor writes them."""

    @property
    def text(self) -> pycrdt.XmlFragment:
        return self.doc.get("default", type=pycrdt.XmlFragment)

    def adds(self, node) -> int:
        response = self.write(lambda body: body.children.append(node))
        self.case.assertEqual(response.status_code, 200, response.get_data())
        return answer(response)["rev"]


class TestSuspect(CheckpointCase):
    recovered = test_quarantine.TestQuarantine.recovered
    states = test_quarantine.TestQuarantine.states

    def setUp(self):
        super().setUp()
        if not kernel.usable_node() or not BUNDLE.is_file():
            self.skipTest(f"needs Node {kernel.NODE_MAJOR}+ and the built bundle at {BUNDLE}")
        self.requested = []
        for stub in (
            patch.object(
                frappe, "enqueue", lambda method, **kw: self.requested.append((method, kw["doc_id"]))
            ),
            patch.object(frappe.local, "job", frappe._dict(job_name="test_suspect"), create=True),
        ):
            stub.start()
            self.addCleanup(stub.stop)

    def refusing(self, *markers: bytes):
        """pycrdt panics on any of `markers`, as it would on a row it can't integrate; Yjs takes them."""
        real = compaction.compact

        def compact(checkpoint, rows, roots):
            if any(row in markers for row in rows):
                raise compaction.CompactionFailed("unreadable")
            return real(checkpoint, rows, roots)

        return patch.object(compaction, "compact", compact)

    def judge(self, node: str) -> str | None:
        return suspect.judge(routes.ADAPTER, self.doc_row(node).id, writer_collab.ROOTS, writer_collab.KERNEL)

    def alerts(self, title: str) -> int:
        return frappe.db.count("Error Log", {"method": f"Collab document {title}"})

    def test_a_row_only_pycrdt_refuses_is_quarantined_and_the_document_compacts_again(self):
        node = self.new_document()
        a, b = Pen(self, node), Pen(self, node)
        a.adds(paragraph("alpha"))
        b.adds(paragraph("beta"))
        a.adds(paragraph("gamma"))
        doc_id = self.doc_row(node).id

        with self.refusing(a.sent[1]):
            self.job(doc_id).run()
            self.assertEqual((self.doc_row(node).suspect, self.checkpoints_of(node)), ("unreadable", []))
            self.assertEqual(self.requested, [(JUDGE, doc_id)])

            self.assertEqual(self.judge(node), "quarantined")

        self.assertEqual(self.states(node), ["ok", "ok", "quarantined"])
        self.assertEqual(self.recovered(node), [(3, WRITER, "pycrdt_refused", a.sent[1])])
        self.assertEqual((self.doc_row(node).suspect, self.doc_row(node).suspect_held), (None, None))
        self.job(doc_id).run()
        [(through, _state, integrated)] = self.checkpoints_of(node)
        self.assertEqual((through, integrated), (3, 1))

    def test_a_table_cell_straight_in_the_body_is_quarantined_with_what_its_writer_wrote_after(self):
        node = self.new_document()
        a, b = Pen(self, node), Pen(self, node)
        a.adds(paragraph("abc"))
        b.adds(paragraph("def"))
        a.adds(pycrdt.XmlElement("tableCell", contents=[paragraph("z")]))
        a.adds(paragraph("after"))
        self.set_doc(node, suspect="client")

        self.assertEqual(self.judge(node), "quarantined")

        self.assertEqual(self.states(node), ["ok", "ok", "quarantined", "quarantined"])
        self.assertEqual(
            [reason for _rev, _owner, reason, _payload in self.recovered(node)], ["editor_schema"] * 2
        )
        read = routes.collab.read(routes.ADAPTER, self.doc_row(node).id)
        self.assertEqual(
            kernel.judge(BUNDLE, read["checkpoint"], [payload for _rev, payload in read["rows"]]),
            kernel.Verdict(None),
        )
        self.assertIsNone(self.doc_row(node).suspect)

    def test_without_node_the_document_is_held_keeps_its_rows_and_pauses_saving(self):
        node = self.new_document()
        a = Pen(self, node)
        a.adds(paragraph("alpha"))
        with self.refusing(a.sent[0]):
            self.job(self.doc_row(node).id).run()
        before = self.alerts("suspect held: no_node")

        with patch.object(kernel, "usable_node", lambda: None):
            self.assertEqual(self.judge(node), "held")

        doc = self.doc_row(node)
        self.assertEqual((doc.suspect, doc.suspect_held), ("unreadable", "no_node"))
        self.assertEqual(self.alerts("suspect held: no_node"), before + 1)
        self.assertEqual(self.states(node), ["ok"])
        response = a.write(lambda body: body.children.append(paragraph("beta")))
        self.assertEqual(response.status_code, 423)
        self.assertEqual((answer(response)["reason"], self.row_count(node)), ("suspect", 1))

    def test_a_suspect_document_is_never_compacted_and_only_an_unheld_one_is_judged_by_the_sweep(self):
        node = self.new_document()
        Pen(self, node).adds(paragraph("alpha"))
        doc_id = self.doc_row(node).id
        self.set_doc(node, suspect="unreadable")

        self.job(doc_id).run()
        writer_collab.consider_compaction(doc_id)
        writer_collab.sweep()
        self.assertEqual((self.checkpoints_of(node), self.doc_row(node).compaction_failures), ([], 0))
        self.assertEqual([call for call in self.requested if call[1] == doc_id], [(JUDGE, doc_id)])

        self.set_doc(node, suspect_held="no_node")
        self.requested.clear()
        writer_collab.sweep()
        self.assertNotIn(doc_id, [doc for _method, doc in self.requested])

    def test_a_checkpoint_that_holds_the_bad_content_is_held(self):
        node = self.new_document()
        a = Pen(self, node)
        a.adds(pycrdt.XmlElement("tableCell", contents=[paragraph("z")]))
        self.job(self.doc_row(node).id).run()
        a.adds(paragraph("after"))
        self.set_doc(node, suspect="client")

        self.assertEqual(self.judge(node), "held")

        self.assertEqual(self.doc_row(node).suspect_held, "bad_checkpoint")
        self.assertEqual(self.states(node), ["ok", "ok"])

    def test_rows_pycrdt_still_refuses_after_the_quarantine_hold_the_document_once(self):
        node = self.new_document()
        a = Pen(self, node)
        a.adds(paragraph("alpha"))
        self.set_doc(node, suspect="unreadable")
        quarantined = []

        with (
            self.refusing(a.sent[0]),
            patch.object(quarantine, "quarantine", lambda *args: quarantined.append(args) or []),
        ):
            self.assertEqual(self.judge(node), "held")

        self.assertEqual((len(quarantined), self.doc_row(node).suspect_held), (1, "still_refused"))
        self.assertEqual(self.requested, [])
