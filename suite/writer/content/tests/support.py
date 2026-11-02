"""Shared fixtures for the Writer collaboration tests."""

import base64
import gzip
import hashlib
import json
import struct
import uuid
from dataclasses import dataclass
from http import HTTPStatus

import frappe
import pycrdt
from frappe.tests import IntegrationTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite import drive
from suite.content import (
    checkpoints,
    compaction,
    jobs,
    log,
    logged,
    scheduling,
    tables,
)
from suite.content.http import routes
from suite.content.log import chain_next, chain_seed
from suite.content.stage import PIECE_MAX
from suite.content.updates import encoded_string, encoded_uint
from suite.drive._core.nodes import purge, update
from suite.drive._core.principals import Principals
from suite.tests.utils import ensure_user
from suite.writer import content as writer_content

WRITER = "writer-collab-writer@example.com"
OUTSIDER = "writer-collab-outsider@example.com"
READER = "writer-collab-reader@example.com"


def call_route(handler, node: str, *, body: bytes = b"", expected_user: str | None = None):
    headers = {routes.EXPECTED_USER_HEADER: expected_user or frappe.session.user}
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
    opened = read_open(frame)
    return opened.header, opened.rows


@dataclass(frozen=True)
class OpenFrame:
    header: dict
    checkpoint: bytes
    rows: list[tuple[int, bytes]]


def read_open(frame: bytes) -> OpenFrame:
    (length,) = struct.unpack(">I", frame[:4])
    header = json.loads(frame[4 : 4 + length])
    offset = 4 + length
    (size,) = struct.unpack(">I", frame[offset : offset + 4])
    checkpoint = frame[offset + 4 : offset + 4 + size]
    offset += 4 + size
    (count,) = struct.unpack(">I", frame[offset : offset + 4])
    offset += 4

    rows: list[tuple[int, bytes]] = []
    for _ in range(count):
        rev, size = struct.unpack(">QI", frame[offset : offset + 12])
        rows.append((rev, frame[offset + 12 : offset + 12 + size]))
        offset += 12 + size

    return OpenFrame(header, checkpoint, rows)


def typed_updates(client_id: int, texts: list[str]) -> list[bytes]:
    doc = pycrdt.Doc(client_id=client_id)
    seen = doc.get_state()
    body = doc.get("default", type=pycrdt.XmlFragment)
    text = body.children.append(pycrdt.XmlText())

    updates: list[bytes] = []
    for next_text in texts:
        text.insert(len(str(text)), next_text)
        updates.append(doc.get_update(seen))
        seen = doc.get_state()

    return updates


def embed_update(client_id: int, value: str) -> bytes:
    return (
        bytes([1, 1])
        + encoded_uint(client_id)
        + bytes([0, 5, 1])
        + encoded_string("t")
        + encoded_string(value)
        + bytes([0])
    )


def element_update(client_id: int, tag: str) -> bytes:
    doc = pycrdt.Doc(client_id=client_id)
    body = doc.get("default", type=pycrdt.XmlFragment)
    body.children.append(pycrdt.XmlElement(tag))

    return doc.get_update()


def body_item_update(client_id: int, kind: int, content: bytes) -> bytes:
    return (
        bytes([1, 1])
        + encoded_uint(client_id)
        + bytes([0, kind, 1])
        + encoded_string("default")
        + content
        + bytes([0])
    )


def formatted_update(client_id: int, key: str) -> bytes:
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
    expected_user: str | None = None,
    *,
    entries: list[bytes] | None = None,
    schema: int = 1,
    stage_id: str | None = None,
    restore: str | None = None,
) -> bytes:
    entries = entries or [payload]
    fields = {
        "lineage": lineage,
        "expected_user": expected_user or frappe.session.user,
        "sid": sid,
        "from": seq,
        "to": seq + len(entries) - 1,
        "cid": client_id,
        "seen_rev": seen_rev,
        "schema": schema,
        "shas": [hashlib.sha256(entry).hexdigest() for entry in entries],
    }
    if stage_id:
        fields["stage_id"] = stage_id

    if restore:
        fields["restore"] = restore

    header = json.dumps(fields).encode()

    return struct.pack(">I", len(header)) + header + payload


def pieces_of(change: bytes) -> list[bytes]:
    return [change[at : at + PIECE_MAX] for at in range(0, len(change), PIECE_MAX)]


def piece_body(lineage: str, sid: str, seq: int, change: bytes, piece: bytes, /, **header) -> bytes:
    fields = {
        "lineage": lineage,
        "expected_user": frappe.session.user,
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
    if len(update) <= PIECE_MAX:
        return push_body(lineage, sid, client_id, seq, 0, update)

    stage_id = uuid.uuid4().hex
    for index, piece in enumerate(pieces_of(update)):
        body = piece_body(lineage, sid, seq, update, piece)
        response = call_route(
            lambda node, index=index: routes.stage_put(node, stage_id, str(index)), node, body=body
        )
        assert response.status_code == HTTPStatus.OK, answer(response)

    return push_body(lineage, sid, client_id, seq, 0, b"", entries=[update], stage_id=stage_id)


def big_change(client_id: int, nbytes: int) -> bytes:
    [update] = typed_updates(client_id, ["x" * (nbytes - 64)])

    return update


def as_final(body: bytes) -> bytes:
    length = int.from_bytes(body[:4], "big")
    header = json.loads(body[4 : 4 + length]) | {"final": True}
    encoded = json.dumps(header).encode()
    return len(encoded).to_bytes(4, "big") + encoded + body[4 + length :]


class CollabCase(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(WRITER)
        ensure_user(OUTSIDER)
        ensure_user(READER)
        tables.ensure_tables(writer_content.APP)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        self.saved_mode = log.mode(writer_content.APP)
        self.addCleanup(self.restore_mode)
        frappe.set_user(WRITER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.texts_by_client: dict[int, dict[int, str]] = {}

    def restore_mode(self):
        log.set_mode(writer_content.APP, self.saved_mode)
        frappe.db.commit()

    def set_mode(self, mode: str):
        log.set_mode(writer_content.APP, mode)
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
        doc = routes.content.find(writer_content.APP, node)
        if doc:
            for kind in ("update", "session", "stage"):
                frappe.db.sql(f"DELETE FROM `__writer_content_{kind}` WHERE `doc_id` = %s", doc.id)

            frappe.db.sql("DELETE FROM `__writer_content_doc` WHERE `id` = %s", doc.id)
            frappe.db.commit()

    def table_count(self, kind: str) -> int:
        [(count,)] = frappe.db.sql(f"SELECT COUNT(*) FROM `__writer_content_{kind}`")

        return count

    def open_document(self, node: str):
        response = call_route(routes.document_get, node)

        return read_frame(response.get_data())

    def start_session(self, node: str) -> tuple[str, int]:
        sid = uuid.uuid4().hex
        body = json.dumps({"sid": sid}).encode()
        response = call_route(routes.sessions_post, node, body=body)

        return sid, answer(response)["client_id"]

    def typed_update(self, client_id: int, seq: int, text: str) -> bytes:
        texts = self.texts_by_client.setdefault(client_id, {})
        texts[seq] = text
        texts_so_far = [texts.setdefault(earlier, str(earlier)) for earlier in range(1, seq + 1)]

        return typed_updates(client_id, texts_so_far)[-1]

    def push(self, node: str, sid: str, client_id: int, seq: int, payload: bytes | None = None, entries=None):
        payload = payload or self.typed_update(client_id, seq, str(seq))
        header, rows = self.open_document(node)
        seen_rev = 0
        if rows:
            seen_rev, _ = rows[-1]

        body = push_body(header["lineage"], sid, client_id, seq, seen_rev, payload, entries=entries)
        response = call_route(routes.updates_post, node, body=body)

        return response.status_code, answer(response)

    def assert_one_order(self, node: str, count: int):
        _, rows = self.open_document(node)
        self.assertEqual([rev for rev, _ in rows], list(range(1, count + 1)))

        stored = routes.content.find(writer_content.APP, node)
        chain = chain_seed(stored.lineage)
        for rev, payload in rows:
            chain = chain_next(chain, rev, hashlib.sha256(payload).digest())

        self.assertEqual(chain, bytes(stored.head_chain))

    def stored_text(self, node: str) -> str:
        reader = pycrdt.Doc()
        _, rows = self.open_document(node)
        for _rev, payload in rows:
            reader.apply_update(payload)

        return str(reader.get("default", type=pycrdt.XmlFragment).children[0])

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

    def put_piece(self, node: str, stage_id: str, index: int, body: bytes):
        response = call_route(lambda node: routes.stage_put(node, stage_id, str(index)), node, body=body)

        return response.status_code, answer(response)

    def stage(self, node: str, sid: str, change: bytes, *, seq: int = 1, order=None, **header) -> str:
        stage_id = uuid.uuid4().hex
        opened, _ = self.open_document(node)
        lineage = opened["lineage"]
        pieces = pieces_of(change)
        indexes = order
        if order is None:
            indexes = range(len(pieces))

        for index in indexes:
            body = piece_body(lineage, sid, seq, change, pieces[index], **header)
            status, _body = self.put_piece(node, stage_id, index, body)
            self.assertEqual(status, 200)

        return stage_id

    def push_staged(self, node: str, sid: str, client_id: int, change: bytes, stage_id: str, seq: int = 1):
        header, rows = self.open_document(node)
        seen_rev = 0
        if rows:
            seen_rev, _ = rows[-1]

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
        doc_id = routes.content.find(writer_content.APP, node).id
        [(count,)] = frappe.db.sql(
            "SELECT COUNT(*) FROM `__writer_content_stage` WHERE `doc_id` = %s", doc_id
        )

        return count


class CheckpointCase(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(WRITER)
        logged.ensure_tables()
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        self.saved_mode = log.mode(writer_content.APP)
        log.set_mode(writer_content.APP, "on")
        frappe.db.commit()
        scheduling.paused_until = 0.0
        self.addCleanup(setattr, scheduling, "paused_until", 0.0)
        self.addCleanup(self.restore_mode)
        frappe.set_user(WRITER)
        self.addCleanup(frappe.set_user, "Administrator")

    def compaction_job(self, doc_id: str) -> checkpoints.Compaction:
        return checkpoints.Compaction(
            "writer",
            doc_id,
            writer_content.PART_MAP,
            "suite.content.jobs.judge",
        )

    def restore_mode(self):
        log.set_mode(writer_content.APP, self.saved_mode)
        frappe.db.commit()

    def new_document(self) -> str:
        root = drive.ensure_personal_root(WRITER)
        parent = frappe.db.get_value("Drive Root", root, "node")
        node = drive.create_document(
            parent, f"Collab {uuid.uuid4().hex[:8]}", content_doctype="Writer Document"
        )
        frappe.db.commit()
        self.addCleanup(self.delete_document, node)
        self.addCleanup(self.delete_log, node)
        return node

    def delete_document(self, node: str):
        frappe.set_user("Administrator")
        admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        state = frappe.db.get_value("Drive Node", node, "state")
        if state is None:
            return

        if state != "Trashed":
            update(admin, node, state="Trashed")

        purge(admin, node)
        frappe.db.commit()

    def delete_log(self, node: str):
        doc = routes.content.find(writer_content.APP, node)
        if doc:
            for kind in ("update", "session", "stage", "checkpoint", "recovery", "projection", "copy"):
                frappe.db.sql(f"DELETE FROM `__writer_content_{kind}` WHERE `doc_id` = %s", doc.id)

            frappe.db.sql("DELETE FROM `__writer_content_doc` WHERE `id` = %s", doc.id)
            frappe.db.commit()

    def type_into(self, node: str, words: list[str]) -> str:
        sid = uuid.uuid4().hex
        session_body = json.dumps({"sid": sid}).encode()
        session = call_route(routes.sessions_post, node, body=session_body)
        client_id = answer(session)["client_id"]

        opened_bytes = call_route(routes.document_get, node).get_data()
        frame = read_open(opened_bytes)
        doc = pycrdt.Doc(client_id=client_id)
        for payload in [frame.checkpoint, *(payload for _rev, payload in frame.rows)]:
            if payload:
                doc.apply_update(payload)

        seen = doc.get_state()
        fragment = doc.get("default", type=pycrdt.XmlFragment)
        if len(fragment.children):
            text = fragment.children[0]
        else:
            text = fragment.children.append(pycrdt.XmlText())

        for seq, word in enumerate(words, start=1):
            text.insert(len(str(text)), word)
            update = doc.get_update(seen)
            seen = doc.get_state()
            body = body_for(node, frame.header["lineage"], sid, client_id, seq, update)
            pushed = call_route(routes.updates_post, node, body=body)
            self.assertEqual(pushed.status_code, 200)
            self.last_answer = answer(pushed)

        return str(text)

    def doc_row(self, node: str):
        [row] = frappe.db.sql("SELECT * FROM `__writer_content_doc` WHERE `node` = %s", node, as_dict=True)

        return row

    def checkpoints_of(self, node: str) -> list[tuple[int, bytes, int]]:
        stored = frappe.db.sql(
            """SELECT `through_rev`, `gz`, `integrated` FROM `__writer_content_checkpoint`
            WHERE `doc_id` = %s ORDER BY `through_rev`""",
            self.doc_row(node).id,
        )
        return [(int(rev), gzip.decompress(bytes(gz)), int(integrated)) for rev, gz, integrated in stored]

    def body_of(self, node: str) -> bytes:
        encoded_body = frappe.db.get_value("Writer Document", {"node": node}, "content") or ""
        return base64.b64decode(encoded_body)

    def row_count(self, node: str) -> int:
        [(count,)] = frappe.db.sql(
            "SELECT COUNT(*) FROM `__writer_content_update` WHERE `doc_id` = %s", self.doc_row(node).id
        )

        return count

    def set_doc(self, node: str, **values):
        assignments = ", ".join(f"`{key}` = %({key})s" for key in values)
        params = {**values, "node": node}
        frappe.db.sql(f"UPDATE `__writer_content_doc` SET {assignments} WHERE `node` = %(node)s", params)
        frappe.db.commit()

    def text_of(self, state: bytes) -> str:
        doc = compaction.load_doc([state])
        fragment = doc.get("default", type=pycrdt.XmlFragment)
        return "".join(str(child) for child in fragment.children)

    def compact(self, node: str):
        jobs.compact(writer_content.APP, self.doc_row(node).id)
