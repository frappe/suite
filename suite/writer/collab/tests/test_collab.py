import hashlib
import json
import struct
import threading
import time
import uuid
from dataclasses import replace
from unittest.mock import patch

import frappe
import pycrdt
from frappe.tests import IntegrationTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite import drive
from suite.drive._core.access import grant
from suite.drive._core.principals import Principals
from suite.suite_core.collab.log import chain_next, chain_seed
from suite.suite_core.collab.updates import encoded_string, encoded_uint
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
    header, _checkpoint, rows = read_open(data)
    return header, rows


def read_open(data: bytes) -> tuple[dict, bytes, list[tuple[int, bytes]]]:
    (length,) = struct.unpack(">I", data[:4])
    header = json.loads(data[4 : 4 + length])
    at = 4 + length
    (size,) = struct.unpack(">I", data[at : at + 4])
    checkpoint = data[at + 4 : at + 4 + size]
    at += 4 + size
    (count,) = struct.unpack(">I", data[at : at + 4])
    at += 4
    rows = []
    for _ in range(count):
        rev, size = struct.unpack(">QI", data[at : at + 12])
        rows.append((rev, data[at + 12 : at + 12 + size]))
        at += 12 + size
    return header, checkpoint, rows


def typed(cid: int, texts: list[str]) -> list[bytes]:
    """The updates a tab writing as `cid` sends as it types each text in turn, each continuing the clocks before it."""
    doc = pycrdt.Doc(client_id=cid)
    seen = doc.get_state()
    text = doc.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlText())
    updates = []
    for each in texts:
        text.insert(len(str(text)), each)
        updates.append(doc.get_update(seen))
        seen = doc.get_state()
    return updates


def embedded(cid: int, value: str) -> bytes:
    """An update in which `cid` puts one embed holding the JSON `value` in the root array "t", at clock 0."""
    return (
        bytes([1, 1])
        + encoded_uint(cid)
        + bytes([0, 5, 1])
        + encoded_string("t")
        + encoded_string(value)
        + bytes([0])
    )


def element(cid: int, tag: str) -> bytes:
    """The update a tab writing as `cid` sends as it adds one `tag` node to an empty document."""
    doc = pycrdt.Doc(client_id=cid)
    doc.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlElement(tag))
    return doc.get_update()


def in_body(cid: int, kind: int, content: bytes) -> bytes:
    """The update that puts one item of content `kind` straight in an empty document's body."""
    return (
        bytes([1, 1])
        + encoded_uint(cid)
        + bytes([0, kind, 1])
        + encoded_string("default")
        + content
        + bytes([0])
    )


def formatted(cid: int, key: str) -> bytes:
    """The update a tab writing as `cid` sends as it types one character carrying the format `key`."""
    doc = pycrdt.Doc(client_id=cid)
    doc.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlText()).insert(0, "x", {key: {}})
    return doc.get_update()


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
    schema: int = 1,
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
            "schema": schema,
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
        self.tabs = {}

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

    def typed(self, cid: int, seq: int, text: str) -> bytes:
        """What the tab writing as `cid` sends as `seq`: `text`, typed after what it sent as each earlier seq."""
        texts = self.tabs.setdefault(cid, {})
        texts[seq] = text
        return typed(cid, [texts.setdefault(earlier, str(earlier)) for earlier in range(1, seq + 1)])[-1]

    def push(self, node: str, sid: str, cid: int, seq: int, payload: bytes | None = None, entries=None):
        payload = payload or self.typed(cid, seq, str(seq))
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
        for handler in (
            routes.collab_sessions_post,
            routes.collab_updates_post,
            routes.collab_updates_get,
            routes.collab_suspect_post,
        ):
            response = call(handler, node, body=json.dumps({"sid": uuid.uuid4().hex}).encode())
            self.assertEqual((response.status_code, answer(response)), (409, {"collab": "disabled"}))
        self.assertEqual({kind: self.count(kind) for kind in before}, before)

    def test_two_writers_converge_on_one_order(self):
        self.set_mode("on")
        node = self.new_document()
        self.assertEqual(self.open(node)[0]["state"], "live")
        first, second = self.session(node), self.session(node)

        sent = []
        for seq in (1, 2):
            for sid, cid in (first, second):
                sent.append(self.typed(cid, seq, f"{cid}:{seq}"))
                self.assertEqual(self.push(node, sid, cid, seq, sent[-1])[0], 200)

        _header, rows = self.open(node)
        self.assertEqual([payload for _, payload in rows], sent)
        self.assert_one_order(node, 4)

    def test_a_push_at_the_size_cap_keeps_every_byte_value(self):
        self.set_mode("on")
        node = self.new_document()
        sid, cid = self.session(node)
        doc = pycrdt.Doc(client_id=cid)
        doc.get("meta", type=pycrdt.Map)["firstTabLabel"] = bytes(range(256)) * 1024
        payload = doc.get_update()

        self.assertEqual(self.push(node, sid, cid, 1, payload)[0], 200)

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

        a, b = typed(cid, ["a", "b"])
        both = pycrdt.merge_updates(a, b)

        first = self.push(node, sid, cid, 1, a)
        status, body = self.push(node, sid, cid, 1, both, entries=[a, b])
        rest = self.push(node, sid, cid, 2, b)

        self.assertEqual((status, body["dup"], body["acked"], body["rev"]), (200, True, 1, first[1]["rev"]))
        self.assertEqual((rest[0], rest[1]["rev"], rest[1]["acked"]), (200, 2, 2))
        self.assert_one_order(node, 2)

    def test_a_resend_with_different_bytes_is_refused(self):
        self.set_mode("on")
        node = self.new_document()
        sid, cid = self.session(node)

        a = self.typed(cid, 1, "a")
        self.push(node, sid, cid, 1, a)
        status, body = self.push(node, sid, cid, 1, self.typed(cid, 1, "c"))

        self.assertEqual((status, body), (409, {"collab": "seq_conflict"}))
        self.assertEqual([payload for _, payload in self.open(node)[1]], [a])

    def test_a_push_that_skips_seqs_is_out_of_another_lineage_or_ahead_of_the_log_is_refused(self):
        self.set_mode("on")
        node = self.new_document()
        sid, cid = self.session(node)
        lineage = self.open(node)[0]["lineage"]
        first, second = typed(cid, ["a", "b"])

        for body, refusal in (
            (push_body(lineage, sid, cid, 2, 0, second), {"collab": "seq", "acked": 0}),
            (push_body("0" * 32, sid, cid, 1, 0, first), {"collab": "lineage"}),
            (push_body(lineage, sid, cid, 1, 1, first), {"collab": "diverged"}),
        ):
            with self.subTest(refusal=refusal):
                response = call(routes.collab_updates_post, node, body=body)
                self.assertEqual((response.status_code, answer(response)), (409, refusal))

        self.assertEqual(self.open(node)[1], [])
        self.assertEqual(self.push(node, sid, cid, 1, first)[1]["rev"], 1)

    def test_a_push_of_bytes_no_tab_of_this_writer_could_send_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        sid, cid = self.session(node)
        lineage = self.open(node)[0]["lineage"]
        [own] = typed(cid, ["a"])

        cases = (
            ("not an update", b"\x00\x01"),
            ("empty", b"\x00\x00"),
            ("nested too deep", embedded(cid, "[" * 200_000 + "]" * 200_000)),
            ("another writer's", typed(cid + 1, ["a"])[0]),
        )
        for case, payload in cases:
            with self.subTest(case):
                response = call(
                    routes.collab_updates_post, node, body=push_body(lineage, sid, cid, 1, 0, payload)
                )
                self.assertEqual((response.status_code, answer(response)), (400, {"collab": "malformed"}))

        self.assertEqual(self.open(node)[1], [])
        self.assertEqual(self.push(node, sid, cid, 1, own)[0], 200)

    def test_a_push_from_a_build_newer_than_the_server_waits_and_is_stored_with_its_schema(self):
        self.set_mode("on")
        node = self.new_document()
        sid, cid = self.session(node)
        lineage = self.open(node)[0]["lineage"]
        newer = routes.SCHEMA.version + 1
        body = push_body(lineage, sid, cid, 1, 0, typed(cid, ["a"])[0], schema=newer)

        response = call(routes.collab_updates_post, node, body=body)

        self.assertEqual(
            (response.status_code, answer(response)), (423, {"collab": "upgrading", "retry_ms": 30_000})
        )
        self.assertEqual(self.open(node)[1], [])
        with patch.object(routes, "SCHEMA", replace(routes.SCHEMA, version=newer)):
            self.assertEqual(call(routes.collab_updates_post, node, body=body).status_code, 200)
        doc_id = routes.collab.find(routes.ADAPTER, node).id
        self.assertEqual(
            frappe.db.sql("SELECT `schema` FROM `__writer_collab_update` WHERE `doc_id` = %s", doc_id),
            ((newer,),),
        )

    def test_a_row_naming_what_its_schema_does_not_declare_is_refused_and_other_tabs_keep_saving(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open(node)[0]["lineage"]
        (sid, cid), (other_sid, other_cid) = self.session(node), self.session(node)
        marquee = push_body(lineage, sid, cid, 1, 0, element(cid, "marquee"))
        stepped = replace(
            routes.SCHEMA,
            version=2,
            features={**routes.SCHEMA.features, "marquee": 2},
            nodes=routes.SCHEMA.nodes | {"marquee"},
        )

        undeclared = call(routes.collab_updates_post, node, body=marquee)
        with patch.object(routes, "SCHEMA", stepped):
            too_early = call(routes.collab_updates_post, node, body=marquee)
            other = call(
                routes.collab_updates_post,
                node,
                body=push_body(lineage, other_sid, other_cid, 1, 0, typed(other_cid, ["b"])[0]),
            )
            stamped = call(
                routes.collab_updates_post,
                node,
                body=push_body(lineage, sid, cid, 1, 0, element(cid, "marquee"), schema=2),
            )

        self.assertEqual(
            [(response.status_code, answer(response)) for response in (undeclared, too_early)],
            [(409, {"collab": "poison"})] * 2,
        )
        self.assertEqual((other.status_code, stamped.status_code), (200, 200))
        self.assertEqual(len(self.open(node)[1]), 2)

    def test_a_row_putting_a_type_the_editor_cannot_show_in_the_body_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open(node)[0]["lineage"]
        sid, cid = self.session(node)

        refused = [
            call(
                routes.collab_updates_post,
                node,
                body=push_body(lineage, sid, cid, 1, 0, in_body(cid, 7, encoded_uint(shared))),
            )
            # A Map, then a Text
            for shared in (1, 2)
        ]

        self.assertEqual(
            [(response.status_code, answer(response)) for response in refused],
            [(409, {"collab": "poison"})] * 2,
        )
        self.assertEqual(self.open(node)[1], [])
        self.assertEqual(self.push(node, sid, cid, 1, typed(cid, ["a"])[0])[0], 200)

    def test_a_row_using_a_name_in_the_wrong_role_or_an_embed_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open(node)[0]["lineage"]
        sid, cid = self.session(node)
        rows = {
            "a mark name as a node": element(cid, "bold"),
            "a node name as a mark": formatted(cid, "paragraph"),
            "an overlapping mark's key": formatted(cid, "bold--abc"),
            "an embed": in_body(cid, 5, encoded_string("{}")),
        }

        for case, row in rows.items():
            with self.subTest(case):
                response = call(
                    routes.collab_updates_post, node, body=push_body(lineage, sid, cid, 1, 0, row)
                )
                self.assertEqual((response.status_code, answer(response)), (409, {"collab": "poison"}))
        self.assertEqual(self.open(node)[1], [])
        self.assertEqual(self.push(node, sid, cid, 1, formatted(cid, "bold"))[0], 200)

    def test_the_highest_schema_steps_up_only_when_a_stored_row_raises_it(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open(node)[0]["lineage"]
        (sid, cid), (newer_sid, newer), (later_sid, later) = (self.session(node) for _tab in range(3))
        stepped = replace(
            routes.SCHEMA,
            version=2,
            features={**routes.SCHEMA.features, "marquee": 2},
            nodes=routes.SCHEMA.nodes | {"marquee"},
        )

        def steps():
            [(value,)] = frappe.db.sql(
                "SELECT `schema_steps` FROM `__writer_collab_doc` WHERE `node` = %s", node
            )
            return json.loads(value)

        def stamped(tab_sid, tab_cid, seq, payload, schema):
            body = push_body(lineage, tab_sid, tab_cid, seq, 0, payload, schema=schema)
            return call(routes.collab_updates_post, node, body=body).status_code

        self.assertEqual(steps(), [[0, 1]])
        with patch.object(routes, "SCHEMA", stepped):
            refused = [
                stamped(newer_sid, newer, 2, element(newer, "marquee"), 2),
                stamped(newer_sid, newer, 1, b"\x00", 2),
                stamped(newer_sid, newer, 1, element(newer, "blink"), 2),
                stamped(newer_sid, newer, 1, element(newer, "marquee"), 3),
            ]
            self.assertEqual(refused, [409, 400, 409, 423])
            self.assertEqual(stamped(sid, cid, 1, typed(cid, ["a"])[0], 1), 200)
            self.assertEqual(steps(), [[0, 1]])
            self.assertEqual(stamped(newer_sid, newer, 1, element(newer, "marquee"), 2), 200)
            self.assertEqual(stamped(later_sid, later, 1, element(later, "marquee"), 2), 200)
            self.assertEqual(stamped(sid, cid, 2, typed(cid, ["a", "b"])[1], 1), 200)

        self.assertEqual(steps(), [[0, 1], [2, 2]])

    def test_a_push_that_does_not_continue_its_writers_clocks_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        sid, cid = self.session(node)
        a, b, c = typed(cid, ["a", "b", "c"])

        # The text node takes clock 0, so "a" is clock 1 and "b" starts at 2
        self.assertEqual(self.push(node, sid, cid, 1, b), (409, {"collab": "clock_gap", "clock": 0}))
        self.assertEqual(self.push(node, sid, cid, 1, a)[0], 200)
        self.assertEqual(self.push(node, sid, cid, 2, c), (409, {"collab": "clock_gap", "clock": 2}))
        self.assertEqual(self.push(node, sid, cid, 2, a), (409, {"collab": "clock_gap", "clock": 2}))

        self.assertEqual(self.open(node)[1], [(1, a)])
        self.assertEqual(
            [self.push(node, sid, cid, seq, each)[0] for seq, each in ((2, b), (3, c))], [200, 200]
        )

    def test_a_push_that_needs_another_writers_unsent_typing_waits_for_it(self):
        self.set_mode("on")
        node = self.new_document()
        (first_sid, first), (second_sid, second) = self.session(node), self.session(node)
        [abc] = typed(first, ["abc"])
        tab = pycrdt.Doc(client_id=second)
        tab.apply_update(abc)
        before = tab.get_state()
        text = tab.get("default", type=pycrdt.XmlFragment).children[0]
        text.insert(3, "x")
        after_c = tab.get_update(before)

        # "x" sits after "c", the first writer's clock 3
        self.assertEqual(
            self.push(node, second_sid, second, 1, after_c),
            (409, {"collab": "missing_dep", "client": first, "clock": 3}),
        )
        self.assertEqual(self.open(node)[1], [])
        self.assertEqual(self.push(node, first_sid, first, 1, abc)[0], 200)
        self.assertEqual(self.push(node, second_sid, second, 1, after_c)[0], 200)
        self.assertEqual(self.open(node)[1], [(1, abc), (2, after_c)])

    def test_a_push_whose_text_follows_itself_or_later_text_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        sid, cid = self.session(node)

        def after(clock: int, text: str) -> bytes:
            return bytes([0x84]) + encoded_uint(cid) + encoded_uint(clock) + encoded_string(text)

        in_root = bytes([4, 1]) + encoded_string("default") + encoded_string("b")
        rows = {
            # "a" at clock 0 placed after clock 0, itself
            "itself": bytes([1, 1]) + encoded_uint(cid) + bytes([0]) + after(0, "a") + bytes([0]),
            # "a" at clock 0 placed after "b" at clock 1, later in the same row
            "later text": bytes([1, 2])
            + encoded_uint(cid)
            + bytes([0])
            + after(1, "a")
            + in_root
            + bytes([0]),
        }
        for (case, payload), clock in zip(rows.items(), (0, 1), strict=True):
            with self.subTest(case):
                stuck = pycrdt.Doc()
                stuck.apply_update(payload)
                self.assertEqual(stuck.get_state(), pycrdt.Doc().get_state())
                self.assertEqual(
                    self.push(node, sid, cid, 1, payload),
                    (409, {"collab": "missing_dep", "client": cid, "clock": clock}),
                )

        self.assertEqual(self.open(node)[1], [])
        self.assertEqual(self.push(node, sid, cid, 1)[0], 200)

    def test_a_delete_may_reach_the_last_committed_clock_and_no_further(self):
        self.set_mode("on")
        node = self.new_document()
        sessions = [self.session(node) for _ in range(3)]
        (first_sid, first), (seen_sid, seen), (ahead_sid, ahead) = sessions
        abc, d = typed(first, ["abc", "d"])
        self.assertEqual(self.push(node, first_sid, first, 1, abc)[0], 200)

        def deleting(cid, rows, start, end):
            tab = pycrdt.Doc(client_id=cid)
            for row in rows:
                tab.apply_update(row)
            before = tab.get_state()
            del tab.get("default", type=pycrdt.XmlFragment).children[0][start:end]
            return tab.get_update(before)

        # Committed clocks end at 3 ("c"); "d" is clock 4
        last = deleting(seen, [abc], 2, 3)
        past = deleting(ahead, [abc, d], 3, 4)

        self.assertEqual(self.push(node, seen_sid, seen, 1, last)[0], 200)
        self.assertEqual(
            self.push(node, ahead_sid, ahead, 1, past),
            (409, {"collab": "missing_dep", "client": first, "clock": 4}),
        )
        self.assertEqual(self.push(node, first_sid, first, 2, d)[0], 200)
        self.assertEqual(self.push(node, ahead_sid, ahead, 1, past)[0], 200)

    def test_a_copy_is_edited_where_its_start_was_written_and_nowhere_past_it(self):
        self.set_mode("on")
        node = self.new_document()
        original, later = typed(7, ["start", "!"])
        routes.collab.replace_start(routes.ADAPTER, routes.collab.find(routes.ADAPTER, node).id, original, 1)
        frappe.db.commit()
        (sid, cid), (ahead_sid, ahead) = self.session(node), self.session(node)

        def appending(tab_cid, rows):
            tab = pycrdt.Doc(client_id=tab_cid)
            for row in rows:
                tab.apply_update(row)
            before = tab.get_state()
            text = tab.get("default", type=pycrdt.XmlFragment).children[0]
            text.insert(len(str(text)), "?")
            return tab.get_update(before)

        # "start" is clocks 1 to 5 of the writer the copy began from; "!" is clock 6
        self.assertEqual(self.push(node, sid, cid, 1, appending(cid, [original]))[0], 200)
        self.assertEqual(
            self.push(node, ahead_sid, ahead, 1, appending(ahead, [original, later])),
            (409, {"collab": "missing_dep", "client": 7, "clock": 6}),
        )

    def test_logs_made_before_clocks_were_kept_read_them_from_their_rows(self):
        self.set_mode("on")
        node = self.new_document()
        start, after_start = typed(7, ["start", "!"])
        doc_id = routes.collab.find(routes.ADAPTER, node).id
        routes.collab.replace_start(routes.ADAPTER, doc_id, start, 1)
        frappe.db.commit()
        sid, cid = self.session(node)
        a, b, c = typed(cid, ["a", "b", "c"])
        self.assertEqual(
            [self.push(node, sid, cid, seq, each)[0] for seq, each in ((1, a), (2, b))], [200, 200]
        )
        frappe.db.sql("UPDATE `__writer_collab_session` SET `next_clock` = NULL WHERE `doc_id` = %s", doc_id)
        frappe.db.sql("UPDATE `__writer_collab_doc` SET `start_clocks` = NULL WHERE `id` = %s", doc_id)
        frappe.db.commit()

        routes.collab.backfill_clocks(routes.ADAPTER)

        self.assertEqual(self.push(node, sid, cid, 3, a), (409, {"collab": "clock_gap", "clock": 3}))
        self.assertEqual(self.push(node, sid, cid, 3, c)[0], 200)
        other_sid, other = self.session(node)
        tab = pycrdt.Doc(client_id=other)
        tab.apply_update(start)
        before = tab.get_state()
        del tab.get("default", type=pycrdt.XmlFragment).children[0][4:5]
        self.assertEqual(self.push(node, other_sid, other, 1, tab.get_update(before))[0], 200)
        tab.apply_update(after_start)
        before = tab.get_state()
        del tab.get("default", type=pycrdt.XmlFragment).children[0][4:5]
        self.assertEqual(
            self.push(node, other_sid, other, 2, tab.get_update(before)),
            (409, {"collab": "missing_dep", "client": 7, "clock": 6}),
        )

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
            self.push(node, sid, cid, 1, self.typed(cid, 1, "a"))

        self.assertEqual(self.open(node)[1], [])
        b = self.typed(cid, 1, "b")
        self.assertEqual(self.push(node, sid, cid, 1, b)[1]["rev"], 1)
        self.assertEqual(self.open(node)[1], [(1, b)])
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
                return self.push(node, sid, cid, seq)

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
                self.assertEqual(self.push(node, sid, cid, seq)[0], 200)

        self.assert_one_order(node, steps + 1)
        self.assertEqual(
            [payload for _, payload in self.open(node)[1]],
            typed(cid, [str(seq) for seq in range(1, steps + 2)]),
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
            (routes.collab_suspect_post, b'{"rev": 1}'),
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
        offline = self.typed(cid, 1, "offline")
        self.assertEqual(self.push(node, sid, cid, 1, offline)[0], 200)
        self.assertEqual([payload for _, payload in self.open(node)[1]], [offline])

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

    def test_a_tab_never_gets_the_id_of_a_writer_its_copy_started_from(self):
        self.set_mode("on")
        node = self.new_document()
        issued, claimed = 7, 2**30 + 7
        start = pycrdt.merge_updates(typed(issued, ["start"])[0], typed(claimed, ["start"])[0])
        routes.collab.replace_start(routes.ADAPTER, routes.collab.find(routes.ADAPTER, node).id, start, 1)
        frappe.db.commit()
        lineage = self.open(node)[0]["lineage"]

        with patch("secrets.randbelow", side_effect=[issued - 1, 41]):
            self.assertEqual(self.session(node)[1], 42)
        self.assertEqual(self.claim(node, uuid.uuid4().hex, claimed, lineage), (200, {"claim": "clash"}))
        self.assertEqual(self.claim(node, uuid.uuid4().hex, claimed + 1, lineage), (200, {"claim": "ok"}))

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
            sent = typed(cid, [str(seq) for seq in range(1, pushes + 1)])
            try:
                seq = 1
                while seq <= pushes:
                    body = push_body(lineage, sid, cid, seq, 0, sent[seq - 1])
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

    def test_an_open_on_a_broken_chain_is_refused_and_logged(self):
        self.set_mode("on")
        node = self.new_document()
        self.push(node, *self.session(node), 1)
        doc_id = routes.collab.find(routes.ADAPTER, node).id
        frappe.db.sql(
            "UPDATE `__writer_collab_doc` SET `head_chain` = %s WHERE `id` = %s", (b"\x00" * 32, doc_id)
        )
        frappe.db.commit()
        self.addCleanup(frappe.db.commit)
        logged = {"method": "Collab open: chain_break", "error": f"{routes.ADAPTER} document {doc_id}"}
        self.addCleanup(frappe.db.delete, "Error Log", logged)

        response = call(routes.collab_get, node)
        # The request is a GET, so frappe rolls back what it wrote
        frappe.db.rollback()

        self.assertEqual((response.status_code, answer(response)), (503, {"collab": "chain_break"}))
        self.assertEqual(frappe.db.count("Error Log", logged), 1)
