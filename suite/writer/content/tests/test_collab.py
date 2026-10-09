import base64
import hashlib
import json
import struct
import threading
import time
import uuid
from dataclasses import replace
from datetime import timedelta
from unittest.mock import Mock, patch

import frappe
import pycrdt
from frappe.tests import IntegrationTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite import drive
from suite.composition import content as routes
from suite.drive._core.access import grant
from suite.drive._core.principals import Principals
from suite.suite_core.content import capacity, documents, live, scheduling
from suite.suite_core.content.log import chain_next, chain_seed
from suite.suite_core.content.stage import PIECE_MAX
from suite.suite_core.content.updates import encoded_string, encoded_uint
from suite.tests.utils import ensure_user
from suite.writer import content as writer_content

WRITER = "writer-collab-writer@example.com"
OUTSIDER = "writer-collab-outsider@example.com"
READER = "writer-collab-reader@example.com"


def call_route(handler, node: str, *, body: bytes = b"", principal: str | None = None):
    """Run one route handler as the current user, the way the dispatcher would."""
    headers = {routes.PRINCIPAL_HEADER: principal or frappe.session.user}
    environ = EnvironBuilder(method="POST", data=body, headers=headers).get_environ()
    frappe.local.request = Request(environ)
    frappe.local.form_dict = frappe._dict()

    try:
        return handler(node)
    finally:
        frappe.local.request = None


def answer(response) -> dict:
    return json.loads(response.get_data())


def read_frame(frame: bytes) -> tuple[dict, list[tuple[int, bytes]]]:
    header, _checkpoint, rows = read_open(frame)
    return header, rows


def read_open(frame: bytes) -> tuple[dict, bytes, list[tuple[int, bytes]]]:
    (length,) = struct.unpack(">I", frame[:4])
    header = json.loads(frame[4 : 4 + length])
    offset = 4 + length
    (size,) = struct.unpack(">I", frame[offset : offset + 4])
    checkpoint = frame[offset + 4 : offset + 4 + size]
    offset += 4 + size
    (count,) = struct.unpack(">I", frame[offset : offset + 4])
    offset += 4

    rows = []
    for _ in range(count):
        rev, size = struct.unpack(">QI", frame[offset : offset + 12])
        rows.append((rev, frame[offset + 12 : offset + 12 + size]))
        offset += 12 + size

    return header, checkpoint, rows


def typed_updates(client_id: int, texts: list[str]) -> list[bytes]:
    """The updates a tab writing as `client_id` sends as it types each text in turn, each continuing the clocks before it."""
    doc = pycrdt.Doc(client_id=client_id)
    seen = doc.get_state()
    body = doc.get("default", type=pycrdt.XmlFragment)
    text = body.children.append(pycrdt.XmlText())

    updates = []
    for next_text in texts:
        text.insert(len(str(text)), next_text)
        updates.append(doc.get_update(seen))
        seen = doc.get_state()

    return updates


def embed_update(client_id: int, value: str) -> bytes:
    """An update in which `client_id` puts one embed holding the JSON `value` in the root array "t", at clock 0."""
    return (
        bytes([1, 1])
        + encoded_uint(client_id)
        + bytes([0, 5, 1])
        + encoded_string("t")
        + encoded_string(value)
        + bytes([0])
    )


def element_update(client_id: int, tag: str) -> bytes:
    """The update a tab writing as `client_id` sends as it adds one `tag` node to an empty document."""
    doc = pycrdt.Doc(client_id=client_id)
    body = doc.get("default", type=pycrdt.XmlFragment)
    body.children.append(pycrdt.XmlElement(tag))

    return doc.get_update()


def body_item_update(client_id: int, kind: int, content: bytes) -> bytes:
    """The update that puts one item of content `kind` straight in an empty document's body."""
    return (
        bytes([1, 1])
        + encoded_uint(client_id)
        + bytes([0, kind, 1])
        + encoded_string("default")
        + content
        + bytes([0])
    )


def formatted_update(client_id: int, key: str) -> bytes:
    """The update a tab writing as `client_id` sends as it types one character carrying the format `key`."""
    doc = pycrdt.Doc(client_id=client_id)
    body = doc.get("default", type=pycrdt.XmlFragment)
    text = body.children.append(pycrdt.XmlText())
    text.insert(0, "x", {key: {}})

    return doc.get_update()


def push_body(
    lineage: str,
    sid: str,
    client_id: int,
    seq: int,
    seen_rev: int,
    payload: bytes,
    principal: str | None = None,
    *,
    entries: list[bytes] | None = None,
    schema: int = 1,
    stage_id: str | None = None,
) -> bytes:
    """One push of `entries` (or `payload` alone) as seqs from `seq`; the body sent is `payload`."""
    entries = entries or [payload]
    fields = {
        **({"stage_id": stage_id} if stage_id else {}),
        "lineage": lineage,
        "principal": principal or frappe.session.user,
        "sid": sid,
        "from": seq,
        "to": seq + len(entries) - 1,
        "cid": client_id,
        "seen_rev": seen_rev,
        "schema": schema,
        "shas": [hashlib.sha256(entry).hexdigest() for entry in entries],
    }
    header = json.dumps(fields).encode()

    return struct.pack(">I", len(header)) + header + payload


def pieces_of(change: bytes) -> list[bytes]:
    return [change[at : at + PIECE_MAX] for at in range(0, len(change), PIECE_MAX)]


def piece_body(lineage: str, sid: str, seq: int, change: bytes, piece: bytes, /, **header) -> bytes:
    """One piece of `change`, staged as `seq` of session `sid`; `header` overrides what it says."""
    fields = {
        "lineage": lineage,
        "principal": frappe.session.user,
        "sid": sid,
        "from": seq,
        "to": seq,
        "total_len": len(change),
        "sha_total": hashlib.sha256(change).hexdigest(),
        **header,
    }
    header_bytes = json.dumps(fields).encode()

    return struct.pack(">I", len(header_bytes)) + header_bytes + piece


def body_for(node: str, lineage: str, sid: str, client_id: int, seq: int, update: bytes) -> bytes:
    """The push of `update` as `seq`: inline, or naming the stage its pieces were put to first."""
    if len(update) <= PIECE_MAX:
        return push_body(lineage, sid, client_id, seq, 0, update)

    stage_id = uuid.uuid4().hex
    for index, piece in enumerate(pieces_of(update)):
        body = piece_body(lineage, sid, seq, update, piece)
        response = call_route(
            lambda node, index=index: routes.stage_put(node, stage_id, str(index)), node, body=body
        )
        assert response.status_code == 200, answer(response)

    return push_body(lineage, sid, client_id, seq, 0, b"", entries=[update], stage_id=stage_id)


def big_change(client_id: int, nbytes: int) -> bytes:
    """A first change by `client_id` of about `nbytes` bytes of typing."""
    return typed_updates(client_id, ["x" * (nbytes - 64)])[0]


class TestWriterCollab(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(WRITER)
        ensure_user(OUTSIDER)
        ensure_user(READER)
        routes.content.ensure_tables(writer_content.ADAPTER)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        self.saved_mode = frappe.db.get_single_value("Suite Collab Settings", "mode")
        self.addCleanup(self.restore_mode)
        frappe.set_user(WRITER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.texts_by_client = {}

    def restore_mode(self):
        frappe.db.set_single_value("Suite Collab Settings", "mode", self.saved_mode or "off")
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
        self.addCleanup(self.delete_log, node)

        return node

    def delete_log(self, node: str):
        doc = routes.content.find(writer_content.ADAPTER, node)
        if doc:
            for kind in ("update", "session", "stage"):
                frappe.db.sql(f"DELETE FROM `__writer_content_{kind}` WHERE `doc_id` = %s", doc.id)
            frappe.db.sql("DELETE FROM `__writer_content_doc` WHERE `id` = %s", doc.id)
            frappe.db.commit()

    def table_count(self, kind: str) -> int:
        return frappe.db.sql(f"SELECT COUNT(*) FROM `__writer_content_{kind}`")[0][0]

    def open_document(self, node: str):
        response = call_route(routes.document_get, node)

        return read_frame(response.get_data())

    def start_session(self, node: str) -> tuple[str, int]:
        sid = uuid.uuid4().hex
        body = json.dumps({"sid": sid}).encode()
        response = call_route(routes.sessions_post, node, body=body)

        return sid, answer(response)["client_id"]

    def typed_update(self, client_id: int, seq: int, text: str) -> bytes:
        """What the tab writing as `client_id` sends as `seq`: `text`, typed after what it sent as each earlier seq."""
        texts = self.texts_by_client.setdefault(client_id, {})
        texts[seq] = text
        texts_so_far = [texts.setdefault(earlier, str(earlier)) for earlier in range(1, seq + 1)]

        return typed_updates(client_id, texts_so_far)[-1]

    def push(self, node: str, sid: str, client_id: int, seq: int, payload: bytes | None = None, entries=None):
        payload = payload or self.typed_update(client_id, seq, str(seq))
        header, rows = self.open_document(node)
        seen_rev = rows[-1][0] if rows else 0
        body = push_body(header["lineage"], sid, client_id, seq, seen_rev, payload, entries=entries)
        response = call_route(routes.updates_post, node, body=body)

        return response.status_code, answer(response)

    def assert_one_order(self, node: str, count: int):
        header, rows = self.open_document(node)
        self.assertEqual([rev for rev, _ in rows], list(range(1, count + 1)))

        stored = routes.content.find(writer_content.ADAPTER, node)
        chain = chain_seed(stored.lineage)
        for rev, payload in rows:
            chain = chain_next(chain, rev, hashlib.sha256(payload).digest())

        self.assertEqual(chain, bytes(stored.head_chain))

    def test_mode_off_answers_disabled_and_writes_nothing(self):
        self.set_mode("off")
        before = {kind: self.table_count(kind) for kind in ("doc", "update", "session")}
        node = self.new_document()

        header, rows = self.open_document(node)
        self.assertEqual((header["state"], rows), ("disabled", []))
        for handler in (
            routes.sessions_post,
            routes.updates_post,
            routes.updates_get,
            routes.suspect_post,
        ):
            body = json.dumps({"sid": uuid.uuid4().hex}).encode()
            response = call_route(handler, node, body=body)
            self.assertEqual((response.status_code, answer(response)), (409, {"collab": "disabled"}))
        self.assertEqual({kind: self.table_count(kind) for kind in before}, before)

    def test_two_writers_converge_on_one_order(self):
        self.set_mode("on")
        node = self.new_document()
        self.assertEqual(self.open_document(node)[0]["state"], "live")
        first, second = self.start_session(node), self.start_session(node)

        sent = []
        for seq in (1, 2):
            for sid, client_id in (first, second):
                sent.append(self.typed_update(client_id, seq, f"{client_id}:{seq}"))
                self.assertEqual(self.push(node, sid, client_id, seq, sent[-1])[0], 200)

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
        self.assertEqual(self.push_staged(node, sid, client_id, payload, stage_id)[0], 200)

        self.assertEqual(self.open_document(node)[1], [(1, payload)])
        self.assert_one_order(node, 1)

    def test_a_resent_push_commits_once(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        first = self.push(node, sid, client_id, 1)
        status, body = self.push(node, sid, client_id, 1)

        self.assertEqual(first[0], 200)
        self.assertEqual((status, body["dup"], body["acked"]), (200, True, 1))
        self.assertEqual((body["rev"], body["chain"]), (first[1]["rev"], first[1]["chain"]))
        self.assert_one_order(node, 1)

    def test_a_resend_grown_by_more_typing_gets_the_original_answer(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        a, b = typed_updates(client_id, ["a", "b"])
        both = pycrdt.merge_updates(a, b)

        first = self.push(node, sid, client_id, 1, a)
        status, body = self.push(node, sid, client_id, 1, both, entries=[a, b])
        rest = self.push(node, sid, client_id, 2, b)

        self.assertEqual((status, body["dup"], body["acked"], body["rev"]), (200, True, 1, first[1]["rev"]))
        self.assertEqual((rest[0], rest[1]["rev"], rest[1]["acked"]), (200, 2, 2))
        self.assert_one_order(node, 2)

    def test_a_resend_with_different_bytes_is_refused(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        a = self.typed_update(client_id, 1, "a")
        self.push(node, sid, client_id, 1, a)
        c = self.typed_update(client_id, 1, "c")
        status, body = self.push(node, sid, client_id, 1, c)

        self.assertEqual((status, body), (409, {"collab": "seq_conflict"}))
        self.assertEqual([payload for _, payload in self.open_document(node)[1]], [a])

    def test_a_push_that_skips_seqs_is_out_of_another_lineage_or_ahead_of_the_log_is_refused(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        lineage = self.open_document(node)[0]["lineage"]
        first, second = typed_updates(client_id, ["a", "b"])

        for body, refusal in (
            (push_body(lineage, sid, client_id, 2, 0, second), {"collab": "seq", "acked": 0}),
            (push_body("0" * 32, sid, client_id, 1, 0, first), {"collab": "lineage"}),
            (push_body(lineage, sid, client_id, 1, 1, first), {"collab": "diverged"}),
        ):
            with self.subTest(refusal=refusal):
                response = call_route(routes.updates_post, node, body=body)
                self.assertEqual((response.status_code, answer(response)), (409, refusal))

        self.assertEqual(self.open_document(node)[1], [])
        self.assertEqual(self.push(node, sid, client_id, 1, first)[1]["rev"], 1)

    def test_a_push_of_bytes_no_tab_of_this_writer_could_send_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        lineage = self.open_document(node)[0]["lineage"]
        [own] = typed_updates(client_id, ["a"])

        cases = (
            ("not an update", b"\x00\x01"),
            ("empty", b"\x00\x00"),
            ("nested too deep", embed_update(client_id, "[" * 100_000 + "]" * 100_000)),
            ("another writer's", typed_updates(client_id + 1, ["a"])[0]),
        )
        for case, payload in cases:
            with self.subTest(case):
                body = push_body(lineage, sid, client_id, 1, 0, payload)
                response = call_route(routes.updates_post, node, body=body)
                self.assertEqual((response.status_code, answer(response)), (400, {"collab": "malformed"}))

        self.assertEqual(self.open_document(node)[1], [])
        self.assertEqual(self.push(node, sid, client_id, 1, own)[0], 200)

    def test_a_push_from_a_build_newer_than_the_server_waits_and_is_stored_with_its_schema(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        lineage = self.open_document(node)[0]["lineage"]
        newer = writer_content.SCHEMA.version + 1
        [a] = typed_updates(client_id, ["a"])
        body = push_body(lineage, sid, client_id, 1, 0, a, schema=newer)

        response = call_route(routes.updates_post, node, body=body)

        refusal = {
            "collab": "upgrading",
            "retry_ms": 30_000,
        }
        self.assertEqual((response.status_code, answer(response)), (423, refusal))
        self.assertEqual(self.open_document(node)[1], [])

        newer_schema = replace(writer_content.SCHEMA, version=newer)
        newer_spec = replace(writer_content.SPEC, schema=newer_schema)
        with patch.object(writer_content, "SPEC", newer_spec):
            self.assertEqual(call_route(routes.updates_post, node, body=body).status_code, 200)

        doc_id = routes.content.find(writer_content.ADAPTER, node).id
        self.assertEqual(
            frappe.db.sql("SELECT `schema` FROM `__writer_content_update` WHERE `doc_id` = %s", doc_id),
            ((newer,),),
        )

    def test_a_row_naming_what_its_schema_does_not_declare_is_refused_and_other_tabs_keep_saving(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open_document(node)[0]["lineage"]
        (sid, client_id), (other_sid, other_client_id) = self.start_session(node), self.start_session(node)
        marquee = push_body(lineage, sid, client_id, 1, 0, element_update(client_id, "marquee"))
        stepped = replace(
            writer_content.SCHEMA,
            version=2,
            features={**writer_content.SCHEMA.features, "marquee": 2},
            nodes=writer_content.SCHEMA.nodes | {"marquee"},
        )
        stepped_spec = replace(writer_content.SPEC, schema=stepped)
        [other_typing] = typed_updates(other_client_id, ["b"])
        other_body = push_body(lineage, other_sid, other_client_id, 1, 0, other_typing)
        stamped_body = push_body(
            lineage, sid, client_id, 1, 0, element_update(client_id, "marquee"), schema=2
        )

        undeclared = call_route(routes.updates_post, node, body=marquee)
        with patch.object(writer_content, "SPEC", stepped_spec):
            too_early = call_route(routes.updates_post, node, body=marquee)
            other = call_route(routes.updates_post, node, body=other_body)
            stamped = call_route(routes.updates_post, node, body=stamped_body)

        self.assertEqual(
            [(response.status_code, answer(response)) for response in (undeclared, too_early)],
            [(409, {"collab": "poison"})] * 2,
        )
        self.assertEqual((other.status_code, stamped.status_code), (200, 200))
        self.assertEqual(len(self.open_document(node)[1]), 2)

    def test_a_row_putting_a_type_the_editor_cannot_show_in_the_body_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open_document(node)[0]["lineage"]
        sid, client_id = self.start_session(node)

        refused = []
        # A Map, then a Text
        for shared in (1, 2):
            row = body_item_update(client_id, 7, encoded_uint(shared))
            body = push_body(lineage, sid, client_id, 1, 0, row)
            refused.append(call_route(routes.updates_post, node, body=body))

        self.assertEqual(
            [(response.status_code, answer(response)) for response in refused],
            [(409, {"collab": "poison"})] * 2,
        )
        self.assertEqual(self.open_document(node)[1], [])
        self.assertEqual(self.push(node, sid, client_id, 1, typed_updates(client_id, ["a"])[0])[0], 200)

    def test_a_row_using_a_name_in_the_wrong_role_or_an_embed_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open_document(node)[0]["lineage"]
        sid, client_id = self.start_session(node)
        rows = {
            "a mark name as a node": element_update(client_id, "bold"),
            "a node name as a mark": formatted_update(client_id, "paragraph"),
            "an overlapping mark's key": formatted_update(client_id, "bold--abc"),
            "an embed": body_item_update(client_id, 5, encoded_string("{}")),
        }

        for case, row in rows.items():
            with self.subTest(case):
                body = push_body(lineage, sid, client_id, 1, 0, row)
                response = call_route(routes.updates_post, node, body=body)
                self.assertEqual((response.status_code, answer(response)), (409, {"collab": "poison"}))

        self.assertEqual(self.open_document(node)[1], [])
        self.assertEqual(self.push(node, sid, client_id, 1, formatted_update(client_id, "bold"))[0], 200)

    def test_the_highest_schema_steps_up_only_when_a_stored_row_raises_it(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open_document(node)[0]["lineage"]
        (sid, client_id), (newer_sid, newer_client_id), (later_sid, later_client_id) = (
            self.start_session(node) for _tab in range(3)
        )
        stepped = replace(
            writer_content.SCHEMA,
            version=2,
            features={**writer_content.SCHEMA.features, "marquee": 2},
            nodes=writer_content.SCHEMA.nodes | {"marquee"},
        )
        stepped_spec = replace(writer_content.SPEC, schema=stepped)

        def schema_steps():
            [(value,)] = frappe.db.sql(
                "SELECT `schema_steps` FROM `__writer_content_doc` WHERE `node` = %s", node
            )

            return json.loads(value)

        def push_with_schema(tab_sid, tab_client_id, seq, payload, schema):
            body = push_body(lineage, tab_sid, tab_client_id, seq, 0, payload, schema=schema)

            return call_route(routes.updates_post, node, body=body).status_code

        self.assertEqual(schema_steps(), [[0, 1]])
        self.assertEqual(self.open_document(node)[0]["schema"], 1)
        with patch.object(writer_content, "SPEC", stepped_spec):
            refused = [
                push_with_schema(
                    newer_sid, newer_client_id, 2, element_update(newer_client_id, "marquee"), 2
                ),
                push_with_schema(newer_sid, newer_client_id, 1, b"\x00", 2),
                push_with_schema(newer_sid, newer_client_id, 1, element_update(newer_client_id, "blink"), 2),
                push_with_schema(
                    newer_sid, newer_client_id, 1, element_update(newer_client_id, "marquee"), 3
                ),
            ]
            self.assertEqual(refused, [409, 400, 409, 423])
            self.assertEqual(push_with_schema(sid, client_id, 1, typed_updates(client_id, ["a"])[0], 1), 200)
            self.assertEqual(schema_steps(), [[0, 1]])
            self.assertEqual(
                push_with_schema(
                    newer_sid, newer_client_id, 1, element_update(newer_client_id, "marquee"), 2
                ),
                200,
            )
            self.assertEqual(
                push_with_schema(
                    later_sid, later_client_id, 1, element_update(later_client_id, "marquee"), 2
                ),
                200,
            )
            self.assertEqual(
                push_with_schema(sid, client_id, 2, typed_updates(client_id, ["a", "b"])[1], 1), 200
            )

        self.assertEqual(schema_steps(), [[0, 1], [2, 2]])
        pull = call_route(routes.updates_get, node)
        pulled = read_frame(pull.get_data())[0]
        self.assertEqual((self.open_document(node)[0]["schema"], pulled["schema"]), (2, 2))

    def test_a_push_that_does_not_continue_its_writers_clocks_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        a, b, c = typed_updates(client_id, ["a", "b", "c"])

        # The text node takes clock 0, so "a" is clock 1 and "b" starts at 2
        self.assertEqual(self.push(node, sid, client_id, 1, b), (409, {"collab": "clock_gap", "clock": 0}))
        self.assertEqual(self.push(node, sid, client_id, 1, a)[0], 200)
        self.assertEqual(self.push(node, sid, client_id, 2, c), (409, {"collab": "clock_gap", "clock": 2}))
        self.assertEqual(self.push(node, sid, client_id, 2, a), (409, {"collab": "clock_gap", "clock": 2}))

        self.assertEqual(self.open_document(node)[1], [(1, a)])
        self.assertEqual(
            [self.push(node, sid, client_id, seq, each)[0] for seq, each in ((2, b), (3, c))], [200, 200]
        )

    def test_a_push_that_needs_another_writers_unsent_typing_waits_for_it(self):
        self.set_mode("on")
        node = self.new_document()
        (first_sid, first_client_id), (second_sid, second_client_id) = (
            self.start_session(node),
            self.start_session(node),
        )
        [abc] = typed_updates(first_client_id, ["abc"])
        tab = pycrdt.Doc(client_id=second_client_id)
        tab.apply_update(abc)
        before = tab.get_state()
        text = tab.get("default", type=pycrdt.XmlFragment).children[0]
        text.insert(3, "x")
        after_c = tab.get_update(before)

        # "x" sits after "c", the first writer's clock 3
        self.assertEqual(
            self.push(node, second_sid, second_client_id, 1, after_c),
            (409, {"collab": "missing_dep", "client": first_client_id, "clock": 3}),
        )
        self.assertEqual(self.open_document(node)[1], [])
        self.assertEqual(self.push(node, first_sid, first_client_id, 1, abc)[0], 200)
        self.assertEqual(self.push(node, second_sid, second_client_id, 1, after_c)[0], 200)
        self.assertEqual(self.open_document(node)[1], [(1, abc), (2, after_c)])

    def test_a_push_whose_text_follows_itself_or_later_text_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        def after(clock: int, text: str) -> bytes:
            return bytes([0x84]) + encoded_uint(client_id) + encoded_uint(clock) + encoded_string(text)

        in_root = bytes([4, 1]) + encoded_string("default") + encoded_string("b")
        rows = {
            # "a" at clock 0 placed after clock 0, itself
            "itself": bytes([1, 1]) + encoded_uint(client_id) + bytes([0]) + after(0, "a") + bytes([0]),
            # "a" at clock 0 placed after "b" at clock 1, later in the same row
            "later text": bytes([1, 2])
            + encoded_uint(client_id)
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
                    self.push(node, sid, client_id, 1, payload),
                    (409, {"collab": "missing_dep", "client": client_id, "clock": clock}),
                )

        self.assertEqual(self.open_document(node)[1], [])
        self.assertEqual(self.push(node, sid, client_id, 1)[0], 200)

    def test_a_delete_may_reach_the_last_committed_clock_and_no_further(self):
        self.set_mode("on")
        node = self.new_document()
        sessions = [self.start_session(node) for _ in range(3)]
        (first_sid, first_client_id), (seen_sid, seen_client_id), (ahead_sid, ahead_client_id) = sessions
        abc, d = typed_updates(first_client_id, ["abc", "d"])
        self.assertEqual(self.push(node, first_sid, first_client_id, 1, abc)[0], 200)

        def deleting(client_id, rows, start, end):
            tab = pycrdt.Doc(client_id=client_id)
            for row in rows:
                tab.apply_update(row)

            before = tab.get_state()
            text = tab.get("default", type=pycrdt.XmlFragment).children[0]
            del text[start:end]

            return tab.get_update(before)

        # Committed clocks end at 3 ("c"); "d" is clock 4
        last = deleting(seen_client_id, [abc], 2, 3)
        past = deleting(ahead_client_id, [abc, d], 3, 4)

        self.assertEqual(self.push(node, seen_sid, seen_client_id, 1, last)[0], 200)
        self.assertEqual(
            self.push(node, ahead_sid, ahead_client_id, 1, past),
            (409, {"collab": "missing_dep", "client": first_client_id, "clock": 4}),
        )
        self.assertEqual(self.push(node, first_sid, first_client_id, 2, d)[0], 200)
        self.assertEqual(self.push(node, ahead_sid, ahead_client_id, 1, past)[0], 200)

    def test_a_copy_is_edited_where_its_start_was_written_and_nowhere_past_it(self):
        self.set_mode("on")
        node = self.new_document()
        original, later = typed_updates(7, ["start", "!"])
        doc_id = routes.content.find(writer_content.ADAPTER, node).id
        routes.content.replace_start(writer_content.ADAPTER, doc_id, original, 1)
        frappe.db.commit()
        (sid, client_id), (ahead_sid, ahead_client_id) = self.start_session(node), self.start_session(node)

        def appending(tab_client_id, rows):
            tab = pycrdt.Doc(client_id=tab_client_id)
            for row in rows:
                tab.apply_update(row)

            before = tab.get_state()
            text = tab.get("default", type=pycrdt.XmlFragment).children[0]
            text.insert(len(str(text)), "?")

            return tab.get_update(before)

        # "start" is clocks 1 to 5 of the writer the copy began from; "!" is clock 6
        appended_to_start = appending(client_id, [original])
        appended_past_start = appending(ahead_client_id, [original, later])
        self.assertEqual(self.push(node, sid, client_id, 1, appended_to_start)[0], 200)
        self.assertEqual(
            self.push(node, ahead_sid, ahead_client_id, 1, appended_past_start),
            (409, {"collab": "missing_dep", "client": 7, "clock": 6}),
        )

    def test_logs_made_before_clocks_were_kept_read_them_from_their_rows(self):
        self.set_mode("on")
        node = self.new_document()
        start, after_start = typed_updates(7, ["start", "!"])
        doc_id = routes.content.find(writer_content.ADAPTER, node).id
        routes.content.replace_start(writer_content.ADAPTER, doc_id, start, 1)
        frappe.db.commit()
        sid, client_id = self.start_session(node)
        a, b, c = typed_updates(client_id, ["a", "b", "c"])
        self.assertEqual(
            [self.push(node, sid, client_id, seq, each)[0] for seq, each in ((1, a), (2, b))], [200, 200]
        )
        frappe.db.sql("UPDATE `__writer_content_session` SET `next_clock` = NULL WHERE `doc_id` = %s", doc_id)
        frappe.db.sql("UPDATE `__writer_content_doc` SET `start_clocks` = NULL WHERE `id` = %s", doc_id)
        frappe.db.commit()

        routes.content.backfill_clocks(writer_content.ADAPTER, writer_content.document_owner)

        self.assertEqual(self.push(node, sid, client_id, 3, a), (409, {"collab": "clock_gap", "clock": 3}))
        self.assertEqual(self.push(node, sid, client_id, 3, c)[0], 200)
        other_sid, other_client_id = self.start_session(node)
        tab = pycrdt.Doc(client_id=other_client_id)
        tab.apply_update(start)
        before = tab.get_state()
        text = tab.get("default", type=pycrdt.XmlFragment).children[0]
        del text[4:5]
        within_start = tab.get_update(before)
        self.assertEqual(self.push(node, other_sid, other_client_id, 1, within_start)[0], 200)

        tab.apply_update(after_start)
        before = tab.get_state()
        text = tab.get("default", type=pycrdt.XmlFragment).children[0]
        del text[4:5]
        past_start = tab.get_update(before)
        self.assertEqual(
            self.push(node, other_sid, other_client_id, 2, past_start),
            (409, {"collab": "missing_dep", "client": 7, "clock": 6}),
        )

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
            a = self.typed_update(client_id, 1, "a")
            self.push(node, sid, client_id, 1, a)

        self.assertEqual(self.open_document(node)[1], [])
        b = self.typed_update(client_id, 1, "b")
        self.assertEqual(self.push(node, sid, client_id, 1, b)[1]["rev"], 1)
        self.assertEqual(self.open_document(node)[1], [(1, b)])
        self.assert_one_order(node, 1)

    def test_a_worker_killed_at_any_step_loses_and_duplicates_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        sql, commit = frappe.db.sql, frappe.db.commit
        calls = []

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
                self.assertEqual(self.push(node, sid, client_id, seq)[0], 200)

        self.assert_one_order(node, steps + 1)
        self.assertEqual(
            [payload for _, payload in self.open_document(node)[1]],
            typed_updates(client_id, [str(seq) for seq in range(1, steps + 2)]),
        )

    def test_a_user_without_edit_access_cannot_push(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        lineage = self.open_document(node)[0]["lineage"]

        frappe.set_user(OUTSIDER)
        body = push_body(lineage, sid, client_id, 1, 0, b"x")
        response = call_route(routes.updates_post, node, body=body)

        self.assertIn(response.status_code, (403, 404))
        frappe.set_user(WRITER)
        self.assertEqual(self.open_document(node)[1], [])

    def test_a_reader_follows_but_cannot_write(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        grant(node, READER, drive.READ, Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)))
        frappe.db.commit()

        frappe.set_user(READER)
        header, _rows = self.open_document(node)
        session_body = json.dumps({"sid": uuid.uuid4().hex}).encode()
        own_session = call_route(routes.sessions_post, node, body=session_body)
        push_bytes = push_body(header["lineage"], sid, client_id, 1, 0, b"x")
        push = call_route(routes.updates_post, node, body=push_bytes)

        self.assertEqual((header["state"], header["can_write"]), ("live", False))
        self.assertEqual((own_session.status_code, push.status_code), (403, 403))
        frappe.set_user(WRITER)
        self.assertEqual(self.open_document(node)[1], [])

    def test_a_tab_signed_out_or_switched_is_told_why_before_any_access_check(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        lineage = self.open_document(node)[0]["lineage"]
        body = push_body(lineage, sid, client_id, 1, 0, b"x", principal=WRITER)
        session_body = json.dumps({"sid": uuid.uuid4().hex}).encode()
        handlers = (
            (routes.document_get, b""),
            (routes.updates_get, b""),
            (routes.sessions_post, session_body),
            (routes.updates_post, body),
            (routes.suspect_post, b'{"rev": 1}'),
            (
                lambda node: routes.stage_put(node, uuid.uuid4().hex, "0"),
                piece_body(lineage, sid, 1, b"x", b"x", principal=WRITER),
            ),
        )

        for user, expected in (("Guest", (401, "signed_out")), (OUTSIDER, (409, "principal_changed"))):
            frappe.set_user(user)
            for handler, request_body in handlers:
                response = call_route(handler, node, body=request_body, principal=WRITER)
                self.assertEqual((response.status_code, answer(response)["collab"]), expected)

        frappe.set_user(WRITER)
        self.assertEqual(self.open_document(node)[1], [])

    def test_a_guest_reads_but_cannot_write_even_where_drive_would_let_them(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        lineage = self.open_document(node)[0]["lineage"]

        frappe.set_user("Guest")
        with patch.object(routes.drive, "check"):
            header, _rows = self.open_document(node)
            session_body = json.dumps({"sid": uuid.uuid4().hex}).encode()
            session = call_route(routes.sessions_post, node, body=session_body)
            push_bytes = push_body(lineage, sid, client_id, 1, 0, b"x")
            push = call_route(routes.updates_post, node, body=push_bytes)

        self.assertEqual((header["state"], header["can_write"]), ("live", False))
        for response in (session, push):
            self.assertEqual((response.status_code, answer(response)["collab"]), (401, "signed_out"))
        frappe.set_user(WRITER)
        self.assertEqual(self.open_document(node)[1], [])

    def claim(self, node: str, sid: str, client_id: int, lineage: str):
        claim = {
            "sid": sid,
            "claim": {
                "cid": client_id,
                "lineage": lineage,
            },
        }
        body = json.dumps(claim).encode()
        response = call_route(routes.sessions_post, node, body=body)

        return response.status_code, answer(response)

    def test_a_node_no_app_keeps_here_is_not_found_as_a_missing_one_is(self):
        self.set_mode("on")
        root = drive.ensure_personal_root(WRITER)
        parent = frappe.db.get_value("Drive Root", root, "node")
        presentation = drive.create_document(
            parent, f"Not here {uuid.uuid4().hex[:8]}", content_doctype="Presentation"
        )
        frappe.db.commit()
        session_body = json.dumps({"sid": uuid.uuid4().hex}).encode()
        push_bytes = push_body(uuid.uuid4().hex, uuid.uuid4().hex, 7, 1, 0, b"x")
        handlers = (
            (routes.document_get, b""),
            (routes.updates_get, b""),
            (routes.sessions_post, session_body),
            (routes.updates_post, push_bytes),
            (routes.suspect_post, b'{"rev": 1}'),
            (lambda node: routes.stage_put(node, uuid.uuid4().hex, "0"), b"x"),
        )

        for node in (presentation, "no-such-node"):
            for handler, request_body in handlers:
                response = call_route(handler, node, body=request_body)
                self.assertEqual((response.status_code, answer(response)), (404, {"collab": "not_found"}))
        self.assertIsNone(routes.content.find(writer_content.ADAPTER, presentation))

    def test_an_offline_tab_claims_its_own_client_id_and_then_pushes(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open_document(node)[0]["lineage"]
        sid, client_id = uuid.uuid4().hex, 2**30 + 7

        self.assertEqual(self.claim(node, sid, client_id, lineage), (200, {"claim": "ok"}))
        self.assertEqual(self.claim(node, sid, client_id, lineage), (200, {"claim": "ok"}))
        offline = self.typed_update(client_id, 1, "offline")
        self.assertEqual(self.push(node, sid, client_id, 1, offline)[0], 200)
        self.assertEqual([payload for _, payload in self.open_document(node)[1]], [offline])

    def test_a_claim_on_a_taken_id_or_another_lineage_binds_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open_document(node)[0]["lineage"]
        client_id = 2**30 + 9
        self.assertEqual(self.claim(node, uuid.uuid4().hex, client_id, lineage)[1], {"claim": "ok"})
        sessions = self.table_count("session")

        clash = self.claim(node, uuid.uuid4().hex, client_id, lineage)
        other_lineage = self.claim(node, uuid.uuid4().hex, client_id + 1, "0" * 32)

        self.assertEqual((clash, other_lineage), ((200, {"claim": "clash"}), (200, {"claim": "lineage"})))
        self.assertEqual(self.table_count("session"), sessions)

    def test_a_tab_never_gets_the_id_of_a_writer_its_copy_started_from(self):
        self.set_mode("on")
        node = self.new_document()
        issued, claimed = 7, 2**30 + 7
        [issued_start] = typed_updates(issued, ["start"])
        [claimed_start] = typed_updates(claimed, ["start"])
        start = pycrdt.merge_updates(issued_start, claimed_start)
        doc_id = routes.content.find(writer_content.ADAPTER, node).id
        routes.content.replace_start(writer_content.ADAPTER, doc_id, start, 1)
        frappe.db.commit()
        lineage = self.open_document(node)[0]["lineage"]

        with patch("secrets.randbelow", side_effect=[issued - 1, 41]):
            self.assertEqual(self.start_session(node)[1], 42)
        self.assertEqual(self.claim(node, uuid.uuid4().hex, claimed, lineage), (200, {"claim": "clash"}))
        self.assertEqual(self.claim(node, uuid.uuid4().hex, claimed + 1, lineage), (200, {"claim": "ok"}))

    def test_a_claim_outside_the_device_range_is_refused(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open_document(node)[0]["lineage"]

        for client_id in (5, 2**31, "x"):
            self.assertEqual(
                self.claim(node, uuid.uuid4().hex, client_id, lineage), (400, {"collab": "malformed"})
            )

    def test_many_writers_at_once_get_gap_free_revs(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open_document(node)[0]["lineage"]
        writers, pushes = 16, 10
        sessions = [self.start_session(node) for _ in range(writers)]
        site, failures = frappe.local.site, []

        def push_all(sid: str, client_id: int):
            frappe.init(site=site)
            frappe.connect()
            frappe.set_user(WRITER)
            sent = typed_updates(client_id, [str(seq) for seq in range(1, pushes + 1)])

            try:
                seq = 1
                while seq <= pushes:
                    body = push_body(lineage, sid, client_id, seq, 0, sent[seq - 1])
                    response = call_route(routes.updates_post, node, body=body)
                    if response.status_code == 200:
                        seq += 1
                    elif response.status_code == 423:
                        time.sleep(0.005)
                    else:
                        failures.append(answer(response))
                        return
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
        self.push(node, *self.start_session(node), 1)
        doc_id = routes.content.find(writer_content.ADAPTER, node).id
        frappe.db.sql(
            "UPDATE `__writer_content_doc` SET `head_chain` = %s WHERE `id` = %s", (b"\x00" * 32, doc_id)
        )
        frappe.db.commit()
        self.addCleanup(frappe.db.commit)
        logged = {
            "method": "Collab open: chain_break",
            "error": f"{writer_content.ADAPTER} document {doc_id}",
        }
        self.addCleanup(frappe.db.delete, "Error Log", logged)

        response = call_route(routes.document_get, node)
        # The request is a GET, so frappe rolls back what it wrote
        frappe.db.rollback()

        self.assertEqual((response.status_code, answer(response)), (503, {"collab": "chain_break"}))
        self.assertEqual(frappe.db.count("Error Log", logged), 1)

    def put_piece(self, node: str, stage_id: str, index: int, body: bytes):
        response = call_route(lambda node: routes.stage_put(node, stage_id, str(index)), node, body=body)

        return response.status_code, answer(response)

    def stage(self, node: str, sid: str, change: bytes, *, seq: int = 1, order=None, **header) -> str:
        """Put every piece of `change` (in `order`) under a new stage id, and answer the id."""
        stage_id = uuid.uuid4().hex
        lineage = self.open_document(node)[0]["lineage"]
        pieces = pieces_of(change)
        indexes = order if order is not None else range(len(pieces))

        for index in indexes:
            body = piece_body(lineage, sid, seq, change, pieces[index], **header)
            status, _body = self.put_piece(node, stage_id, index, body)
            self.assertEqual(status, 200)

        return stage_id

    def push_staged(self, node: str, sid: str, client_id: int, change: bytes, stage_id: str, seq: int = 1):
        header, rows = self.open_document(node)
        seen_rev = rows[-1][0] if rows else 0
        body = push_body(
            header["lineage"],
            sid,
            client_id,
            seq,
            seen_rev,
            b"",
            entries=[change],
            stage_id=stage_id,
        )
        response = call_route(routes.updates_post, node, body=body)

        return response.status_code, answer(response)

    def staged(self, node: str) -> int:
        doc_id = routes.content.find(writer_content.ADAPTER, node).id
        counted = frappe.db.sql("SELECT COUNT(*) FROM `__writer_content_stage` WHERE `doc_id` = %s", doc_id)

        return counted[0][0]

    def test_a_four_mebibyte_change_sent_in_pieces_in_any_order_commits_once_and_leaves_no_pieces(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        change = big_change(client_id, 4 * 2**20)
        order = [5, 0, 15, 3, 3, 9, 1, 2, 14, 4, 6, 7, 8, 10, 11, 12, 13]

        stage_id = self.stage(node, sid, change, order=order)
        first = self.push_staged(node, sid, client_id, change, stage_id)
        again = self.push_staged(node, sid, client_id, change, stage_id)
        lineage = self.open_document(node)[0]["lineage"]
        late_body = piece_body(lineage, sid, 1, change, pieces_of(change)[2])
        late = self.put_piece(node, stage_id, 2, late_body)

        self.assertEqual((len(pieces_of(change)), first[0]), (16, 200))
        self.assertEqual((again[0], again[1]["dup"], again[1]["rev"]), (200, True, first[1]["rev"]))
        self.assertEqual(late, (200, {"dup": True}))
        self.assertEqual(self.open_document(node)[1], [(1, change)])
        self.assertEqual(self.staged(node), 0)
        self.assert_one_order(node, 1)

    def test_a_push_naming_a_stage_that_lacks_a_piece_stores_nothing_until_the_piece_arrives(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        change = big_change(client_id, 600_000)

        stage_id = self.stage(node, sid, change, order=[0, 2])
        waiting = self.push_staged(node, sid, client_id, change, stage_id)
        unknown = self.push_staged(node, sid, client_id, change, uuid.uuid4().hex)
        self.assertEqual(self.open_document(node)[1], [])
        lineage = self.open_document(node)[0]["lineage"]
        missing_body = piece_body(lineage, sid, 1, change, pieces_of(change)[1])
        self.put_piece(node, stage_id, 1, missing_body)
        done = self.push_staged(node, sid, client_id, change, stage_id)

        self.assertEqual(waiting, (409, {"collab": "stage_incomplete"}))
        self.assertEqual(unknown, (409, {"collab": "stage_incomplete"}))
        self.assertEqual(done[0], 200)
        self.assertEqual(self.open_document(node)[1], [(1, change)])
        self.assertEqual(self.staged(node), 0)

    def test_a_corrupt_piece_drops_its_stage_and_the_change_staged_again_commits(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        change = big_change(client_id, 600_000)
        lineage = self.open_document(node)[0]["lineage"]
        stage_id = uuid.uuid4().hex
        pieces = pieces_of(change)
        flipped = bytes([pieces[1][0] ^ 1]) + pieces[1][1:]

        for index, piece in enumerate([pieces[0], flipped, pieces[2]]):
            self.put_piece(node, stage_id, index, piece_body(lineage, sid, 1, change, piece))
        refused = self.push_staged(node, sid, client_id, change, stage_id)
        dropped = self.staged(node)
        for index, piece in enumerate(pieces):
            self.put_piece(node, stage_id, index, piece_body(lineage, sid, 1, change, piece))
        done = self.push_staged(node, sid, client_id, change, stage_id)

        self.assertEqual((refused, dropped), ((409, {"collab": "stage_incomplete"}), 0))
        self.assertEqual(done[0], 200)
        self.assertEqual(self.open_document(node)[1], [(1, change)])

    def test_a_piece_that_disagrees_with_its_stage_or_another_sessions_stage_is_refused(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        other_sid, other_client_id = self.start_session(node)
        change = big_change(client_id, 600_000)
        lineage = self.open_document(node)[0]["lineage"]
        stage_id = self.stage(node, sid, change, order=[0])
        pieces = pieces_of(change)

        def put_overridden(index, piece, tab_sid=sid, **header):
            body = piece_body(lineage, tab_sid, 1, change, piece, **header)

            return self.put_piece(node, stage_id, index, body)

        refusals = [
            put_overridden(0, pieces[1]),
            put_overridden(1, pieces[1], sha_total="00" * 32),
            put_overridden(1, pieces[1], **{"to": 2}),
            put_overridden(1, pieces[1], tab_sid=other_sid),
        ]
        theirs = self.push_staged(node, other_sid, other_client_id, change, stage_id)

        self.assertEqual(refusals, [(409, {"collab": "stage_conflict"})] * 4)
        self.assertEqual(theirs, (409, {"collab": "stage_conflict"}))
        self.assertEqual(self.staged(node), 1)
        put_overridden(1, pieces[1])
        put_overridden(2, pieces[2])
        self.assertEqual(self.push_staged(node, sid, client_id, change, stage_id)[0], 200)

    def test_pieces_are_cut_where_their_change_says_and_no_change_is_over_four_mebibytes(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        change = big_change(client_id, 600_000)
        lineage = self.open_document(node)[0]["lineage"]
        pieces = pieces_of(change)

        def put_overridden(index, piece, stage_id=None, **header):
            stage_id = stage_id or uuid.uuid4().hex
            body = piece_body(lineage, sid, 1, change, piece, **header)

            return self.put_piece(node, stage_id, index, body)

        self.assertEqual(put_overridden(0, pieces[0][:-1])[0], 400)
        self.assertEqual(put_overridden(2, pieces[2] + b"x")[0], 400)
        self.assertEqual(put_overridden(3, b"x")[0], 400)
        self.assertEqual(put_overridden(0, pieces[0], stage_id="not-an-id")[0], 400)
        self.assertEqual(
            put_overridden(0, pieces[0], total_len=4 * 2**20 + 1), (413, {"collab": "too_large"})
        )
        self.assertEqual(put_overridden(0, pieces[0], lineage="0" * 32), (409, {"collab": "lineage"}))
        self.assertEqual(
            put_overridden(0, pieces[0], sid=uuid.uuid4().hex), (409, {"collab": "session_unknown"})
        )
        self.assertEqual(put_overridden(2, pieces[2])[0], 200)
        self.assertEqual(self.staged(node), 1)

    def test_a_change_over_a_quarter_mebibyte_sent_whole_is_refused_as_too_large(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        overhead = len(big_change(client_id, 200_000)) - 200_000
        over_cap = big_change(client_id, PIECE_MAX + 1 - overhead)
        at_cap = big_change(client_id, PIECE_MAX - overhead)

        self.assertEqual(self.push(node, sid, client_id, 1, over_cap), (413, {"collab": "too_large"}))
        self.assertEqual(self.push(node, sid, client_id, 1, at_cap)[0], 200)

    def test_pieces_of_a_change_over_what_the_database_takes_are_refused_as_too_large(self):
        self.set_mode("on")
        node = self.new_document()
        sid, _ = self.start_session(node)
        change = b"x" * 600_000

        with patch.object(capacity, "edit_max", return_value=len(change) - 1):
            lineage = self.open_document(node)[0]["lineage"]
            first_piece = piece_body(lineage, sid, 1, change, change[:PIECE_MAX])
            status, body = self.put_piece(node, uuid.uuid4().hex, 0, first_piece)

        self.assertEqual((status, body), (413, {"collab": "too_large"}))
        self.assertEqual(self.staged(node), 0)

    def test_open_and_pull_name_the_sizes_a_change_is_checked_against(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        self.push(node, sid, client_id, 1, big_change(client_id, 10_000))

        opened = self.open_document(node)[0]["limits"]
        pull = call_route(routes.updates_get, node)
        pulled = read_frame(pull.get_data())[0]["limits"]

        self.assertEqual(opened, pulled)
        self.assertEqual(
            (opened["fragment"], opened["edit_max"], opened["state_max"]), (256 * 2**10, 4 * 2**20, 4 * 2**20)
        )
        self.assertEqual(opened["tail_bound"], len(big_change(client_id, 10_000)))

    def test_a_document_holds_at_most_sixteen_mebibytes_of_pieces(self):
        self.set_mode("on")
        node = self.new_document()
        sid, _ = self.start_session(node)
        change = b"x" * (4 * 2**20)

        for _ in range(4):
            self.stage(node, sid, change)
        lineage = self.open_document(node)[0]["lineage"]
        first_piece = piece_body(lineage, sid, 1, change, change[:PIECE_MAX])
        status, body = self.put_piece(node, uuid.uuid4().hex, 0, first_piece)

        self.assertEqual((status, body["collab"]), (423, "stage_full"))
        self.assertEqual(self.staged(node), 64)

    def test_one_editors_full_pieces_leave_room_for_anothers(self):
        self.set_mode("on")
        node = self.new_document()
        sid, _ = self.start_session(node)
        change = b"x" * (4 * 2**20)
        for _ in range(4):
            self.stage(node, sid, change)
        grant(node, OUTSIDER, drive.EDIT, Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)))
        frappe.db.commit()
        frappe.set_user(OUTSIDER)
        other_sid, _ = self.start_session(node)

        lineage = self.open_document(node)[0]["lineage"]
        first_piece = piece_body(lineage, other_sid, 1, change, change[:PIECE_MAX])
        status, body = self.put_piece(node, uuid.uuid4().hex, 0, first_piece)

        self.assertEqual((status, body), (200, {"staged": 0}))

    def test_pieces_put_at_once_never_pass_the_cap_together(self):
        self.set_mode("on")
        node = self.new_document()
        sid, _ = self.start_session(node)
        lineage = self.open_document(node)[0]["lineage"]
        change = b"x" * (4 * 2**20)
        for _ in range(3):
            self.stage(node, sid, change)
        self.stage(node, sid, change[: 15 * PIECE_MAX])
        site, answers = frappe.local.site, []

        def put_first_piece():
            frappe.init(site=site)
            frappe.connect()
            frappe.set_user(WRITER)

            try:
                first_piece = piece_body(lineage, sid, 1, change, change[:PIECE_MAX])
                answers.append(self.put_piece(node, uuid.uuid4().hex, 0, first_piece))
            finally:
                frappe.destroy()

        threads = [threading.Thread(target=put_first_piece) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(sorted(status for status, _body in answers), [200] + [423] * 7)
        self.assertEqual(self.staged(node), 64)

    def test_someone_who_cannot_edit_is_refused_before_their_piece_is_read(self):
        self.set_mode("on")
        node = self.new_document()
        grant(node, READER, drive.READ, Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)))
        frappe.db.commit()
        frappe.set_user(READER)

        with patch.object(capacity, "edit_max", side_effect=AssertionError("read the piece")):
            status, body = self.put_piece(node, uuid.uuid4().hex, 0, b"not a piece")

        self.assertEqual((status, body["collab"]), (403, "forbidden"))

    def test_the_sweeper_drops_pieces_older_than_a_quarter_hour(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        change = big_change(client_id, 600_000)
        old = self.stage(node, sid, change)
        recent = self.stage(node, sid, change)
        now = frappe.utils.now_datetime()
        for stage_id, minutes in ((old, 16), (recent, 14)):
            frappe.db.sql(
                "UPDATE `__writer_content_stage` SET `created` = %s WHERE `stage_id` = %s",
                (now - timedelta(minutes=minutes), stage_id),
            )
        frappe.db.commit()

        with patch.object(scheduling, "enqueue"):
            documents.sweep()

        self.assertEqual(
            self.push_staged(node, sid, client_id, change, old), (409, {"collab": "stage_incomplete"})
        )
        self.assertEqual(self.push_staged(node, sid, client_id, change, recent)[0], 200)

    def test_a_stage_whose_pieces_keep_arriving_outlives_a_quarter_hour(self):
        self.set_mode("on")
        node = self.new_document()
        lineage = self.open_document(node)[0]["lineage"]
        tabs = []
        for _ in range(2):
            sid, client_id = self.start_session(node)
            change = big_change(client_id, 600_000)
            tabs.append((sid, client_id, change, pieces_of(change)))
        (slow_sid, _, slow_change, slow_pieces), (resent_sid, _, resent_change, resent_pieces) = tabs
        slow = self.stage(node, slow_sid, slow_change, order=[0])
        resent = self.stage(node, resent_sid, resent_change)
        sixteen_minutes_ago = frappe.utils.now_datetime() - timedelta(minutes=16)
        frappe.db.sql(
            "UPDATE `__writer_content_stage` SET `created` = %s WHERE `stage_id` IN %s",
            (sixteen_minutes_ago, (slow, resent)),
        )
        frappe.db.commit()

        for stage_id, sid, change, pieces, order in (
            (slow, slow_sid, slow_change, slow_pieces, range(1, len(slow_pieces))),
            (resent, resent_sid, resent_change, resent_pieces, [0]),
        ):
            for index in order:
                body = piece_body(lineage, sid, 1, change, pieces[index])
                self.assertEqual(self.put_piece(node, stage_id, index, body)[0], 200)

        with patch.object(scheduling, "enqueue"):
            documents.sweep()

        pushed = [
            self.push_staged(node, sid, client_id, change, stage_id)[0]
            for stage_id, (sid, client_id, change, _pieces) in zip((slow, resent), tabs, strict=True)
        ]
        self.assertEqual(pushed, [200, 200])

    def test_only_an_editor_signed_in_as_the_sessions_owner_stages_a_piece_on_an_open_session(self):
        self.set_mode("on")
        node = self.new_document()
        sid, _ = self.start_session(node)
        lineage = self.open_document(node)[0]["lineage"]
        grant(node, READER, drive.READ, Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)))
        frappe.db.commit()

        def put_as(user):
            frappe.set_user(user)

            try:
                body = piece_body(lineage, sid, 1, b"x", b"x")
                return self.put_piece(node, uuid.uuid4().hex, 0, body)
            finally:
                frappe.set_user(WRITER)

        outsider, reader = put_as(OUTSIDER), put_as(READER)
        frappe.db.sql("UPDATE `__writer_content_session` SET `closed` = 1 WHERE `sid` = %s", sid)
        frappe.db.commit()
        closed = put_as(WRITER)

        self.assertIn(outsider[0], (403, 404))
        self.assertEqual(reader[0], 403)
        self.assertEqual(closed, (409, {"collab": "client_closed"}))
        self.assertEqual(self.staged(node), 0)

    def test_open_and_pull_name_this_epochs_room_and_the_next_and_no_other_documents(self):
        self.set_mode("on")
        node, other = self.new_document(), self.new_document()
        grant(node, READER, drive.READ, Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)))
        frappe.db.commit()

        late_in_epoch_1000 = Mock(time=Mock(return_value=150 * 1000 + 149))
        in_epoch_1001 = Mock(time=Mock(return_value=150 * 1001))

        frappe.set_user(READER)
        with patch.object(live, "time", late_in_epoch_1000):
            opened = self.open_document(node)[0]["rooms"]
            pull = call_route(routes.updates_get, node)
            pulled = read_frame(pull.get_data())[0]["rooms"]
        frappe.set_user(WRITER)
        with patch.object(live, "time", in_epoch_1001):
            later = self.open_document(node)[0]["rooms"]
            elsewhere = self.open_document(other)[0]["rooms"]

        self.assertEqual(opened, pulled)
        self.assertEqual((opened["epoch"], opened["epoch_seconds"]), (1000, 150))
        self.assertEqual(later["keys"][0], opened["keys"][1])
        self.assertEqual(len({*opened["keys"], *later["keys"], *elsewhere["keys"]}), 5)
        for key in opened["keys"]:
            self.assertRegex(key, r"^sc:[A-Za-z0-9_-]{32}$")

    def test_a_document_copied_to_a_new_lineage_gets_new_rooms(self):
        self.set_mode("on")
        node = self.new_document()
        self.open_document(node)
        doc = routes.content.find(writer_content.ADAPTER, node)
        before = routes.content.rooms(writer_content.ADAPTER, doc.id, doc.lineage)

        after = routes.content.rooms(writer_content.ADAPTER, doc.id, uuid.uuid4().hex)

        self.assertFalse({*before["keys"]} & {*after["keys"]})

    def test_a_committed_push_publishes_its_row_to_this_epochs_room(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        rooms = self.open_document(node)[0]["rooms"]
        small, large = self.typed_update(client_id, 1, "small"), self.typed_update(client_id, 2, "x" * 40_000)

        with patch("frappe.publish_realtime") as publish:
            self.push(node, sid, client_id, 1, small)
            self.push(node, sid, client_id, 1, small)
            self.push(node, sid, client_id, 2, large)
            self.push(node, sid, client_id, 5)

        lineage = self.open_document(node)[0]["lineage"]
        published = [
            (event.args, event.kwargs)
            for event in publish.call_args_list
            if event.args[0] == "suite_collab_row"
        ]
        small_row = {
            "lineage": lineage,
            "rev": 1,
            "schema": 1,
            "u": base64.b64encode(small).decode(),
        }
        large_row = {
            "lineage": lineage,
            "rev": 2,
            "schema": 1,
            "u": None,
        }
        this_epochs_room = {"room": rooms["keys"][0]}
        self.assertEqual(
            published,
            [
                (("suite_collab_row", small_row), this_epochs_room),
                (("suite_collab_row", large_row), this_epochs_room),
            ],
        )

    def test_a_push_is_saved_and_answered_when_realtime_cannot_be_reached(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        with patch("frappe.publish_realtime", side_effect=TimeoutError):
            status, body = self.push(node, sid, client_id, 1)

        self.assertEqual((status, body["rev"]), (200, 1))
        self.assert_one_order(node, 1)

    def test_the_realtime_service_may_let_sockets_into_rooms_only_while_collaboration_is_on(self):
        frappe.set_user("Guest")
        answers = {}
        for mode in ("off", "draining", "on"):
            self.set_mode(mode)
            answers[mode] = live.joinable()

        self.assertEqual(answers, {"off": False, "draining": False, "on": True})
