import gzip
import json
import os
import shutil
import signal
import tempfile
import threading
import uuid
from unittest.mock import patch

import frappe
import pycrdt
from frappe.tests import IntegrationTestCase
from frappe.utils.background_jobs import get_redis_conn

from suite import drive
from suite.suite_core.collab import checkpoints, compaction
from suite.suite_core.collab.log import isolation
from suite.tests.utils import ensure_user
from suite.writer import collab as writer_collab
from suite.writer.collab import routes
from suite.writer.collab.tests.test_collab import answer, call, push_body, read_open

WRITER = "writer-collab-writer@example.com"


class CheckpointCase(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(WRITER)
        writer_collab.ensure_tables()
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        self.mode = frappe.db.get_single_value("Suite Collab Settings", "mode")
        frappe.db.set_single_value("Suite Collab Settings", "mode", "on")
        frappe.db.commit()
        self.addCleanup(self.restore_mode)
        frappe.set_user(WRITER)
        self.addCleanup(frappe.set_user, "Administrator")

    def restore_mode(self):
        frappe.db.set_single_value("Suite Collab Settings", "mode", self.mode or "off")
        frappe.db.commit()

    def new_document(self) -> str:
        root = drive.ensure_personal_root(WRITER)
        parent = frappe.db.get_value("Drive Root", root, "node")
        node = drive.create_document(
            parent, f"Collab {uuid.uuid4().hex[:8]}", content_doctype="Writer Document"
        )
        frappe.db.commit()
        self.addCleanup(self.forget, node)
        return node

    def forget(self, node: str):
        doc = routes.collab.find(routes.ADAPTER, node)
        if doc:
            for kind in ("update", "session", "checkpoint"):
                frappe.db.sql(f"DELETE FROM `__writer_collab_{kind}` WHERE `doc_id` = %s", doc.id)
            frappe.db.sql("DELETE FROM `__writer_collab_doc` WHERE `id` = %s", doc.id)
            frappe.db.commit()

    def type_into(self, node: str, words: list[str]) -> str:
        """A tab opened on the document types each word as its own row; returns the whole text."""
        sid = uuid.uuid4().hex
        cid = answer(call(routes.collab_sessions_post, node, body=json.dumps({"sid": sid}).encode()))[
            "client_id"
        ]
        header, checkpoint, rows = read_open(call(routes.collab_get, node).get_data())
        doc = pycrdt.Doc(client_id=cid)
        for payload in [checkpoint, *(payload for _rev, payload in rows)]:
            if payload:
                doc.apply_update(payload)
        seen = doc.get_state()
        fragment = doc.get("default", type=pycrdt.XmlFragment)
        text = fragment.children[0] if len(fragment.children) else fragment.children.append(pycrdt.XmlText())
        for seq, word in enumerate(words, start=1):
            text.insert(len(str(text)), word)
            update = doc.get_update(seen)
            seen = doc.get_state()
            body = push_body(header["lineage"], sid, cid, seq, 0, update)
            self.assertEqual(call(routes.collab_updates_post, node, body=body).status_code, 200)
        return str(text)

    def doc_row(self, node: str):
        return frappe.db.sql("SELECT * FROM `__writer_collab_doc` WHERE `node` = %s", node, as_dict=True)[0]

    def checkpoints_of(self, node: str) -> list[tuple[int, bytes, int]]:
        return [
            (int(rev), gzip.decompress(bytes(gz)), int(integrated))
            for rev, gz, integrated in frappe.db.sql(
                """SELECT `through_rev`, `gz`, `integrated` FROM `__writer_collab_checkpoint`
                WHERE `doc_id` = %s ORDER BY `through_rev`""",
                self.doc_row(node).id,
            )
        ]

    def row_count(self, node: str) -> int:
        return frappe.db.sql(
            "SELECT COUNT(*) FROM `__writer_collab_update` WHERE `doc_id` = %s", self.doc_row(node).id
        )[0][0]

    def set_doc(self, node: str, **values):
        assignments = ", ".join(f"`{key}` = %({key})s" for key in values)
        frappe.db.sql(
            f"UPDATE `__writer_collab_doc` SET {assignments} WHERE `node` = %(node)s",
            {**values, "node": node},
        )
        frappe.db.commit()

    def text_of(self, state: bytes) -> str:
        doc = compaction.load([state])
        return "".join(str(child) for child in doc.get("default", type=pycrdt.XmlFragment).children)

    def compact(self, node: str):
        writer_collab.compact(self.doc_row(node).id)


class TestWriterCheckpoints(CheckpointCase):
    def test_a_compaction_installs_a_checkpoint_of_every_row(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two ", "three"])

        self.compact(node)

        doc = self.doc_row(node)
        [(through, state, integrated)] = self.checkpoints_of(node)
        self.assertEqual((through, integrated), (3, 1))
        self.assertEqual(self.text_of(state), "one two three")
        self.assertEqual(
            (doc.checkpoint_rev, doc.integrated_rev, doc.tail_rows, doc.tail_bytes), (3, 3, 0, 0)
        )
        self.assertEqual((doc.compaction_failures, doc.next_compaction_at), (0, None))
        self.assertEqual(self.row_count(node), 3)

    def test_a_second_compaction_replaces_the_first_checkpoint(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two "])
        self.compact(node)
        self.type_into(node, ["three"])

        self.compact(node)

        [(through, state, _integrated)] = self.checkpoints_of(node)
        self.assertEqual(through, 3)
        self.assertEqual(self.text_of(state), "one two three")

    def test_a_work_horse_killed_mid_compaction_leaves_every_row_and_commits_nothing(self):
        # A crash, the worker's timeout kill and a memory abort all end the horse with a signal
        for sign in (signal.SIGSEGV, signal.SIGKILL, signal.SIGABRT):
            with self.subTest(signal=sign):
                node = self.new_document()
                self.type_into(node, ["one ", "two"])
                doc_id = self.doc_row(node).id

                status = self.in_forked_horse(doc_id, lambda *args, sign=sign: os.kill(os.getpid(), sign))

                self.assertTrue(os.WIFSIGNALED(status))
                frappe.db.rollback()
                doc = self.doc_row(node)
                self.assertEqual(self.checkpoints_of(node), [])
                self.assertEqual((doc.checkpoint_rev, self.row_count(node)), (0, 2))
                self.assertEqual(doc.compaction_failures, 1)
                self.assertGreater(doc.next_compaction_at, frappe.utils.now_datetime())
                self.release_places()

    def in_forked_horse(self, doc_id: str, kernel) -> int:
        site = frappe.local.site
        pid = os.fork()
        if pid == 0:
            try:
                frappe.init(site)
                frappe.connect()
                with patch.object(compaction, "compact", kernel):
                    writer_collab.compact(doc_id)
            finally:
                os._exit(0)
        return os.waitpid(pid, 0)[1]

    def release_places(self):
        redis = get_redis_conn()
        for key in redis.keys("suite:collab:compact*"):
            redis.delete(key)

    def test_another_pycrdt_version_keeps_every_row_backs_off_and_alerts(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        before = frappe.db.count("Error Log")

        with patch.object(pycrdt, "__version__", "0.15.0"):
            self.compact(node)

        doc = self.doc_row(node)
        self.assertEqual(self.checkpoints_of(node), [])
        self.assertEqual(
            (doc.checkpoint_rev, doc.compaction_failures, doc.last_compaction_error), (0, 1, "kernel_version")
        )
        self.assertGreater(doc.next_compaction_at, frappe.utils.now_datetime())
        self.assertEqual(frappe.db.count("Error Log"), before + 1)

    def test_failures_back_off_longer_each_time_and_a_success_clears_them(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        waits = []
        with patch.object(pycrdt, "__version__", "0.15.0"):
            for _ in range(3):
                self.compact(node)
                waits.append(self.doc_row(node).next_compaction_at - frappe.utils.now_datetime())
        self.assertLess(waits[0], waits[1])
        self.assertLess(waits[1], waits[2])

        self.compact(node)

        doc = self.doc_row(node)
        self.assertEqual((doc.compaction_failures, doc.next_compaction_at, doc.checkpoint_rev), (0, None, 1))

    def test_an_older_compaction_never_replaces_a_newer_checkpoint(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two "])
        doc_id = self.doc_row(node).id
        older = routes.collab.read("writer", doc_id)
        self.type_into(node, ["three"])
        self.compact(node)

        rows = [payload for _rev, payload in older["rows"]]
        result = compaction.compact(older["checkpoint"], rows, writer_collab.ROOTS)
        report = {"ms": 1}
        sha = checkpoints.store("writer", doc_id, 2, older["head_chain"], result, report, writer_collab.ROOTS)
        checkpoints.install("writer", doc_id, older["lineage"], 2, older["head_chain"], sha, result, report)

        [(through, state, _integrated)] = self.checkpoints_of(node)
        self.assertEqual((through, self.doc_row(node).checkpoint_rev), (3, 3))
        self.assertEqual(self.text_of(state), "one two three")

    def test_with_every_place_taken_a_compaction_waits_without_counting_a_failure(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        redis = get_redis_conn()
        for index in range(checkpoints.PLACES):
            redis.set(f"suite:collab:compaction:{index}", "elsewhere", ex=60)
        self.addCleanup(self.release_places)

        self.compact(node)

        doc = self.doc_row(node)
        self.assertEqual((self.checkpoints_of(node), doc.compaction_failures), ([], 0))
        self.assertGreater(doc.next_compaction_at, frappe.utils.now_datetime())

    def test_a_large_state_paces_the_next_compaction(self):
        node = self.new_document()
        filler = os.urandom(300 * 1024).hex()
        self.type_into(node, [filler[: len(filler) // 2], filler[len(filler) // 2 :]])

        self.compact(node)

        doc = self.doc_row(node)
        self.assertEqual(doc.checkpoint_rev, 2)
        wait = (doc.next_compaction_at - frappe.utils.now_datetime()).total_seconds()
        self.assertGreater(wait, 50)

    def test_a_state_larger_than_half_the_packet_limit_is_stored(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        packet = int(frappe.db.sql("SELECT @@max_allowed_packet")[0][0])
        state = os.urandom(packet // 2 + 2**20)
        result = compaction.Compacted(state=state, integrated=True, report={})
        snapshot = routes.collab.read("writer", self.doc_row(node).id)

        checkpoints.store(
            "writer", self.doc_row(node).id, 1, snapshot["head_chain"], result, {}, writer_collab.ROOTS
        )

        self.assertEqual(self.checkpoints_of(node), [(1, state, 1)])

    def test_a_state_too_large_to_store_whole_is_refused(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        mode = frappe.db.sql("SELECT @@SESSION.sql_mode")[0][0]
        frappe.db.sql("SET SESSION sql_mode = ''")
        self.addCleanup(frappe.db.sql, "SET SESSION sql_mode = %s", mode)
        packet = int(frappe.db.sql("SELECT @@max_allowed_packet")[0][0])
        result = compaction.Compacted(state=os.urandom(packet + 2**20), integrated=True, report={})
        snapshot = routes.collab.read("writer", self.doc_row(node).id)

        with self.assertRaises(compaction.CompactionFailed) as failed:
            checkpoints.store(
                "writer", self.doc_row(node).id, 1, snapshot["head_chain"], result, {}, writer_collab.ROOTS
            )
        frappe.db.rollback()

        self.assertEqual(failed.exception.reason, "too_large")
        self.assertEqual(self.checkpoints_of(node), [])

    def stored(self, node: str, *, integrated: bool = True) -> tuple[dict, object, bytes]:
        """A compaction of the document through its head, stored as T2 leaves it, not yet installed."""
        doc_id = self.doc_row(node).id
        snapshot = routes.collab.read("writer", doc_id)
        rows = [payload for _rev, payload in snapshot["rows"]]
        result = compaction.compact(snapshot["checkpoint"], rows, writer_collab.ROOTS)
        if not integrated:
            result = compaction.Compacted(compaction.pycrdt.merge_updates(*rows), integrated=False)
        sha = checkpoints.store(
            "writer",
            doc_id,
            snapshot["head_rev"],
            snapshot["head_chain"],
            result,
            {"ms": 1},
            writer_collab.ROOTS,
        )
        return snapshot, result, sha

    def test_a_checkpoint_row_gone_before_its_install_is_never_pointed_at(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two"])
        snapshot, result, sha = self.stored(node)
        # Another job's failure clears the row it thinks is its own
        frappe.db.sql("DELETE FROM `__writer_collab_checkpoint` WHERE `doc_id` = %s", self.doc_row(node).id)
        frappe.db.commit()

        checkpoints.install(
            "writer",
            self.doc_row(node).id,
            snapshot["lineage"],
            2,
            snapshot["head_chain"],
            sha,
            result,
            {"ms": 1},
        )

        self.assertEqual(self.doc_row(node).checkpoint_rev, 0)
        self.assertEqual(self.opened(node)[2], "one two")
        self.compact(node)
        self.assertEqual((self.doc_row(node).checkpoint_rev, self.opened(node)[2]), (2, "one two"))

    def test_an_attempt_killed_after_storing_is_finished_by_the_next(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two"])
        doc_id = self.doc_row(node).id
        site = frappe.local.site
        pid = os.fork()
        if pid == 0:
            try:
                frappe.init(site)
                frappe.connect()
                with patch.object(checkpoints, "install", lambda *args: os.kill(os.getpid(), signal.SIGKILL)):
                    writer_collab.compact(doc_id)
            finally:
                os._exit(0)
        os.waitpid(pid, 0)
        frappe.db.rollback()
        self.release_places()
        self.assertEqual((self.doc_row(node).checkpoint_rev, len(self.checkpoints_of(node))), (0, 1))

        self.compact(node)

        doc = self.doc_row(node)
        [(through, state, integrated)] = self.checkpoints_of(node)
        self.assertEqual((doc.checkpoint_rev, doc.integrated_rev, through, integrated), (2, 2, 2, 1))
        self.assertEqual(self.text_of(state), "one two")

    def test_a_left_over_open_base_is_replaced_by_an_integrated_result(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two"])
        self.stored(node, integrated=False)

        self.compact(node)

        doc = self.doc_row(node)
        self.assertEqual((doc.checkpoint_rev, doc.integrated_rev), (2, 2))
        self.assertEqual([integrated for _rev, _state, integrated in self.checkpoints_of(node)], [1])

    def test_one_document_compacts_in_one_job_at_a_time(self):
        self.addCleanup(self.release_places)
        first = checkpoints.take_place("writer", "doc-a")

        self.assertIsNone(checkpoints.take_place("writer", "doc-a"))
        self.assertIsNotNone(checkpoints.take_place("writer", "doc-b"))
        checkpoints.free_place(first)
        self.assertIsNotNone(checkpoints.take_place("writer", "doc-a"))

    def test_a_job_that_outlived_its_lease_frees_nothing_of_the_next(self):
        self.addCleanup(self.release_places)
        stale = checkpoints.take_place("writer", "doc-a")
        self.release_places()  # the lease ran out
        current = checkpoints.take_place("writer", "doc-a")

        checkpoints.free_place(stale)

        self.assertIsNone(checkpoints.take_place("writer", "doc-a"))
        checkpoints.free_place(current)
        self.assertIsNotNone(checkpoints.take_place("writer", "doc-a"))

    def test_a_host_short_of_memory_keeps_every_row_and_retries_later(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        cgroup = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, cgroup)
        gib = 2**30
        with open(f"{cgroup}/memory.max", "w") as limit:
            limit.write(f"{gib}\n")

        # Two places at 240 MB each on top of what the container already holds must leave a fifth free
        for anon, compacts in ((400 * 2**20, False), (200 * 2**20, True)):
            with open(f"{cgroup}/memory.stat", "w") as stat:
                stat.write(f"file 999\nanon {anon}\n")
            self.set_doc(node, next_compaction_at=None)
            with patch.object(checkpoints, "CGROUP", cgroup):
                self.compact(node)
            doc = self.doc_row(node)
            self.assertEqual(doc.checkpoint_rev == 1, compacts)
            if not compacts:
                self.assertEqual(
                    (doc.last_compaction_error, self.row_count(node)), ("insufficient_memory", 1)
                )
                self.assertGreater(doc.next_compaction_at, frappe.utils.now_datetime())

    def opened(self, node: str) -> tuple[dict, list[int], str]:
        """What a tab opening now gets: the header, the revs sent as rows, and the text it shows."""
        header, checkpoint, rows = read_open(call(routes.collab_get, node).get_data())
        parts = [checkpoint] if checkpoint else []
        return (
            header,
            [rev for rev, _ in rows],
            self.text_of(compaction.pycrdt.merge_updates(*parts, *(p for _, p in rows))),
        )

    def test_opening_a_long_edited_document_reads_one_checkpoint_plus_the_tail(self):
        node = self.new_document()
        self.type_into(node, [f"{n} " for n in range(2000)])
        self.compact(node)
        self.type_into(node, ["and ", "more"])

        header, revs, text = self.opened(node)

        self.assertEqual((header["base"], revs), (2000, [2001, 2002]))
        self.assertEqual(text, "".join(f"{n} " for n in range(2000)) + "and more")

    def test_an_open_during_a_compaction_install_stays_continuous(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two "])
        self.compact(node)
        self.type_into(node, ["three"])
        typed = "one two three"
        doc_id, site = self.doc_row(node).id, frappe.local.site

        def compact_elsewhere():
            frappe.init(site=site)
            frappe.connect()
            try:
                writer_collab.compact(doc_id)
            finally:
                frappe.destroy()

        sql, installed = frappe.db.sql, []

        def install_first(query, *args, **kwargs):
            # The install lands after the open read the control row and before it reads the checkpoint
            if "_collab_checkpoint` WHERE" in str(query) and not installed:
                installed.append(True)
                thread = threading.Thread(target=compact_elsewhere)
                thread.start()
                thread.join()
            return sql(query, *args, **kwargs)

        # The database default may already be REPEATABLE READ; the open must not rely on it
        frappe.db.sql("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED")
        self.addCleanup(frappe.db.sql, "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        frappe.db.commit()
        with patch.object(frappe.db, "sql", install_first):
            header, revs, text = self.opened(node)
        self.assertEqual(isolation(), "READ-COMMITTED")

        self.assertEqual(installed, [True])
        self.assertEqual((header["base"], revs, text), (2, [3], typed))
        self.assertEqual(self.doc_row(node).checkpoint_rev, 3)
        header, revs, text = self.opened(node)
        self.assertEqual((header["base"], revs, text), (3, [], typed))


class TestWriterCompactionTriggers(CheckpointCase):
    """When a compaction is asked for. Each check watches what is enqueued, not the job itself."""

    def setUp(self):
        super().setUp()
        self.requested = []
        enqueue = patch.object(
            frappe, "enqueue", lambda method, **kwargs: self.requested.append(kwargs["doc_id"])
        )
        enqueue.start()
        self.addCleanup(enqueue.stop)

    def push_bytes(self, node: str, sizes: list[int], *, final: bool = False) -> None:
        sid = uuid.uuid4().hex
        cid = answer(call(routes.collab_sessions_post, node, body=json.dumps({"sid": sid}).encode()))[
            "client_id"
        ]
        lineage = self.doc_row(node).lineage
        for seq, size in enumerate(sizes, start=1):
            body = push_body(lineage, sid, cid, seq, 0, os.urandom(size))
            if final and seq == len(sizes):
                length = int.from_bytes(body[:4], "big")
                header = json.loads(body[4 : 4 + length]) | {"final": True}
                encoded = json.dumps(header).encode()
                body = len(encoded).to_bytes(4, "big") + encoded + body[4 + length :]
            self.assertEqual(call(routes.collab_updates_post, node, body=body).status_code, 200)

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
            checkpoint_rev=1,
            state_bytes=checkpoints.STATE_MAX - 300 * 1024,
            tail_rows=0,
            tail_bytes=0,
            tail_bound=0,
        )

        self.push_bytes(node, [8 * 1024] * 20)
        self.assertEqual(self.requested, [])

        self.push_bytes(node, [128 * 1024])
        self.assertEqual(self.requested, [self.doc_row(node).id])

    def test_a_closing_tab_asks_for_a_compaction_unless_someone_else_is_typing(self):
        node = self.new_document()
        self.push_bytes(node, [100, 100], final=True)
        self.assertEqual(self.requested, [self.doc_row(node).id])

        self.requested.clear()
        self.push_bytes(node, [100])
        self.push_bytes(node, [100], final=True)
        self.assertEqual(self.requested, [])

    def test_a_tail_ten_minutes_old_asks_on_the_next_open(self):
        node = self.new_document()
        self.push_bytes(node, [100])
        call(routes.collab_get, node)
        self.assertEqual(self.requested, [])
        frappe.db.sql(
            "UPDATE `__writer_collab_update` SET `created` = %s WHERE `doc_id` = %s",
            (frappe.utils.now_datetime() - checkpoints.AGE, self.doc_row(node).id),
        )
        frappe.db.commit()

        call(routes.collab_get, node)

        self.assertEqual(self.requested, [self.doc_row(node).id])

    def test_a_backed_off_document_waits_for_its_retry_time(self):
        node = self.new_document()
        self.set_doc(node, next_compaction_at=frappe.utils.now_datetime() + checkpoints.QUIET)

        self.push_bytes(node, [300 * 1024], final=True)

        self.assertEqual(self.requested, [])

    def test_the_sweeper_asks_for_documents_whose_tail_waited_half_an_hour(self):
        waited, fresh = self.new_document(), self.new_document()
        self.push_bytes(waited, [100])
        self.push_bytes(fresh, [100])
        frappe.db.sql(
            "UPDATE `__writer_collab_update` SET `created` = %s WHERE `doc_id` = %s",
            (frappe.utils.now_datetime() - checkpoints.SWEEP_AGE, self.doc_row(waited).id),
        )
        frappe.db.commit()

        writer_collab.sweep()

        self.assertIn(self.doc_row(waited).id, self.requested)
        self.assertNotIn(self.doc_row(fresh).id, self.requested)

    def test_a_job_queue_outage_leaves_open_and_push_working(self):
        node = self.new_document()
        refused = []

        def down(method, **kwargs):
            refused.append(kwargs["doc_id"])
            raise ConnectionError("queue down")

        with patch.object(frappe, "enqueue", down):
            self.push_bytes(node, [300 * 1024], final=True)
            self.assertEqual(call(routes.collab_get, node).status_code, 200)

        self.assertEqual(refused, [self.doc_row(node).id] * 2)
        self.assertEqual(self.row_count(node), 1)
