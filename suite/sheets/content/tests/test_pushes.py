"""A tab's edits pushed to a sheet through the content layer's own routes, as the browser sends them."""

import hashlib
import json
import struct
import uuid
from unittest.mock import patch

import frappe
import pycrdt
from frappe.tests import IntegrationTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite import drive
from suite.content import conversions, log, logged, tables
from suite.content.http import routes
from suite.sheets import content as sheets_content
from suite.sheets.content.tests.support import (
    CURRENT_BODY,
    cells_of,
    in_job,
    require_converter,
)
from suite.sheets.doctype.sheet.storage import encode_sheets_data
from suite.tests.utils import ensure_user

OWNER = "sheets-collab-owner@example.com"


def call_route(handler, node: str, body: bytes = b""):
    """Call one route as the browser's request for `node` would."""
    headers = {routes.EXPECTED_USER_HEADER: frappe.session.user}
    frappe.local.request = Request(EnvironBuilder(method="POST", data=body, headers=headers).get_environ())
    frappe.local.form_dict = frappe._dict()
    try:
        return handler(node)
    finally:
        frappe.local.request = None


def opened(node: str) -> tuple[dict, bytes]:
    """The document's open frame: its header and the state a tab starts from (checkpoint, then rows)."""
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


class TestPushes(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        logged.ensure_tables()
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        # The editor's wiring allows turning Sheets on
        ready = patch.object(sheets_content, "EDITOR_READY", True)
        ready.start()
        self.addCleanup(ready.stop)
        saved_mode = log.mode(sheets_content.APP)
        if saved_mode != "on":
            log.set_mode(sheets_content.APP, "on")
            frappe.db.commit()
            self.addCleanup(self.restore_mode, saved_mode)

        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")

    def restore_mode(self, mode: str):
        # Fails while any sheet has a log: one this class left behind
        log.set_mode(sheets_content.APP, mode)
        frappe.db.commit()

    def new_sheet(self) -> str:
        root = drive.ensure_personal_root(OWNER)
        parent = frappe.db.get_value("Drive Root", root, "node")
        node = drive.create_document(parent, f"Pushed {uuid.uuid4().hex[:8]}", content_doctype="Sheet")
        frappe.db.commit()
        self.addCleanup(self.delete_log, node)
        return node

    def delete_log(self, node: str):
        frappe.set_user("Administrator")
        doc = log.find(sheets_content.APP, node)
        if doc:
            for kind in ("update", "session", "stage", "checkpoint", "copy", "recovery", "projection"):
                frappe.db.sql(f"DELETE FROM `{tables.table('sheets', kind)}` WHERE `doc_id` = %s", doc.id)

            frappe.db.sql(f"DELETE FROM `{tables.table('sheets', 'doc')}` WHERE `id` = %s", doc.id)

        frappe.db.sql(f"DELETE FROM `{tables.table('sheets', 'conversion')}` WHERE `node` = %s", node)
        frappe.db.commit()

    def push(self, node: str, change) -> tuple[int, dict]:
        """Open a session, apply `change` to the document as that tab, and push it as one row."""
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
            "schema": sheets_content.SCHEMA.version,
            "shas": [hashlib.sha256(payload).hexdigest()],
        }
        encoded = json.dumps(fields).encode()
        response = call_route(routes.updates_post, node, struct.pack(">I", len(encoded)) + encoded + payload)
        return response.status_code, json.loads(response.get_data())

    def test_a_new_sheets_first_edit_is_accepted_and_kept(self):
        node = self.new_sheet()

        def first_edit(doc: pycrdt.Doc) -> None:
            # What the glue writes for a new sheet and a cell typed in B2 (collab/schema.ts)
            doc.get("meta", type=pycrdt.Map)["schemaVersion"] = 1
            doc.get("sheets", type=pycrdt.Array).append("s1x7p2q9")
            doc.get("sheetMeta", type=pycrdt.Map)["s1x7p2q9"] = {"name": "Sheet1"}
            doc.get("rows", type=pycrdt.Map)["s1x7p2q9"] = pycrdt.Array(["e1", "e2"])
            doc.get("cols", type=pycrdt.Map)["s1x7p2q9"] = pycrdt.Array(["e1", "e2"])
            doc.get("tails", type=pycrdt.Map)["s1x7p2q9:rows:e"] = 2
            doc.get("tails", type=pycrdt.Map)["s1x7p2q9:cols:e"] = 2
            doc.get("inputs", type=pycrdt.Map)["s1x7p2q9:e2:e2"] = "=SUM(A1:A3)"
            doc.get("formats", type=pycrdt.Map)["s1x7p2q9:e2:e2"] = {"bold": True}

        status, body = self.push(node, first_edit)

        self.assertEqual(status, 200, body)
        _, state = opened(node)
        self.assertEqual(cells_of(state), {"Sheet1": {"B2": "=SUM(A1:A3)"}})

    def test_an_edit_to_a_converted_sheet_is_accepted(self):
        require_converter(self)
        in_job(self)
        node = self.new_sheet()
        self.delete_log(node)
        frappe.set_user(OWNER)
        docname = frappe.db.get_value("Drive Node", node, "content_docname")
        frappe.db.set_value("Sheet", docname, "sheets_data", encode_sheets_data(CURRENT_BODY))
        frappe.db.commit()
        self.assertEqual(conversions.convert_document(sheets_content.APP, node), "converted")

        def type_in_c1(doc: pycrdt.Doc) -> None:
            [sheet] = doc.get("sheets", type=pycrdt.Array).to_py()
            row = doc.get("rows", type=pycrdt.Map)[sheet].to_py()[0]
            cols = doc.get("cols", type=pycrdt.Map)[sheet]
            cols.append("e3")
            doc.get("tails", type=pycrdt.Map)[f"{sheet}:cols:e"] = 3
            doc.get("inputs", type=pycrdt.Map)[f"{sheet}:{row}:e3"] = "note"

        status, body = self.push(node, type_in_c1)

        self.assertEqual(status, 200, body)
        _, state = opened(node)
        self.assertEqual(cells_of(state)["Budget"]["C1"], "note")
        self.assertEqual(cells_of(state)["Budget"]["B4"], "=SUM(B1:B2)")

    def test_a_key_the_layer_cannot_take_is_refused_and_not_kept(self):
        node = self.new_sheet()

        def bad_name(doc: pycrdt.Doc) -> None:
            doc.get("names", type=pycrdt.Map)["GRÖSSE"] = {"name": "Größe", "range": "A1"}

        status, body = self.push(node, bad_name)

        self.assertEqual(status, 409, body)
        _, state = opened(node)
        doc: pycrdt.Doc = pycrdt.Doc()
        doc.apply_update(state)
        self.assertEqual(doc.get("names", type=pycrdt.Map).to_py(), {})
