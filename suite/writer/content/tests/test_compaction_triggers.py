import json
import threading
import time
import uuid
from unittest.mock import patch

import frappe
from frappe.utils.background_jobs import create_job_id, get_job, get_redis_conn
from frappe.utils.logging import connection_for
from redis.exceptions import RedisError
from rq.job import Job, JobStatus

from suite.content import capacity, jobs, pushes, scheduling
from suite.content.http import routes
from suite.tests.utils import delete_error_logs
from suite.writer import content as writer_content
from suite.writer.content.tests.support import (
    WRITER,
    CheckpointCase,
    answer,
    as_final,
    body_for,
    call_route,
    typed_updates,
)


class TestWriterCompactionTriggers(CheckpointCase):
    """When a compaction is asked for. Each check watches what is enqueued, not the job itself."""

    def setUp(self):
        super().setUp()
        self.requested: list[str] = []
        real_enqueue = frappe.enqueue

        def enqueue(method, **kwargs):
            if method != jobs.COMPACT:
                return real_enqueue(method, **kwargs)

            self.requested.append(kwargs["doc_id"])

        patcher = patch.object(frappe, "enqueue", enqueue)
        patcher.start()
        self.addCleanup(patcher.stop)

    def typing_pushes(self, node: str, texts: list[str]) -> list[bytes]:
        sid = uuid.uuid4().hex
        session_body = json.dumps({"sid": sid}).encode()
        session = call_route(routes.sessions_post, node, body=session_body)
        client_id = answer(session)["client_id"]
        lineage = self.doc_row(node).lineage
        updates = typed_updates(client_id, texts)
        bodies: list[bytes] = []
        for seq, update in enumerate(updates, start=1):
            bodies.append(body_for(node, lineage, sid, client_id, seq, update))

        return bodies

    def push_bytes(self, node: str, sizes: list[int], *, final: bool = False) -> None:
        bodies = self.typing_pushes(node, ["x" * size for size in sizes])
        if final:
            bodies[-1] = as_final(bodies[-1])

        for body in bodies:
            self.assertEqual(call_route(routes.updates_post, node, body=body).status_code, 200)

    def hold_document(self, doc_id: str, seconds: float) -> None:
        site = frappe.local.site
        held = threading.Event()

        def hold():
            frappe.init(site=site)
            frappe.connect()
            try:
                frappe.db.sql("SELECT `id` FROM `__writer_content_doc` WHERE `id` = %s FOR UPDATE", doc_id)
                held.set()
                time.sleep(seconds)
                frappe.db.commit()
            finally:
                frappe.destroy()

        thread = threading.Thread(target=hold)
        thread.start()
        self.addCleanup(thread.join)
        held.wait()

    def timed_push(self, node: str, body: bytes) -> tuple[int, float]:
        started = time.monotonic()
        response = call_route(routes.updates_post, node, body=body)
        elapsed = time.monotonic() - started
        return response.status_code, elapsed

    def test_a_small_tail_asks_for_nothing_and_a_large_one_asks_once_it_is_large(self):
        node = self.new_document()
        self.push_bytes(node, [1000] * 5)
        self.assertEqual(self.requested, [])

        self.push_bytes(node, [256 * 1024])

        self.assertEqual(self.requested, [self.doc_row(node).id])

    def test_a_document_near_the_cap_does_not_compact_after_every_push(self):
        node = self.new_document()
        self.push_bytes(node, [100])
        self.set_doc(
            node,
            body_rev=1,
            state_bytes=capacity.STATE_MAX - 300 * 1024,
            tail_rows=0,
            tail_bytes=0,
        )

        self.push_bytes(node, [8 * 1024] * 20)
        self.assertEqual(self.requested, [])

        self.push_bytes(node, [128 * 1024])
        self.assertEqual(self.requested, [self.doc_row(node).id])

    def test_a_tail_that_could_fill_half_the_room_left_asks_even_while_its_bytes_are_few(self):
        node = self.new_document()
        self.push_bytes(node, [100])
        self.set_doc(node, state_bytes=capacity.STATE_MAX - 512 * 1024, tail_bound=256 * 1024 - 200)
        self.requested.clear()

        self.push_bytes(node, [100])
        self.assertEqual(self.requested, [])

        self.push_bytes(node, [100])
        self.assertEqual(self.requested, [self.doc_row(node).id])

    def test_a_closing_tab_asks_for_a_compaction_unless_someone_else_is_typing(self):
        node = self.new_document()
        self.push_bytes(node, [100, 100], final=True)
        self.assertEqual(self.requested, [self.doc_row(node).id])

        self.requested.clear()
        self.push_bytes(node, [100])
        self.push_bytes(node, [100], final=True)
        self.assertEqual(self.requested, [])

    def test_a_closing_tab_waits_out_a_push_holding_the_document_and_its_text_is_compacted(self):
        node = self.new_document()
        doc_id = self.doc_row(node).id
        first, last = self.typing_pushes(node, ["Typed just before ", "the tab closed"])
        self.assertEqual(call_route(routes.updates_post, node, body=first).status_code, 200)
        self.hold_document(doc_id, 0.5)

        status, _elapsed = self.timed_push(node, as_final(last))

        self.assertEqual(status, 200)
        self.assertEqual(self.requested, [doc_id])
        self.compact(node)
        self.assertEqual(self.text_of(self.body_of(node)), "Typed just before the tab closed")

    def test_a_closing_tab_waits_no_more_than_two_seconds_and_then_answers_busy(self):
        node = self.new_document()
        doc_id = self.doc_row(node).id
        first, last = self.typing_pushes(node, ["one ", "two"])
        self.assertEqual(call_route(routes.updates_post, node, body=first).status_code, 200)
        self.hold_document(doc_id, 4)

        status, elapsed = self.timed_push(node, as_final(last))

        self.assertEqual(status, 423)
        self.assertGreaterEqual(elapsed, 1.9)
        self.assertLess(elapsed, 3)

    def test_while_one_closing_tab_waits_another_answers_busy_at_once_and_a_later_one_may_wait(self):
        node = self.new_document()
        doc_id = self.doc_row(node).id
        site = frappe.local.site
        (first_tab_push,) = self.typing_pushes(node, ["one"])
        (second_tab_push,) = self.typing_pushes(node, ["two"])
        (third_tab_push,) = self.typing_pushes(node, ["three"])
        self.hold_document(doc_id, 1.8)
        waiting = threading.Event()
        answered: list[tuple[int, float]] = []

        def close_first_tab():
            frappe.init(site=site)
            frappe.connect()
            frappe.set_user(WRITER)
            real_sql = frappe.db.sql

            def signal_lock_wait(query, *args, **kwargs):
                if "FOR UPDATE WAIT" in str(query):
                    waiting.set()

                return real_sql(query, *args, **kwargs)

            try:
                with patch.object(frappe.db, "sql", signal_lock_wait):
                    answered.append(self.timed_push(node, as_final(first_tab_push)))
            finally:
                frappe.destroy()

        first_tab = threading.Thread(target=close_first_tab)
        first_tab.start()
        self.assertTrue(waiting.wait(3))

        status, elapsed = self.timed_push(node, as_final(second_tab_push))
        first_tab.join()

        self.assertEqual(status, 423)
        self.assertLess(elapsed, 0.5)
        [(first_status, first_elapsed)] = answered
        self.assertEqual(first_status, 200)
        self.assertGreaterEqual(first_elapsed, 1)

        self.hold_document(doc_id, 0.5)
        status, elapsed = self.timed_push(node, as_final(third_tab_push))

        self.assertEqual(status, 200)
        self.assertGreaterEqual(elapsed, 0.4)

    def test_a_closing_tab_still_saves_while_redis_is_down(self):
        node = self.new_document()
        (last,) = self.typing_pushes(node, ["Typed while Redis was down"])

        with patch.object(pushes, "get_redis_conn", side_effect=RedisError):
            status, _elapsed = self.timed_push(node, as_final(last))

        self.assertEqual(status, 200)
        self.compact(node)
        self.assertEqual(self.text_of(self.body_of(node)), "Typed while Redis was down")

    def test_a_push_from_an_open_tab_answers_busy_at_once_while_the_document_is_held(self):
        node = self.new_document()
        doc_id = self.doc_row(node).id
        first, last = self.typing_pushes(node, ["one ", "two"])
        self.assertEqual(call_route(routes.updates_post, node, body=first).status_code, 200)
        self.hold_document(doc_id, 1)

        status, elapsed = self.timed_push(node, last)

        self.assertEqual(status, 423)
        self.assertLess(elapsed, 0.5)

    def test_a_tail_ten_minutes_old_asks_on_the_next_open(self):
        node = self.new_document()
        self.push_bytes(node, [100])
        call_route(routes.document_get, node)
        self.assertEqual(self.requested, [])
        frappe.db.sql(
            "UPDATE `__writer_content_update` SET `created` = %s WHERE `doc_id` = %s",
            (frappe.utils.now_datetime() - scheduling.TAIL_AGE, self.doc_row(node).id),
        )
        frappe.db.commit()

        call_route(routes.document_get, node)

        self.assertEqual(self.requested, [self.doc_row(node).id])

    def test_a_backed_off_document_waits_for_its_retry_time(self):
        node = self.new_document()
        self.set_doc(node, next_compaction_at=frappe.utils.now_datetime() + scheduling.QUIET_SPAN)

        self.push_bytes(node, [300 * 1024], final=True)

        self.assertEqual(self.requested, [])

    def test_the_sweeper_asks_for_documents_whose_tail_waited_half_an_hour(self):
        waited = self.new_document()
        fresh = self.new_document()
        self.push_bytes(waited, [100])
        self.push_bytes(fresh, [100])
        # Older than any tail other tests left, as a sweep takes the oldest first
        frappe.db.sql(
            "UPDATE `__writer_content_update` SET `created` = %s WHERE `doc_id` = %s",
            ("2000-01-01", self.doc_row(waited).id),
        )
        frappe.db.commit()

        jobs.sweep()

        self.assertIn(self.doc_row(waited).id, self.requested)
        self.assertNotIn(self.doc_row(fresh).id, self.requested)

    def test_requests_while_the_cache_and_queue_are_down_are_logged_once(self):
        logged = {
            "method": "Collab compaction: request failed",
            "creation": (">=", frappe.utils.now_datetime()),
        }
        self.addCleanup(frappe.db.commit)
        self.addCleanup(delete_error_logs, logged)

        def queue_down(method, **kwargs):
            raise ConnectionError("queue down")

        def cache_down(*args, **kwargs):
            import redis

            raise redis.exceptions.ConnectionError("cache down")

        with (
            patch.object(frappe.cache, "get", cache_down),
            patch.object(frappe.cache, "set", cache_down),
            patch.object(frappe, "enqueue", queue_down),
        ):
            for _ in range(50):
                # Each request starts with an empty local cache
                frappe.local.cache = {}
                scheduling.request_compaction(writer_content.APP, "outage", "unused")

        self.assertEqual(connection_for("Error Log").count("Error Log", logged), 1)

    def test_requests_reach_the_queue_again_once_the_pause_ends(self):
        tried: list[str] = []
        logged = {
            "method": "Collab compaction: request failed",
            "creation": (">=", frappe.utils.now_datetime()),
        }
        self.addCleanup(frappe.db.commit)
        self.addCleanup(delete_error_logs, logged)

        def queue_down(method, **kwargs):
            tried.append(kwargs["doc_id"])
            raise ConnectionError("queue down")

        with patch.object(frappe, "enqueue", queue_down):
            scheduling.request_compaction(writer_content.APP, "outage", "unused")
            scheduling.request_compaction(writer_content.APP, "outage", "unused")
            later = scheduling.time.monotonic() + scheduling.QUEUE_PAUSE.total_seconds() + 1
            with patch.object(scheduling.time, "monotonic", lambda: later):
                scheduling.request_compaction(writer_content.APP, "outage", "unused")

        self.assertEqual(tried, ["outage", "outage"])

    def test_a_job_queue_outage_leaves_open_and_push_working_and_is_logged_once(self):
        node = self.new_document()
        other = self.new_document()
        refused: list[str] = []
        logged = {
            "method": "Collab compaction: request failed",
            "creation": (">=", frappe.utils.now_datetime()),
        }
        self.addCleanup(frappe.db.commit)
        self.addCleanup(delete_error_logs, logged)

        def queue_down(method, **kwargs):
            refused.append(kwargs["doc_id"])
            raise ConnectionError("queue down")

        with patch.object(frappe, "enqueue", queue_down):
            self.push_bytes(node, [300 * 1024], final=True)
            self.assertEqual(call_route(routes.document_get, node).status_code, 200)
            self.assertEqual(call_route(routes.updates_get, node).status_code, 200)
            self.push_bytes(other, [300 * 1024], final=True)

        doc_id = self.doc_row(node).id
        self.assertEqual(refused, [doc_id])
        self.assertEqual((self.row_count(node), self.row_count(other)), (1, 1))
        errors = frappe.get_all("Error Log", logged, pluck="error")
        self.assertEqual(len(errors), 1)
        self.assertTrue(errors[0].startswith(f"writer document {doc_id}\n"), errors[0])

    def test_asking_again_for_a_waiting_job_queues_nothing_and_logs_nothing(self):
        job_id = f"suite-collab-test-{uuid.uuid4().hex}"
        # Saved on no queue, so no live worker takes it
        waiting = Job.create(
            "frappe.ping",
            id=create_job_id(job_id),
            status=JobStatus.QUEUED,
            connection=get_redis_conn(),
        )
        waiting.save()
        self.addCleanup(waiting.delete)

        with self.assertNoLogs(frappe.logger(), "ERROR"):
            scheduling.enqueue("frappe.ping", job_id)

        kept = get_job(job_id)
        self.assertEqual((kept.origin, kept.created_at), ("", waiting.created_at))
