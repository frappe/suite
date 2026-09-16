"""Prove the rewrite on real werkzeug requests, with no site and no database.

Every case here builds an actual WSGI environ and runs the `before_request`
hook against it. Nothing is stubbed except `frappe.local`, because the two
things under test - what `API_URL_MAP.bind_to_environ` will match, and what
`get_api_version` will read - are properties of a real request object.
"""

import unittest

import frappe
from frappe.tests import UnitTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite.drive.http import routes, translator
from suite.drive.http.tests import ensure_local_context


def setUpModule():
    ensure_local_context()


V2 = "/api/v2/method/suite.drive.http.routes."

# The Guest column of §11.2, stated once. A route that a share-link holder
# reaches is heard from a caller with no session, because a link is presented
# by a Guest. A route that only an owner or a Suite Admin reaches is not.
GUEST_ROUTES = frozenset(
    {
        "node_create",
        "node_get",
        "node_patch",
        "node_children",
        "node_copy",
        "node_batch",
        "node_put_content",
        "node_get_content",
        "node_media",
        "node_preview",
        "node_activity",
        "upload_create",
        "upload_chunk",
        "upload_finish",
        "link_unlock",
        "node_versions",
        "node_version_create",
        "node_version_patch",
        "node_version_content",
        "node_version_restore",
        "node_threads",
        "node_thread_create",
        "thread_patch",
        "thread_comment_create",
        "comment_patch",
        "comment_delete",
        "unknown",
    }
)
# Three reasons a row is not heard without a session, and no fourth.
#
# MANAGE, which no open principal reaches: a link caps at EDIT and `$PUBLIC` at
# READ (§5.9), so the grant routes, the version delete, and the root routes can
# only ever refuse a Guest - after telling them the node exists.
#
# A personal record, which is keyed on the caller's email (§9.5). `Guest` is
# one email for every anonymous visitor on the site, so a Guest recents list, a
# Guest star, and a Guest inbox are all one shared list.
#
# A view, which is answered from the caller's own principals or from those same
# personal lists (§5.4-5.7). A Guest has neither.
SESSION_ONLY_ROUTES = frozenset(
    {
        "node_purge",
        "node_grants",
        "node_put_grant",
        "node_delete_grant",
        "grant_rotate",
        "node_version_delete",
        "node_visit",
        "node_put_favourite",
        "node_delete_favourite",
        "view_list",
        "view_clear_recents",
        "notifications_list",
        "notifications_read",
        "root_usage",
        "root_patch",
        "root_purge",
    }
)


def translate(path, method="GET", form=None):
    """Run the hook over one request, and report what it did."""
    builder = EnvironBuilder(path=path, method=method)
    request = Request(builder.get_environ())
    frappe.local.request = request
    frappe.local.form_dict = frappe._dict(form or {})
    try:
        translator.handle_before_request()
        return request, frappe.local.form_dict
    finally:
        frappe.local.request = None
        frappe.local.form_dict = frappe._dict()


def handler_of(request):
    """Name the handler a translated request now addresses, or None."""
    if not request.path.startswith(V2):
        return None
    return request.path[len(V2) :]


class TestTranslator(UnitTestCase):
    def test_every_table_row_reaches_its_handler_with_its_path_ids(self):
        cases = (
            ("POST", "/api/suite/drive/nodes", "node_create", {}),
            ("POST", "/api/suite/drive/nodes/batch", "node_batch", {}),
            ("GET", "/api/suite/drive/nodes/n1", "node_get", {"node": "n1"}),
            ("PATCH", "/api/suite/drive/nodes/n1", "node_patch", {"node": "n1"}),
            ("DELETE", "/api/suite/drive/nodes/n1", "node_purge", {"node": "n1"}),
            ("GET", "/api/suite/drive/nodes/n1/children", "node_children", {"node": "n1"}),
            ("POST", "/api/suite/drive/nodes/n1/copy", "node_copy", {"node": "n1"}),
            ("PUT", "/api/suite/drive/nodes/n1/content", "node_put_content", {"node": "n1"}),
            ("GET", "/api/suite/drive/nodes/n1/content", "node_get_content", {"node": "n1"}),
            ("GET", "/api/suite/drive/nodes/n1/media", "node_media", {"node": "n1"}),
            ("POST", "/api/suite/drive/nodes/n1/preview", "node_preview", {"node": "n1"}),
            ("POST", "/api/suite/drive/uploads", "upload_create", {}),
            ("PUT", "/api/suite/drive/uploads/u1/chunk", "upload_chunk", {"upload_id": "u1"}),
            ("POST", "/api/suite/drive/uploads/u1/finish", "upload_finish", {"upload_id": "u1"}),
            ("GET", "/api/suite/drive/nodes/n1/activity", "node_activity", {"node": "n1"}),
            ("POST", "/api/suite/drive/nodes/n1/visit", "node_visit", {"node": "n1"}),
            ("PUT", "/api/suite/drive/nodes/n1/favourite", "node_put_favourite", {"node": "n1"}),
            ("DELETE", "/api/suite/drive/nodes/n1/favourite", "node_delete_favourite", {"node": "n1"}),
            ("GET", "/api/suite/drive/nodes/n1/grants", "node_grants", {"node": "n1"}),
            (
                "PUT",
                "/api/suite/drive/nodes/n1/grants/$PUBLIC",
                "node_put_grant",
                {"node": "n1", "principal": "$PUBLIC"},
            ),
            (
                "DELETE",
                "/api/suite/drive/nodes/n1/grants/a@example.com",
                "node_delete_grant",
                {"node": "n1", "principal": "a@example.com"},
            ),
            ("POST", "/api/suite/drive/grants/g1/rotate", "grant_rotate", {"grant": "g1"}),
            ("POST", "/api/suite/drive/links/t1/unlock", "link_unlock", {"token": "t1"}),
            ("DELETE", "/api/suite/drive/views/recents", "view_clear_recents", {}),
            ("GET", "/api/suite/drive/views/shared", "view_list", {"view": "shared"}),
            ("GET", "/api/suite/drive/nodes/n1/versions", "node_versions", {"node": "n1"}),
            ("POST", "/api/suite/drive/nodes/n1/versions", "node_version_create", {"node": "n1"}),
            (
                "PATCH",
                "/api/suite/drive/nodes/n1/versions/3",
                "node_version_patch",
                {"node": "n1", "seq": "3"},
            ),
            (
                "DELETE",
                "/api/suite/drive/nodes/n1/versions/3",
                "node_version_delete",
                {"node": "n1", "seq": "3"},
            ),
            (
                "GET",
                "/api/suite/drive/nodes/n1/versions/3/content",
                "node_version_content",
                {"node": "n1", "seq": "3"},
            ),
            (
                "POST",
                "/api/suite/drive/nodes/n1/versions/3/restore",
                "node_version_restore",
                {"node": "n1", "seq": "3"},
            ),
            ("GET", "/api/suite/drive/nodes/n1/threads", "node_threads", {"node": "n1"}),
            ("POST", "/api/suite/drive/nodes/n1/threads", "node_thread_create", {"node": "n1"}),
            ("PATCH", "/api/suite/drive/threads/t9", "thread_patch", {"thread": "t9"}),
            (
                "POST",
                "/api/suite/drive/threads/t9/comments",
                "thread_comment_create",
                {"thread": "t9"},
            ),
            ("PATCH", "/api/suite/drive/comments/c9", "comment_patch", {"comment": "c9"}),
            ("DELETE", "/api/suite/drive/comments/c9", "comment_delete", {"comment": "c9"}),
            ("GET", "/api/suite/drive/notifications", "notifications_list", {}),
            ("POST", "/api/suite/drive/notifications/read", "notifications_read", {}),
            ("GET", "/api/suite/drive/roots/r1/usage", "root_usage", {"root": "r1"}),
            ("PATCH", "/api/suite/drive/roots/r1", "root_patch", {"root": "r1"}),
            ("DELETE", "/api/suite/drive/roots/r1", "root_purge", {"root": "r1"}),
        )
        self.assertEqual(len(cases), len(translator.ROUTES))
        for method, path, expected, ids in cases:
            with self.subTest(path=path, method=method):
                request, form = translate(path, method)
                self.assertEqual(handler_of(request), expected)
                for key, value in ids.items():
                    self.assertEqual(form[key], value)

    def test_both_the_environ_and_the_request_attribute_are_rewritten(self):
        request, _form = translate("/api/suite/drive/nodes/n1")
        target = V2 + "node_get"
        self.assertEqual(request.environ["PATH_INFO"], target)
        self.assertEqual(request.path, target)

    def test_cached_url_properties_are_recomputed_after_the_rewrite(self):
        builder = EnvironBuilder(path="/api/suite/drive/nodes/n1?expand=access")
        request = Request(builder.get_environ())
        # Read them first, so the rewrite has to invalidate a populated cache.
        self.assertTrue(request.full_path.startswith("/api/suite/drive/"))
        self.assertIn("/api/suite/drive/", request.url)
        frappe.local.request = request
        frappe.local.form_dict = frappe._dict()
        try:
            translator.handle_before_request()
        finally:
            frappe.local.request = None
            frappe.local.form_dict = frappe._dict()
        self.assertEqual(request.full_path, V2 + "node_get?expand=access")
        self.assertTrue(request.url.endswith(V2 + "node_get?expand=access"))

    def test_the_client_path_survives_the_rewrite(self):
        builder = EnvironBuilder(path="/api/suite/drive/nodes/n1")
        request = Request(builder.get_environ())
        frappe.local.request = request
        frappe.local.form_dict = frappe._dict()
        try:
            translator.handle_before_request()
            self.assertEqual(translator.original_path(), "/api/suite/drive/nodes/n1")
        finally:
            frappe.local.request = None
            frappe.local.form_dict = frappe._dict()

    def test_a_path_id_overrides_a_conflicting_argument(self):
        _request, form = translate(
            "/api/suite/drive/nodes/addressed",
            "PATCH",
            {"node": "smuggled", "title": "kept"},
        )
        self.assertEqual(form["node"], "addressed")
        self.assertEqual(form["title"], "kept")

    def test_a_path_id_overrides_a_conflicting_upload_id(self):
        _request, form = translate(
            "/api/suite/drive/uploads/addressed/finish",
            "POST",
            {"upload_id": "smuggled"},
        )
        self.assertEqual(form["upload_id"], "addressed")

    def test_cmd_cannot_redirect_a_matched_route(self):
        request, form = translate(
            "/api/suite/drive/nodes/n1",
            "GET",
            {"cmd": "frappe.client.get_list"},
        )
        self.assertNotIn("cmd", form)
        self.assertEqual(handler_of(request), "node_get")

    def test_cmd_cannot_redirect_an_unclaimed_address(self):
        request, form = translate(
            "/api/suite/drive/grants/g1",
            "GET",
            {"cmd": "frappe.client.get_list"},
        )
        self.assertNotIn("cmd", form)
        self.assertEqual(handler_of(request), translator.UNKNOWN)

    def test_a_verb_no_row_declares_is_not_a_different_row(self):
        for method in ("POST", "PUT"):
            with self.subTest(method=method):
                request, _form = translate("/api/suite/drive/nodes/n1", method)
                self.assertEqual(handler_of(request), translator.UNKNOWN)

    def test_an_unclaimed_path_inside_the_prefix_is_unknown(self):
        for path in (
            "/api/suite/drive/nodes/n1/versions/3",
            "/api/suite/drive/views/recents/extra",
            "/api/suite/drive/nodes/n1/children/extra",
            "/api/suite/drive/",
            "/api/suite/drive/../../v2/method/frappe.client.get_list",
        ):
            with self.subTest(path=path):
                request, _form = translate(path)
                self.assertEqual(handler_of(request), translator.UNKNOWN)

    def test_a_percent_encoded_slash_cannot_forge_a_segment(self):
        # werkzeug decodes PATH_INFO, so `%2F` arrives as a real separator and
        # must not let one segment become two.
        request, _form = translate("/api/suite/drive/nodes/n1%2Fchildren")
        self.assertEqual(handler_of(request), "node_children")
        request, _form = translate("/api/suite/drive/nodes/a%2Fb%2Fc")
        self.assertEqual(handler_of(request), translator.UNKNOWN)

    def test_a_trailing_slash_addresses_the_same_row(self):
        request, form = translate("/api/suite/drive/nodes/n1/", "GET")
        self.assertEqual(handler_of(request), "node_get")
        self.assertEqual(form["node"], "n1")

    def test_a_path_outside_the_prefix_is_left_alone(self):
        for path in ("/api/v2/method/frappe.client.get_list", "/app/drive", "/dav/x", "/api/suite/drivex"):
            with self.subTest(path=path):
                request, form = translate(path, "GET", {"cmd": "frappe.ping"})
                self.assertEqual(request.path, path)
                self.assertEqual(request.environ["PATH_INFO"], path)
                self.assertEqual(form["cmd"], "frappe.ping")

    def test_options_is_left_for_the_framework_to_answer(self):
        request, _form = translate("/api/suite/drive/nodes/n1", "OPTIONS")
        self.assertEqual(request.path, "/api/suite/drive/nodes/n1")

    def test_no_request_is_not_an_error(self):
        frappe.local.request = None
        translator.handle_before_request()
        self.assertIsNone(translator.original_path())


class TestRouteTable(UnitTestCase):
    """The table and the decorators must agree, or one of them is a hole."""

    def test_every_row_names_a_whitelisted_handler_that_allows_its_verb(self):
        for method, _pattern, name, _ids in translator.ROUTES:
            with self.subTest(row=f"{method} {name}"):
                handler = getattr(routes, name)
                self.assertIn(handler, frappe.whitelisted)
                self.assertIn(method, frappe.allowed_http_methods_for_whitelisted_func[handler])

    def test_a_handler_allows_only_the_verbs_its_rows_declare(self):
        declared = {}
        for method, _pattern, name, _ids in translator.ROUTES:
            declared.setdefault(name, set()).add(method)
        for name, methods in declared.items():
            with self.subTest(handler=name):
                allowed = set(frappe.allowed_http_methods_for_whitelisted_func[getattr(routes, name)])
                # `whitelist` adds QUERY alongside GET on its own.
                self.assertEqual(allowed - {"QUERY"}, methods)

    def test_guest_access_matches_the_table(self):
        for name in GUEST_ROUTES:
            with self.subTest(handler=name):
                self.assertIn(getattr(routes, name), frappe.guest_methods)
        for name in SESSION_ONLY_ROUTES:
            with self.subTest(handler=name):
                self.assertNotIn(getattr(routes, name), frappe.guest_methods)

    def test_the_guest_columns_cover_every_handler(self):
        named = {name for _method, _pattern, name, _ids in translator.ROUTES}
        named.add(translator.UNKNOWN)
        self.assertEqual(named, GUEST_ROUTES | SESSION_ONLY_ROUTES)

    def test_the_unknown_handler_hears_every_verb_from_anyone(self):
        allowed = frappe.allowed_http_methods_for_whitelisted_func[routes.unknown]
        for method in ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"):
            self.assertIn(method, allowed)
        self.assertIn(routes.unknown, frappe.guest_methods)

    def test_every_path_id_is_a_parameter_of_its_handler(self):
        import inspect

        for _method, _pattern, name, ids in translator.ROUTES:
            with self.subTest(handler=name):
                handler = getattr(routes, name)
                parameters = inspect.signature(inspect.unwrap(handler)).parameters
                for path_id in ids:
                    self.assertIn(path_id, parameters)

    def test_every_handler_parameter_is_annotated(self):
        # `require_type_annotated_api_methods` is on, and its refusal is raised
        # outside the handler body where the Drive error mapping cannot reach
        # it. Annotations must be present, and permissive.
        import inspect

        for name in GUEST_ROUTES | SESSION_ONLY_ROUTES:
            with self.subTest(handler=name):
                signature = inspect.signature(inspect.unwrap(getattr(routes, name)))
                for parameter in signature.parameters.values():
                    self.assertEqual(parameter.annotation, routes.Given)
                    self.assertIsNone(parameter.default)

    def test_only_the_one_declared_row_names_a_blob(self):
        # §11.2 declares `blob` on one body only: `POST /nodes`. It hands it
        # straight to a workflow that re-reads the blob row. The PATCH body is
        # `{title} | {parent} | {state} | {parent, state} | {content_modified}`,
        # so a head is replaced through `PUT /nodes/<id>/content`, which names
        # an upload session instead of a blob.
        import inspect

        naming = set()
        for name in GUEST_ROUTES | SESSION_ONLY_ROUTES:
            parameters = inspect.signature(inspect.unwrap(getattr(routes, name))).parameters
            if "blob" in parameters:
                naming.add(name)
        self.assertEqual(naming, {"node_create"})

    def test_the_patch_body_is_exactly_the_five_declared_alternatives(self):
        # §11.2's PATCH row. `node` is the path id the translator writes in.
        import inspect

        parameters = set(inspect.signature(inspect.unwrap(routes.node_patch)).parameters)
        self.assertEqual(parameters, {"node", "title", "parent", "state", "content_modified"})

    def test_no_handler_takes_a_storage_key_or_a_bare_url(self):
        # A blob id is checked against the stored row. These are not checkable
        # at all: they would let a client name bytes the workflow never reads.
        import inspect

        forbidden = {"blob_key", "file_url", "file_name", "preview_id", "upload_key", "content_hash"}
        for name in GUEST_ROUTES | SESSION_ONLY_ROUTES:
            with self.subTest(handler=name):
                parameters = set(inspect.signature(inspect.unwrap(getattr(routes, name))).parameters)
                self.assertEqual(parameters & forbidden, set())


if __name__ == "__main__":
    unittest.main()
