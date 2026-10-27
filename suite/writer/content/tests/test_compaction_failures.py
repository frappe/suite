import os
import signal
from datetime import timedelta
from typing import NoReturn
from unittest.mock import patch

import frappe
import pycrdt
from frappe.utils.logging import connection_for

from suite.content import admission, compaction, jobs
from suite.tests.utils import delete_error_logs
from suite.writer import content as writer_content
from suite.writer.content.tests.compaction_case import CompactionCase


def compact_in_horse(site: str, doc_id: str, compact_stub) -> NoReturn:
    try:
        frappe.init(site)
        frappe.connect()
        with patch.object(compaction, "compact", compact_stub):
            jobs.compact(writer_content.APP, doc_id)
    finally:
        os._exit(0)


def compact_killed_after_writing(site: str, doc_id: str) -> NoReturn:
    try:
        frappe.init(site)
        frappe.connect()
        real_sql = frappe.db.sql

        def killed_after_writing(query, *args, **kwargs):
            found = real_sql(query, *args, **kwargs)
            if "UPDATE `tabWriter Document`" in str(query):
                os.kill(os.getpid(), signal.SIGKILL)

            return found

        with patch.object(frappe.db, "sql", killed_after_writing):
            jobs.compact(writer_content.APP, doc_id)
    finally:
        os._exit(0)


class TestCompactionFailures(CompactionCase):
    def test_a_work_horse_killed_mid_compaction_leaves_every_row_and_commits_nothing(self):
        # A crash, the worker's timeout kill and a memory abort all end the horse with a signal
        for kill_signal in (signal.SIGSEGV, signal.SIGKILL, signal.SIGABRT):
            with self.subTest(signal=kill_signal):
                node = self.new_document()
                self.type_into(node, ["one ", "two"])
                doc_id = self.doc_row(node).id

                status = self.in_forked_horse(
                    doc_id, lambda *args, kill_signal=kill_signal: os.kill(os.getpid(), kill_signal)
                )

                self.assertTrue(os.WIFSIGNALED(status))
                frappe.db.rollback()
                doc = self.doc_row(node)
                self.assertEqual((self.checkpoints_of(node), self.body_of(node)), ([], b"\x00\x00"))
                self.assertEqual((doc.body_rev, self.row_count(node)), (0, 2))
                self.assertEqual(doc.compaction_failures, 1)
                self.assertGreater(doc.next_compaction_at, frappe.utils.now_datetime())
                self.release_places()

    def in_forked_horse(self, doc_id: str, compact_stub) -> int:
        site = frappe.local.site
        pid = os.fork()
        if pid == 0:
            compact_in_horse(site, doc_id, compact_stub)

        _, status = os.waitpid(pid, 0)
        return status

    def test_another_pycrdt_version_keeps_every_row_backs_off_and_alerts(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        before = connection_for("Error Log").count("Error Log")

        with patch.object(pycrdt, "__version__", "0.15.0"):
            self.compact(node)

        doc = self.doc_row(node)
        self.assertEqual(self.checkpoints_of(node), [])
        self.assertEqual(
            (doc.body_rev, doc.compaction_failures, doc.last_compaction_error), (0, 1, "kernel_version")
        )
        self.assertGreater(doc.next_compaction_at, frappe.utils.now_datetime())
        self.assertEqual(connection_for("Error Log").count("Error Log"), before + 1)

    def test_failures_back_off_longer_each_time_and_a_success_clears_them(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        waits: list[timedelta] = []
        with patch.object(pycrdt, "__version__", "0.15.0"):
            for _ in range(3):
                self.compact(node)
                wait = self.doc_row(node).next_compaction_at - frappe.utils.now_datetime()
                waits.append(wait)

        self.assertLess(waits[0], waits[1])
        self.assertLess(waits[1], waits[2])

        self.compact(node)

        doc = self.doc_row(node)
        self.assertEqual((doc.compaction_failures, doc.next_compaction_at, doc.body_rev), (0, None, 1))

    def test_the_third_failure_in_a_row_tells_an_admin(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        logged = {"method": "Collab compaction: insufficient_memory"}
        self.addCleanup(delete_error_logs, logged)
        counts: list[int] = []
        with patch.object(admission, "enough_memory", return_value=False):
            for _ in range(3):
                self.compact(node)
                counts.append(connection_for("Error Log").count("Error Log", logged))

        self.assertEqual(counts, [0, 0, 1])

    def test_an_attempt_killed_while_writing_is_finished_by_the_next(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two"])
        doc_id = self.doc_row(node).id
        site = frappe.local.site
        pid = os.fork()
        if pid == 0:
            compact_killed_after_writing(site, doc_id)

        os.waitpid(pid, 0)
        frappe.db.rollback()
        self.release_places()
        self.assertEqual((self.doc_row(node).body_rev, self.body_of(node)), (0, b"\x00\x00"))

        self.compact(node)

        self.assertEqual(self.doc_row(node).body_rev, 2)
        self.assertEqual(self.text_of(self.body_of(node)), "one two")
