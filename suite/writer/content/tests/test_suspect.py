import json
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import frappe
import pycrdt
from frappe.utils import now_datetime
from frappe.utils.background_jobs import get_redis_conn

from suite import drive
from suite.drive._core.access import grant
from suite.drive._core.principals import Principals
from suite.suite_core.content import (
    admission,
    compaction,
    documents,
    kernel,
    live,
    quarantine,
    scheduling,
    suspect,
)
from suite.tests.utils import ensure_user
from suite.writer import content as writer_content
from suite.writer.content import routes
from suite.writer.content.tests import test_checkpoints, test_quarantine
from suite.writer.content.tests.test_checkpoints import WRITER, CheckpointCase
from suite.writer.content.tests.test_collab import OUTSIDER, READER, answer, call, read_frame
from suite.writer.content.tests.test_kernel import BUNDLE, paragraph

JUDGE = "suite.suite_core.content.documents.judge"
SYSTEM_MANAGER = "collab-system-manager@example.com"
SUITE_ADMIN = "collab-suite-admin@example.com"
NO_ROLE = "collab-no-role@example.com"


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
    release_places = test_checkpoints.TestWriterCheckpoints.release_places

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for email, roles in (
            (SYSTEM_MANAGER, ("System Manager",)),
            (SUITE_ADMIN, ("Suite Admin",)),
            (NO_ROLE, ()),
        ):
            ensure_user(email)
            frappe.get_doc("User", email).add_roles(*roles)
        frappe.db.commit()

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
        return suspect.judge(
            routes.ADAPTER,
            self.doc_row(node).id,
            writer_content.ROOTS,
            writer_content.KERNEL,
            writer_content.document_owner,
        )

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
        read = routes.content.read(routes.ADAPTER, self.doc_row(node).id)
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
        self.assertEqual(self.pulled(node)["held"], "change")
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
        documents.consider_compaction(writer_content.ADAPTER, doc_id)
        documents.sweep()
        self.assertEqual((self.checkpoints_of(node), self.doc_row(node).compaction_failures), ([], 0))
        self.assertEqual([call for call in self.requested if call[1] == doc_id], [(JUDGE, doc_id)])

        self.set_doc(node, suspect_held="no_node")
        self.requested.clear()
        documents.sweep()
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
        self.assertEqual(self.pulled(node)["held"], "bad_checkpoint")
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

    def report(self, node: str, rev) -> tuple[int, dict]:
        response = call(routes.collab_suspect_post, node, body=json.dumps({"rev": rev}).encode())
        return response.status_code, answer(response)

    def pulled(self, node: str) -> dict:
        return read_frame(call(routes.collab_updates_get, node).get_data())[0]

    def test_a_tab_that_cannot_apply_a_row_reads_the_verdict_on_its_pull(self):
        node = self.new_document()
        a = Pen(self, node)
        a.adds(paragraph("abc"))
        bad = a.adds(pycrdt.XmlElement("tableCell", contents=[paragraph("z")]))
        doc_id = self.doc_row(node).id
        self.assertNotIn("verdict", self.pulled(node))

        self.assertEqual(self.report(node, bad), (202, {"collab": "judging", "judged": 0}))
        self.assertEqual((self.doc_row(node).suspect, self.requested), ("client", [(JUDGE, doc_id)]))
        documents.judge(writer_content.ADAPTER, doc_id)

        pulled = self.pulled(node)
        self.assertEqual((pulled["judged"], pulled["verdict"], pulled["q_epoch"]), (1, "quarantined", 1))
        self.assertEqual(self.states(node), ["ok", "quarantined"])

        fine = Pen(self, node).adds(paragraph("def"))
        self.set_doc(node, suspect_reported_at=now_datetime() - timedelta(seconds=61))
        self.assertEqual(self.report(node, fine), (202, {"collab": "judging", "judged": 1}))
        documents.judge(writer_content.ADAPTER, doc_id)
        self.assertEqual(
            {key: self.pulled(node)[key] for key in ("judged", "verdict")}, {"judged": 2, "verdict": "clean"}
        )

    def test_a_report_is_heard_once_a_minute_and_a_row_in_the_checkpoint_is_clean_at_once(self):
        node = self.new_document()
        a = Pen(self, node)
        checked = a.adds(paragraph("alpha"))
        self.job(self.doc_row(node).id).run()
        later = a.adds(paragraph("beta"))

        self.assertEqual(self.report(node, checked), (200, {"verdict": "clean", "judged": 0}))
        self.assertEqual((self.doc_row(node).suspect, self.requested), (None, []))

        self.assertEqual(self.report(node, later)[0], 202)
        self.assertEqual(self.report(node, later), (423, {"collab": "busy", "retry_ms": 60_000}))
        self.assertEqual(len(self.requested), 1)
        self.set_doc(node, suspect_reported_at=now_datetime() - timedelta(seconds=61))
        self.assertEqual(self.report(node, later)[0], 202)

    def test_a_report_must_name_a_row_of_the_document_and_a_held_one_stays_paused(self):
        node = self.new_document()
        rev = Pen(self, node).adds(paragraph("alpha"))

        for rev_sent in (0, rev + 1, str(rev), None, True):
            with self.subTest(rev=rev_sent):
                self.assertEqual(self.report(node, rev_sent), (400, {"collab": "malformed"}))
        self.set_doc(node, suspect="client", suspect_held="no_node")
        status, body = self.report(node, rev)
        self.assertEqual((status, body["collab"], body["reason"]), (423, "paused", "suspect"))
        self.assertEqual(self.requested, [])

    def test_anyone_who_can_read_the_document_may_report_and_no_one_else(self):
        ensure_user(READER)
        ensure_user(OUTSIDER)
        node = self.new_document()
        rev = Pen(self, node).adds(paragraph("alpha"))
        grant(node, READER, drive.READ, Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)))
        frappe.db.commit()

        frappe.set_user(OUTSIDER)
        self.assertIn(self.report(node, rev)[0], (403, 404))
        self.assertIsNone(self.doc_row(node).suspect)
        frappe.set_user(READER)
        self.assertEqual(self.report(node, rev)[0], 202)

    def test_a_reader_learns_only_whether_one_change_or_the_document_is_held(self):
        ensure_user(READER)
        node = self.new_document()
        Pen(self, node).adds(paragraph("alpha"))
        grant(node, READER, drive.READ, Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)))
        frappe.db.commit()
        frappe.set_user(READER)

        for held, shown in (
            ("kernel_failed", "change"),
            ("still_refused", "change"),
            ("bad_checkpoint", "bad_checkpoint"),
        ):
            self.set_doc(node, suspect="unreadable", suspect_held=held)
            self.assertEqual(self.pulled(node)["held"], shown)

    def test_a_report_the_judge_cannot_settle_clears_and_saving_goes_on(self):
        def fails(*args):
            raise kernel.KernelFailed("killed")

        for why, stub in (
            ("no_node", lambda: patch.object(kernel, "usable_node", lambda: None)),
            ("kernel_failed", lambda: patch.object(kernel, "judge", fails)),
        ):
            with self.subTest(why=why):
                node = self.new_document()
                a = Pen(self, node)
                rev = a.adds(paragraph("alpha"))
                before = self.alerts(f"suspect unjudged: {why}")

                self.assertEqual(self.report(node, rev)[0], 202)
                with stub():
                    documents.judge(writer_content.ADAPTER, self.doc_row(node).id)

                doc = self.doc_row(node)
                self.assertEqual((doc.suspect, doc.suspect_held, doc.verdict), (None, None, "unjudged"))
                self.assertEqual(self.alerts(f"suspect unjudged: {why}"), before + 1)
                a.adds(paragraph("beta"))
                self.assertEqual(self.states(node), ["ok", "ok"])

    def test_a_row_a_fallback_checkpoint_only_merged_is_still_judged(self):
        node = self.new_document()
        a = Pen(self, node)
        rev = a.adds(paragraph("alpha"))
        doc_id = self.doc_row(node).id

        def merged(checkpoint, rows, roots):
            return compaction.Compacted(compaction.pycrdt.merge_updates(*rows), integrated=False)

        with patch.object(compaction, "compact", merged):
            self.job(doc_id).run()
        self.assertEqual((self.doc_row(node).checkpoint_rev, self.doc_row(node).suspect), (rev, "fallback"))
        self.set_doc(node, suspect=None)
        self.requested.clear()

        self.assertEqual(self.report(node, rev), (202, {"collab": "judging", "judged": 0}))
        self.assertEqual(self.requested, [(JUDGE, doc_id)])

    def test_a_judge_that_fails_holds_a_compaction_suspect_once_and_clears_a_report(self):
        class Panic(BaseException):
            pass

        for marked, held, verdict, error in (
            ("unreadable", "judge_failed", "held", ValueError),
            ("client", None, "unjudged", ValueError),
            ("unreadable", "judge_failed", "held", Panic),
        ):

            def breaks(*args, error=error):
                raise error("unexpected")

            with self.subTest(marked=marked, error=error.__name__):
                node = self.new_document()
                Pen(self, node).adds(paragraph("alpha"))
                doc_id = self.doc_row(node).id
                self.set_doc(node, suspect=marked)
                title = "suspect held: judge_failed" if held else "suspect unjudged: judge_failed"
                before = self.alerts(title)

                with patch.object(suspect, "read", breaks):
                    self.assertEqual(self.judge(node), verdict)

                doc = self.doc_row(node)
                self.assertEqual((doc.suspect_held, doc.verdict), (held, verdict))
                self.assertEqual(self.alerts(title), before + 1)
                logged = frappe.get_last_doc("Error Log", {"method": f"Collab document {title}"}).error
                self.assertEqual((error.__name__ in logged, "unexpected" in logged), (True, False))
                self.requested.clear()
                documents.sweep()
                self.assertNotIn((JUDGE, doc_id), self.requested)

    def test_a_compaction_that_fails_again_after_a_clean_verdict_holds_the_document(self):
        node = self.new_document()
        a = Pen(self, node)
        a.adds(paragraph("alpha"))
        doc_id = self.doc_row(node).id
        failing = [True]
        real = compaction.compact

        def compact(checkpoint, rows, roots):
            if failing[0]:
                raise compaction.CompactionFailed("unreadable")
            return real(checkpoint, rows, roots)

        def fails_then_judged() -> str | None:
            a.adds(paragraph("more"))
            failing[0] = True
            self.job(doc_id).run()
            self.assertEqual(self.doc_row(node).suspect, "unreadable")
            failing[0] = False
            return self.judge(node)

        with patch.object(compaction, "compact", compact):
            self.assertEqual(fails_then_judged(), "clean")
            a.adds(paragraph("beta"))
            self.job(doc_id).run()
            self.assertEqual(self.doc_row(node).compaction_failures, 0)
            self.assertEqual(fails_then_judged(), "clean")
            before = self.alerts("suspect held: unreproduced")

            self.assertEqual(fails_then_judged(), "held")

        self.assertEqual(self.doc_row(node).suspect_held, "unreproduced")
        self.assertEqual(self.alerts("suspect held: unreproduced"), before + 1)
        self.assertEqual(self.states(node), ["ok"] * 5)

    def test_a_reader_who_keeps_reporting_a_good_row_never_pauses_saving(self):
        node = self.new_document()
        a = Pen(self, node)
        rev = a.adds(paragraph("alpha"))
        doc_id = self.doc_row(node).id
        self.set_doc(node, compaction_failures=5)

        for judged in range(1, 5):
            self.set_doc(node, suspect_reported_at=now_datetime() - timedelta(seconds=61))
            self.assertEqual(self.report(node, rev)[0], 202)
            documents.judge(writer_content.ADAPTER, doc_id)
            doc = self.doc_row(node)
            self.assertEqual(
                (doc.suspect, doc.suspect_held, doc.verdict, doc.judged), (None, None, "clean", judged)
            )
        a.adds(paragraph("beta"))

    def test_a_report_judged_clean_does_not_count_toward_a_compaction_hold(self):
        node = self.new_document()
        a = Pen(self, node)
        rev = a.adds(paragraph("alpha"))
        doc_id = self.doc_row(node).id
        self.assertEqual(self.report(node, rev)[0], 202)
        documents.judge(writer_content.ADAPTER, doc_id)
        self.assertEqual(self.doc_row(node).verdict, "clean")

        with patch.object(admission, "enough_memory", lambda: False):
            self.job(doc_id).run()
        self.assertEqual((self.doc_row(node).suspect, self.doc_row(node).compaction_failures), (None, 1))
        with self.refusing(a.sent[0]):
            self.job(doc_id).run()
        self.assertEqual(
            (self.doc_row(node).suspect, self.doc_row(node).compaction_failures), ("unreadable", 2)
        )

        self.assertEqual(self.judge(node), "clean")
        self.assertIsNone(self.doc_row(node).suspect_held)

    def test_a_fallback_judged_clean_is_not_judged_or_alerted_again_for_a_day(self):
        node = self.new_document()
        a = Pen(self, node)
        doc_id = self.doc_row(node).id

        def merged(checkpoint, rows, roots):
            updates = [checkpoint, *rows] if checkpoint else rows
            return compaction.Compacted(compaction.pycrdt.merge_updates(*updates), integrated=False)

        def falls_back() -> tuple[str | None, int, list]:
            a.adds(paragraph("more"))
            self.requested.clear()
            with patch.object(compaction, "compact", merged):
                self.job(doc_id).run()
            alerts = frappe.db.count(
                "Error Log", {"method": "Collab compaction: fallback", "error": ["like", f"%{doc_id}%"]}
            )
            return self.doc_row(node).suspect, alerts, self.requested

        self.assertEqual(falls_back(), ("fallback", 1, [(JUDGE, doc_id)]))
        self.assertEqual(self.judge(node), "clean")

        self.assertEqual(falls_back(), (None, 1, []))
        self.set_doc(node, fallback_judged_clean_at=now_datetime() - timedelta(hours=23))
        self.assertEqual(falls_back(), (None, 1, []))
        stamp = self.doc_row(node).fallback_judged_clean_at
        a.adds(paragraph("unread"))
        with self.refusing(a.sent[-1]):
            self.job(doc_id).run()
        self.assertEqual(self.doc_row(node).suspect, "unreadable")
        self.assertEqual(self.judge(node), "clean")
        self.assertEqual(self.doc_row(node).fallback_judged_clean_at, stamp)

        self.set_doc(node, fallback_judged_clean_at=now_datetime() - timedelta(hours=25))
        self.assertEqual(falls_back(), ("fallback", 2, [(JUDGE, doc_id)]))
        self.assertEqual(self.states(node), ["ok"] * 5)

    def held_document(self) -> tuple[str, str, Pen]:
        node = self.new_document()
        a = Pen(self, node)
        a.adds(paragraph("alpha"))
        self.set_doc(node, suspect="unreadable", suspect_held="no_node")
        return node, self.doc_row(node).id, a

    def test_a_system_manager_lists_suspect_documents_without_their_content_and_changes_nothing(self):
        node, doc_id, _a = self.held_document()
        clean = self.new_document()
        Pen(self, clean).adds(paragraph("beta"))

        frappe.set_user(SYSTEM_MANAGER)
        listed = {row.id: row for row in documents.suspect_documents(writer_content.ADAPTER)}

        self.assertNotIn(self.doc_row(clean).id, listed)
        row = listed[doc_id]
        self.assertEqual(
            set(row),
            {
                "id",
                "node",
                "suspect",
                "suspect_held",
                "verdict",
                "judged",
                "head_rev",
                "checkpoint_rev",
                "integrated_rev",
                "state_bytes",
                "tail_bytes",
                "compaction_failures",
                "last_compaction_error",
            },
        )
        self.assertEqual(
            (row.node, row.suspect, row.suspect_held, row.head_rev), (node, "unreadable", "no_node", 1)
        )
        for refused in (documents.rejudge_suspect, documents.clear_suspect):
            with self.subTest(method=refused.__name__):
                self.assertRaises(frappe.PermissionError, refused, writer_content.ADAPTER, doc_id)
        doc = self.doc_row(node)
        self.assertEqual((doc.suspect, doc.suspect_held, doc.judged), ("unreadable", "no_node", 0))
        self.assertEqual(self.requested, [])

        frappe.set_user(NO_ROLE)
        self.assertRaises(frappe.PermissionError, documents.suspect_documents, writer_content.ADAPTER)

    def test_listing_is_open_to_system_managers_and_acting_to_suite_admins_and_administrator(self):
        node = self.new_document()
        Pen(self, node).adds(paragraph("alpha"))
        doc_id = self.doc_row(node).id
        methods = (
            ("list", lambda: documents.suspect_documents(writer_content.ADAPTER)),
            ("rejudge", lambda: documents.rejudge_suspect(writer_content.ADAPTER, doc_id)),
            ("clear", lambda: documents.clear_suspect(writer_content.ADAPTER, doc_id)),
        )
        may = {
            SYSTEM_MANAGER: (True, False, False),
            SUITE_ADMIN: (True, True, True),
            "Administrator": (True, True, True),
            NO_ROLE: (False, False, False),
            "Guest": (False, False, False),
        }
        for user, allowed in may.items():
            for (name, method), expected in zip(methods, allowed, strict=True):
                with self.subTest(user=user, method=name):
                    frappe.set_user(user)
                    if expected:
                        method()
                    else:
                        self.assertRaises(frappe.PermissionError, method)
        self.assertEqual((self.doc_row(node).suspect, self.requested), (None, []))

    def test_a_suite_admin_asks_for_a_new_verdict_on_a_held_document(self):
        node, doc_id, _a = self.held_document()
        before = self.alerts("suspect re-judged")

        frappe.set_user(SUITE_ADMIN)
        self.assertTrue(documents.rejudge_suspect(writer_content.ADAPTER, doc_id))

        doc = self.doc_row(node)
        self.assertEqual((doc.suspect, doc.suspect_held), ("unreadable", None))
        self.assertEqual(self.requested, [(JUDGE, doc_id)])
        self.assertEqual(self.alerts("suspect re-judged"), before + 1)
        documents.judge(writer_content.ADAPTER, doc_id)
        doc = self.doc_row(node)
        self.assertEqual((doc.suspect, doc.verdict), (None, "clean"))
        self.assertFalse(documents.rejudge_suspect(writer_content.ADAPTER, doc_id))
        self.assertEqual(self.alerts("suspect re-judged"), before + 1)

    def test_a_suite_admin_clears_a_held_document_and_saving_goes_on_with_its_rows(self):
        node, doc_id, a = self.held_document()
        self.assertEqual(a.write(lambda body: body.children.append(paragraph("blocked"))).status_code, 423)
        before = self.alerts("suspect cleared")
        backoff = (now_datetime() + timedelta(minutes=2)).replace(microsecond=0)
        self.set_doc(node, next_compaction_at=backoff)

        frappe.set_user(SUITE_ADMIN)
        self.assertTrue(documents.clear_suspect(writer_content.ADAPTER, doc_id))

        doc = self.doc_row(node)
        self.assertEqual(
            (doc.suspect, doc.suspect_held, doc.verdict, doc.judged, doc.next_compaction_at),
            (None, None, "unjudged", 1, backoff),
        )
        self.assertEqual(self.alerts("suspect cleared"), before + 1)
        self.assertEqual(self.requested, [])
        self.assertFalse(documents.clear_suspect(writer_content.ADAPTER, doc_id))
        frappe.set_user(WRITER)
        self.assertNotIn("held", self.pulled(node))
        Pen(self, node).adds(paragraph("beta"))
        self.assertEqual(self.states(node), ["ok", "ok"])

    def test_a_hold_and_each_way_out_of_it_tell_the_documents_live_room(self):
        node = self.new_document()
        Pen(self, node).adds(paragraph("alpha"))
        doc = self.doc_row(node)
        room = live.rooms(writer_content.ADAPTER, doc.id, doc.lineage)["keys"][0]
        self.set_doc(node, suspect="unreadable")

        with patch("frappe.publish_realtime") as publish:
            suspect.hold(writer_content.ADAPTER, doc.id, "kernel_failed", "held by the test")
            frappe.set_user(SUITE_ADMIN)
            documents.rejudge_suspect(writer_content.ADAPTER, doc.id)
            suspect.hold(writer_content.ADAPTER, doc.id, "kernel_failed", "held by the test")
            documents.clear_suspect(writer_content.ADAPTER, doc.id)

        self.assertEqual(
            [
                (call.args[1]["kind"], call.kwargs["room"])
                for call in publish.call_args_list
                if call.args[0] == "suite_collab_ctl"
            ],
            [("held", room), ("released", room), ("held", room), ("released", room)],
        )

    def test_a_refused_row_whose_session_is_gone_is_quarantined_for_the_document_owner(self):
        node = self.new_document()
        a = Pen(self, node)
        a.adds(paragraph("alpha"))
        frappe.db.sql("DELETE FROM `__writer_content_session` WHERE `sid` = %s", a.sid)
        self.set_doc(node, suspect="unreadable")
        frappe.set_user("Administrator")

        with self.refusing(a.sent[0]):
            self.assertEqual(self.judge(node), "quarantined")

        self.assertEqual(self.recovered(node), [(1, WRITER, "pycrdt_refused", a.sent[0])])
        doc = self.doc_row(node)
        self.assertEqual((doc.suspect, doc.suspect_held, doc.verdict), (None, None, "quarantined"))

    def test_with_every_place_taken_a_judge_waits_for_the_sweep_and_frees_its_place(self):
        node = self.new_document()
        Pen(self, node).adds(paragraph("alpha"))
        doc_id = self.doc_row(node).id
        self.set_doc(node, suspect="unreadable")
        redis = get_redis_conn()
        for index in range(admission.PLACES):
            redis.set(f"suite:collab:compaction:{index}", "elsewhere", ex=60)
        self.addCleanup(self.release_places)

        self.assertEqual(self.judge(node), "busy")

        doc = self.doc_row(node)
        self.assertEqual(
            (doc.suspect, doc.suspect_held, doc.verdict, doc.judged), ("unreadable", None, None, 0)
        )
        documents.sweep()
        self.assertIn((JUDGE, doc_id), self.requested)

        self.release_places()
        self.assertEqual(self.judge(node), "clean")
        self.assertFalse(redis.exists(f"suite:collab:compacting:{frappe.local.site}:writer:{doc_id}"))

    def test_a_re_judge_asked_while_the_judge_runs_is_judged_before_the_judge_ends(self):
        node, doc_id, _a = self.held_document()
        self.set_doc(node, suspect_held=None)
        real, calls = kernel.judge, []

        def judged_while_asked(bundle, checkpoint, rows):
            calls.append(1)
            if len(calls) > 1:
                return real(bundle, checkpoint, rows)
            frappe.set_user(SUITE_ADMIN)
            documents.rejudge_suspect(writer_content.ADAPTER, doc_id)
            frappe.set_user("Administrator")

        with patch.object(kernel, "judge", judged_while_asked):
            self.assertEqual(self.judge(node), "clean")

        doc = self.doc_row(node)
        self.assertEqual((doc.suspect, doc.suspect_held, doc.verdict, doc.judged), (None, None, "clean", 2))
        self.assertEqual(self.judge(node), None)
        self.assertEqual(len(calls), 2)

    def test_a_judge_that_would_hold_a_document_an_admin_cleared_meanwhile_leaves_it_cleared(self):
        node, doc_id, _a = self.held_document()
        self.set_doc(node, suspect_held=None)
        before = self.alerts("suspect held: no_node")

        def cleared_meanwhile(bundle, checkpoint, rows):
            frappe.set_user(SUITE_ADMIN)
            documents.clear_suspect(writer_content.ADAPTER, doc_id)
            frappe.set_user("Administrator")

        with patch.object(kernel, "judge", cleared_meanwhile):
            self.assertIsNone(self.judge(node))

        doc = self.doc_row(node)
        self.assertEqual((doc.suspect, doc.suspect_held, doc.verdict), (None, None, "unjudged"))
        self.assertEqual(self.alerts("suspect held: no_node"), before)

    def test_a_re_judge_asked_before_the_judge_starts_is_judged_once(self):
        node, doc_id, _a = self.held_document()
        before = self.alerts("suspect held: no_node")
        frappe.set_user(SUITE_ADMIN)
        documents.rejudge_suspect(writer_content.ADAPTER, doc_id)
        frappe.set_user("Administrator")

        with patch.object(kernel, "usable_node", lambda: None):
            self.assertEqual(self.judge(node), "held")

        self.assertEqual((self.doc_row(node).judged, self.alerts("suspect held: no_node")), (1, before + 1))

    def test_a_kernel_naming_no_row_holds_the_document_and_quarantines_nothing(self):
        for index in ("-2", "3", "0.5", "true"):
            with self.subTest(index=index), tempfile.TemporaryDirectory() as folder:
                node = self.new_document()
                pen = Pen(self, node)
                for text in ("alpha", "beta", "gamma"):
                    pen.adds(paragraph(text))
                self.set_doc(node, suspect="unreadable")
                bundle = Path(folder) / "kernel.cjs"
                bundle.write_text(
                    f"process.stdout.write(JSON.stringify({{ verdict: 'bad', index: {index}, reason: 'yjs' }}))"
                )

                with patch.object(writer_content, "KERNEL", bundle):
                    verdict = self.judge(node)

                self.assertEqual((verdict, self.doc_row(node).suspect_held), ("held", "kernel_failed"))
                self.assertEqual(self.states(node), ["ok", "ok", "ok"])

    def test_a_judge_that_cannot_reach_redis_takes_no_place(self):
        node = self.new_document()
        Pen(self, node).adds(paragraph("alpha"))
        doc_id = self.doc_row(node).id
        self.set_doc(node, suspect="unreadable")

        with (
            patch.object(suspect, "get_redis_conn", side_effect=ConnectionError),
            self.assertRaises(ConnectionError),
        ):
            self.judge(node)

        self.assertFalse(
            get_redis_conn().exists(f"suite:collab:compacting:{frappe.local.site}:writer:{doc_id}")
        )

    def test_a_verdict_on_a_compaction_suspect_asks_for_a_compaction_at_once(self):
        for verdict in ("quarantined", "clean"):
            with self.subTest(verdict), patch.object(scheduling, "TAIL_ROWS", 1):
                node = self.new_document()
                a, b = Pen(self, node), Pen(self, node)
                a.adds(paragraph("alpha"))
                b.adds(paragraph("beta"))
                a.adds(paragraph("gamma"))
                doc_id = self.doc_row(node).id
                with self.refusing(a.sent[1]):
                    self.job(doc_id).run()
                self.assertGreater(self.doc_row(node).next_compaction_at, now_datetime())
                self.requested.clear()

                with self.refusing(a.sent[1] if verdict == "quarantined" else b""):
                    documents.judge(writer_content.ADAPTER, doc_id)

                doc = self.doc_row(node)
                self.assertEqual((doc.verdict, doc.next_compaction_at), (verdict, None))
                self.assertEqual(self.requested, [("suite.suite_core.content.documents.compact", doc_id)])
