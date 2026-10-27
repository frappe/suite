import json
import tempfile
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import frappe
import pycrdt
from frappe.utils import now_datetime
from frappe.utils.background_jobs import get_redis_conn
from frappe.utils.logging import connection_for

from suite import drive
from suite.content import (
    admission,
    checker,
    compaction,
    jobs,
    live,
    quarantine,
    scheduling,
    suspect,
)
from suite.content.http import routes
from suite.drive._core.access import grant
from suite.drive._core.principals import Principals
from suite.tests.utils import ensure_user
from suite.writer import content as writer_content
from suite.writer.content.tests import compaction_case, test_quarantine
from suite.writer.content.tests.support import (
    OUTSIDER,
    READER,
    WRITER,
    answer,
    call_route,
    read_frame,
)
from suite.writer.content.tests.test_checker import BUNDLE, paragraph

JUDGE = "suite.content.jobs.judge"


@dataclass(frozen=True)
class FallbackOutcome:
    suspect: str | None
    alerts: int
    requested: list


class Pen(test_quarantine.Tab):
    """A tab that edits the body itself, so its rows hold paragraphs as the editor writes them."""

    @property
    def text(self) -> pycrdt.XmlFragment:
        return self.ydoc.get("default", type=pycrdt.XmlFragment)

    def append_block(self, node) -> int:
        response = self.push_edit(lambda body: body.children.append(node))
        self.case.assertEqual(response.status_code, 200, response.get_data())
        return answer(response)["rev"]


@dataclass(frozen=True)
class HeldDocument:
    node: str
    doc_id: str
    pen: Pen


class TestSuspect(compaction_case.CompactionCase):
    recovery_copies = test_quarantine.TestQuarantine.recovery_copies
    row_states = test_quarantine.TestQuarantine.row_states

    def setUp(self):
        super().setUp()
        if not checker.usable_node() or not BUNDLE.is_file():
            self.skipTest(f"needs Node {checker.NODE_MAJOR}+ and the built bundle at {BUNDLE}")

        patcher = patch.object(frappe.local, "job", frappe._dict(job_name="test_suspect"), create=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def pycrdt_refusing(self, *markers: bytes):
        real_compact = compaction.compact

        def compact(checkpoint, rows, part_map):
            if any(row in markers for row in rows):
                raise compaction.CompactionFailed("unreadable")

            return real_compact(checkpoint, rows, part_map)

        return patch.object(compaction, "compact", compact)

    def judge(self, node: str) -> str | None:
        return suspect.judge(
            writer_content.APP,
            self.doc_row(node).id,
            writer_content.PART_MAP,
            writer_content.CHECKER_BUILD,
        )

    def alert_count(self, title: str) -> int:
        return connection_for("Error Log").count("Error Log", {"method": f"Collab document {title}"})

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
        snapshot = routes.content.read(writer_content.APP, self.doc_row(node).id)
        payloads = snapshot.payloads()
        verdict = checker.judge(BUNDLE, snapshot.checkpoint, payloads)
        self.assertEqual(verdict, checker.Verdict(None))
        self.assertIsNone(self.doc_row(node).suspect)

    def test_without_node_the_document_is_held_keeps_its_rows_and_pauses_saving(self):
        node = self.new_document()
        first_pen = Pen(self, node)
        first_pen.append_block(paragraph("alpha"))
        with self.pycrdt_refusing(first_pen.sent[0]):
            self.compaction_job(self.doc_row(node).id).run()

        alerts_before = self.alert_count("suspect held: no_node")

        with patch.object(checker, "usable_node", return_value=None):
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
        scheduling.request_if_due(writer_content.APP, doc_id, jobs.COMPACT)
        jobs.sweep()
        self.assertEqual((self.checkpoints_of(node), self.doc_row(node).compaction_failures), ([], 0))
        self.assertEqual([request for request in self.requested if request[1] == doc_id], [(JUDGE, doc_id)])

        self.set_doc(node, suspect_held="no_node")
        self.requested.clear()
        jobs.sweep()
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
        quarantined: list[tuple] = []

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
        header, _rows = read_frame(response.get_data())
        return header

    def test_a_tab_that_cannot_apply_a_row_reads_the_verdict_on_its_pull(self):
        node = self.new_document()
        first_pen = Pen(self, node)
        first_pen.append_block(paragraph("abc"))
        bad = first_pen.append_block(pycrdt.XmlElement("tableCell", contents=[paragraph("z")]))
        doc_id = self.doc_row(node).id
        self.assertNotIn("verdict", self.pulled(node))

        self.assertEqual(self.report(node, bad), (202, {"collab": "judging", "judged": 0}))
        self.assertEqual((self.doc_row(node).suspect, self.requested), ("client", [(JUDGE, doc_id)]))
        jobs.judge(writer_content.APP, doc_id)

        pulled = self.pulled(node)
        self.assertEqual((pulled["judged"], pulled["verdict"], pulled["q_epoch"]), (1, "quarantined", 1))
        self.assertEqual(self.row_states(node), ["ok", "quarantined"])

        fine = Pen(self, node).append_block(paragraph("def"))
        self.set_doc(node, suspect_reported_at=now_datetime() - timedelta(seconds=61))
        self.assertEqual(self.report(node, fine), (202, {"collab": "judging", "judged": 1}))
        jobs.judge(writer_content.APP, doc_id)
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

        first_status, _ = self.report(node, later)
        self.assertEqual(first_status, 202)
        self.assertEqual(self.report(node, later), (423, {"collab": "busy", "retry_ms": 60_000}))
        self.assertEqual(len(self.requested), 1)
        self.set_doc(node, suspect_reported_at=now_datetime() - timedelta(seconds=61))
        later_status, _ = self.report(node, later)
        self.assertEqual(later_status, 202)

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
        outsider_status, _ = self.report(node, rev)
        self.assertIn(outsider_status, (403, 404))
        self.assertIsNone(self.doc_row(node).suspect)
        frappe.set_user(READER)
        reader_status, _ = self.report(node, rev)
        self.assertEqual(reader_status, 202)

    def test_a_reader_learns_only_whether_one_change_or_the_document_is_held(self):
        ensure_user(READER)
        node = self.new_document()
        Pen(self, node).append_block(paragraph("alpha"))
        writer_principals = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        grant(node, READER, drive.READ, writer_principals)
        frappe.db.commit()
        frappe.set_user(READER)

        for held, shown in (
            ("checker_failed", "change"),
            ("still_refused", "change"),
            ("bad_checkpoint", "bad_checkpoint"),
        ):
            self.set_doc(node, suspect="unreadable", suspect_held=held)
            self.assertEqual(self.pulled(node)["held"], shown)

    def assert_report_unsettled(self, why: str, stub):
        node = self.new_document()
        first_pen = Pen(self, node)
        rev = first_pen.append_block(paragraph("alpha"))
        alerts_before = self.alert_count(f"suspect unjudged: {why}")

        status, _ = self.report(node, rev)
        self.assertEqual(status, 202)
        with stub():
            jobs.judge(writer_content.APP, self.doc_row(node).id)

        doc = self.doc_row(node)
        self.assertEqual((doc.suspect, doc.suspect_held, doc.verdict), (None, None, "unjudged"))
        self.assertEqual(self.alert_count(f"suspect unjudged: {why}"), alerts_before + 1)
        first_pen.append_block(paragraph("beta"))
        self.assertEqual(self.row_states(node), ["ok", "ok"])

    def test_a_report_the_judge_cannot_settle_clears_and_saving_goes_on(self):
        def checker_fails(*args):
            raise checker.CheckerFailed("killed")

        for why, stub in (
            ("no_node", lambda: patch.object(checker, "usable_node", return_value=None)),
            ("checker_failed", lambda: patch.object(checker, "judge", checker_fails)),
        ):
            with self.subTest(why=why):
                self.assert_report_unsettled(why, stub)

    def test_a_row_a_fallback_checkpoint_only_merged_is_still_judged(self):
        node = self.new_document()
        first_pen = Pen(self, node)
        rev = first_pen.append_block(paragraph("alpha"))
        doc_id = self.doc_row(node).id

        def fallback_compact(checkpoint, rows, part_map):
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

    def assert_judge_failure(self, marked: str, held: str | None, verdict: str, error: type[BaseException]):
        def read_fails(*args, **kwargs):
            raise error("unexpected")

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
        jobs.sweep()
        self.assertNotIn((JUDGE, doc_id), self.requested)

    def test_a_judge_that_fails_holds_a_compaction_suspect_once_and_clears_a_report(self):
        class Panic(BaseException):
            pass

        for marked, held, verdict, error in (
            ("unreadable", "judge_failed", "held", ValueError),
            ("client", None, "unjudged", ValueError),
            ("unreadable", "judge_failed", "held", Panic),
        ):
            with self.subTest(marked=marked, error=error.__name__):
                self.assert_judge_failure(marked, held, verdict, error)

    def assert_left_for_the_sweep(self, marked: str):
        node = self.new_document()
        Pen(self, node).append_block(paragraph("alpha"))
        doc_id = self.doc_row(node).id
        self.set_doc(node, suspect=marked)
        titles = ("suspect held: checker_failed", "suspect unjudged: checker_failed")
        alerts_before = [self.alert_count(title) for title in titles]

        with patch.object(checker, "judge", side_effect=checker.CheckerBusy("waited")):
            self.assertEqual(self.judge(node), "busy")

        doc = self.doc_row(node)
        self.assertEqual((doc.suspect, doc.suspect_held, doc.verdict), (marked, None, None))
        self.assertEqual([self.alert_count(title) for title in titles], alerts_before)
        self.requested.clear()
        jobs.sweep()
        self.assertIn((JUDGE, doc_id), self.requested)

    def test_a_judge_that_waits_out_a_busy_checker_leaves_the_document_suspect_for_the_sweep(self):
        for marked in ("unreadable", "client"):
            with self.subTest(marked=marked):
                self.assert_left_for_the_sweep(marked)

    def test_a_compaction_that_fails_again_after_a_clean_verdict_holds_the_document(self):
        node = self.new_document()
        first_pen = Pen(self, node)
        first_pen.append_block(paragraph("alpha"))
        doc_id = self.doc_row(node).id
        failing = [True]
        real_compact = compaction.compact

        def compact(checkpoint, rows, part_map):
            if failing[0]:
                raise compaction.CompactionFailed("unreadable")

            return real_compact(checkpoint, rows, part_map)

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
            status, _ = self.report(node, rev)
            self.assertEqual(status, 202)
            jobs.judge(writer_content.APP, doc_id)
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
        status, _ = self.report(node, rev)
        self.assertEqual(status, 202)
        jobs.judge(writer_content.APP, doc_id)
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

        def fallback_compact(checkpoint, rows, part_map):
            updates = rows
            if checkpoint:
                updates = [checkpoint, *rows]

            merged_state = compaction.pycrdt.merge_updates(*updates)
            return compaction.Compacted(merged_state, integrated=False)

        def falls_back() -> FallbackOutcome:
            first_pen.append_block(paragraph("more"))
            self.requested.clear()
            with patch.object(compaction, "compact", fallback_compact):
                self.compaction_job(doc_id).run()

            fallback_alerts = {
                "method": "Collab compaction: fallback",
                "error": ["like", f"%{doc_id}%"],
            }
            alerts = connection_for("Error Log").count("Error Log", fallback_alerts)
            return FallbackOutcome(self.doc_row(node).suspect, alerts, self.requested)

        self.assertEqual(falls_back(), FallbackOutcome("fallback", 1, [(JUDGE, doc_id)]))
        self.assertEqual(self.judge(node), "clean")

        self.assertEqual(falls_back(), FallbackOutcome(None, 1, []))
        self.set_doc(node, fallback_judged_clean_at=now_datetime() - timedelta(hours=23))
        self.assertEqual(falls_back(), FallbackOutcome(None, 1, []))
        judged_clean_at = self.doc_row(node).fallback_judged_clean_at
        first_pen.append_block(paragraph("unread"))
        with self.pycrdt_refusing(first_pen.sent[-1]):
            self.compaction_job(doc_id).run()

        self.assertEqual(self.doc_row(node).suspect, "unreadable")
        self.assertEqual(self.judge(node), "clean")
        self.assertEqual(self.doc_row(node).fallback_judged_clean_at, judged_clean_at)

        self.set_doc(node, fallback_judged_clean_at=now_datetime() - timedelta(hours=25))
        self.assertEqual(falls_back(), FallbackOutcome("fallback", 2, [(JUDGE, doc_id)]))
        self.assertEqual(self.row_states(node), ["ok"] * 5)

    def held_document(self) -> HeldDocument:
        node = self.new_document()
        first_pen = Pen(self, node)
        first_pen.append_block(paragraph("alpha"))
        self.set_doc(node, suspect="unreadable", suspect_held="no_node")
        return HeldDocument(node, self.doc_row(node).id, first_pen)

    def test_a_re_judge_lifts_the_hold_and_asks_for_a_new_verdict(self):
        held = self.held_document()
        alerts_before = self.alert_count("suspect re-judged")

        self.assertTrue(suspect.rejudge(writer_content.APP, held.doc_id, JUDGE))

        doc = self.doc_row(held.node)
        self.assertEqual((doc.suspect, doc.suspect_held), ("unreadable", None))
        self.assertEqual(self.requested, [(JUDGE, held.doc_id)])
        self.assertEqual(self.alert_count("suspect re-judged"), alerts_before + 1)
        jobs.judge(writer_content.APP, held.doc_id)
        doc = self.doc_row(held.node)
        self.assertEqual((doc.suspect, doc.verdict), (None, "clean"))
        self.assertFalse(suspect.rejudge(writer_content.APP, held.doc_id, JUDGE))
        self.assertEqual(self.alert_count("suspect re-judged"), alerts_before + 1)

    def test_a_released_document_saves_again_with_its_rows(self):
        held = self.held_document()
        response = held.pen.push_edit(lambda body: body.children.append(paragraph("blocked")))
        self.assertEqual(response.status_code, 423)
        alerts_before = self.alert_count("suspect cleared")
        backoff = (now_datetime() + timedelta(minutes=2)).replace(microsecond=0)
        self.set_doc(held.node, next_compaction_at=backoff)

        self.assertTrue(suspect.release(writer_content.APP, held.doc_id))

        doc = self.doc_row(held.node)
        self.assertEqual(
            (doc.suspect, doc.suspect_held, doc.verdict, doc.judged, doc.next_compaction_at),
            (None, None, "unjudged", 1, backoff),
        )
        self.assertEqual(self.alert_count("suspect cleared"), alerts_before + 1)
        self.assertEqual(self.requested, [])
        self.assertFalse(suspect.release(writer_content.APP, held.doc_id))
        frappe.set_user(WRITER)
        self.assertNotIn("held", self.pulled(held.node))
        Pen(self, held.node).append_block(paragraph("beta"))
        self.assertEqual(self.row_states(held.node), ["ok", "ok"])

    def test_a_hold_and_each_way_out_of_it_tell_the_documents_live_room(self):
        node = self.new_document()
        Pen(self, node).append_block(paragraph("alpha"))
        doc = self.doc_row(node)
        room = live.rooms(writer_content.APP, doc.id, doc.lineage)["keys"][0]
        self.set_doc(node, suspect="unreadable")

        with patch("frappe.publish_realtime") as publish:
            suspect.hold_document(writer_content.APP, doc.id, "checker_failed", "held by the test")
            suspect.rejudge(writer_content.APP, doc.id, JUDGE)
            suspect.hold_document(writer_content.APP, doc.id, "checker_failed", "held by the test")
            suspect.release(writer_content.APP, doc.id)

        messages: list[tuple[str, str]] = []
        for published in publish.call_args_list:
            if published.args[0] == "suite_collab_ctl":
                messages.append((published.args[1]["kind"], published.kwargs["room"]))

        self.assertEqual(messages, [("held", room), ("released", room), ("held", room), ("released", room)])

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

    def test_a_refused_row_whose_owner_drive_cannot_find_holds_the_document(self):
        node = self.new_document()
        first_pen = Pen(self, node)
        first_pen.append_block(paragraph("alpha"))
        frappe.db.sql("DELETE FROM `__writer_content_session` WHERE `sid` = %s", first_pen.sid)
        self.set_doc(node, suspect="unreadable")
        frappe.set_user("Administrator")
        alerts_before = self.alert_count("suspect held: unowned_row")

        with self.pycrdt_refusing(first_pen.sent[0]), test_quarantine.node_gone():
            self.assertEqual(self.judge(node), "held")

        doc = self.doc_row(node)
        self.assertEqual((doc.suspect, doc.suspect_held, doc.verdict), ("unreadable", "unowned_row", "held"))
        self.assertEqual(self.alert_count("suspect held: unowned_row"), alerts_before + 1)
        self.assertEqual((self.row_states(node), self.recovery_copies(node)), (["ok"], []))

    def test_with_every_place_taken_a_judge_waits_for_the_sweep_and_frees_its_place(self):
        node = self.new_document()
        Pen(self, node).append_block(paragraph("alpha"))
        doc_id = self.doc_row(node).id
        self.set_doc(node, suspect="unreadable")
        redis = get_redis_conn()
        live_key = f"suite:collab:compacting:{frappe.local.site}:writer:a-live-doc"
        redis.set(live_key, "a-live-job", nx=True, ex=5)
        self.addCleanup(redis.eval, admission.RELEASE_SCRIPT, 1, live_key, "a-live-job")
        for index in range(admission.PLACES):
            redis.set(f"{admission.KEY_PREFIX}compaction:{index}", "elsewhere", ex=60)

        self.addCleanup(self.release_places)

        self.assertEqual(self.judge(node), "busy")

        doc = self.doc_row(node)
        self.assertEqual(
            (doc.suspect, doc.suspect_held, doc.verdict, doc.judged), ("unreadable", None, None, 0)
        )
        jobs.sweep()
        self.assertIn((JUDGE, doc_id), self.requested)

        self.release_places()
        self.assertEqual(redis.get(live_key), b"a-live-job")
        self.assertEqual(self.judge(node), "clean")
        compacting_key = f"{admission.KEY_PREFIX}compacting:{frappe.local.site}:writer:{doc_id}"
        self.assertFalse(redis.exists(compacting_key))

    def test_a_re_judge_asked_while_the_judge_runs_is_judged_before_the_judge_ends(self):
        held = self.held_document()
        self.set_doc(held.node, suspect_held=None)
        real_judge = checker.judge
        judge_calls: list[int] = []

        def judged_while_asked(bundle, checkpoint, rows):
            judge_calls.append(1)
            if len(judge_calls) > 1:
                return real_judge(bundle, checkpoint, rows)

            suspect.rejudge(writer_content.APP, held.doc_id, JUDGE)

        with patch.object(checker, "judge", judged_while_asked):
            self.assertEqual(self.judge(held.node), "clean")

        doc = self.doc_row(held.node)
        self.assertEqual((doc.suspect, doc.suspect_held, doc.verdict, doc.judged), (None, None, "clean", 2))
        self.assertEqual(self.judge(held.node), None)
        self.assertEqual(len(judge_calls), 2)

    def test_a_judge_that_would_hold_a_document_an_admin_cleared_meanwhile_leaves_it_cleared(self):
        held = self.held_document()
        self.set_doc(held.node, suspect_held=None)
        alerts_before = self.alert_count("suspect held: no_node")

        def cleared_meanwhile(bundle, checkpoint, rows):
            suspect.release(writer_content.APP, held.doc_id)

        with patch.object(checker, "judge", cleared_meanwhile):
            self.assertIsNone(self.judge(held.node))

        doc = self.doc_row(held.node)
        self.assertEqual((doc.suspect, doc.suspect_held, doc.verdict), (None, None, "unjudged"))
        self.assertEqual(self.alert_count("suspect held: no_node"), alerts_before)

    def test_a_re_judge_asked_before_the_judge_starts_is_judged_once(self):
        held = self.held_document()
        alerts_before = self.alert_count("suspect held: no_node")
        suspect.rejudge(writer_content.APP, held.doc_id, JUDGE)

        with patch.object(checker, "usable_node", return_value=None):
            self.assertEqual(self.judge(held.node), "held")

        self.assertEqual(
            (self.doc_row(held.node).judged, self.alert_count("suspect held: no_node")),
            (1, alerts_before + 1),
        )

    def assert_held_for_index(self, index: str, folder: str):
        node = self.new_document()
        pen = Pen(self, node)
        for text in ("alpha", "beta", "gamma"):
            pen.append_block(paragraph(text))

        self.set_doc(node, suspect="unreadable")
        bundle = Path(folder) / "checker.cjs"
        bundle.write_text(
            f"process.stdout.write(JSON.stringify({{ verdict: 'bad', index: {index}, reason: 'yjs' }}))"
        )

        with patch.object(writer_content, "CHECKER_BUILD", bundle):
            verdict = self.judge(node)

        self.assertEqual((verdict, self.doc_row(node).suspect_held), ("held", "checker_failed"))
        self.assertEqual(self.row_states(node), ["ok", "ok", "ok"])

    def test_a_checker_naming_no_row_holds_the_document_and_quarantines_nothing(self):
        for index in ("-2", "3", "0.5", "true"):
            with self.subTest(index=index), tempfile.TemporaryDirectory() as folder:
                self.assert_held_for_index(index, folder)

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

        compacting_key = f"{admission.KEY_PREFIX}compacting:{frappe.local.site}:writer:{doc_id}"
        self.assertFalse(get_redis_conn().exists(compacting_key))

    def assert_verdict_asks_for_compaction(self, verdict: str):
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

        refused_row = b""
        if verdict == "quarantined":
            refused_row = first_pen.sent[1]

        with self.pycrdt_refusing(refused_row):
            jobs.judge(writer_content.APP, doc_id)

        doc = self.doc_row(node)
        self.assertEqual((doc.verdict, doc.next_compaction_at), (verdict, None))
        self.assertEqual(self.requested, [("suite.content.jobs.compact", doc_id)])

    def test_a_verdict_on_a_compaction_suspect_asks_for_a_compaction_at_once(self):
        for verdict in ("quarantined", "clean"):
            with self.subTest(verdict), patch.object(scheduling, "TAIL_ROWS", 1):
                self.assert_verdict_asks_for_compaction(verdict)
