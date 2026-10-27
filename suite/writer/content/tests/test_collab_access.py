import json
import uuid
from unittest.mock import patch

import frappe
from frappe.utils import now_datetime

from suite import drive
from suite.content import touches
from suite.content.http import routes
from suite.drive._core.access import grant
from suite.drive._core.principals import Principals
from suite.writer import content as writer_content
from suite.writer.content.tests.support import (
    OUTSIDER,
    READER,
    WRITER,
    CollabCase,
    answer,
    call_route,
    piece_body,
    push_body,
)


class TestWriterCollabAccess(CollabCase):
    def test_a_user_without_edit_access_cannot_push(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        header, _ = self.open_document(node)
        lineage = header["lineage"]

        frappe.set_user(OUTSIDER)
        body = push_body(lineage, sid, client_id, 1, 0, b"x")
        response = call_route(routes.updates_post, node, body=body)

        self.assertIn(response.status_code, (403, 404))
        frappe.set_user(WRITER)
        _, rows = self.open_document(node)
        self.assertEqual(rows, [])

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
        _, rows = self.open_document(node)
        self.assertEqual(rows, [])

    def test_a_tab_signed_out_or_switched_is_told_why_before_any_access_check(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        header, _ = self.open_document(node)
        lineage = header["lineage"]
        body = push_body(lineage, sid, client_id, 1, 0, b"x", expected_user=WRITER)
        session_body = json.dumps({"sid": uuid.uuid4().hex}).encode()
        handlers = (
            (routes.document_get, b""),
            (routes.updates_get, b""),
            (routes.sessions_post, session_body),
            (routes.updates_post, body),
            (routes.suspect_post, b'{"rev": 1}'),
            (
                lambda node: routes.stage_put(node, uuid.uuid4().hex, "0"),
                piece_body(lineage, sid, 1, b"x", b"x", expected_user=WRITER),
            ),
        )

        for user, expected in (("Guest", (401, "signed_out")), (OUTSIDER, (409, "user_changed"))):
            frappe.set_user(user)
            for handler, request_body in handlers:
                response = call_route(handler, node, body=request_body, expected_user=WRITER)
                self.assertEqual((response.status_code, answer(response)["collab"]), expected)

        frappe.set_user(WRITER)
        _, rows = self.open_document(node)
        self.assertEqual(rows, [])

    def test_a_guest_reads_but_cannot_write_even_where_drive_would_let_them(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        writer_header, _ = self.open_document(node)
        lineage = writer_header["lineage"]

        frappe.set_user("Guest")
        with patch.object(routes.drive, "check", return_value=writer_content.EDITOR.doctype):
            header, _rows = self.open_document(node)
            session_body = json.dumps({"sid": uuid.uuid4().hex}).encode()
            session = call_route(routes.sessions_post, node, body=session_body)
            push_bytes = push_body(lineage, sid, client_id, 1, 0, b"x")
            push = call_route(routes.updates_post, node, body=push_bytes)

        self.assertEqual((header["state"], header["can_write"]), ("live", False))
        for response in (session, push):
            self.assertEqual((response.status_code, answer(response)["collab"]), (401, "signed_out"))

        frappe.set_user(WRITER)
        _, rows = self.open_document(node)
        self.assertEqual(rows, [])

    def test_a_node_no_app_keeps_here_is_not_found_as_a_missing_one_is(self):
        self.set_mode("on")
        root = drive.ensure_personal_root(WRITER)
        parent = frappe.db.get_value("Drive Root", root, "node")
        presentation = drive.create_document(
            parent, f"Not here {uuid.uuid4().hex[:8]}", content_doctype="Presentation"
        )
        grant(presentation, READER, drive.READ, Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)))
        frappe.db.commit()
        hidden = (404, {"collab": "not_found"})
        forbidden = (403, {"collab": "forbidden"})
        expected = (
            (WRITER, "no-such-node", (hidden,) * 9),
            (WRITER, presentation, (hidden,) * 9),
            (OUTSIDER, presentation, (hidden,) * 9),
            (
                READER,
                presentation,
                (hidden, hidden, forbidden, forbidden, hidden, forbidden) + (forbidden,) * 3,
            ),
        )

        for user, node, answers in expected:
            frappe.set_user(user)
            session_body = json.dumps({"sid": uuid.uuid4().hex}).encode()
            push_bytes = push_body(uuid.uuid4().hex, uuid.uuid4().hex, 7, 1, 0, b"x", user)
            handlers = (
                (routes.document_get, b""),
                (routes.updates_get, b""),
                (routes.sessions_post, session_body),
                (routes.updates_post, push_bytes),
                (routes.suspect_post, b'{"rev": 1}'),
                (lambda node: routes.stage_put(node, uuid.uuid4().hex, "0"), b"x"),
                (routes.html_post, b"{}"),
                (routes.restore_post, b"{}"),
                (routes.restore_cancel_post, b"{}"),
            )
            for (handler, request_body), refused in zip(handlers, answers, strict=True):
                response = call_route(handler, node, body=request_body)
                self.assertEqual((response.status_code, answer(response)), refused)
                self.assertNotIn("Presentation", str(response.headers))

        self.assertIsNone(routes.content.find(writer_content.APP, presentation))

    def test_a_push_runs_a_fixed_number_of_statements(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        with patch.object(touches, "now_datetime", return_value=now_datetime()):
            status, _ = self.push(node, sid, client_id, 1)
            self.assertEqual(status, 200)
            header, _ = self.open_document(node)
            body = push_body(header["lineage"], sid, client_id, 2, 1, self.typed_update(client_id, 2, "2"))
            with patch.object(frappe.db, "sql", wraps=frappe.db.sql) as sql:
                pushed = call_route(routes.updates_post, node, body=body)

        self.assertEqual((pushed.status_code, sql.call_count), (200, 16))
