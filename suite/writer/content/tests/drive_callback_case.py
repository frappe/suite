"""A test case that pushes a tab's edit to a Writer document and gives it media old enough to sweep."""

import io
import json
import uuid
from dataclasses import replace
from datetime import timedelta
from unittest.mock import patch

import frappe
import pycrdt
from frappe.utils import now_datetime

from suite import drive
from suite.content.http import routes
from suite.drive._core import content as drive_content
from suite.writer import content as writer_content
from suite.writer import drive as writer_drive
from suite.writer.content.tests.support import CheckpointCase, answer, call_route, push_body, read_open


def version_of(docname: str) -> dict:
    stream, mime = writer_drive.SPEC.version_bytes(docname)
    assert mime == "application/json"
    return json.loads(stream.getvalue())


def declaring(*names: str):
    features = {**writer_content.SCHEMA.features, **dict.fromkeys(names, 1)}
    shared_types = writer_content.SCHEMA.shared_types | {0, 1, 2}
    schema = replace(writer_content.SCHEMA, features=features, shared_types=shared_types)
    spec = replace(writer_content.EDITOR, schema=schema)
    return patch.object(writer_content, "EDITOR", spec)


def embed(media: str) -> str:
    return f"/api/method/suite.writer.api.embed.get?id={media}"


class DriveCallbackCase(CheckpointCase):
    def push_edit(self, node: str, change, schema: int = 1) -> None:
        sid = uuid.uuid4().hex
        session_body = json.dumps({"sid": sid}).encode()
        session = answer(call_route(routes.sessions_post, node, body=session_body))
        client_id = session["client_id"]
        opened = call_route(routes.document_get, node).get_data()
        frame = read_open(opened)

        doc = pycrdt.Doc(client_id=client_id)
        for payload in [frame.checkpoint, *(payload for _rev, payload in frame.rows)]:
            if payload:
                doc.apply_update(payload)

        seen = doc.get_state()
        change(doc.get("default", type=pycrdt.XmlFragment))

        changes = doc.get_update(seen)
        body = push_body(frame.header["lineage"], sid, client_id, 1, 0, changes, schema=schema)
        pushed = call_route(routes.updates_post, node, body=body)
        self.assertEqual(pushed.status_code, 200)

    def docname_of(self, node: str) -> str:
        return frappe.db.get_value("Drive Node", node, "content_docname")

    def old_media(self, document: str, title: str) -> str:
        with patch.object(frappe, "enqueue"):
            media = drive.store_file(document, title, io.BytesIO(title.encode()))

        aged = now_datetime() - timedelta(days=drive_content.UNUSED_MEDIA_GRACE_DAYS + 1)
        frappe.db.set_value("Drive Node", media, "creation", aged, update_modified=False)
        frappe.db.commit()
        self.addCleanup(self.delete_document, media)
        return media
