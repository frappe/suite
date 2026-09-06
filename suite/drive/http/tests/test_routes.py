"""The route boundary: what a refusal becomes, and what a handler will not do.

These run with the `_core` workflows stubbed, because the subject is the
boundary itself - the mapping in §11.6, the savepoint isolation in §11.5, and
the bound on a streamed chunk. The workflows have their own tests, and
`test_dispatch` proves the two meet over real HTTP.
"""

import io
import unittest
from unittest.mock import MagicMock, call, patch

import frappe
from frappe.tests import UnitTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite.drive._core.errors import (
    DriveConflict,
    DriveError,
    DriveForbidden,
    DriveLinkExpired,
    DriveLocked,
    DriveNotFound,
    DriveOverQuota,
)
from suite.drive._core.principals import Principals
from suite.drive.http import routes
from suite.drive.http.tests import ensure_local_context

SOMEONE = Principals(user="a@example.com", own=("a@example.com",), open=("$PUBLIC",), is_admin=False)


def setUpModule():
    ensure_local_context()


class BoundaryCase(UnitTestCase):
    def setUp(self):
        frappe.local.response_headers = {}
        frappe.local.message_log = []
        self.principals = patch.object(routes, "_principals", return_value=SOMEONE)
        self.principals.start()
        self.addCleanup(self.principals.stop)


class TestRefusalMapping(BoundaryCase):
    def test_every_drive_error_keeps_its_class_and_its_status(self):
        expected = (
            (DriveError, 400),
            (DriveLocked, 401),
            (DriveForbidden, 403),
            (DriveNotFound, 404),
            (DriveConflict, 409),
            (DriveLinkExpired, 410),
            (DriveOverQuota, 413),
        )
        for kind, status in expected:
            with self.subTest(error=kind.__name__):
                with patch.object(routes.node_core, "get", side_effect=kind("refused")) as workflow:
                    with self.assertRaises(kind) as caught:
                        routes.node_get(node="n1")
                self.assertTrue(workflow.called)
                self.assertEqual(caught.exception.http_status_code, status)
                self.assertEqual(str(caught.exception), "refused")

    def test_a_refusal_carries_a_message_the_envelope_can_publish(self):
        # `report_error` copies a message onto the error body only when
        # `msgprint` stamped an id onto the exception. A bare `raise` in a
        # workflow does not, which is why the boundary throws it again.
        with patch.object(routes.node_core, "get", side_effect=DriveNotFound("gone")):
            with self.assertRaises(DriveNotFound) as caught:
                routes.node_get(node="n1")
        stamped = getattr(caught.exception, "_BoundaryCase__frappe_exc_id", None) or getattr(
            caught.exception, "__frappe_exc_id", None
        )
        self.assertTrue(stamped)
        self.assertTrue(
            any(entry.get("__frappe_exc_id") == stamped for entry in frappe.local.message_log),
            frappe.local.message_log,
        )

    def test_a_plain_validation_error_becomes_a_bad_request(self):
        # The framework scores a bare ValidationError 417. §11.6 has one code
        # for a malformed request, and it is DriveError at 400.
        with patch.object(routes.node_core, "get", side_effect=frappe.ValidationError("bad")):
            with self.assertRaises(DriveError) as caught:
                routes.node_get(node="n1")
        self.assertIs(type(caught.exception), DriveError)
        self.assertEqual(caught.exception.http_status_code, 400)

    def test_a_coercion_refusal_becomes_a_bad_request(self):
        for handler, kwargs in (
            (routes.node_get, {"node": None}),
            (routes.node_get, {"node": "n1", "expand": "grants"}),
            (routes.node_children, {"node": "n1", "limit": "-3"}),
            (routes.node_batch, {"nodes": [], "patch": {"title": "a"}}),
            (routes.node_batch, {"nodes": ["n1"], "patch": {"blob": "x"}}),
            (routes.node_preview, {"node": "n1", "image": "not base64!", "mime": "image/png"}),
            (routes.upload_create, {"parent": "f1", "filename": "", "size": 1}),
        ):
            with self.subTest(call=handler.__name__, kwargs=kwargs):
                with self.assertRaises(DriveError) as caught:
                    handler(**kwargs)
                self.assertEqual(caught.exception.http_status_code, 400)

    def test_a_locked_link_names_the_unlock_scheme_not_a_login(self):
        with patch.object(routes.node_core, "get", side_effect=DriveLocked("locked")):
            with self.assertRaises(DriveLocked):
                routes.node_get(node="n1")
        self.assertEqual(frappe.local.response_headers["WWW-Authenticate"], 'DriveLink realm="drive"')

    def test_an_unrefused_error_is_not_flattened_into_a_drive_error(self):
        # A defect must abort the request, not be reported as a client fault.
        with patch.object(routes.node_core, "get", side_effect=KeyError("boom")):
            with self.assertRaises(KeyError):
                routes.node_get(node="n1")

    def test_an_unclaimed_address_is_not_found(self):
        with self.assertRaises(DriveNotFound) as caught:
            routes.unknown()
        self.assertEqual(caught.exception.http_status_code, 404)


class TestBatchIsolation(BoundaryCase):
    def setUp(self):
        super().setUp()
        self.db = MagicMock()
        self.database = patch.object(frappe.local, "db", self.db, create=True)
        self.database.start()
        self.addCleanup(self.database.stop)

    def test_a_refused_node_rolls_back_alone_and_the_rest_stand(self):
        outcomes = {"a": None, "b": DriveForbidden("no"), "c": None}

        def update(_principals, node, **_kwargs):
            refusal = outcomes[node]
            if refusal:
                raise refusal
            return frappe._dict({"name": node})

        with patch.object(routes.node_core, "update", side_effect=update):
            answer = routes.node_batch(nodes=["a", "b", "c"], patch={"state": "Trashed"})

        self.assertEqual(answer["ok"], ["a", "c"])
        self.assertEqual(answer["failed"], [{"node": "b", "type": "DriveForbidden", "message": "no"}])
        self.assertEqual(self.db.savepoint.call_count, 3)
        self.assertEqual(self.db.release_savepoint.call_count, 2)
        self.assertEqual(self.db.rollback.call_count, 1)

    def test_each_node_gets_its_own_savepoint_name(self):
        with patch.object(routes.node_core, "update", return_value=frappe._dict({"name": "x"})):
            routes.node_batch(nodes=["a", "b", "c"], patch={"title": "t"})
        names = [call.args[0] for call in self.db.savepoint.call_args_list]
        self.assertEqual(len(set(names)), 3)
        released = [call.args[0] for call in self.db.release_savepoint.call_args_list]
        self.assertEqual(names, released)

    def test_a_plain_validation_error_is_reported_as_a_bad_request_per_node(self):
        with patch.object(routes.node_core, "update", side_effect=frappe.ValidationError("bad title")):
            answer = routes.node_batch(nodes=["a"], patch={"title": "t"})
        self.assertEqual(answer["ok"], [])
        self.assertEqual(answer["failed"], [{"node": "a", "type": "DriveError", "message": "bad title"}])

    def test_a_defect_aborts_the_whole_batch(self):
        with patch.object(routes.node_core, "update", side_effect=KeyError("boom")):
            with self.assertRaises(KeyError):
                routes.node_batch(nodes=["a", "b"], patch={"title": "t"})
        self.assertEqual(self.db.release_savepoint.call_count, 0)

    def test_the_rollback_names_the_failing_node_s_own_savepoint(self):
        # A bare `frappe.db.rollback()` here would undo every node in the
        # batch, which is the one thing §11.5 forbids. Counting calls does not
        # tell the two apart; naming the savepoint does.
        outcomes = {"a": None, "b": DriveForbidden("no")}

        def update(_principals, node, **_kwargs):
            if outcomes[node]:
                raise outcomes[node]
            return frappe._dict({"name": node})

        with patch.object(routes.node_core, "update", side_effect=update):
            routes.node_batch(nodes=["a", "b"], patch={"state": "Trashed"})
        names = [call.args[0] for call in self.db.savepoint.call_args_list]
        self.assertEqual(self.db.rollback.call_args_list, [call(save_point=names[1])])

    def test_a_repeated_node_is_touched_once(self):
        with patch.object(routes.node_core, "update", return_value=frappe._dict({"name": "a"})) as update:
            answer = routes.node_batch(nodes=["a", "a", "a"], patch={"title": "t"})
        self.assertEqual(update.call_count, 1)
        self.assertEqual(answer["ok"], ["a"])


class TestExpansions(BoundaryCase):
    """§11.3's three expansions cost their queries only when they are named."""

    def setUp(self):
        super().setUp()
        self.row = frappe._dict({"name": "n1", "title": "t", "kind": "file", "root": "r1"})
        self.get = patch.object(routes.node_core, "get", return_value=self.row)
        self.get.start()
        self.addCleanup(self.get.stop)

    def answer_for(self, expand):
        with patch.object(routes, "describe", return_value={"role": 40}) as access:
            with patch.object(routes.node_core, "breadcrumbs", return_value=[{"name": "r1"}]) as trail:
                with patch.object(
                    routes.previews, "preview_expansions", return_value={"n1": {"url": "/f/x"}}
                ) as preview:
                    return routes.node_get(node="n1", expand=expand), (access, trail, preview)

    def test_no_expansion_is_built_unless_it_is_named(self):
        answer, (access, trail, preview) = self.answer_for(None)
        self.assertEqual(set(answer) & {"access", "breadcrumbs", "preview"}, set())
        for spent in (access, trail, preview):
            spent.assert_not_called()

    def test_each_named_expansion_is_built_and_published(self):
        for name, key in (("access", "access"), ("breadcrumbs", "breadcrumbs"), ("preview", "preview")):
            with self.subTest(expansion=name):
                answer, _ = self.answer_for(name)
                self.assertIn(key, answer)
                self.assertEqual(set(answer) & {"access", "breadcrumbs", "preview"}, {key})

    def test_all_three_arrive_together_when_all_three_are_named(self):
        answer, _ = self.answer_for("access,breadcrumbs,preview")
        self.assertEqual(answer["access"], {"role": 40})
        self.assertEqual(answer["breadcrumbs"], [{"name": "r1"}])
        self.assertEqual(answer["preview"], {"url": "/f/x"})


class TestPageEnvelope(BoundaryCase):
    """§11.4: rows, and an opaque cursor that is null on the last page."""

    def page_for(self, next_cursor):
        result = {"rows": [], "next_cursor": next_cursor, "parent": frappe._dict({"name": "f1"})}
        with patch.object(routes.node_core, "children", return_value=result) as listed:
            return routes.node_children(node="f1", limit="10", cursor="b2Zmc2V0OjEw"), listed

    def test_the_cursor_is_carried_through_and_the_page_is_two_keys(self):
        answer, listed = self.page_for("b2Zmc2V0OjIw")
        self.assertEqual(answer, {"rows": [], "next_cursor": "b2Zmc2V0OjIw"})
        self.assertEqual(listed.call_args.kwargs["cursor"], "b2Zmc2V0OjEw")
        self.assertEqual(listed.call_args.kwargs["limit"], 10)

    def test_the_last_page_carries_a_null_cursor(self):
        answer, _ = self.page_for(None)
        self.assertIsNone(answer["next_cursor"])

    def test_an_empty_cursor_is_the_first_page_not_a_malformed_one(self):
        result = {"rows": [], "next_cursor": None, "parent": frappe._dict({"name": "f1"})}
        with patch.object(routes.node_core, "children", return_value=result) as listed:
            routes.node_children(node="f1", cursor="")
        self.assertIsNone(listed.call_args.kwargs["cursor"])


class TestContentAnswer(BoundaryCase):
    """§11.2: a file redirects, a document streams, nothing else has bytes."""

    def test_a_file_redirects_to_the_minted_signed_url(self):
        row = frappe._dict({"name": "n1", "kind": "file", "title": "report.bin"})
        with patch.object(routes.node_core, "get", return_value=row):
            with patch.object(
                routes.node_core, "signed_content_url", return_value={"url": "/f/b/report.bin?e=1&s=x"}
            ) as minted:
                answer = routes.node_get_content(node="n1")
        minted.assert_called_once_with(row)
        self.assertEqual(answer.status_code, 302)
        self.assertEqual(answer.headers["Location"], "/f/b/report.bin?e=1&s=x")
        self.assertEqual(answer.headers["Cache-Control"], "private, no-store")

    def test_a_document_streams_under_the_name_the_app_gave_it(self):
        row = frappe._dict({"name": "n1", "kind": "document"})
        with patch.object(routes.node_core, "get", return_value=row):
            with patch.object(
                routes.content, "export_document", return_value=(io.BytesIO(b"body"), "text/html", "Q3.html")
            ):
                answer = routes.node_get_content(node="n1", format="html")
        self.assertEqual(answer.mimetype, "text/html")
        self.assertEqual(answer.headers["Content-Disposition"], "attachment; filename=Q3.html")

    def test_a_folder_has_no_content_to_send(self):
        row = frappe._dict({"name": "n1", "kind": "folder"})
        with patch.object(routes.node_core, "get", return_value=row):
            with self.assertRaises(DriveConflict):
                routes.node_get_content(node="n1")

    def test_a_title_wsgi_cannot_encode_is_carried_in_filename_star(self):
        # A WSGI header is latin-1. Werkzeug quotes a filename but does not
        # encode one, so a Cyrillic title kills the response after the status
        # line unless RFC 5987 carries it.
        names = routes._disposition_names("Отчёт.html")
        self.assertEqual(names["filename*"], "UTF-8''%D0%9E%D1%82%D1%87%D1%91%D1%82.html")
        names["filename"].encode("latin-1")

    def test_a_title_holding_a_newline_never_reaches_a_header(self):
        # Werkzeug raises ValueError on a header newline, and ValueError is not
        # a frappe.ValidationError, so it would escape the §11.6 mapping.
        self.assertEqual(routes._disposition_names("a\nb.html"), {"filename": "ab.html"})

    def test_a_title_with_nothing_printable_still_names_the_download(self):
        self.assertEqual(routes._disposition_names("\n\t"), {"filename": "download"})


class TestChunkBody(BoundaryCase):
    def request_with(self, body, cached=False):
        builder = EnvironBuilder(
            path="/api/suite/drive/uploads/u1/chunk", method="PUT", input_stream=None, data=body
        )
        request = Request(builder.get_environ())
        if cached:
            request.get_data(cache=True)
        frappe.local.request = request
        self.addCleanup(setattr, frappe.local, "request", None)
        return request

    def test_a_streamed_body_is_read_one_byte_past_the_limit(self):
        self.request_with(b"x" * 64)
        self.assertEqual(routes._chunk_bytes(), b"x" * 64)

    def test_a_body_the_framework_already_read_is_reused(self):
        self.request_with(b"cached bytes", cached=True)
        self.assertEqual(routes._chunk_bytes(), b"cached bytes")

    def test_no_more_than_the_limit_plus_one_is_ever_buffered(self):
        limit = routes.upload_core.MAX_CHUNK_BYTES
        with patch.object(routes.upload_core, "MAX_CHUNK_BYTES", 16):
            self.request_with(b"y" * 64)
            self.assertEqual(len(routes._chunk_bytes()), 17)
        self.assertEqual(routes.upload_core.MAX_CHUNK_BYTES, limit)

    def test_an_oversized_chunk_is_refused_as_a_bad_request(self):
        with patch.object(routes.upload_core, "MAX_CHUNK_BYTES", 16):
            self.request_with(b"y" * 64)
            with patch.object(routes.upload_core, "authorize_chunk", return_value={"parent": "f1"}):
                with self.assertRaises(DriveError) as caught:
                    routes.upload_chunk(upload_id="u1", offset="0")
        self.assertEqual(caught.exception.http_status_code, 400)

    def test_the_session_is_authorized_before_the_body_is_read(self):
        # Python evaluates every argument first, so a body read written inline
        # in the call to `upload_chunk` would buffer 16 MiB for a session that
        # does not exist. The refusal has to arrive before the read.
        request = self.request_with(b"z" * 64)
        with patch.object(
            routes.upload_core, "authorize_chunk", side_effect=DriveNotFound("no such session")
        ) as authorize:
            with self.assertRaises(DriveNotFound):
                routes.upload_chunk(upload_id="u1", offset="0")
        authorize.assert_called_once()
        self.assertNotIn("_cached_data", request.__dict__)
        self.assertEqual(request.stream.read(4), b"zzzz")

    def test_the_coerced_offset_is_the_one_storage_is_given(self):
        # `?offset=` is the only argument that says where the bytes land.
        self.request_with(b"payload")
        with patch.object(routes.upload_core, "authorize_chunk", return_value={"parent": "f1"}):
            with patch.object(routes.upload_core, "upload_chunk", return_value={}) as written:
                routes.upload_chunk(upload_id="u1", offset="4096")
        self.assertEqual(written.call_args.args[1:], ("u1", 4096, b"payload"))


if __name__ == "__main__":
    unittest.main()
