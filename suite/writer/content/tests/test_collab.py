import json
import threading
import time
import uuid
from collections.abc import Callable
from http import HTTPStatus
from unittest.mock import patch

import frappe
import pycrdt
from frappe.utils.logging import connection_for

from suite.content.http import routes
from suite.tests.utils import delete_error_logs
from suite.writer import content as writer_content
from suite.writer.content.tests.support import (
    WRITER,
    CollabCase,
    answer,
    call_route,
    push_body,
    typed_updates,
)


class TestWriterCollab(CollabCase):
    def test_two_writers_converge_on_one_order(self):
        self.set_mode("on")
        node = self.new_document()
        header, _ = self.open_document(node)
        self.assertEqual(header["state"], "live")
        first = self.start_session(node)
        second = self.start_session(node)

        sent: list[bytes] = []
        for seq in (1, 2):
            for sid, client_id in (first, second):
                sent.append(self.typed_update(client_id, seq, f"{client_id}:{seq}"))
                status, _ = self.push(node, sid, client_id, seq, sent[-1])
                self.assertEqual(status, 200)

        _header, rows = self.open_document(node)
        self.assertEqual([payload for _, payload in rows], sent)
        self.assert_one_order(node, 4)

    def test_a_push_at_the_size_cap_keeps_every_byte_value(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        doc = pycrdt.Doc(client_id=client_id)
        doc.get("meta", type=pycrdt.Map)["firstTabLabel"] = bytes(range(256)) * (16 * 2**10 - 1)
        payload = doc.get_update()
        self.assertLessEqual(len(payload), 4 * 2**20)

        stage_id = self.stage(node, sid, payload)
        status, _ = self.push_staged(node, sid, client_id, payload, stage_id)
        self.assertEqual(status, 200)

        _, rows = self.open_document(node)
        self.assertEqual(rows, [(1, payload)])
        self.assert_one_order(node, 1)

    def test_a_push_that_skips_seqs_is_out_of_another_lineage_or_ahead_of_the_log_is_refused(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        header, _ = self.open_document(node)
        lineage = header["lineage"]
        first, second = typed_updates(client_id, ["a", "b"])

        for body, refusal in (
            (push_body(lineage, sid, client_id, 2, 0, second), {"collab": "seq", "acked": 0}),
            (push_body("0" * 32, sid, client_id, 1, 0, first), {"collab": "lineage"}),
            (push_body(lineage, sid, client_id, 1, 1, first), {"collab": "diverged"}),
        ):
            with self.subTest(refusal=refusal):
                response = call_route(routes.updates_post, node, body=body)
                self.assertEqual((response.status_code, answer(response)), (409, refusal))

        _, rows = self.open_document(node)
        self.assertEqual(rows, [])
        _, pushed = self.push(node, sid, client_id, 1, first)
        self.assertEqual(pushed["rev"], 1)

    def test_a_push_that_fails_midway_leaves_no_trace(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        sql = frappe.db.sql

        def failing_sql(query, *args, **kwargs):
            if "`last_push_at`" in query:
                raise RuntimeError("database gone")

            return sql(query, *args, **kwargs)

        with patch.object(frappe.db, "sql", failing_sql), self.assertRaises(RuntimeError):
            lost = self.typed_update(client_id, 1, "a")
            self.push(node, sid, client_id, 1, lost)

        _, rows = self.open_document(node)
        self.assertEqual(rows, [])
        kept = self.typed_update(client_id, 1, "b")
        _, pushed = self.push(node, sid, client_id, 1, kept)
        self.assertEqual(pushed["rev"], 1)
        _, rows = self.open_document(node)
        self.assertEqual(rows, [(1, kept)])
        self.assert_one_order(node, 1)

    def test_a_worker_killed_at_any_step_loses_and_duplicates_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        sql = frappe.db.sql
        commit = frappe.db.commit
        calls: list[Callable] = []

        def killing_at_step(real, *, after: bool):
            def counted_call(*args, **kwargs):
                calls.append(real)
                if len(calls) == kill_at and not after:
                    raise RuntimeError("worker killed")

                result = real(*args, **kwargs)
                if len(calls) == kill_at and after:
                    raise RuntimeError("worker killed")

                return result

            return counted_call

        def push_counted(seq: int):
            calls.clear()
            with (
                patch.object(frappe.db, "sql", killing_at_step(sql, after=False)),
                patch.object(frappe.db, "commit", killing_at_step(commit, after=True)),
            ):
                return self.push(node, sid, client_id, seq)

        def push_and_recover(seq: int):
            try:
                push_counted(seq)
            except RuntimeError:
                frappe.db.rollback()

        kill_at = 0
        status, _ = push_counted(1)
        self.assertEqual(status, 200)
        steps = len(calls)
        for kill_at in range(1, steps + 1):
            seq = kill_at + 1
            with self.subTest(step=kill_at):
                push_and_recover(seq)
                status, _ = self.push(node, sid, client_id, seq)
                self.assertEqual(status, 200)

        self.assert_one_order(node, steps + 1)
        _, rows = self.open_document(node)
        self.assertEqual(
            [payload for _, payload in rows],
            typed_updates(client_id, [str(seq) for seq in range(1, steps + 2)]),
        )

    def test_many_writers_at_once_get_gap_free_revs(self):
        self.set_mode("on")
        node = self.new_document()
        header, _ = self.open_document(node)
        lineage = header["lineage"]
        writers = 16
        pushes = 10
        sessions = [self.start_session(node) for _ in range(writers)]
        site = frappe.local.site
        failures: list[dict] = []

        def push_in_turn(sid: str, client_id: int, sent: list[bytes]):
            seq = 1
            while seq <= pushes:
                body = push_body(lineage, sid, client_id, seq, 0, sent[seq - 1])
                response = call_route(routes.updates_post, node, body=body)
                if response.status_code == HTTPStatus.OK:
                    seq += 1
                elif response.status_code == HTTPStatus.LOCKED:
                    time.sleep(0.005)
                else:
                    failures.append(answer(response))
                    return

        def push_all(sid: str, client_id: int):
            frappe.init(site=site)
            frappe.connect()
            frappe.set_user(WRITER)
            sent = typed_updates(client_id, [str(seq) for seq in range(1, pushes + 1)])

            try:
                push_in_turn(sid, client_id, sent)
            finally:
                frappe.destroy()

        threads = [threading.Thread(target=push_all, args=session) for session in sessions]
        for thread in threads:
            thread.start()

        for thread in threads:
            thread.join()

        self.assertEqual(failures, [])
        self.assert_one_order(node, writers * pushes)

    def test_an_open_on_a_broken_chain_is_refused_and_logged(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        self.push(node, sid, client_id, 1)
        doc_id = routes.content.find(writer_content.APP, node).id
        frappe.db.sql(
            "UPDATE `__writer_content_doc` SET `head_chain` = %s WHERE `id` = %s", (b"\x00" * 32, doc_id)
        )
        frappe.db.commit()
        self.addCleanup(frappe.db.commit)
        logged = {
            "method": "Collab open: chain_break",
            "error": f"{writer_content.APP} document {doc_id}",
        }
        self.addCleanup(delete_error_logs, logged)

        response = call_route(routes.document_get, node)
        # The request is a GET, so frappe rolls back what it wrote
        frappe.db.rollback()

        self.assertEqual((response.status_code, answer(response)), (503, {"collab": "chain_break"}))
        self.assertEqual(connection_for("Error Log").count("Error Log", logged), 1)
