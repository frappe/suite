import hashlib
import json
import struct
import threading
import time
import uuid
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite import drive
from suite.drive._core.access import grant
from suite.drive._core.principals import Principals
from suite.suite_core.collab.log import chain_next, chain_seed
from suite.tests.utils import ensure_user
from suite.writer.collab import routes

WRITER = "writer-collab-writer@example.com"
OUTSIDER = "writer-collab-outsider@example.com"
READER = "writer-collab-reader@example.com"


def call(handler, node: str, *, body: bytes = b"", principal: str | None = None):
    """Run one route handler as the current user, the way the dispatcher would."""
    headers = {routes.PRINCIPAL_HEADER: principal or frappe.session.user}
    frappe.local.request = Request(EnvironBuilder(method="POST", data=body, headers=headers).get_environ())
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


def push_body(
    lineage: str,
    sid: str,
    cid: int,
    seq: int,
    seen_rev: int,
    payload: bytes,
    principal: str | None = None,
    *,
    entries: list[bytes] | None = None,
) -> bytes:
    """One push of `entries` (or `payload` alone) as seqs from `seq`; the body sent is `payload`."""
    entries = entries or [payload]
    header = json.dumps(
        {
            "lineage": lineage,
            "principal": principal or frappe.session.user,
            "sid": sid,
            "from": seq,
            "to": seq + len(entries) - 1,
            "cid": cid,
            "seen_rev": seen_rev,
            "shas": [hashlib.sha256(entry).hexdigest() for entry in entries],
        }
    ).encode()
    return struct.pack(">I", len(header)) + header + payload


class TestWriterCollab(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(WRITER)
        ensure_user(OUTSIDER)
        ensure_user(READER)
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

    def push(self, node: str, sid: str, cid: int, seq: int, payload: bytes = b"\x00", entries=None):
        header, rows = self.open(node)
        body = push_body(
            header["lineage"], sid, cid, seq, rows[-1][0] if rows else 0, payload, entries=entries
        )
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

    def test_a_push_at_the_size_cap_keeps_every_byte_value(self):
        self.set_mode("on")
        node = self.new_document()
        payload = bytes(range(256)) * 1024

        self.assertEqual(self.push(node, *self.session(node), 1, payload)[0], 200)

        self.assertEqual(self.open(node)[1], [(1, payload)])
        self.assert_one_order(node, 1)

    def test_a_resent_push_commits_once(self):
        self.set_mode("on")
        node = self.new_document()
        sid, cid = self.session(node)

        first = self.push(node, sid, cid, 1)
        status, body = self.push(node, sid, cid, 1)

        self.assertEqual(first[0], 200)
        self.assertEqual((status, body["dup"], body["acked"]), (200, True, 1))
        self.assertEqual((body["rev"], body["chain"]), (first[1]["rev"], first[1]["chain"]))
        self.assert_one_order(node, 1)

    def test_a_resend_grown_by_more_typing_gets_the_original_answer(self):
        self.set_mode("on")
        node = self.new_document()
        sid, cid = self.session(node)

        first = self.push(node, sid, cid, 1, b"a")
        status, body = self.push(node, sid, cid, 1, b"ab", entries=[b"a", b"b"])
        rest = self.push(node, sid, cid, 2, b"b")

        self.assertEqual((status, body["dup"], body["acked"], body["rev"]), (200, True, 1, first[1]["rev"]))
        self.assertEqual((rest[0], rest[1]["rev"], rest[1]["acked"]), (200, 2, 2))
        self.assert_one_order(node, 2)

    def test_a_resend_with_different_bytes_is_refused(self):
        self.set_mode("on")
        node = self.new_document()
        sid, cid = self.session(node)

        self.push(node, sid, cid, 1, b"a")
        status, body = self.push(node, sid, cid, 1, b"c")

        self.assertEqual((status, body), (409, {"collab": "seq_conflict"}))
        self.assertEqual([payload for _, payload in self.open(node)[1]], [b"a"])

    def test_a_push_that_skips_seqs_is_out_of_another_lineage_or_ahead_of_the_log_is_refused(self):
        self.set_mode("on")
        node = self.new_document()
        sid, cid = self.session(node)
        lineage = self.open(node)[0]["lineage"]

        for body, refusal in (
            (push_body(lineage, sid, cid, 2, 0, b"a"), {"collab": "seq", "acked": 0}),
            (push_body("0" * 32, sid, cid, 1, 0, b"a"), {"collab": "lineage"}),
            (push_body(lineage, sid, cid, 1, 1, b"a"), {"collab": "diverged"}),
        ):
            with self.subTest(refusal=refusal):
                response = call(routes.collab_updates_post, node, body=body)
                self.assertEqual((response.status_code, answer(response)), (409, refusal))

        self.assertEqual(self.open(node)[1], [])
        self.assertEqual(self.push(node, sid, cid, 1, b"a")[1]["rev"], 1)

    def test_a_push_that_fails_midway_leaves_no_trace(self):
        self.set_mode("on")
        node = self.new_document()
        sid, cid = self.session(node)
        sql = frappe.db.sql

        def failing(query, *args, **kwargs):
            if "`last_push_at`" in query:
                raise RuntimeError("database gone")
            return sql(query, *args, **kwargs)

        with patch.object(frappe.db, "sql", failing), self.assertRaises(RuntimeError):
            self.push(node, sid, cid, 1, b"a")

        self.assertEqual(self.open(node)[1], [])
        self.assertEqual(self.push(node, sid, cid, 1, b"b")[1]["rev"], 1)
        self.assertEqual(self.open(node)[1], [(1, b"b")])
        self.assert_one_order(node, 1)

    def test_a_worker_killed_at_any_step_loses_and_duplicates_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        sid, cid = self.session(node)
        sql, commit = frappe.db.sql, frappe.db.commit
        calls = []

        def counted(real, *, after: bool):
            def step(*args, **kwargs):
                calls.append(real)
                if len(calls) == kill_at and not after:
                    raise RuntimeError("worker killed")
                result = real(*args, **kwargs)
                if len(calls) == kill_at and after:
                    raise RuntimeError("worker killed")
                return result

            return step

        def push_counted(seq: int):
            calls.clear()
            with (
                patch.object(frappe.db, "sql", counted(sql, after=False)),
                patch.object(frappe.db, "commit", counted(commit, after=True)),
            ):
                return self.push(node, sid, cid, seq, b"%d" % seq)

        kill_at = 0
        self.assertEqual(push_counted(1)[0], 200)
        steps = len(calls)
        for kill_at in range(1, steps + 1):
            seq = kill_at + 1
            with self.subTest(step=kill_at):
                try:
                    push_counted(seq)
                except RuntimeError:
                    frappe.db.rollback()
                self.assertEqual(self.push(node, sid, cid, seq, b"%d" % seq)[0], 200)

        self.assert_one_order(node, steps + 1)
        self.assertEqual(
            [payload for _, payload in self.open(node)[1]], [b"%d" % seq for seq in range(1, steps + 2)]
        )

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

    def test_a_reader_follows_but_cannot_write(self):
        self.set_mode("on")
        node = self.new_document()
        sid, cid = self.session(node)
        grant(node, READER, drive.READ, Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)))
        frappe.db.commit()

        frappe.set_user(READER)
        header, _rows = self.open(node)
        own_session = call(
            routes.collab_sessions_post, node, body=json.dumps({"sid": uuid.uuid4().hex}).encode()
        )
        push = call(routes.collab_updates_post, node, body=push_body(header["lineage"], sid, cid, 1, 0, b"x"))

        self.assertEqual((header["state"], header["can_write"]), ("live", False))
        self.assertEqual((own_session.status_code, push.status_code), (403, 403))
        frappe.set_user(WRITER)
        self.assertEqual(self.open(node)[1], [])

    def test_a_tab_signed_out_or_switched_is_told_why_before_any_access_check(self):
        self.set_mode("on")
        node = self.new_document()
        sid, cid = self.session(node)
        lineage = self.open(node)[0]["lineage"]
        body = push_body(lineage, sid, cid, 1, 0, b"x", principal=WRITER)
        session_body = json.dumps({"sid": uuid.uuid4().hex}).encode()
        handlers = (
            (routes.collab_get, b""),
            (routes.collab_updates_get, b""),
            (routes.collab_sessions_post, session_body),
            (routes.collab_updates_post, body),
        )

        for user, expected in (("Guest", (401, "signed_out")), (OUTSIDER, (409, "principal_changed"))):
            frappe.set_user(user)
            for handler, data in handlers:
                response = call(handler, node, body=data, principal=WRITER)
                self.assertEqual((response.status_code, answer(response)["collab"]), expected)

        frappe.set_user(WRITER)
        self.assertEqual(self.open(node)[1], [])

    def test_a_guest_reads_but_cannot_write_even_where_drive_would_let_them(self):
        self.set_mode("on")
        node = self.new_document()
        sid, cid = self.session(node)
        lineage = self.open(node)[0]["lineage"]

        frappe.set_user("Guest")
        with patch.object(routes.drive, "check"):
            header, _rows = self.open(node)
            session = call(
                routes.collab_sessions_post, node, body=json.dumps({"sid": uuid.uuid4().hex}).encode()
            )
            push = call(routes.collab_updates_post, node, body=push_body(lineage, sid, cid, 1, 0, b"x"))

        self.assertEqual((header["state"], header["can_write"]), ("live", False))
        for response in (session, push):
            self.assertEqual((response.status_code, answer(response)["collab"]), (401, "signed_out"))
        frappe.set_user(WRITER)
        self.assertEqual(self.open(node)[1], [])

    def claim(self, node: str, sid: str, cid: int, lineage: str):
        body = json.dumps({"sid": sid, "claim": {"cid": cid, "lineage": lineage}}).encode()
        response = call(routes.collab_sessions_post, node, body=body)
        return response.status_code, answer(response)

    def test_an_offline_tab_claims_its_own_client_id_and_then_pushes(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open(node)[0]["lineage"]
        sid, cid = uuid.uuid4().hex, 2**30 + 7

        self.assertEqual(self.claim(node, sid, cid, lineage), (200, {"claim": "ok"}))
        self.assertEqual(self.claim(node, sid, cid, lineage), (200, {"claim": "ok"}))
        self.assertEqual(self.push(node, sid, cid, 1, b"offline")[0], 200)
        self.assertEqual([payload for _, payload in self.open(node)[1]], [b"offline"])

    def test_a_claim_on_a_taken_id_or_another_lineage_binds_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open(node)[0]["lineage"]
        cid = 2**30 + 9
        self.assertEqual(self.claim(node, uuid.uuid4().hex, cid, lineage)[1], {"claim": "ok"})
        sessions = self.count("session")

        clash = self.claim(node, uuid.uuid4().hex, cid, lineage)
        other_lineage = self.claim(node, uuid.uuid4().hex, cid + 1, "0" * 32)

        self.assertEqual((clash, other_lineage), ((200, {"claim": "clash"}), (200, {"claim": "lineage"})))
        self.assertEqual(self.count("session"), sessions)

    def test_a_claim_outside_the_device_range_is_refused(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open(node)[0]["lineage"]

        for cid in (5, 2**31, "x"):
            self.assertEqual(self.claim(node, uuid.uuid4().hex, cid, lineage), (400, {"collab": "malformed"}))

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
