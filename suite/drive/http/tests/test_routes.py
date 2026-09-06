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


class TestGrantRoutes(BoundaryCase):
    """§5.8 to §5.11 at the boundary: what is asked, and what comes back."""

    def test_no_named_principal_asks_for_no_explanation(self):
        listed = {"grants": [{"name": "g1", "node": "n1", "principal": "a@example.com", "role": 40}]}
        with patch.object(routes.access, "grants_for", return_value=listed) as workflow:
            with patch.object(routes.framework, "principals_for_principal") as resolved:
                answer = routes.node_grants(node="n1")
        self.assertIsNone(workflow.call_args.kwargs["subject"])
        resolved.assert_not_called()
        self.assertEqual(set(answer), {"grants"})

    def test_a_named_principal_is_resolved_and_its_explanation_is_published(self):
        subject = Principals(user="b@example.com", own=("b@example.com",), open=(), is_admin=False)
        listed = {"grants": [], "explain": {"role": 40, "source": "grant", "rows": []}}
        with patch.object(routes.access, "grants_for", return_value=listed) as workflow:
            with patch.object(routes.framework, "principals_for_principal", return_value=subject) as resolved:
                answer = routes.node_grants(node="n1", principal="b@example.com")
        resolved.assert_called_once_with("b@example.com")
        self.assertIs(workflow.call_args.kwargs["subject"], subject)
        self.assertEqual(answer["explain"], {"role": 40, "source": "grant", "rows": []})

    def test_a_published_grant_row_never_carries_the_stored_password(self):
        # §11.2 publishes `has_password`, which says a password exists. The
        # hash itself is what the link is unlocked against.
        row = {
            "name": "g1",
            "node": "n1",
            "principal": "$LINK:tok",
            "role": 20,
            "has_password": 1,
            "password_hash": "$2b$12$secret",
        }
        with patch.object(routes.access, "grants_for", return_value={"grants": [row]}):
            answer = routes.node_grants(node="n1")
        self.assertNotIn("password_hash", answer["grants"][0])
        self.assertTrue(answer["grants"][0]["has_password"])

    def test_a_grant_without_a_role_writes_nothing(self):
        with patch.object(routes.access, "grant") as workflow:
            with self.assertRaises(DriveError) as caught:
                routes.node_put_grant(node="n1", principal="b@example.com")
        self.assertEqual(caught.exception.http_status_code, 400)
        workflow.assert_not_called()

    def test_role_zero_reaches_the_workflow_as_zero_and_not_as_an_absent_role(self):
        # §5.9: `role: 0` is the explicit deny, and it is the only way to
        # write one. Treating it as absent would erase the gesture.
        with patch.object(routes.access, "grant", return_value={"name": "g1", "role": 0}) as workflow:
            routes.node_put_grant(node="n1", principal="b@example.com", role=0)
        self.assertEqual(workflow.call_args.args[:3], ("n1", "b@example.com", 0))
        self.assertIs(workflow.call_args.args[3], SOMEONE)

    def test_the_role_and_the_principal_are_forwarded_as_they_arrived(self):
        with patch.object(routes.access, "grant", return_value={"name": "g1"}) as workflow:
            routes.node_put_grant(node="n1", principal="$PUBLIC", role="10", expires_on="2026-10-01")
        self.assertEqual(workflow.call_args.args[:3], ("n1", "$PUBLIC", 10))
        self.assertEqual(workflow.call_args.kwargs["expires_on"], "2026-10-01")

    def test_a_link_url_is_published_beside_the_row_only_when_one_was_minted(self):
        minted = {"name": "g1", "node": "n1", "principal": "$LINK:tok", "role": 20, "url": "/drive/l/tok"}
        with patch.object(routes.access, "grant", return_value=minted):
            answer = routes.node_put_grant(node="n1", principal="$LINK", role=20)
        self.assertEqual(set(answer), {"grant", "url"})
        self.assertEqual(answer["url"], "/drive/l/tok")
        with patch.object(routes.access, "grant", return_value={"name": "g2", "role": 40}):
            answer = routes.node_put_grant(node="n1", principal="b@example.com", role=40)
        self.assertEqual(set(answer), {"grant"})

    def test_a_delete_without_below_removes_the_local_row_alone(self):
        with patch.object(routes.access, "revoke") as revoke:
            with patch.object(routes.access, "revoke_below") as evict:
                answer = routes.node_delete_grant(node="n1", principal="b@example.com")
        revoke.assert_called_once_with("n1", "b@example.com", SOMEONE)
        evict.assert_not_called()
        self.assertEqual(answer, {"result": "revoked"})

    def test_below_evicts_the_subtree_and_reports_the_row_count(self):
        with patch.object(routes.access, "revoke") as revoke:
            with patch.object(routes.access, "revoke_below", return_value=7) as evict:
                answer = routes.node_delete_grant(node="n1", principal="b@example.com", below="1")
        evict.assert_called_once_with("n1", "b@example.com", SOMEONE)
        revoke.assert_not_called()
        self.assertEqual(answer, {"result": "revoked", "rows": 7})

    def test_a_delete_never_writes_a_deny(self):
        # §5.10 keeps removal and denial apart. Only PUT with `role: 0` denies,
        # so this route may not reach the grant workflow on either path.
        with patch.object(routes.access, "grant") as write:
            with patch.object(routes.access, "revoke"):
                routes.node_delete_grant(node="n1", principal="$PUBLIC")
            with patch.object(routes.access, "revoke_below", return_value=3):
                routes.node_delete_grant(node="n1", principal="$PUBLIC", below="1")
        write.assert_not_called()

    def test_rotation_addresses_the_grant_row_and_forwards_its_id(self):
        # §5.11: the address is the `Drive Grant` id. Naming the old token
        # would put the secret being replaced into the access log.
        rotated = {"name": "g1", "node": "n1", "principal": "$LINK:new", "url": "/drive/l/new"}
        with patch.object(routes.access, "rotate_link", return_value=rotated) as workflow:
            answer = routes.grant_rotate(grant="g1")
        workflow.assert_called_once_with("g1", SOMEONE)
        self.assertEqual(answer["url"], "/drive/l/new")

    def test_a_blank_grant_id_rotates_nothing(self):
        with patch.object(routes.access, "rotate_link") as workflow:
            with self.assertRaises(DriveError) as caught:
                routes.grant_rotate(grant="   ")
        self.assertEqual(caught.exception.http_status_code, 400)
        workflow.assert_not_called()

    def test_a_locked_out_token_keeps_its_own_class_and_status(self):
        # §6.3 locks a token out for fifteen minutes after five wrong
        # passwords. Flattening that to 400 would hide it among bad arguments.
        with patch.object(
            routes.access, "unlock_link", side_effect=frappe.RateLimitExceededError("locked out")
        ):
            with self.assertRaises(frappe.RateLimitExceededError) as caught:
                routes.link_unlock(token="tok", password="secret")
        self.assertIs(type(caught.exception), frappe.RateLimitExceededError)
        self.assertEqual(caught.exception.http_status_code, 429)

    def test_a_locked_link_still_answers_401_from_the_unlock_route(self):
        with patch.object(routes.access, "unlock_link", side_effect=DriveLocked("locked")):
            with self.assertRaises(DriveLocked) as caught:
                routes.link_unlock(token="tok", password="secret")
        self.assertEqual(caught.exception.http_status_code, 401)

    def test_an_unlock_without_a_password_never_reaches_the_workflow(self):
        with patch.object(routes.access, "unlock_link") as workflow:
            with self.assertRaises(DriveError) as caught:
                routes.link_unlock(token="tok")
        self.assertEqual(caught.exception.http_status_code, 400)
        workflow.assert_not_called()


class TestViewRoutes(BoundaryCase):
    """§11.2's seven frozen views: one filter set each, and one expansion."""

    def setUp(self):
        super().setUp()
        self.row = frappe._dict({"name": "n1", "title": "t", "kind": "file", "root": "r1"})
        self.views = patch.object(
            routes.node_core, "views", return_value={"rows": [self.row], "next_cursor": None}
        )
        self.workflow = self.views.start()
        self.addCleanup(self.views.stop)
        self.previews = patch.object(
            routes.previews, "preview_expansions", return_value={"n1": {"url": "/f/x", "expires": 99}}
        )
        self.minted = self.previews.start()
        self.addCleanup(self.previews.stop)

    def test_preview_is_minted_once_for_the_page_and_attached_to_each_row(self):
        answer = routes.view_list(view="recents", expand="preview")
        self.minted.assert_called_once_with(["n1"])
        self.assertEqual(answer["rows"][0]["preview"], {"url": "/f/x", "expires": 99})

    def test_a_view_refuses_the_two_expansions_it_cannot_answer(self):
        for name in ("access", "breadcrumbs"):
            with self.subTest(expansion=name):
                with self.assertRaises(DriveError) as caught:
                    routes.view_list(view="recents", expand=name)
                self.assertEqual(caught.exception.http_status_code, 400)
        self.workflow.assert_not_called()
        self.minted.assert_not_called()

    def test_an_unknown_expansion_is_a_bad_request(self):
        with self.assertRaises(DriveError) as caught:
            routes.view_list(view="recents", expand="grants")
        self.assertEqual(caught.exception.http_status_code, 400)
        self.workflow.assert_not_called()

    def test_archived_roots_rows_are_root_metadata_and_never_node_shapes(self):
        # §5.5 answers root rows here, so a node shape would drop the archive
        # state and the quota counters the view exists to show.
        root = frappe._dict({"name": "r1", "state": "Archived", "quota_bytes": 10, "used_bytes": 4})
        self.workflow.return_value = {"rows": [root], "next_cursor": None}
        with patch.object(routes.shapes, "node_shape") as shaped:
            answer = routes.view_list(view="archived-roots")
        shaped.assert_not_called()
        self.assertEqual(answer["rows"], [dict(root)])

    def test_each_view_is_given_only_the_filters_it_declares(self):
        expected = (
            ("trash", {"root": "r1"}),
            ("templates", {"content_doctype": "Presentation"}),
            ("search", {"term": "budget"}),
            ("shared", {}),
            ("recents", {}),
            ("favourites", {}),
            ("archived-roots", {}),
        )
        for name, filters in expected:
            with self.subTest(view=name):
                routes.view_list(view=name, root="r1", content_doctype="Presentation", term="budget")
                passed = dict(self.workflow.call_args.kwargs)
                passed.pop("cursor")
                passed.pop("limit")
                self.assertEqual(passed, filters)

    def test_trash_without_a_root_and_search_without_a_term_page_nothing(self):
        for kwargs in ({"view": "trash"}, {"view": "search"}):
            with self.subTest(kwargs=kwargs):
                with self.assertRaises(DriveError) as caught:
                    routes.view_list(**kwargs)
                self.assertEqual(caught.exception.http_status_code, 400)
        self.workflow.assert_not_called()

    def test_clearing_recents_without_naming_nodes_clears_them_all(self):
        with patch.object(routes.activity_core, "clear_recents", return_value=12) as workflow:
            answer = routes.view_clear_recents()
        self.assertEqual(workflow.call_args.args, (SOMEONE, None))
        self.assertEqual(answer, {"cleared": 12})

    def test_naming_nodes_clears_only_the_coerced_list(self):
        with patch.object(routes.activity_core, "clear_recents", return_value=2) as workflow:
            answer = routes.view_clear_recents(nodes=["n1", "n2", "n1"])
        self.assertEqual(workflow.call_args.args, (SOMEONE, ("n1", "n2")))
        self.assertEqual(answer, {"cleared": 2})


class TestVersionRoutes(BoundaryCase):
    """§9.1 at the boundary: a sequence names a version, and zero names none."""

    def test_a_version_page_is_two_keys_and_carries_the_cursor(self):
        row = frappe._dict({"name": "v1", "node": "n1", "seq": 3, "kind": "auto", "size": 10})
        result = {"rows": [row], "next_cursor": "b2Zmc2V0OjIw"}
        with patch.object(routes.versions, "list_versions", return_value=result) as workflow:
            answer = routes.node_versions(node="n1", limit="10", cursor="b2Zmc2V0OjEw")
        self.assertEqual(set(answer), {"rows", "next_cursor"})
        self.assertEqual(answer["next_cursor"], "b2Zmc2V0OjIw")
        self.assertEqual(answer["rows"][0]["seq"], 3)
        self.assertEqual(workflow.call_args.kwargs["cursor"], "b2Zmc2V0OjEw")
        self.assertEqual(workflow.call_args.kwargs["limit"], 10)

    def test_an_unnamed_version_kind_is_an_automatic_one(self):
        with patch.object(routes.versions, "take_version", return_value=4) as workflow:
            answer = routes.node_version_create(node="n1")
        self.assertEqual(workflow.call_args.kwargs["kind"], "auto")
        self.assertIsNone(workflow.call_args.kwargs["label"])
        self.assertEqual(answer, {"seq": 4})

    def test_a_named_kind_and_label_reach_the_workflow_as_they_arrived(self):
        with patch.object(routes.versions, "take_version", return_value=5) as workflow:
            answer = routes.node_version_create(node="n1", kind="milestone", label="Q3 sign-off")
        self.assertEqual(workflow.call_args.kwargs["kind"], "milestone")
        self.assertEqual(workflow.call_args.kwargs["label"], "Q3 sign-off")
        self.assertEqual(answer, {"seq": 5})

    def test_a_label_and_a_pin_are_forwarded_and_the_pin_is_published_as_an_int(self):
        with patch.object(routes.versions, "label_version") as workflow:
            answer = routes.node_version_patch(node="n1", seq="3", label="Q3", pinned="1")
        self.assertEqual(workflow.call_args.args[1:], ("n1", 3))
        self.assertEqual(workflow.call_args.kwargs, {"label": "Q3", "pinned": True})
        self.assertEqual(answer, {"label": "Q3", "pinned": 1})
        self.assertIs(type(answer["pinned"]), int)

    def test_deleting_a_version_answers_an_empty_body(self):
        with patch.object(routes.versions, "delete_version") as workflow:
            answer = routes.node_version_delete(node="n1", seq="2")
        self.assertEqual(workflow.call_args.args[1:], ("n1", 2))
        self.assertEqual(answer, {})

    def test_version_bytes_redirect_to_the_minted_signature_and_are_never_cached(self):
        with patch.object(routes.versions, "version_content_url", return_value={"url": "/f/b/v.bin?e=1&s=x"}):
            answer = routes.node_version_content(node="n1", seq="2")
        self.assertEqual(answer.status_code, 302)
        self.assertEqual(answer.headers["Location"], "/f/b/v.bin?e=1&s=x")
        self.assertEqual(answer.headers["Cache-Control"], "private, no-store")

    def test_a_restore_publishes_the_version_it_took_first(self):
        # §9.1: restore captures the current state before it writes, and that
        # capture is the sequence a client needs to undo the restore.
        with patch.object(routes.versions, "restore_version", return_value=9) as workflow:
            answer = routes.node_version_restore(node="n1", seq="3")
        self.assertEqual(workflow.call_args.args[1:], ("n1", 3))
        self.assertEqual(answer, {"seq": 9})

    def test_sequence_zero_and_an_absent_sequence_name_no_version(self):
        # A sequence starts at 1, so 0 is a malformed address rather than the
        # first version.
        addressed = (
            (routes.node_version_patch, "label_version"),
            (routes.node_version_delete, "delete_version"),
            (routes.node_version_content, "version_content_url"),
            (routes.node_version_restore, "restore_version"),
        )
        for handler, name in addressed:
            for seq in ("0", None):
                with self.subTest(call=handler.__name__, seq=seq):
                    with patch.object(routes.versions, name) as workflow:
                        with self.assertRaises(DriveError) as caught:
                            handler(node="n1", seq=seq)
                    self.assertEqual(caught.exception.http_status_code, 400)
                    workflow.assert_not_called()


class TestRecordRoutes(BoundaryCase):
    """§9.3 to §9.5: threads, comments, history, and the caller's own lists."""

    def test_an_absent_resolved_filter_is_a_different_question_from_false(self):
        # `resolved=None` lists every thread. `resolved=false` lists the open
        # ones. An unasked filter must not become the second question.
        for asked, forwarded in ((None, None), ("false", False), ("true", True)):
            with self.subTest(resolved=asked):
                with patch.object(routes.comments, "threads", return_value=[]) as workflow:
                    routes.node_threads(node="n1", resolved=asked)
                self.assertIs(workflow.call_args.kwargs["resolved"], forwarded)

    def test_a_new_thread_publishes_the_pair_the_workflow_returned(self):
        written = {"thread": "t1", "comment": "c1"}
        with patch.object(routes.comments, "create_thread", return_value=written) as workflow:
            answer = routes.node_thread_create(node="n1", anchor="a1", text="hello")
        self.assertEqual(answer, written)
        self.assertEqual(workflow.call_args.args[1:], ("n1", "a1", "hello"))

    def test_a_reply_publishes_only_the_comment_id_the_workflow_minted(self):
        with patch.object(routes.comments, "reply", return_value="c2") as workflow:
            answer = routes.thread_comment_create(thread="t1", text="second", author_name="Ada")
        self.assertEqual(answer, {"comment": "c2"})
        self.assertEqual(workflow.call_args.args[1:], ("t1", "second"))
        self.assertEqual(workflow.call_args.kwargs["author_name"], "Ada")

    def test_a_reply_with_no_text_appends_nothing(self):
        with patch.object(routes.comments, "reply") as workflow:
            with self.assertRaises(DriveError) as caught:
                routes.thread_comment_create(thread="t1", text="   ")
        self.assertEqual(caught.exception.http_status_code, 400)
        workflow.assert_not_called()

    def test_resolving_a_thread_without_saying_which_way_writes_nothing(self):
        with patch.object(routes.comments, "resolve") as workflow:
            with self.assertRaises(DriveError) as caught:
                routes.thread_patch(thread="t1")
        self.assertEqual(caught.exception.http_status_code, 400)
        workflow.assert_not_called()

    def test_a_blank_comment_id_edits_nothing_and_deletes_nothing(self):
        addressed = (
            (routes.comment_patch, "edit_comment", {"comment": "  ", "text": "new"}),
            (routes.comment_delete, "delete_comment", {"comment": "  "}),
        )
        for handler, name, kwargs in addressed:
            with self.subTest(call=handler.__name__):
                with patch.object(routes.comments, name) as workflow:
                    with self.assertRaises(DriveError) as caught:
                        handler(**kwargs)
                self.assertEqual(caught.exception.http_status_code, 400)
                workflow.assert_not_called()

    def test_an_activity_page_is_two_keys_and_carries_the_cursor(self):
        row = frappe._dict({"name": "h1", "node": "n1", "action": "edit", "actor": "a@example.com"})
        result = {"rows": [row], "next_cursor": "b2Zmc2V0OjYw"}
        with patch.object(routes.activity_core, "history", return_value=result) as workflow:
            answer = routes.node_activity(node="n1", cursor="b2Zmc2V0OjAw")
        self.assertEqual(set(answer), {"rows", "next_cursor"})
        self.assertEqual(answer["next_cursor"], "b2Zmc2V0OjYw")
        self.assertEqual(answer["rows"][0]["action"], "edit")
        self.assertEqual(workflow.call_args.kwargs["cursor"], "b2Zmc2V0OjAw")

    def test_a_notification_page_is_two_keys_and_carries_the_cursor(self):
        row = frappe._dict({"name": "p1", "read": 0, "activity": {"name": "h1", "action": "comment"}})
        result = {"rows": [row], "next_cursor": None}
        with patch.object(routes.activity_core, "notifications", return_value=result) as workflow:
            answer = routes.notifications_list(cursor="b2Zmc2V0OjAw", unread="1")
        self.assertEqual(set(answer), {"rows", "next_cursor"})
        self.assertIsNone(answer["next_cursor"])
        self.assertEqual(answer["rows"][0]["activity"]["action"], "comment")
        self.assertEqual(workflow.call_args.kwargs["cursor"], "b2Zmc2V0OjAw")
        self.assertTrue(workflow.call_args.kwargs["only_unread"])

    def test_marking_read_needs_either_a_list_or_the_all_flag(self):
        with patch.object(routes.activity_core, "mark_read") as workflow:
            with self.assertRaises(DriveError) as caught:
                routes.notifications_read()
        self.assertEqual(caught.exception.http_status_code, 400)
        workflow.assert_not_called()

    def test_an_empty_list_marks_nothing_and_is_not_the_all_flag(self):
        # Clearing an already empty badge is the answer 0, never a refusal.
        with patch.object(routes.activity_core, "mark_read", return_value=0) as workflow:
            answer = routes.notifications_read(notifications=[])
        self.assertEqual(workflow.call_args.args, (SOMEONE, ()))
        self.assertEqual(answer, {"read": 0})

    def test_the_all_flag_names_no_notification(self):
        with patch.object(routes.activity_core, "mark_read", return_value=8) as workflow:
            answer = routes.notifications_read(all="1")
        self.assertEqual(workflow.call_args.args, (SOMEONE, None))
        self.assertEqual(answer, {"read": 8})

    def test_a_visit_forwards_the_caller_s_own_principals(self):
        with patch.object(routes.activity_core, "visit") as workflow:
            answer = routes.node_visit(node="n1")
        self.assertEqual(workflow.call_args.args, (SOMEONE, "n1"))
        self.assertEqual(answer, {})

    def test_a_star_and_an_unstar_are_the_same_call_with_the_two_values(self):
        for handler, value in ((routes.node_put_favourite, True), (routes.node_delete_favourite, False)):
            with self.subTest(call=handler.__name__):
                with patch.object(routes.activity_core, "set_favourite") as workflow:
                    answer = handler(node="n1")
                self.assertEqual(workflow.call_args.args, (SOMEONE, "n1", value))
                self.assertEqual(answer, {})


if __name__ == "__main__":
    unittest.main()
