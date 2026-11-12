"""Pushes and logged decks for Slides' content tests, through the layer's real routes."""

import hashlib
import json
import struct
import uuid
from collections.abc import Callable

import frappe
import pycrdt
from frappe.tests import IntegrationTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite import drive
from suite.content import log, logged, tables
from suite.content.http import routes
from suite.slides.content import APP, SCHEMA, turn_on
from suite.tests.utils import ensure_user

OWNER = "slides-collab-owner@example.com"
LOG_KINDS = ("update", "session", "stage", "checkpoint", "copy", "recovery", "projection")


def call_route(handler: Callable, node: str, body: bytes = b""):
    headers = {routes.EXPECTED_USER_HEADER: frappe.session.user}
    frappe.local.request = Request(EnvironBuilder(method="POST", data=body, headers=headers).get_environ())
    frappe.local.form_dict = frappe._dict()
    try:
        return handler(node)
    finally:
        frappe.local.request = None


def opened(node: str) -> tuple[dict, bytes]:
    frame = call_route(routes.document_get, node).get_data()
    (length,) = struct.unpack(">I", frame[:4])
    header = json.loads(frame[4 : 4 + length])
    at = 4 + length
    (size,) = struct.unpack(">I", frame[at : at + 4])
    doc: pycrdt.Doc = pycrdt.Doc()
    if size:
        doc.apply_update(frame[at + 4 : at + 4 + size])

    at += 4 + size
    (count,) = struct.unpack(">I", frame[at : at + 4])
    at += 4
    for _ in range(count):
        _rev, size = struct.unpack(">QI", frame[at : at + 12])
        doc.apply_update(frame[at + 12 : at + 12 + size])
        at += 12 + size

    return header, doc.get_update()


def delete_log(node: str) -> None:
    drop_log(node)
    frappe.db.commit()


# Removes `node`'s log in the caller's transaction, leaving the deck as it was before it converted
def drop_log(node: str) -> None:
    doc = log.find(APP, node)
    if doc:
        for kind in LOG_KINDS:
            kind_table = tables.table(APP, kind)
            frappe.db.sql(f"DELETE FROM `{kind_table}` WHERE `doc_id` = %s", doc.id)

        doc_table = tables.table(APP, "doc")
        frappe.db.sql(f"DELETE FROM `{doc_table}` WHERE `id` = %s", doc.id)

    conversion_table = tables.table(APP, "conversion")
    frappe.db.sql(f"DELETE FROM `{conversion_table}` WHERE `node` = %s", node)


def trash_template(node: str) -> None:
    # every reader of templates takes Active nodes only, so a trashed one is offered nowhere
    frappe.db.set_value("Drive Node", node, "state", "Trashed")
    frappe.db.commit()


def owner_folder() -> str:
    root = drive.ensure_personal_root(OWNER)
    return frappe.db.get_value("Drive Root", root, "node")


class LoggedDeckCase(IntegrationTestCase):
    """Makes sure Slides is on, as install and migrate leave it, for a test of logged decks."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        logged.ensure_tables()
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        turn_on()
        frappe.db.commit()
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")

    def new_deck(self) -> str:
        node = drive.create_document(
            owner_folder(), f"Pushed {uuid.uuid4().hex[:8]}", content_doctype="Presentation"
        )
        frappe.db.commit()
        self.addCleanup(delete_log, node)
        return node

    def push(self, node: str, change: Callable[[pycrdt.Doc], None]) -> tuple[int, dict]:
        sid = uuid.uuid4().hex
        session = call_route(routes.sessions_post, node, json.dumps({"sid": sid}).encode())
        client_id = json.loads(session.get_data())["client_id"]
        header, state = opened(node)
        doc: pycrdt.Doc = pycrdt.Doc(client_id=client_id)
        doc.apply_update(state)
        seen = doc.get_state()
        change(doc)
        payload = doc.get_update(seen)
        fields = {
            "lineage": header["lineage"],
            "expected_user": frappe.session.user,
            "sid": sid,
            "from": 1,
            "to": 1,
            "cid": client_id,
            "seen_rev": 0,
            "schema": SCHEMA.version,
            "shas": [hashlib.sha256(payload).hexdigest()],
        }
        encoded = json.dumps(fields).encode()
        response = call_route(routes.updates_post, node, struct.pack(">I", len(encoded)) + encoded + payload)
        return response.status_code, json.loads(response.get_data())
