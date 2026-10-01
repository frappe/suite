import hashlib
import json
import struct
import threading
import time
import uuid

import frappe
from frappe.tests import IntegrationTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite import drive
from suite.suite_core.collab.log import chain_next, chain_seed
from suite.tests.utils import ensure_user
from suite.writer.collab import routes

WRITER = "writer-collab-writer@example.com"
OUTSIDER = "writer-collab-outsider@example.com"


def call(handler, node: str, *, body: bytes = b""):
    """Run one route handler as the current user, the way the dispatcher would."""
    frappe.local.request = Request(EnvironBuilder(method="POST", data=body).get_environ())
    frappe.local.form_dict = frappe._dict()
    try:
        return handler(node)
    finally:
        frappe.local.request = None


def answer(response) -> dict:
    return json.loads(response.get_data())


def read_frame(data: bytes) -> tuple[dict, list[tuple[int, bytes]]]:
    (length,) = struct.unpack(">I", data[:4])
    header = json.loads(data[4 : 4 + length])
    at = 4 + length
    checkpoint, count = struct.unpack(">II", data[at : at + 8])
    at += 8 + checkpoint
    rows = []
    for _ in range(count):
        rev, size = struct.unpack(">QI", data[at : at + 12])
        rows.append((rev, data[at + 12 : at + 12 + size]))
        at += 12 + size
    return header, rows


def push_body(lineage: str, sid: str, cid: int, seq: int, seen_rev: int, payload: bytes) -> bytes:
    header = json.dumps(
        {
            "lineage": lineage,
            "principal": frappe.session.user,
            "sid": sid,
            "from": seq,
            "to": seq,
            "cid": cid,
            "seen_rev": seen_rev,
        }
    ).encode()
    return struct.pack(">I", len(header)) + header + payload


class TestWriterCollab(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(WRITER)
        ensure_user(OUTSIDER)
        routes.collab.ensure_tables(routes.ADAPTER)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        self.mode = frappe.db.get_single_value("Suite Collab Settings", "mode")
        self.addCleanup(self.restore_mode)
        frappe.set_user(WRITER)
        self.addCleanup(frappe.set_user, "Administrator")

    def restore_mode(self):
        frappe.db.set_single_value("Suite Collab Settings", "mode", self.mode or "off")
        frappe.db.commit()

    def set_mode(self, mode: str):
        frappe.db.set_single_value("Suite Collab Settings", "mode", mode)
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
            for kind in ("update", "session"):
                frappe.db.sql(f"DELETE FROM `__writer_collab_{kind}` WHERE `doc_id` = %s", doc.id)
            frappe.db.sql("DELETE FROM `__writer_collab_doc` WHERE `id` = %s", doc.id)
            frappe.db.commit()

    def count(self, kind: str) -> int:
        return frappe.db.sql(f"SELECT COUNT(*) FROM `__writer_collab_{kind}`")[0][0]

    def open(self, node: str):
        return read_frame(call(routes.collab_get, node).get_data())

    def session(self, node: str) -> tuple[str, int]:
        sid = uuid.uuid4().hex
        return sid, answer(call(routes.collab_sessions_post, node, body=json.dumps({"sid": sid}).encode()))[
            "client_id"
        ]

    def push(self, node: str, sid: str, cid: int, seq: int, payload: bytes = b"\x00"):
        header, rows = self.open(node)
        body = push_body(header["lineage"], sid, cid, seq, rows[-1][0] if rows else 0, payload)
        response = call(routes.collab_updates_post, node, body=body)
        return response.status_code, answer(response)

    def assert_one_order(self, node: str, count: int):
        header, rows = self.open(node)
        self.assertEqual([rev for rev, _ in rows], list(range(1, count + 1)))
        stored = routes.collab.find(routes.ADAPTER, node)
        chain = chain_seed(stored.lineage)
        for rev, payload in rows:
            chain = chain_next(chain, rev, hashlib.sha256(payload).digest())
        self.assertEqual(chain, bytes(stored.head_chain))

    def test_mode_off_answers_disabled_and_writes_nothing(self):
        self.set_mode("off")
        before = {kind: self.count(kind) for kind in ("doc", "update", "session")}
        node = self.new_document()

        header, rows = self.open(node)
        self.assertEqual((header["state"], rows), ("disabled", []))
        for handler in (routes.collab_sessions_post, routes.collab_updates_post, routes.collab_updates_get):
            response = call(handler, node, body=json.dumps({"sid": uuid.uuid4().hex}).encode())
            self.assertEqual((response.status_code, answer(response)), (409, {"collab": "disabled"}))
        self.assertEqual({kind: self.count(kind) for kind in before}, before)

    def test_two_writers_converge_on_one_order(self):
        self.set_mode("on")
        node = self.new_document()
        self.assertEqual(self.open(node)[0]["state"], "live")
        first, second = self.session(node), self.session(node)

        for seq in (1, 2):
            self.assertEqual(self.push(node, *first, seq, b"a%d" % seq)[0], 200)
            self.assertEqual(self.push(node, *second, seq, b"b%d" % seq)[0], 200)

        _header, rows = self.open(node)
        self.assertEqual([payload for _, payload in rows], [b"a1", b"b1", b"a2", b"b2"])
        self.assert_one_order(node, 4)

    def test_a_resent_push_commits_once(self):
        self.set_mode("on")
        node = self.new_document()
        sid, cid = self.session(node)

        self.assertEqual(self.push(node, sid, cid, 1)[0], 200)
        status, body = self.push(node, sid, cid, 1)

        self.assertEqual((status, body["dup"], body["acked"]), (200, True, 1))
        self.assert_one_order(node, 1)

    def test_a_user_without_edit_access_cannot_push(self):
        self.set_mode("on")
        node = self.new_document()
        sid, cid = self.session(node)
        lineage = self.open(node)[0]["lineage"]

        frappe.set_user(OUTSIDER)
        response = call(routes.collab_updates_post, node, body=push_body(lineage, sid, cid, 1, 0, b"x"))

        self.assertIn(response.status_code, (403, 404))
        frappe.set_user(WRITER)
        self.assertEqual(self.open(node)[1], [])

    def test_many_writers_at_once_get_gap_free_revs(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open(node)[0]["lineage"]
        writers, pushes = 16, 10
        sessions = [self.session(node) for _ in range(writers)]
        site, failures = frappe.local.site, []

        def write(sid: str, cid: int):
            frappe.init(site=site)
            frappe.connect()
            frappe.set_user(WRITER)
            try:
                seq = 1
                while seq <= pushes:
                    body = push_body(lineage, sid, cid, seq, 0, uuid.uuid4().bytes)
                    response = call(routes.collab_updates_post, node, body=body)
                    if response.status_code == 200:
                        seq += 1
                    elif response.status_code == 423:
                        time.sleep(0.005)
                    else:
                        failures.append(answer(response))
                        return
            finally:
                frappe.destroy()

        threads = [threading.Thread(target=write, args=session) for session in sessions]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(failures, [])
        self.assert_one_order(node, writers * pushes)
