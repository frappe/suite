"""The route boundary: what a refusal becomes, and what a handler will not do.

These run with the `_core` workflows stubbed, because the subject is the
boundary itself - the mapping in §11.6, the savepoint isolation in §11.5, and
the bound on a streamed chunk. The workflows have their own tests, and
`test_dispatch` proves the two meet over real HTTP.
"""

import unittest
from unittest.mock import MagicMock, patch

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
        for call, kwargs in (
            (routes.node_get, {"node": None}),
            (routes.node_get, {"node": "n1", "expand": "grants"}),
            (routes.node_children, {"node": "n1", "limit": "-3"}),
            (routes.node_batch, {"nodes": [], "patch": {"title": "a"}}),
            (routes.node_batch, {"nodes": ["n1"], "patch": {"blob": "x"}}),
            (routes.node_preview, {"node": "n1", "image": "not base64!", "mime": "image/png"}),
            (routes.upload_create, {"parent": "f1", "filename": "", "size": 1}),
        ):
            with self.subTest(call=call.__name__, kwargs=kwargs):
                with self.assertRaises(DriveError) as caught:
                    call(**kwargs)
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

    def test_a_repeated_node_is_touched_once(self):
        with patch.object(routes.node_core, "update", return_value=frappe._dict({"name": "a"})) as update:
            answer = routes.node_batch(nodes=["a", "a", "a"], patch={"title": "t"})
        self.assertEqual(update.call_count, 1)
        self.assertEqual(answer["ok"], ["a"])


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
            with self.assertRaises(DriveError) as caught:
                routes.upload_chunk(upload_id="u1", offset="0")
        self.assertEqual(caught.exception.http_status_code, 400)


if __name__ == "__main__":
    unittest.main()
