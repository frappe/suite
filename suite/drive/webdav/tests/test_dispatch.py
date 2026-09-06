from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from werkzeug.datastructures import Headers
from werkzeug.exceptions import NotFound

from suite.drive.tests.fixtures import nodes_in_root
from suite.drive.webdav import ALLOWED_METHODS
from suite.drive.webdav.dispatch import handle_before_request
from suite.drive.webdav.tests.utils import (
    dispatch,
    drop_nodes,
    enable_user_webdav,
    ensure_user_with_password,
    personal_dav_root,
    set_dav_request,
)

USER = "webdav-dispatch@example.com"
PASSWORD = "webdav-dispatch-pw-9000"

# ticket 25 relinked the write verbs, so the whole implemented surface is on
# the wire and the site can claim class 2 again
OFFERED = ", ".join(ALLOWED_METHODS)
WRITE_VERBS = ("PUT", "DELETE", "PROPPATCH", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK")


class TestWebDAVDispatch(IntegrationTestCase):
    """The dispatcher commits and rolls back mid-request, so fixtures are
    committed up front and the global toggle is restored explicitly."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user_with_password(USER, PASSWORD)
        enable_user_webdav(USER)
        # the mount is the caller's Personal Root, so a suite that expects a
        # 207 rather than a 404 has to have one
        cls.root = personal_dav_root(USER)
        frappe.db.commit()

    def setUp(self):
        self._set_global(1)

    def tearDown(self):
        self._set_global(0)
        frappe.set_user("Administrator")
        super().tearDown()

    def _set_global(self, value: int):
        """Committed, because a refused dispatch rolls the transaction back.

        Every error path in the dispatcher calls `db.rollback`, and
        `clear_document_cache` re-clears the cached Single on rollback, so an
        uncommitted toggle is discarded by the first 401/403/405 of a test and
        the next request reads the site as feature-off."""
        frappe.db.set_single_value("Drive Disk Settings", "webdav_enabled", value)
        frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
        frappe.db.commit()

    def test_non_dav_paths_pass_through(self):
        for path in ("/davsomething", "/drive/home", "/api/method/ping"):
            set_dav_request("PROPFIND", path)
            self.assertIsNone(handle_before_request())

    def test_global_toggle_off_is_stock_404(self):
        self._set_global(0)
        set_dav_request("PROPFIND", "/dav/")
        self.assertRaises(NotFound, handle_before_request)

    def test_options_advertises_every_offered_verb(self):
        response = dispatch("OPTIONS", "/dav")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Allow"], OFFERED)
        self.assertEqual(response.headers["MS-Author-Via"], "DAV")
        # LOCK and UNLOCK are on the wire again, and Finder reads class 2 to
        # decide whether the mount is read-write
        self.assertEqual(response.headers["DAV"], "1, 2, 3")

    def test_options_on_server_root_advertises_dav(self):
        frappe.local.response_headers = Headers()
        self.assertIsNone(dispatch("OPTIONS", "/"))
        self.assertEqual(frappe.local.response_headers.get("DAV"), "1, 2, 3")

        # feature off: no advertisement
        self._set_global(0)
        frappe.local.response_headers = Headers()
        self.assertIsNone(dispatch("OPTIONS", "/"))
        self.assertIsNone(frappe.local.response_headers.get("DAV"))

    def test_unauthenticated_request_gets_challenge(self):
        response = dispatch("PROPFIND", "/dav/")

        self.assertEqual(response.status_code, 401)
        self.assertIn("Basic", response.headers["WWW-Authenticate"])

    def test_unhandled_method_is_405_with_allow(self):
        response = dispatch("POST", "/dav/", user=USER, password=PASSWORD)

        self.assertEqual(response.status_code, 405)
        self.assertEqual(response.headers["Allow"], OFFERED)

    def test_every_write_verb_reaches_its_handler(self):
        """Ticket 25 relinked them, so none is refused at the gate any more.

        The status each one answers is its own business; what this case owns is
        that the dispatcher no longer stops it. A 405 here would mean the verb
        fell off `dispatch._HANDLERS` or off the allow-list.
        """
        before = nodes_in_root(self.root)
        try:
            for method in WRITE_VERBS:
                response = dispatch(
                    method,
                    f"/dav/probe-{method.lower()}.txt",
                    user=USER,
                    password=PASSWORD,
                    data=b"x",
                )
                self.assertNotEqual(response.status_code, 405, method)
                self.assertIn(method, OFFERED, method)
        finally:
            # PUT and MKCOL really create, and the dispatcher commits, so the
            # rows they leave are dropped rather than rolled back
            drop_nodes(nodes_in_root(self.root) - before)
            frappe.db.commit()

    def test_the_admin_list_narrows_the_offered_set_and_never_widens_it(self):
        frappe.db.set_single_value("Drive Disk Settings", "webdav_allowed_methods", "OPTIONS, GET, LOCK")
        frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
        frappe.db.commit()
        try:
            response = dispatch("OPTIONS", "/dav")
            # LOCK is implemented now, so an admin who asks for it gets it
            self.assertEqual(response.headers["Allow"], "OPTIONS, GET, HEAD, LOCK")
            # RFC 4918 §9.1 makes PROPFIND what class 1 means, and this list
            # holds none, so the site claims no class at all
            self.assertNotIn("DAV", response.headers)

            # a verb the admin left out is still refused before a handler runs
            response = dispatch("PROPPATCH", "/dav/x.txt", user=USER, password=PASSWORD)
            self.assertEqual(response.status_code, 405)
            self.assertEqual(response.headers["Allow"], "OPTIONS, GET, HEAD, LOCK")
        finally:
            frappe.db.set_single_value("Drive Disk Settings", "webdav_allowed_methods", "")
            frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
            frappe.db.commit()

    def test_user_toggle_off_is_403(self):
        frappe.db.set_value("Drive Settings", USER, "webdav_enabled", 0)
        frappe.db.commit()
        try:
            response = dispatch("PROPFIND", "/dav/", user=USER, password=PASSWORD)
        finally:
            enable_user_webdav(USER, commit=True)

        self.assertEqual(response.status_code, 403)
        self.assertIn("disabled for your account", response.get_data(as_text=True))

    def test_user_access_is_opt_in_by_default(self):
        # a user who never touched their settings must be rejected
        fresh = "webdav-dispatch-fresh@example.com"
        ensure_user_with_password(fresh, PASSWORD)
        frappe.db.set_value("Drive Settings", fresh, "webdav_enabled", 0, update_modified=False)
        frappe.db.commit()

        response = dispatch("PROPFIND", "/dav/", user=fresh, password=PASSWORD)
        self.assertEqual(response.status_code, 403)
        self.assertIn("disabled for your account", response.get_data(as_text=True))

    def test_method_allow_list_is_enforced(self):
        frappe.db.set_single_value("Drive Disk Settings", "webdav_allowed_methods", "OPTIONS, PROPFIND")
        frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
        frappe.db.commit()
        try:
            # a verb the admin left out: 405 naming the permitted set
            response = dispatch("GET", "/dav/x.txt", user=USER, password=PASSWORD)
            self.assertEqual(response.status_code, 405)
            self.assertEqual(response.headers["Allow"], "OPTIONS, PROPFIND")
            self.assertIn("disabled on this site", response.get_data(as_text=True))

            # permitted verb still works end to end
            response = dispatch("PROPFIND", "/dav/", user=USER, password=PASSWORD, headers={"Depth": "0"})
            self.assertEqual(response.status_code, 207)

            response = dispatch("OPTIONS", "/dav")
            self.assertEqual(response.headers["Allow"], "OPTIONS, PROPFIND")
        finally:
            frappe.db.set_single_value("Drive Disk Settings", "webdav_allowed_methods", "")
            frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
            frappe.db.commit()

        response = dispatch("OPTIONS", "/dav")
        self.assertEqual(response.headers["Allow"], OFFERED)

    def test_success_path_commits_before_raising(self):
        with patch.object(frappe.db, "commit", wraps=frappe.db.commit) as commit:
            response = dispatch("OPTIONS", "/dav")

        self.assertEqual(response.status_code, 200)
        commit.assert_called()

    def test_unexpected_handler_error_maps_to_500_and_logs_durably(self):
        from suite.drive.webdav import dispatch as dispatch_module

        log_filter = {"method": "WebDAV PROPFIND /dav/"}
        frappe.db.delete("Error Log", log_filter)
        try:
            with patch.dict(dispatch_module._HANDLERS, {"PROPFIND": ("missing_module", "handle")}):
                response = dispatch("PROPFIND", "/dav/", user=USER, password=PASSWORD)

            self.assertEqual(response.status_code, 500)
            # the response body must not leak the traceback
            self.assertNotIn(b"missing_module", response.get_data())
            # frappe/app.py rolls back after the response carrier is raised;
            # the Error Log row must survive that or production 500s vanish
            frappe.db.rollback()
            self.assertTrue(frappe.db.exists("Error Log", log_filter))
        finally:
            frappe.db.delete("Error Log", log_filter)
            frappe.db.commit()
