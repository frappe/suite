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
from suite.composition import content as routes
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
from suite.writer.content.tests import test_checkpoints, test_quarantine
from suite.writer.content.tests.test_checkpoints import WRITER, CheckpointCase
from suite.writer.content.tests.test_collab import OUTSIDER, READER, answer, call_route, read_frame
from suite.writer.content.tests.test_kernel import BUNDLE, paragraph

JUDGE = "suite.suite_core.content.documents.judge"
SYSTEM_MANAGER = "collab-system-manager@example.com"
SUITE_ADMIN = "collab-suite-admin@example.com"
NO_ROLE = "collab-no-role@example.com"


class Pen(test_quarantine.Tab):
    """A tab that edits the body itself, so its rows hold paragraphs as the editor writes them."""

    @property
    def text(self) -> pycrdt.XmlFragment:
        return self.ydoc.get("default", type=pycrdt.XmlFragment)

    def append_block(self, node) -> int:
        response = self.push_edit(lambda body: body.children.append(node))
        self.case.assertEqual(response.status_code, 200, response.get_data())
        return answer(response)["rev"]


class TestSuspect(CheckpointCase):
    recovery_copies = test_quarantine.TestQuarantine.recovery_copies
    row_states = test_quarantine.TestQuarantine.row_states
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

        def enqueue(method, **kwargs):
            self.requested.append((method, kwargs["doc_id"]))

        for patcher in (
            patch.object(frappe, "enqueue", enqueue),
            patch.object(frappe.local, "job", frappe._dict(job_name="test_suspect"), create=True),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def pycrdt_refusing(self, *markers: bytes):
        """pycrdt panics on any of `markers`, as it would on a row it can't integrate; Yjs takes them."""
        real_compact = compaction.compact

        def compact(checkpoint, rows, roots):
            if any(row in markers for row in rows):
                raise compaction.CompactionFailed("unreadable")

            return real_compact(checkpoint, rows, roots)

        return patch.object(compaction, "compact", compact)

    def judge(self, node: str) -> str | None:
        return suspect.judge(
            writer_content.ADAPTER,
            self.doc_row(node).id,
            writer_content.ROOTS,
            writer_content.KERNEL,
            writer_content.document_owner,
        )

    def alert_count(self, title: str) -> int:
        return frappe.db.count("Error Log", {"method": f"Collab document {title}"})

    def test_a_row_only_pycrdt_refuses_is_quarantined_and_the_document_compacts_again(self):
        node = self.new_document()
        first_pen = Pen(self, node)
        second_pen = Pen(self, node)
        first_pen.append_block(paragraph("alpha"))
        second_pen.append_block(paragraph("beta"))
        first_pen.append_block(paragraph("gamma"))
        doc_id = self.doc_row(node).id

        with self.pycrdt_refusing(first_pen.sent[1]):
            self.compaction_job(doc_id).run()
            self.assertEqual((self.doc_row(node).suspect, self.checkpoints_of(node)), ("unreadable", []))
            self.assertEqual(self.requested, [(JUDGE, doc_id)])

            self.assertEqual(self.judge(node), "quarantined")

        self.assertEqual(self.row_states(node), ["ok", "ok", "quarantined"])
        self.assertEqual(self.recovery_copies(node), [(3, WRITER, "pycrdt_refused", first_pen.sent[1])])
        self.assertEqual((self.doc_row(node).suspect, self.doc_row(node).suspect_held), (None, None))
        self.compaction_job(doc_id).run()
        self.assertEqual((self.doc_row(node).body_rev, self.checkpoints_of(node)), (3, []))
        self.assertIn(
            self.text_of(self.body_of(node)),
            {
                "<paragraph>alpha</paragraph><paragraph>beta</paragraph>",
                "<paragraph>beta</paragraph><paragraph>alpha</paragraph>",
            },
        )

    def test_a_table_cell_straight_in_the_body_is_quarantined_with_what_its_writer_wrote_after(self):
        node = self.new_document()
        first_pen = Pen(self, node)
        second_pen = Pen(self, node)
        first_pen.append_block(paragraph("abc"))
        second_pen.append_block(paragraph("def"))
        first_pen.append_block(pycrdt.XmlElement("tableCell", contents=[paragraph("z")]))
        first_pen.append_block(paragraph("after"))
        self.set_doc(node, suspect="client")

        self.assertEqual(self.judge(node), "quarantined")

        self.assertEqual(self.row_states(node), ["ok", "ok", "quarantined", "quarantined"])
        reasons = [reason for _rev, _owner, reason, _payload in self.recovery_copies(node)]
        self.assertEqual(reasons, ["editor_schema"] * 2)
        snapshot = routes.content.read(writer_content.ADAPTER, self.doc_row(node).id)
        payloads = [payload for _rev, payload in snapshot["rows"]]
        verdict = kernel.judge(BUNDLE, snapshot["checkpoint"], payloads)
        self.assertEqual(verdict, kernel.Verdict(None))
        self.assertIsNone(self.doc_row(node).suspect)

    def test_without_node_the_document_is_held_keeps_its_rows_and_pauses_saving(self):
        node = self.new_document()
        first_pen = Pen(self, node)
        first_pen.append_block(paragraph("alpha"))
        with self.pycrdt_refusing(first_pen.sent[0]):
            self.compaction_job(self.doc_row(node).id).run()
        alerts_before = self.alert_count("suspect held: no_node")

        with patch.object(kernel, "usable_node", lambda: None):
            self.assertEqual(self.judge(node), "held")

        doc = self.doc_row(node)
        self.assertEqual((doc.suspect, doc.suspect_held), ("unreadable", "no_node"))
        self.assertEqual(self.pulled(node)["held"], "change")
        self.assertEqual(self.alert_count("suspect held: no_node"), alerts_before + 1)
        self.assertEqual(self.row_states(node), ["ok"])
        response = first_pen.push_edit(lambda body: body.children.append(paragraph("beta")))
        self.assertEqual(response.status_code, 423)
        self.assertEqual((answer(response)["reason"], self.row_count(node)), ("suspect", 1))

    def test_a_suspect_document_is_never_compacted_and_only_an_unheld_one_is_judged_by_the_sweep(self):
        node = self.new_document()
        Pen(self, node).append_block(paragraph("alpha"))
        doc_id = self.doc_row(node).id
        self.set_doc(node, suspect="unreadable")

        self.compaction_job(doc_id).run()
        documents.consider_compaction(writer_content.ADAPTER, doc_id)
        documents.sweep()
        self.assertEqual((self.checkpoints_of(node), self.doc_row(node).compaction_failures), ([], 0))
        self.assertEqual([request for request in self.requested if request[1] == doc_id], [(JUDGE, doc_id)])

        self.set_doc(node, suspect_held="no_node")
        self.requested.clear()
        documents.sweep()
        self.assertNotIn(doc_id, [requested_doc_id for _method, requested_doc_id in self.requested])

    def test_a_checkpoint_that_holds_the_bad_content_is_held(self):
        node = self.new_document()
        first_pen = Pen(self, node)
        first_pen.append_block(pycrdt.XmlElement("tableCell", contents=[paragraph("z")]))
        self.compaction_job(self.doc_row(node).id).run()
        first_pen.append_block(paragraph("after"))
        self.set_doc(node, suspect="client")

        self.assertEqual(self.judge(node), "held")

        self.assertEqual(self.doc_row(node).suspect_held, "bad_checkpoint")
        self.assertEqual(self.pulled(node)["held"], "bad_checkpoint")
        self.assertEqual(self.row_states(node), ["ok", "ok"])

    def test_rows_pycrdt_still_refuses_after_the_quarantine_hold_the_document_once(self):
        node = self.new_document()
        first_pen = Pen(self, node)
        first_pen.append_block(paragraph("alpha"))
        self.set_doc(node, suspect="unreadable")
        quarantined = []

        with (
            self.pycrdt_refusing(first_pen.sent[0]),
            patch.object(quarantine, "quarantine", lambda *args: quarantined.append(args) or []),
        ):
            self.assertEqual(self.judge(node), "held")

        self.assertEqual((len(quarantined), self.doc_row(node).suspect_held), (1, "still_refused"))
        self.assertEqual(self.requested, [])

    def report(self, node: str, rev) -> tuple[int, dict]:
        body = json.dumps({"rev": rev}).encode()
        response = call_route(routes.suspect_post, node, body=body)
        return response.status_code, answer(response)

    def pulled(self, node: str) -> dict:
        response = call_route(routes.updates_get, node)
        return read_frame(response.get_data())[0]

    def test_a_tab_that_cannot_apply_a_row_reads_the_verdict_on_its_pull(self):
        node = self.new_document()
        first_pen = Pen(self, node)
        first_pen.append_block(paragraph("abc"))
        bad = first_pen.append_block(pycrdt.XmlElement("tableCell", contents=[paragraph("z")]))
        doc_id = self.doc_row(node).id
        self.assertNotIn("verdict", self.pulled(node))

        self.assertEqual(self.report(node, bad), (202, {"collab": "judging", "judged": 0}))
        self.assertEqual((self.doc_row(node).suspect, self.requested), ("client", [(JUDGE, doc_id)]))
        documents.judge(writer_content.ADAPTER, doc_id)

        pulled = self.pulled(node)
        self.assertEqual((pulled["judged"], pulled["verdict"], pulled["q_epoch"]), (1, "quarantined", 1))
        self.assertEqual(self.row_states(node), ["ok", "quarantined"])

        fine = Pen(self, node).append_block(paragraph("def"))
        self.set_doc(node, suspect_reported_at=now_datetime() - timedelta(seconds=61))
        self.assertEqual(self.report(node, fine), (202, {"collab": "judging", "judged": 1}))
        documents.judge(writer_content.ADAPTER, doc_id)
        self.assertEqual(
            {key: self.pulled(node)[key] for key in ("judged", "verdict")}, {"judged": 2, "verdict": "clean"}
        )

    def test_a_report_is_heard_once_a_minute_and_a_row_in_the_checkpoint_is_clean_at_once(self):
        node = self.new_document()
        first_pen = Pen(self, node)
        checked = first_pen.append_block(paragraph("alpha"))
        self.compaction_job(self.doc_row(node).id).run()
        later = first_pen.append_block(paragraph("beta"))

        self.assertEqual(self.report(node, checked), (200, {"verdict": "clean", "judged": 0}))
        self.assertEqual((self.doc_row(node).suspect, self.requested), (None, []))

        self.assertEqual(self.report(node, later)[0], 202)
        self.assertEqual(self.report(node, later), (423, {"collab": "busy", "retry_ms": 60_000}))
        self.assertEqual(len(self.requested), 1)
        self.set_doc(node, suspect_reported_at=now_datetime() - timedelta(seconds=61))
        self.assertEqual(self.report(node, later)[0], 202)

    def test_a_report_must_name_a_row_of_the_document_and_a_held_one_stays_paused(self):
        node = self.new_document()
        rev = Pen(self, node).append_block(paragraph("alpha"))

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
        rev = Pen(self, node).append_block(paragraph("alpha"))
        writer_principals = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        grant(node, READER, drive.READ, writer_principals)
        frappe.db.commit()

        frappe.set_user(OUTSIDER)
        self.assertIn(self.report(node, rev)[0], (403, 404))
        self.assertIsNone(self.doc_row(node).suspect)
        frappe.set_user(READER)
        self.assertEqual(self.report(node, rev)[0], 202)

    def test_a_reader_learns_only_whether_one_change_or_the_document_is_held(self):
        ensure_user(READER)
        node = self.new_document()
        Pen(self, node).append_block(paragraph("alpha"))
        writer_principals = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        grant(node, READER, drive.READ, writer_principals)
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
        def kernel_fails(*args):
            raise kernel.KernelFailed("killed")

        for why, stub in (
            ("no_node", lambda: patch.object(kernel, "usable_node", lambda: None)),
            ("kernel_failed", lambda: patch.object(kernel, "judge", kernel_fails)),
        ):
            with self.subTest(why=why):
                node = self.new_document()
                first_pen = Pen(self, node)
                rev = first_pen.append_block(paragraph("alpha"))
                alerts_before = self.alert_count(f"suspect unjudged: {why}")

                self.assertEqual(self.report(node, rev)[0], 202)
                with stub():
                    documents.judge(writer_content.ADAPTER, self.doc_row(node).id)

                doc = self.doc_row(node)
                self.assertEqual((doc.suspect, doc.suspect_held, doc.verdict), (None, None, "unjudged"))
                self.assertEqual(self.alert_count(f"suspect unjudged: {why}"), alerts_before + 1)
                first_pen.append_block(paragraph("beta"))
                self.assertEqual(self.row_states(node), ["ok", "ok"])

    def test_a_row_a_fallback_checkpoint_only_merged_is_still_judged(self):
        node = self.new_document()
        first_pen = Pen(self, node)
        rev = first_pen.append_block(paragraph("alpha"))
        doc_id = self.doc_row(node).id

        def fallback_compact(checkpoint, rows, roots):
            merged_state = compaction.pycrdt.merge_updates(*rows)
            return compaction.Compacted(merged_state, integrated=False)

        with patch.object(compaction, "compact", fallback_compact):
            self.compaction_job(doc_id).run()

        through_revs = [through for through, _state, _integrated in self.checkpoints_of(node)]
        self.assertEqual((through_revs, self.doc_row(node).suspect), ([rev], "fallback"))
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

            def read_fails(*args, error=error, **kwargs):
                raise error("unexpected")

            with self.subTest(marked=marked, error=error.__name__):
                node = self.new_document()
                Pen(self, node).append_block(paragraph("alpha"))
                doc_id = self.doc_row(node).id
                self.set_doc(node, suspect=marked)
                title = "suspect held: judge_failed" if held else "suspect unjudged: judge_failed"
                alerts_before = self.alert_count(title)

                with patch.object(suspect, "read", read_fails):
                    self.assertEqual(self.judge(node), verdict)

                doc = self.doc_row(node)
                self.assertEqual((doc.suspect_held, doc.verdict), (held, verdict))
                self.assertEqual(self.alert_count(title), alerts_before + 1)
                logged = frappe.get_last_doc("Error Log", {"method": f"Collab document {title}"}).error
                self.assertEqual((error.__name__ in logged, "unexpected" in logged), (True, False))
                self.requested.clear()
                documents.sweep()
                self.assertNotIn((JUDGE, doc_id), self.requested)

    def test_a_compaction_that_fails_again_after_a_clean_verdict_holds_the_document(self):
        node = self.new_document()
        first_pen = Pen(self, node)
        first_pen.append_block(paragraph("alpha"))
        doc_id = self.doc_row(node).id
        failing = [True]
        real_compact = compaction.compact

        def compact(checkpoint, rows, roots):
            if failing[0]:
                raise compaction.CompactionFailed("unreadable")

            return real_compact(checkpoint, rows, roots)

        def fails_then_judged() -> str | None:
            first_pen.append_block(paragraph("more"))
            failing[0] = True
            self.compaction_job(doc_id).run()
            self.assertEqual(self.doc_row(node).suspect, "unreadable")
            failing[0] = False
            return self.judge(node)

        with patch.object(compaction, "compact", compact):
            self.assertEqual(fails_then_judged(), "clean")
            first_pen.append_block(paragraph("beta"))
            self.compaction_job(doc_id).run()
            self.assertEqual(self.doc_row(node).compaction_failures, 0)
            self.assertEqual(fails_then_judged(), "clean")
            alerts_before = self.alert_count("suspect held: unreproduced")

            self.assertEqual(fails_then_judged(), "held")

        self.assertEqual(self.doc_row(node).suspect_held, "unreproduced")
        self.assertEqual(self.alert_count("suspect held: unreproduced"), alerts_before + 1)
        self.assertEqual(self.row_states(node), ["ok"] * 5)

    def test_a_reader_who_keeps_reporting_a_good_row_never_pauses_saving(self):
        node = self.new_document()
        first_pen = Pen(self, node)
        rev = first_pen.append_block(paragraph("alpha"))
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
        first_pen.append_block(paragraph("beta"))

    def test_a_report_judged_clean_does_not_count_toward_a_compaction_hold(self):
        node = self.new_document()
        first_pen = Pen(self, node)
        rev = first_pen.append_block(paragraph("alpha"))
        doc_id = self.doc_row(node).id
        self.assertEqual(self.report(node, rev)[0], 202)
        documents.judge(writer_content.ADAPTER, doc_id)
        self.assertEqual(self.doc_row(node).verdict, "clean")

        with patch.object(admission, "enough_memory", lambda: False):
            self.compaction_job(doc_id).run()
        self.assertEqual((self.doc_row(node).suspect, self.doc_row(node).compaction_failures), (None, 1))
        with self.pycrdt_refusing(first_pen.sent[0]):
            self.compaction_job(doc_id).run()
        self.assertEqual(
            (self.doc_row(node).suspect, self.doc_row(node).compaction_failures), ("unreadable", 2)
        )

        self.assertEqual(self.judge(node), "clean")
        self.assertIsNone(self.doc_row(node).suspect_held)

    def test_a_fallback_judged_clean_is_not_judged_or_alerted_again_for_a_day(self):
        node = self.new_document()
        first_pen = Pen(self, node)
        doc_id = self.doc_row(node).id

        def fallback_compact(checkpoint, rows, roots):
            updates = [checkpoint, *rows] if checkpoint else rows
            merged_state = compaction.pycrdt.merge_updates(*updates)
            return compaction.Compacted(merged_state, integrated=False)

        def falls_back() -> tuple[str | None, int, list]:
            first_pen.append_block(paragraph("more"))
            self.requested.clear()
            with patch.object(compaction, "compact", fallback_compact):
                self.compaction_job(doc_id).run()
            fallback_alerts = {
                "method": "Collab compaction: fallback",
                "error": ["like", f"%{doc_id}%"],
            }
            alerts = frappe.db.count("Error Log", fallback_alerts)
            return self.doc_row(node).suspect, alerts, self.requested

        self.assertEqual(falls_back(), ("fallback", 1, [(JUDGE, doc_id)]))
        self.assertEqual(self.judge(node), "clean")

        self.assertEqual(falls_back(), (None, 1, []))
        self.set_doc(node, fallback_judged_clean_at=now_datetime() - timedelta(hours=23))
        self.assertEqual(falls_back(), (None, 1, []))
        judged_clean_at = self.doc_row(node).fallback_judged_clean_at
        first_pen.append_block(paragraph("unread"))
        with self.pycrdt_refusing(first_pen.sent[-1]):
            self.compaction_job(doc_id).run()
        self.assertEqual(self.doc_row(node).suspect, "unreadable")
        self.assertEqual(self.judge(node), "clean")
        self.assertEqual(self.doc_row(node).fallback_judged_clean_at, judged_clean_at)

        self.set_doc(node, fallback_judged_clean_at=now_datetime() - timedelta(hours=25))
        self.assertEqual(falls_back(), ("fallback", 2, [(JUDGE, doc_id)]))
        self.assertEqual(self.row_states(node), ["ok"] * 5)

    def held_document(self) -> tuple[str, str, Pen]:
        node = self.new_document()
        first_pen = Pen(self, node)
        first_pen.append_block(paragraph("alpha"))
        self.set_doc(node, suspect="unreadable", suspect_held="no_node")
        return node, self.doc_row(node).id, first_pen

    def test_a_system_manager_lists_suspect_documents_without_their_content_and_changes_nothing(self):
        node, doc_id, _ = self.held_document()
        clean = self.new_document()
        Pen(self, clean).append_block(paragraph("beta"))

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
                "body_rev",
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
        Pen(self, node).append_block(paragraph("alpha"))
        doc_id = self.doc_row(node).id
        methods = (
            ("list", lambda: documents.suspect_documents(writer_content.ADAPTER)),
            ("rejudge", lambda: documents.rejudge_suspect(writer_content.ADAPTER, doc_id)),
            ("clear", lambda: documents.clear_suspect(writer_content.ADAPTER, doc_id)),
        )
        allowed_by_role = {
            SYSTEM_MANAGER: (True, False, False),
            SUITE_ADMIN: (True, True, True),
            "Administrator": (True, True, True),
            NO_ROLE: (False, False, False),
            "Guest": (False, False, False),
        }
        for user, allowed in allowed_by_role.items():
            for (name, method), expected in zip(methods, allowed, strict=True):
                with self.subTest(user=user, method=name):
                    frappe.set_user(user)
                    if expected:
                        method()
                    else:
                        self.assertRaises(frappe.PermissionError, method)
        self.assertEqual((self.doc_row(node).suspect, self.requested), (None, []))

    def test_a_suite_admin_asks_for_a_new_verdict_on_a_held_document(self):
        node, doc_id, _ = self.held_document()
        alerts_before = self.alert_count("suspect re-judged")

        frappe.set_user(SUITE_ADMIN)
        self.assertTrue(documents.rejudge_suspect(writer_content.ADAPTER, doc_id))

        doc = self.doc_row(node)
        self.assertEqual((doc.suspect, doc.suspect_held), ("unreadable", None))
        self.assertEqual(self.requested, [(JUDGE, doc_id)])
        self.assertEqual(self.alert_count("suspect re-judged"), alerts_before + 1)
        documents.judge(writer_content.ADAPTER, doc_id)
        doc = self.doc_row(node)
        self.assertEqual((doc.suspect, doc.verdict), (None, "clean"))
        self.assertFalse(documents.rejudge_suspect(writer_content.ADAPTER, doc_id))
        self.assertEqual(self.alert_count("suspect re-judged"), alerts_before + 1)

    def test_a_suite_admin_clears_a_held_document_and_saving_goes_on_with_its_rows(self):
        node, doc_id, first_pen = self.held_document()
        response = first_pen.push_edit(lambda body: body.children.append(paragraph("blocked")))
        self.assertEqual(response.status_code, 423)
        alerts_before = self.alert_count("suspect cleared")
        backoff = (now_datetime() + timedelta(minutes=2)).replace(microsecond=0)
        self.set_doc(node, next_compaction_at=backoff)

        frappe.set_user(SUITE_ADMIN)
        self.assertTrue(documents.clear_suspect(writer_content.ADAPTER, doc_id))

        doc = self.doc_row(node)
        self.assertEqual(
            (doc.suspect, doc.suspect_held, doc.verdict, doc.judged, doc.next_compaction_at),
            (None, None, "unjudged", 1, backoff),
        )
        self.assertEqual(self.alert_count("suspect cleared"), alerts_before + 1)
        self.assertEqual(self.requested, [])
        self.assertFalse(documents.clear_suspect(writer_content.ADAPTER, doc_id))
        frappe.set_user(WRITER)
        self.assertNotIn("held", self.pulled(node))
        Pen(self, node).append_block(paragraph("beta"))
        self.assertEqual(self.row_states(node), ["ok", "ok"])

    def test_a_hold_and_each_way_out_of_it_tell_the_documents_live_room(self):
        node = self.new_document()
        Pen(self, node).append_block(paragraph("alpha"))
        doc = self.doc_row(node)
        room = live.rooms(writer_content.ADAPTER, doc.id, doc.lineage)["keys"][0]
        self.set_doc(node, suspect="unreadable")

        with patch("frappe.publish_realtime") as publish:
            suspect.hold_document(writer_content.ADAPTER, doc.id, "kernel_failed", "held by the test")
            frappe.set_user(SUITE_ADMIN)
            documents.rejudge_suspect(writer_content.ADAPTER, doc.id)
            suspect.hold_document(writer_content.ADAPTER, doc.id, "kernel_failed", "held by the test")
            documents.clear_suspect(writer_content.ADAPTER, doc.id)

        published = [
            (published.args[1]["kind"], published.kwargs["room"])
            for published in publish.call_args_list
            if published.args[0] == "suite_collab_ctl"
        ]
        self.assertEqual(published, [("held", room), ("released", room), ("held", room), ("released", room)])

    def test_a_refused_row_whose_session_is_gone_is_quarantined_for_the_document_owner(self):
        node = self.new_document()
        first_pen = Pen(self, node)
        first_pen.append_block(paragraph("alpha"))
        frappe.db.sql("DELETE FROM `__writer_content_session` WHERE `sid` = %s", first_pen.sid)
        self.set_doc(node, suspect="unreadable")
        frappe.set_user("Administrator")

        with self.pycrdt_refusing(first_pen.sent[0]):
            self.assertEqual(self.judge(node), "quarantined")

        self.assertEqual(self.recovery_copies(node), [(1, WRITER, "pycrdt_refused", first_pen.sent[0])])
        doc = self.doc_row(node)
        self.assertEqual((doc.suspect, doc.suspect_held, doc.verdict), (None, None, "quarantined"))

    def test_with_every_place_taken_a_judge_waits_for_the_sweep_and_frees_its_place(self):
        node = self.new_document()
        Pen(self, node).append_block(paragraph("alpha"))
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
        compacting_key = f"suite:collab:compacting:{frappe.local.site}:writer:{doc_id}"
        self.assertFalse(redis.exists(compacting_key))

    def test_a_re_judge_asked_while_the_judge_runs_is_judged_before_the_judge_ends(self):
        node, doc_id, _ = self.held_document()
        self.set_doc(node, suspect_held=None)
        real_judge = kernel.judge
        judge_calls = []

        def judged_while_asked(bundle, checkpoint, rows):
            judge_calls.append(1)
            if len(judge_calls) > 1:
                return real_judge(bundle, checkpoint, rows)

            frappe.set_user(SUITE_ADMIN)
            documents.rejudge_suspect(writer_content.ADAPTER, doc_id)
            frappe.set_user("Administrator")

        with patch.object(kernel, "judge", judged_while_asked):
            self.assertEqual(self.judge(node), "clean")

        doc = self.doc_row(node)
        self.assertEqual((doc.suspect, doc.suspect_held, doc.verdict, doc.judged), (None, None, "clean", 2))
        self.assertEqual(self.judge(node), None)
        self.assertEqual(len(judge_calls), 2)

    def test_a_judge_that_would_hold_a_document_an_admin_cleared_meanwhile_leaves_it_cleared(self):
        node, doc_id, _ = self.held_document()
        self.set_doc(node, suspect_held=None)
        alerts_before = self.alert_count("suspect held: no_node")

        def cleared_meanwhile(bundle, checkpoint, rows):
            frappe.set_user(SUITE_ADMIN)
            documents.clear_suspect(writer_content.ADAPTER, doc_id)
            frappe.set_user("Administrator")

        with patch.object(kernel, "judge", cleared_meanwhile):
            self.assertIsNone(self.judge(node))

        doc = self.doc_row(node)
        self.assertEqual((doc.suspect, doc.suspect_held, doc.verdict), (None, None, "unjudged"))
        self.assertEqual(self.alert_count("suspect held: no_node"), alerts_before)

    def test_a_re_judge_asked_before_the_judge_starts_is_judged_once(self):
        node, doc_id, _ = self.held_document()
        alerts_before = self.alert_count("suspect held: no_node")
        frappe.set_user(SUITE_ADMIN)
        documents.rejudge_suspect(writer_content.ADAPTER, doc_id)
        frappe.set_user("Administrator")

        with patch.object(kernel, "usable_node", lambda: None):
            self.assertEqual(self.judge(node), "held")

        self.assertEqual(
            (self.doc_row(node).judged, self.alert_count("suspect held: no_node")), (1, alerts_before + 1)
        )

    def test_a_kernel_naming_no_row_holds_the_document_and_quarantines_nothing(self):
        for index in ("-2", "3", "0.5", "true"):
            with self.subTest(index=index), tempfile.TemporaryDirectory() as folder:
                node = self.new_document()
                pen = Pen(self, node)
                for text in ("alpha", "beta", "gamma"):
                    pen.append_block(paragraph(text))
                self.set_doc(node, suspect="unreadable")
                bundle = Path(folder) / "kernel.cjs"
                bundle.write_text(
                    f"process.stdout.write(JSON.stringify({{ verdict: 'bad', index: {index}, reason: 'yjs' }}))"
                )

                with patch.object(writer_content, "KERNEL", bundle):
                    verdict = self.judge(node)

                self.assertEqual((verdict, self.doc_row(node).suspect_held), ("held", "kernel_failed"))
                self.assertEqual(self.row_states(node), ["ok", "ok", "ok"])

    def test_a_judge_that_cannot_reach_redis_takes_no_place(self):
        node = self.new_document()
        Pen(self, node).append_block(paragraph("alpha"))
        doc_id = self.doc_row(node).id
        self.set_doc(node, suspect="unreadable")

        with (
            patch.object(suspect, "get_redis_conn", side_effect=ConnectionError),
            self.assertRaises(ConnectionError),
        ):
            self.judge(node)

        compacting_key = f"suite:collab:compacting:{frappe.local.site}:writer:{doc_id}"
        self.assertFalse(get_redis_conn().exists(compacting_key))

    def test_a_verdict_on_a_compaction_suspect_asks_for_a_compaction_at_once(self):
        for verdict in ("quarantined", "clean"):
            with self.subTest(verdict), patch.object(scheduling, "TAIL_ROWS", 1):
                node = self.new_document()
                first_pen = Pen(self, node)
                second_pen = Pen(self, node)
                first_pen.append_block(paragraph("alpha"))
                second_pen.append_block(paragraph("beta"))
                first_pen.append_block(paragraph("gamma"))
                doc_id = self.doc_row(node).id
                with self.pycrdt_refusing(first_pen.sent[1]):
                    self.compaction_job(doc_id).run()
                self.assertGreater(self.doc_row(node).next_compaction_at, now_datetime())
                self.requested.clear()

                refused_row = first_pen.sent[1] if verdict == "quarantined" else b""
                with self.pycrdt_refusing(refused_row):
                    documents.judge(writer_content.ADAPTER, doc_id)

                doc = self.doc_row(node)
                self.assertEqual((doc.verdict, doc.next_compaction_at), (verdict, None))
                self.assertEqual(self.requested, [("suite.suite_core.content.documents.compact", doc_id)])
