import gzip
import json
import os
import signal
import uuid
from unittest.mock import patch

import frappe
import pycrdt
from frappe.tests import IntegrationTestCase
from frappe.utils.background_jobs import get_redis_conn

from suite import drive
from suite.suite_core.collab import checkpoints, compaction
from suite.tests.utils import ensure_user
from suite.writer import collab as writer_collab
from suite.writer.collab import routes
from suite.writer.collab.tests.test_collab import answer, call, push_body, read_frame

WRITER = "writer-collab-writer@example.com"


class TestWriterCheckpoints(IntegrationTestCase):
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
        header, rows = read_frame(call(routes.collab_get, node).get_data())
        doc = pycrdt.Doc(client_id=cid)
        for _rev, payload in rows:
            doc.apply_update(payload)
        seen = doc.get_state()
        fragment = doc.get("default", type=pycrdt.XmlFragment)
        text = fragment.children[0] if len(fragment.children) else fragment.children.append(pycrdt.XmlText())
        for seq, word in enumerate(words, start=1):
            text.insert(len(str(text)), word)
            update = doc.get_update(seen)
            seen = doc.get_state()
            body = push_body(header["lineage"], sid, cid, seq, rows[-1][0] if rows else 0, update)
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

    def text_of(self, state: bytes) -> str:
        doc = compaction.load([state])
        return "".join(str(child) for child in doc.get("default", type=pycrdt.XmlFragment).children)

    def compact(self, node: str):
        writer_collab.compact(self.doc_row(node).id)

    def test_a_compaction_installs_a_checkpoint_of_every_row(self):
        node = self.new_document()
        typed = self.type_into(node, ["one ", "two ", "three"])

        self.compact(node)

        doc = self.doc_row(node)
        [(through, state, integrated)] = self.checkpoints_of(node)
        self.assertEqual((through, integrated), (3, 1))
        self.assertEqual(self.text_of(state), typed)
        self.assertEqual(
            (doc.checkpoint_rev, doc.integrated_rev, doc.tail_rows, doc.tail_bytes), (3, 3, 0, 0)
        )
        self.assertEqual((doc.compaction_failures, doc.next_compaction_at), (0, None))
        self.assertEqual(self.row_count(node), 3)

    def test_a_second_compaction_replaces_the_first_checkpoint(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two "])
        self.compact(node)
        typed = self.type_into(node, ["three"])

        self.compact(node)

        [(through, state, _integrated)] = self.checkpoints_of(node)
        self.assertEqual(through, 3)
        self.assertEqual(self.text_of(state), typed)

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
        older = checkpoints.read("writer", doc_id)
        typed = self.type_into(node, ["three"])
        self.compact(node)

        result = compaction.compact(older["checkpoint"], older["rows"], writer_collab.ROOTS)
        report = {"ms": 1}
        checkpoints.store("writer", doc_id, 2, older["head_chain"], result, report, writer_collab.ROOTS)
        checkpoints.install("writer", doc_id, older["lineage"], 2, older["head_chain"], result, report)

        [(through, state, _integrated)] = self.checkpoints_of(node)
        self.assertEqual((through, self.doc_row(node).checkpoint_rev), (3, 3))
        self.assertEqual(self.text_of(state), typed)

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
