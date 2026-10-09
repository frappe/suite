import base64
import gzip
import json
import os
import shutil
import signal
import tempfile
import threading
import time
import uuid
from unittest.mock import patch

import frappe
import pycrdt
from frappe.tests import IntegrationTestCase
from frappe.utils.background_jobs import get_redis_conn

from suite import drive
from suite.composition import content as routes
from suite.suite_core.content import admission, checkpoints, compaction, documents, live, scheduling
from suite.suite_core.content.log import isolation
from suite.tests.utils import ensure_user
from suite.writer import content as writer_content
from suite.writer import drive as writer_drive
from suite.writer.content.tests.test_collab import answer, body_for, call, push_body, read_open, typed

WRITER = "writer-collab-writer@example.com"


class CheckpointCase(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(WRITER)
        documents.ensure_tables()
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        self.mode = frappe.db.get_single_value("Suite Collab Settings", "mode")
        frappe.db.set_single_value("Suite Collab Settings", "mode", "on")
        frappe.db.commit()
        scheduling.paused_until = 0.0
        self.addCleanup(setattr, scheduling, "paused_until", 0.0)
        self.addCleanup(self.restore_mode)
        frappe.set_user(WRITER)
        self.addCleanup(frappe.set_user, "Administrator")

    def job(self, doc_id: str) -> checkpoints.Compaction:
        return checkpoints.Compaction(
            "writer",
            doc_id,
            writer_content.ROOTS,
            "suite.suite_core.content.documents.judge",
            writer_content.document_owner,
        )

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
        doc = routes.content.find(writer_content.ADAPTER, node)
        if doc:
            for kind in ("update", "session", "checkpoint", "recovery"):
                frappe.db.sql(f"DELETE FROM `__writer_content_{kind}` WHERE `doc_id` = %s", doc.id)
            frappe.db.sql("DELETE FROM `__writer_content_doc` WHERE `id` = %s", doc.id)
            frappe.db.commit()

    def type_into(self, node: str, words: list[str]) -> str:
        """A tab opened on the document types each word as its own row; returns the whole text."""
        sid = uuid.uuid4().hex
        cid = answer(call(routes.sessions_post, node, body=json.dumps({"sid": sid}).encode()))["client_id"]
        header, checkpoint, rows = read_open(call(routes.document_get, node).get_data())
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
            body = body_for(node, header["lineage"], sid, cid, seq, update)
            self.assertEqual(call(routes.updates_post, node, body=body).status_code, 200)
        return str(text)

    def doc_row(self, node: str):
        return frappe.db.sql("SELECT * FROM `__writer_content_doc` WHERE `node` = %s", node, as_dict=True)[0]

    def checkpoints_of(self, node: str) -> list[tuple[int, bytes, int]]:
        return [
            (int(rev), gzip.decompress(bytes(gz)), int(integrated))
            for rev, gz, integrated in frappe.db.sql(
                """SELECT `through_rev`, `gz`, `integrated` FROM `__writer_content_checkpoint`
                WHERE `doc_id` = %s ORDER BY `through_rev`""",
                self.doc_row(node).id,
            )
        ]

    def body_of(self, node: str) -> bytes:
        """The body Writer's own row holds, as Drive and a version read it."""
        return base64.b64decode(frappe.db.get_value("Writer Document", {"node": node}, "content") or "")

    def row_count(self, node: str) -> int:
        return frappe.db.sql(
            "SELECT COUNT(*) FROM `__writer_content_update` WHERE `doc_id` = %s", self.doc_row(node).id
        )[0][0]

    def set_doc(self, node: str, **values):
        assignments = ", ".join(f"`{key}` = %({key})s" for key in values)
        frappe.db.sql(
            f"UPDATE `__writer_content_doc` SET {assignments} WHERE `node` = %(node)s",
            {**values, "node": node},
        )
        frappe.db.commit()

    def text_of(self, state: bytes) -> str:
        doc = compaction.load([state])
        return "".join(str(child) for child in doc.get("default", type=pycrdt.XmlFragment).children)

    def compact(self, node: str):
        documents.compact(writer_content.ADAPTER, self.doc_row(node).id)


class TestWriterCheckpoints(CheckpointCase):
    def test_the_self_test_fixture_uses_the_roots_writer_writes(self):
        from suite.suite_core.content import selftest

        self.assertEqual(selftest.ROOTS, writer_content.ROOTS)

    def test_a_compaction_writes_every_row_into_the_writer_row(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two ", "three"])
        versions = frappe.db.count("Drive Node Version", {"node": node})

        self.compact(node)

        doc = self.doc_row(node)
        self.assertEqual(self.text_of(self.body_of(node)), "one two three")
        self.assertEqual(self.checkpoints_of(node), [])
        self.assertEqual((doc.body_rev, doc.tail_rows, doc.tail_bytes), (3, 0, 0))
        self.assertEqual((doc.compaction_failures, doc.next_compaction_at), (0, None))
        self.assertEqual(self.row_count(node), 3)
        self.assertEqual(frappe.db.get_value("Writer Document", {"node": node}, "html"), "")
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": node}), versions)

    def test_a_second_compaction_replaces_the_first_body(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two "])
        self.compact(node)
        self.type_into(node, ["three"])

        self.compact(node)

        self.assertEqual(self.doc_row(node).body_rev, 3)
        self.assertEqual(self.text_of(self.body_of(node)), "one two three")

    def test_the_writer_row_is_modified_as_of_the_newest_edit_it_holds(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        set_edited = "UPDATE `__writer_content_update` SET `created` = %s WHERE `doc_id` = %s"
        frappe.db.sql(set_edited, ("2999-01-02 03:04:05", self.doc_row(node).id))
        frappe.db.commit()

        self.compact(node)

        modified = frappe.db.get_value("Writer Document", {"node": node}, "modified")
        self.assertEqual(str(modified), "2999-01-02 03:04:05")
        self.type_into(node, [" two"])
        frappe.db.sql(set_edited + " AND `rev` = 2", ("2000-01-01", self.doc_row(node).id))
        frappe.db.commit()
        self.compact(node)
        self.assertEqual(
            str(frappe.db.get_value("Writer Document", {"node": node}, "modified")), str(modified)
        )

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
                self.assertEqual((self.checkpoints_of(node), self.body_of(node)), ([], b"\x00\x00"))
                self.assertEqual((doc.body_rev, self.row_count(node)), (0, 2))
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
                    documents.compact(writer_content.ADAPTER, doc_id)
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
            (doc.body_rev, doc.compaction_failures, doc.last_compaction_error), (0, 1, "kernel_version")
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
        self.assertEqual((doc.compaction_failures, doc.next_compaction_at, doc.body_rev), (0, None, 1))

    def test_the_third_failure_in_a_row_tells_an_admin(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        logged = {"method": "Collab compaction: insufficient_memory"}
        self.addCleanup(frappe.db.delete, "Error Log", logged)
        counts = []
        with patch.object(admission, "enough_memory", return_value=False):
            for _ in range(3):
                self.compact(node)
                counts.append(frappe.db.count("Error Log", logged))

        self.assertEqual(counts, [0, 0, 1])

    def test_an_older_compaction_never_replaces_a_newer_body(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two "])
        doc_id = self.doc_row(node).id
        older = routes.content.read("writer", doc_id)
        self.type_into(node, ["three"])
        self.compact(node)
        modified = frappe.db.get_value("Writer Document", {"node": node}, "modified")

        rows = [payload for _rev, payload in older["rows"]]
        result = compaction.compact(older["checkpoint"], rows, writer_content.ROOTS)
        self.job(doc_id).install(older, result)

        self.assertEqual(self.doc_row(node).body_rev, 3)
        self.assertEqual(self.text_of(self.body_of(node)), "one two three")
        self.assertEqual(frappe.db.get_value("Writer Document", {"node": node}, "modified"), modified)

    def test_a_compaction_of_another_lineage_changes_nothing(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two"])
        snapshot = routes.content.read("writer", self.doc_row(node).id)
        rows = [payload for _rev, payload in snapshot["rows"]]
        result = compaction.compact(None, rows, writer_content.ROOTS)

        self.job(self.doc_row(node).id).install({**snapshot, "lineage": "0" * 32}, result)

        doc = self.doc_row(node)
        self.assertEqual((doc.body_rev, self.body_of(node)), (0, b"\x00\x00"))
        self.assertEqual((doc.compaction_failures, doc.next_compaction_at), (0, None))
        self.assertEqual(self.opened(node)[2], "one two")

    def test_with_every_place_taken_a_compaction_waits_without_counting_a_failure(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        redis = get_redis_conn()
        for index in range(admission.PLACES):
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
        self.assertEqual(doc.body_rev, 2)
        wait = (doc.next_compaction_at - frappe.utils.now_datetime()).total_seconds()
        self.assertGreater(wait, 50)

    def test_a_fallback_larger_than_half_the_packet_limit_is_stored(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        packet = int(frappe.db.sql("SELECT @@max_allowed_packet")[0][0])
        state = os.urandom(packet // 2 + 2**20)
        result = compaction.Compacted(state=state, integrated=False, report={})
        snapshot = routes.content.read("writer", self.doc_row(node).id)

        self.job(self.doc_row(node).id).keep_fallback(snapshot, result)

        self.assertEqual(self.checkpoints_of(node), [(1, state, 0)])

    def test_a_start_state_larger_than_half_the_packet_limit_is_stored(self):
        node = self.new_document()
        packet = int(frappe.db.sql("SELECT @@max_allowed_packet")[0][0])
        start = pycrdt.Doc()
        start["blob"] = pycrdt.Map({"bytes": os.urandom(packet // 2 + 2**20)})
        state = start.get_update()

        checkpoints.replace_start("writer", self.doc_row(node).id, state, 1)

        self.assertEqual((self.body_of(node), self.checkpoints_of(node)), (state, []))

    def test_a_state_too_large_to_store_whole_is_refused(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        mode = frappe.db.sql("SELECT @@SESSION.sql_mode")[0][0]
        frappe.db.sql("SET SESSION sql_mode = ''")
        self.addCleanup(frappe.db.sql, "SET SESSION sql_mode = %s", mode)
        packet = int(frappe.db.sql("SELECT @@max_allowed_packet")[0][0])
        result = compaction.Compacted(state=os.urandom(packet + 2**20), integrated=False, report={})
        snapshot = routes.content.read("writer", self.doc_row(node).id)

        with self.assertRaises(compaction.CompactionFailed) as failed:
            self.job(self.doc_row(node).id).keep_fallback(snapshot, result)
        frappe.db.rollback()

        self.assertEqual(failed.exception.reason, "too_large")
        self.assertEqual(self.checkpoints_of(node), [])

    def compacted(self, node: str, *, integrated: bool = True) -> tuple[dict, compaction.Compacted]:
        """A compaction of the document through its head, not yet installed."""
        snapshot = routes.content.read("writer", self.doc_row(node).id)
        rows = [payload for _rev, payload in snapshot["rows"]]
        result = compaction.compact(snapshot["checkpoint"], rows, writer_content.ROOTS)
        if not integrated:
            result = compaction.Compacted(compaction.pycrdt.merge_updates(*rows), integrated=False)
        result.ms = 1
        return snapshot, result

    def test_a_push_while_the_body_is_written_answers_busy_and_lands_after(self):
        node = self.new_document()
        self.type_into(node, ["one "])
        doc_id, site = self.doc_row(node).id, frappe.local.site
        snapshot, result = self.compacted(node)
        sid = uuid.uuid4().hex
        cid = answer(call(routes.sessions_post, node, body=json.dumps({"sid": sid}).encode()))["client_id"]
        header, checkpoint, rows = read_open(call(routes.document_get, node).get_data())
        doc = pycrdt.Doc(client_id=cid)
        for payload in [checkpoint, *(payload for _rev, payload in rows)]:
            if payload:
                doc.apply_update(payload)
        seen = doc.get_state()
        doc.get("default", type=pycrdt.XmlFragment).children[0].insert(4, "two")
        body = body_for(node, header["lineage"], sid, cid, 1, doc.get_update(seen))
        answered = []

        def push_elsewhere():
            frappe.init(site=site)
            frappe.connect()
            frappe.set_user(WRITER)
            try:
                answered.append(call(routes.updates_post, node, body=body).status_code)
            finally:
                frappe.destroy()

        sql = frappe.db.sql

        def push_while_writing(query, *args, **kwargs):
            if "UPDATE `tabWriter Document`" in str(query) and not answered:
                thread = threading.Thread(target=push_elsewhere)
                thread.start()
                thread.join()
            return sql(query, *args, **kwargs)

        with patch.object(frappe.db, "sql", push_while_writing):
            self.job(doc_id).install(snapshot, result)

        self.assertEqual(answered, [423])
        self.assertEqual(self.text_of(self.body_of(node)), "one ")
        self.assertEqual(call(routes.updates_post, node, body=body).status_code, 200)
        self.assertEqual(self.opened(node)[2], "one two")

    def test_a_purge_before_the_body_is_written_leaves_the_row_as_it_was(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        doc_id = self.doc_row(node).id
        snapshot, result = self.compacted(node)
        routes.content.mark_purged("writer", node)
        frappe.db.commit()

        with self.assertRaises(compaction.CompactionFailed) as failed:
            self.job(doc_id).install(snapshot, result)
        frappe.db.rollback()

        self.assertEqual(failed.exception.reason, "purged")
        self.assertEqual((self.body_of(node), self.checkpoints_of(node)), (b"\x00\x00", []))

    def test_a_purge_while_the_body_is_written_waits_and_neither_deadlocks(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        doc_id, site = self.doc_row(node).id, frappe.local.site
        name = frappe.db.get_value("Writer Document", {"node": node})
        snapshot, result = self.compacted(node)
        errors = []
        marking = threading.Event()

        def purge_elsewhere():
            frappe.init(site=site)
            frappe.connect()
            sql = frappe.db.sql

            def signalled(query, *args, **kwargs):
                if "SET `mode` = 'purged'" in str(query):
                    marking.set()
                return sql(query, *args, **kwargs)

            try:
                with patch.object(frappe.db, "sql", signalled):
                    writer_drive.on_purge(name)
                frappe.db.commit()
            except Exception as error:
                errors.append(error)
            finally:
                frappe.destroy()

        sql = frappe.db.sql
        purge = threading.Thread(target=purge_elsewhere)

        def purge_while_writing(query, *args, **kwargs):
            if "FROM `tabWriter Document`" in str(query) and "FOR UPDATE" in str(query) and not purge.ident:
                purge.start()
                marking.wait(10)
                time.sleep(0.5)
            try:
                return sql(query, *args, **kwargs)
            except Exception as error:
                errors.append(error)
                raise

        with patch.object(frappe.db, "sql", purge_while_writing):
            self.job(doc_id).install(snapshot, result)
        purge.join()
        frappe.db.rollback()
        self.addCleanup(documents.delete_purged, writer_content.ADAPTER, doc_id)

        self.assertEqual(errors, [])
        self.assertFalse(frappe.db.exists("Writer Document", name))
        self.assertEqual(self.doc_row(node).mode, "purged")

    def test_an_attempt_killed_while_writing_is_finished_by_the_next(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two"])
        doc_id = self.doc_row(node).id
        site = frappe.local.site
        pid = os.fork()
        if pid == 0:
            try:
                frappe.init(site)
                frappe.connect()
                sql = frappe.db.sql

                def killed_after_writing(query, *args, **kwargs):
                    found = sql(query, *args, **kwargs)
                    if "UPDATE `tabWriter Document`" in str(query):
                        os.kill(os.getpid(), signal.SIGKILL)
                    return found

                with patch.object(frappe.db, "sql", killed_after_writing):
                    documents.compact(writer_content.ADAPTER, doc_id)
            finally:
                os._exit(0)
        os.waitpid(pid, 0)
        frappe.db.rollback()
        self.release_places()
        self.assertEqual((self.doc_row(node).body_rev, self.body_of(node)), (0, b"\x00\x00"))

        self.compact(node)

        self.assertEqual(self.doc_row(node).body_rev, 2)
        self.assertEqual(self.text_of(self.body_of(node)), "one two")

    def test_a_fallback_is_replaced_by_an_integrated_result(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two"])
        self.job(self.doc_row(node).id).keep_fallback(*self.compacted(node, integrated=False))
        self.assertEqual(
            [(rev, integrated) for rev, _state, integrated in self.checkpoints_of(node)], [(2, 0)]
        )
        self.set_doc(node, next_compaction_at=None)
        self.type_into(node, [" three"])

        self.compact(node)

        self.assertEqual((self.doc_row(node).body_rev, self.checkpoints_of(node)), (3, []))
        self.assertEqual(self.text_of(self.body_of(node)), "one two three")

    def test_one_document_compacts_in_one_job_at_a_time(self):
        self.addCleanup(self.release_places)
        first = admission.take_place("writer", "doc-a")

        self.assertIsNone(admission.take_place("writer", "doc-a"))
        self.assertIsNotNone(admission.take_place("writer", "doc-b"))
        admission.free_place(first)
        self.assertIsNotNone(admission.take_place("writer", "doc-a"))

    def test_a_job_that_outlived_its_lease_frees_nothing_of_the_next(self):
        self.addCleanup(self.release_places)
        stale = admission.take_place("writer", "doc-a")
        self.release_places()  # the lease ran out
        current = admission.take_place("writer", "doc-a")

        admission.free_place(stale)

        self.assertIsNone(admission.take_place("writer", "doc-a"))
        admission.free_place(current)
        self.assertIsNotNone(admission.take_place("writer", "doc-a"))

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
            with patch.object(admission, "CGROUP", cgroup):
                self.compact(node)
            doc = self.doc_row(node)
            self.assertEqual(doc.body_rev == 1, compacts)
            if not compacts:
                self.assertEqual(
                    (doc.last_compaction_error, self.row_count(node)), ("insufficient_memory", 1)
                )
                self.assertGreater(doc.next_compaction_at, frappe.utils.now_datetime())

    def opened(self, node: str) -> tuple[dict, list[int], str]:
        """What a tab opening now gets: the header, the revs sent as rows, and the text it shows."""
        header, checkpoint, rows = read_open(call(routes.document_get, node).get_data())
        parts = [checkpoint] if checkpoint else []
        return (
            header,
            [rev for rev, _ in rows],
            self.text_of(compaction.pycrdt.merge_updates(*parts, *(p for _, p in rows))),
        )

    def test_opening_a_long_edited_document_reads_its_body_plus_the_tail(self):
        node = self.new_document()
        self.type_into(node, [f"{n} " for n in range(2000)])
        self.compact(node)
        self.type_into(node, ["and ", "more"])

        header, revs, text = self.opened(node)

        self.assertEqual((header["base"], revs), (2000, [2001, 2002]))
        self.assertEqual(text, "".join(f"{n} " for n in range(2000)) + "and more")

    def test_opening_starts_from_a_fallback_only_while_it_is_newer_than_the_body(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two"])
        self.compact(node)
        self.type_into(node, [" three"])
        snapshot = routes.content.read("writer", self.doc_row(node).id)
        state = compaction.pycrdt.merge_updates(self.body_of(node), *(p for _rev, p in snapshot["rows"]))
        self.job(self.doc_row(node).id).keep_fallback(snapshot, compaction.Compacted(state, integrated=False))

        header, revs, text = self.opened(node)
        self.assertEqual((header["base"], revs, text), (3, [], "one two three"))

        frappe.db.sql(
            "UPDATE `__writer_content_checkpoint` SET `through_rev` = 1 WHERE `doc_id` = %s",
            self.doc_row(node).id,
        )
        frappe.db.commit()

        header, revs, text = self.opened(node)
        self.assertEqual((header["base"], revs, text), (2, [3], "one two three"))

    def test_a_fallback_that_fails_its_sha_is_passed_over_for_the_body(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two"])
        self.compact(node)
        self.type_into(node, [" three"])
        snapshot = routes.content.read("writer", self.doc_row(node).id)
        state = compaction.pycrdt.merge_updates(self.body_of(node), *(p for _rev, p in snapshot["rows"]))
        self.job(self.doc_row(node).id).keep_fallback(snapshot, compaction.Compacted(state, integrated=False))
        frappe.db.sql(
            "UPDATE `__writer_content_checkpoint` SET `gz` = UNHEX(%s) WHERE `doc_id` = %s",
            (gzip.compress(self.body_of(node)).hex(), self.doc_row(node).id),
        )
        frappe.db.commit()

        header, revs, text = self.opened(node)

        self.assertEqual((header["base"], revs, text), (2, [3], "one two three"))

    def test_the_body_move_marks_a_checked_checkpoint_that_fails_its_sha_unchecked(self):
        from suite.writer.patches import move_bodies_into_rows

        node = self.new_document()
        self.type_into(node, ["one ", "two"])
        doc = self.doc_row(node)
        frappe.db.sql(
            """INSERT INTO `__writer_content_checkpoint`
            (`doc_id`, `through_rev`, `chain`, `sha256`, `nbytes`, `gz`, `integrated`, `kernel_schema`, `report`, `created`)
            VALUES (%s, 2, UNHEX(%s), UNHEX(%s), 2, UNHEX(%s), 1, %s, '{}', NOW(6))""",
            (
                doc.id,
                bytes(doc.head_chain).hex(),
                (b"\x01" * 32).hex(),
                gzip.compress(b"\x00\x00").hex(),
                compaction.KERNEL,
            ),
        )
        frappe.db.commit()

        self.assertEqual(move_bodies_into_rows.move(doc.id), "bad_checkpoint")

        self.assertEqual(self.checkpoints_of(node), [(2, b"\x00\x00", 0)])
        self.assertEqual(self.doc_row(node).body_rev, 0)
        header, revs, text = self.opened(node)
        self.assertEqual((header["base"], revs, text), (0, [1, 2], "one two"))

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
                documents.compact(writer_content.ADAPTER, doc_id)
            finally:
                frappe.destroy()

        sql, installed = frappe.db.sql, []

        def install_first(query, *args, **kwargs):
            # The install lands after the open read the control row and before it reads the body
            if "FROM `tabWriter Document`" in str(query) and not installed:
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
        self.assertEqual(self.doc_row(node).body_rev, 3)
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
        cid = answer(call(routes.sessions_post, node, body=json.dumps({"sid": sid}).encode()))["client_id"]
        lineage = self.doc_row(node).lineage
        for seq, update in enumerate(typed(cid, ["x" * size for size in sizes]), start=1):
            body = body_for(node, lineage, sid, cid, seq, update)
            if final and seq == len(sizes):
                length = int.from_bytes(body[:4], "big")
                header = json.loads(body[4 : 4 + length]) | {"final": True}
                encoded = json.dumps(header).encode()
                body = len(encoded).to_bytes(4, "big") + encoded + body[4 + length :]
            self.assertEqual(call(routes.updates_post, node, body=body).status_code, 200)

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
            state_bytes=scheduling.STATE_MAX - 300 * 1024,
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
        self.set_doc(node, state_bytes=scheduling.STATE_MAX - 512 * 1024, tail_bound=256 * 1024 - 200)
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

    def test_a_tail_ten_minutes_old_asks_on_the_next_open(self):
        node = self.new_document()
        self.push_bytes(node, [100])
        call(routes.document_get, node)
        self.assertEqual(self.requested, [])
        frappe.db.sql(
            "UPDATE `__writer_content_update` SET `created` = %s WHERE `doc_id` = %s",
            (frappe.utils.now_datetime() - scheduling.AGE, self.doc_row(node).id),
        )
        frappe.db.commit()

        call(routes.document_get, node)

        self.assertEqual(self.requested, [self.doc_row(node).id])

    def test_a_backed_off_document_waits_for_its_retry_time(self):
        node = self.new_document()
        self.set_doc(node, next_compaction_at=frappe.utils.now_datetime() + scheduling.QUIET)

        self.push_bytes(node, [300 * 1024], final=True)

        self.assertEqual(self.requested, [])

    def test_the_sweeper_asks_for_documents_whose_tail_waited_half_an_hour(self):
        waited, fresh = self.new_document(), self.new_document()
        self.push_bytes(waited, [100])
        self.push_bytes(fresh, [100])
        # Older than any tail other tests left, as a sweep takes the oldest first
        frappe.db.sql(
            "UPDATE `__writer_content_update` SET `created` = %s WHERE `doc_id` = %s",
            ("2000-01-01", self.doc_row(waited).id),
        )
        frappe.db.commit()

        documents.sweep()

        self.assertIn(self.doc_row(waited).id, self.requested)
        self.assertNotIn(self.doc_row(fresh).id, self.requested)

    def test_requests_while_the_cache_and_queue_are_down_are_logged_once(self):
        logged = {
            "method": "Collab compaction: request failed",
            "creation": (">=", frappe.utils.now_datetime()),
        }
        self.addCleanup(frappe.db.commit)
        self.addCleanup(frappe.db.delete, "Error Log", logged)

        def down(method, **kwargs):
            raise ConnectionError("queue down")

        def refused(*args, **kwargs):
            import redis

            raise redis.exceptions.ConnectionError("cache down")

        with (
            patch.object(frappe.cache, "get", refused),
            patch.object(frappe.cache, "set", refused),
            patch.object(frappe, "enqueue", down),
        ):
            for _ in range(50):
                # Each request starts with an empty local cache
                frappe.local.cache = {}
                scheduling.request(writer_content.ADAPTER, "outage", "unused")

        self.assertEqual(frappe.db.count("Error Log", logged), 1)

    def test_requests_reach_the_queue_again_once_the_pause_ends(self):
        tried = []
        logged = {
            "method": "Collab compaction: request failed",
            "creation": (">=", frappe.utils.now_datetime()),
        }
        self.addCleanup(frappe.db.commit)
        self.addCleanup(frappe.db.delete, "Error Log", logged)

        def down(method, **kwargs):
            tried.append(kwargs["doc_id"])
            raise ConnectionError("queue down")

        with patch.object(frappe, "enqueue", down):
            scheduling.request(writer_content.ADAPTER, "outage", "unused")
            scheduling.request(writer_content.ADAPTER, "outage", "unused")
            later = scheduling.time.monotonic() + scheduling.QUEUE_PAUSE.total_seconds() + 1
            with patch.object(scheduling.time, "monotonic", lambda: later):
                scheduling.request(writer_content.ADAPTER, "outage", "unused")

        self.assertEqual(tried, ["outage", "outage"])

    def test_a_job_queue_outage_leaves_open_and_push_working_and_is_logged_once(self):
        node, other = self.new_document(), self.new_document()
        refused = []
        logged = {
            "method": "Collab compaction: request failed",
            "creation": (">=", frappe.utils.now_datetime()),
        }
        self.addCleanup(frappe.db.commit)
        self.addCleanup(frappe.db.delete, "Error Log", logged)

        def down(method, **kwargs):
            refused.append(kwargs["doc_id"])
            raise ConnectionError("queue down")

        with patch.object(frappe, "enqueue", down):
            self.push_bytes(node, [300 * 1024], final=True)
            self.assertEqual(call(routes.document_get, node).status_code, 200)
            self.assertEqual(call(routes.updates_get, node).status_code, 200)
            self.push_bytes(other, [300 * 1024], final=True)

        doc_id = self.doc_row(node).id
        self.assertEqual(refused, [doc_id])
        self.assertEqual((self.row_count(node), self.row_count(other)), (1, 1))
        errors = frappe.get_all("Error Log", logged, pluck="error")
        self.assertEqual(len(errors), 1)
        self.assertTrue(errors[0].startswith(f"writer document {doc_id}\n"), errors[0])


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

    def tab(self, node: str) -> tuple[str, int]:
        sid = uuid.uuid4().hex
        return sid, answer(call(routes.sessions_post, node, body=json.dumps({"sid": sid}).encode()))[
            "client_id"
        ]

    def push(self, node: str, tab: tuple[str, int], seq: int, update: bytes):
        response = call(
            routes.updates_post, node, body=push_body(self.doc_row(node).lineage, *tab, seq, 0, update)
        )
        return response.status_code, answer(response)

    def editing(self, cid: int, rows: list[bytes], edit) -> bytes:
        doc = pycrdt.Doc(client_id=cid)
        for row in rows:
            doc.apply_update(row)
        before = doc.get_state()
        edit(doc.get("default", type=pycrdt.XmlFragment).children[0])
        return doc.get_update(before)

    def test_each_row_adds_its_bytes_and_each_word_it_splits_to_the_tail(self):
        node = self.new_document()
        first, second = self.tab(node), self.tab(node)
        abc, de = typed(first[1], ["abc", "de"])
        inside = self.editing(second[1], [abc, de], lambda text: text.insert(1, "x"))

        for tab, seq, update in ((first, 1, abc), (first, 2, de), (second, 1, inside)):
            self.assertEqual(self.push(node, tab, seq, update)[0], 200)

        self.assertEqual(self.doc_row(node).tail_bound, len(abc) + len(de) + len(inside) + 32)
        self.compact(node)
        self.assertEqual(self.doc_row(node).tail_bound, 0)

    def test_a_push_that_could_take_the_state_past_the_cap_waits_for_a_compaction(self):
        node = self.new_document()
        tab = self.tab(node)
        abc, de = typed(tab[1], ["abc", "de"])
        self.assertEqual(self.push(node, tab, 1, abc)[0], 200)
        self.set_doc(node, state_bytes=scheduling.STATE_MAX - len(abc) - len(de) + 1)
        self.requested.clear()

        self.assertEqual(self.push(node, tab, 2, de), (423, {"collab": "compacting", "retry_ms": 2000}))
        self.assertEqual((self.row_count(node), self.doc_row(node).tail_bound), (1, len(abc)))
        self.assertEqual(self.requested, [self.doc_row(node).id])

        self.set_doc(node, state_bytes=scheduling.STATE_MAX - len(abc) - len(de))
        self.assertEqual(self.push(node, tab, 2, de)[0], 200)

    def test_a_document_at_the_cap_takes_deletes_and_nothing_that_adds(self):
        node = self.new_document()
        writing, deleting = self.tab(node), self.tab(node)
        abc, de = typed(writing[1], ["abc", "de"])
        self.assertEqual(self.push(node, writing, 1, abc)[0], 200)
        self.set_doc(node, state_bytes=scheduling.STATE_MAX)

        self.assertEqual(self.push(node, writing, 2, de), (423, {"collab": "doc_full", "retry_ms": 300_000}))
        removal = self.editing(deleting[1], [abc], lambda text: text.__delitem__(slice(1, 2)))
        self.assertEqual(self.push(node, deleting, 1, removal)[0], 200)
        self.assertEqual(self.row_count(node), 2)

    def test_a_compaction_that_frees_a_full_document_tells_its_live_room(self):
        node = self.new_document()
        tab = self.tab(node)
        abc, de = typed(tab[1], ["abc", "de"])
        self.assertEqual(self.push(node, tab, 1, abc)[0], 200)
        doc = self.doc_row(node)
        room = live.rooms(writer_content.ADAPTER, doc.id, doc.lineage)["keys"][0]
        self.set_doc(node, state_bytes=scheduling.STATE_MAX)

        with patch("frappe.publish_realtime") as publish:
            self.compact(node)
            self.assertEqual(self.push(node, tab, 2, de)[0], 200)
            self.compact(node)

        self.assertEqual(
            [
                (call.args[1]["kind"], call.kwargs["room"])
                for call in publish.call_args_list
                if call.args[0] == "suite_collab_ctl"
            ],
            [("room", room)],
        )

    def test_a_stale_push_to_a_full_document_is_told_it_is_stale(self):
        node = self.new_document()
        tab = self.tab(node)
        abc, de = typed(tab[1], ["abc", "de"])
        self.set_doc(node, state_bytes=scheduling.STATE_MAX)
        ahead = push_body(self.doc_row(node).lineage, *tab, 1, 1, abc)

        self.assertEqual(self.push(node, tab, 2, de), (409, {"collab": "seq", "acked": 0}))
        response = call(routes.updates_post, node, body=ahead)
        self.assertEqual((response.status_code, answer(response)), (409, {"collab": "diverged"}))

    def test_with_no_tail_to_compact_a_push_that_does_not_fit_is_full(self):
        node = self.new_document()
        tab = self.tab(node)
        [abc] = typed(tab[1], ["abc"])
        self.set_doc(node, state_bytes=scheduling.STATE_MAX - len(abc) + 1)

        self.assertEqual(self.push(node, tab, 1, abc), (423, {"collab": "doc_full", "retry_ms": 300_000}))
        self.assertEqual((self.row_count(node), self.requested), (0, []))

    def test_tails_stored_before_bounds_were_kept_count_their_bytes(self):
        node = self.new_document()
        tab = self.tab(node)
        [abc] = typed(tab[1], ["abc"])
        self.assertEqual(self.push(node, tab, 1, abc)[0], 200)
        self.set_doc(node, tail_bound=0)

        documents.ensure_tables()

        self.assertEqual(self.doc_row(node).tail_bound, len(abc))
