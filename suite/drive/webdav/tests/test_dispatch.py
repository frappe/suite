import logging
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase
from werkzeug.datastructures import Headers
from werkzeug.exceptions import NotFound
from werkzeug.wrappers import Response

from suite.drive.tests.fixtures import nodes_in_root
from suite.drive.webdav import ALLOWED_METHODS, log
from suite.drive.webdav import dispatch as dispatch_module
from suite.drive.webdav import get as get_module
from suite.drive.webdav.dispatch import handle_before_request
from suite.drive.webdav.tests.utils import (
    dispatch,
    drop_dav_root,
    drop_nodes,
    enable_user_webdav,
    ensure_user_with_password,
    personal_dav_root,
    reset_dav_request,
    set_dav_request,
    set_global_webdav,
)

USER = "webdav-dispatch@example.com"
PASSWORD = "webdav-dispatch-pw-9000"
FRESH = "webdav-dispatch-fresh@example.com"

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

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        # `setUpClass` and `test_user_access_is_opt_in_by_default` both commit,
        # so `IntegrationTestCase`'s class rollback cannot reach any of this
        for user in (USER, FRESH):
            drop_dav_root(user)
            frappe.db.delete("Drive Settings", {"user": user})
        frappe.db.commit()
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        # what the site held before this case, to be put back verbatim
        self.previous_global = frappe.db.get_single_value("Drive Disk Settings", "webdav_enabled")
        self._set_global(1)
        # `allowed_webdav_methods` reads this Single. Two cases here assert the
        # unnarrowed list, and nothing else establishes that it is unnarrowed.
        self._set_method_list("")

    def tearDown(self):
        self._set_global(self.previous_global)
        self._set_method_list("")
        frappe.set_user("Administrator")
        reset_dav_request()
        super().tearDown()

    def _set_method_list(self, value: str):
        frappe.db.set_single_value("Drive Disk Settings", "webdav_allowed_methods", value)
        frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
        frappe.db.commit()

    def _set_global(self, value):
        set_global_webdav(value)

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
        ensure_user_with_password(FRESH, PASSWORD)
        frappe.db.set_value("Drive Settings", FRESH, "webdav_enabled", 0, update_modified=False)
        frappe.db.commit()

        response = dispatch("PROPFIND", "/dav/", user=FRESH, password=PASSWORD)
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

    def test_a_response_header_the_wire_cannot_carry_is_percent_encoded(self):
        """RFC 9110 §5.5: a header value is latin-1 on the wire.

        A value outside it raised `UnicodeEncodeError` inside the server's own
        `send_header`, after the status line, so the client got no response and
        timed out while the log recorded the handler's status. litmus's
        `put_get_utf8_segment` found it on a node titled `res-€`.
        """
        from suite.drive.webdav import dispatch as dispatch_module

        def handler(ctx):
            answer = Response(status=200)
            answer.headers["Content-Disposition"] = 'attachment; filename="res-€"'
            answer.headers["X-Plain"] = "already ascii"
            return answer

        with patch.object(dispatch_module, "_handler_for", return_value=handler):
            response = dispatch("PROPFIND", "/dav/", user=USER, password=PASSWORD)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Content-Disposition"], 'attachment; filename="res-%E2%82%AC"')
        # the value is now sendable, which is the whole point
        response.headers["Content-Disposition"].encode("latin-1")
        # a header that was already sendable is left exactly as it was
        self.assertEqual(response.headers["X-Plain"], "already ascii")

    def test_a_rewritten_response_keeps_every_header_it_had(self):
        """The net rebuilds the whole `Headers` object, so it must not reorder
        or de-duplicate: it runs on every DAV response there is. One value has
        to be unsendable, or the rebuild never happens and this proves nothing.
        """
        from suite.drive.webdav import dispatch as dispatch_module

        def handler(ctx):
            answer = Response(status=207)
            answer.headers.add("X-Repeated", "one")
            answer.headers.add("X-Repeated", "tw€")
            answer.headers.add("X-Repeated", "three")
            return answer

        with patch.object(dispatch_module, "_handler_for", return_value=handler):
            response = dispatch("PROPFIND", "/dav/", user=USER, password=PASSWORD)

        self.assertEqual(response.headers.getlist("X-Repeated"), ["one", "tw%E2%82%AC", "three"])

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


class TestSendableHeaders(UnitTestCase):
    """`dispatch._make_headers_sendable`, site-free.

    The net runs on every DAV response there is, so its own cases must not
    need a site: they are the ones that have to run in a worktree. The
    dispatched-request case above proves it is wired into `_raise`; these
    prove what it does.
    """

    def setUp(self):
        super().setUp()
        frappe.local._webdav_log = {"level": logging.INFO, "start": 0.0, "user": None, "note": None}

    def tearDown(self):
        frappe.local._webdav_log = None
        super().tearDown()

    def net(self, pairs: list[tuple[str, str]]) -> Response:
        response = Response(status=200)
        response.headers = Headers(pairs)
        dispatch_module._make_headers_sendable(response)
        return response

    def note(self) -> str | None:
        return frappe.local._webdav_log["note"]

    def test_a_value_above_us_ascii_is_percent_encoded(self):
        response = self.net([("Content-Disposition", 'attachment; filename="res-€"')])

        self.assertEqual(response.headers["Content-Disposition"], 'attachment; filename="res-%E2%82%AC"')
        response.headers["Content-Disposition"].encode("latin-1")

    def test_latin_1_is_encoded_too_because_obs_text_is_opaque(self):
        """RFC 9110 §5.5 deprecates `obs-text` and tells a recipient to treat
        it as opaque data, so a latin-1 title is no more carriable in meaning
        than a Chinese one. It reaches the client percent-encoded."""
        response = self.net([("Content-Disposition", 'attachment; filename="café.txt"')])

        self.assertEqual(response.headers["Content-Disposition"], 'attachment; filename="caf%C3%A9.txt"')

    def test_a_control_character_is_encoded_although_it_is_ascii(self):
        """§5.5 allows only `field-vchar`, SP and HTAB. Werkzeug refuses CR
        and LF where a header is set, so a split cannot be built; NUL, DEL and
        the rest of C0 it accepts, and a proxy is free to resynchronise on
        them. The net is where they stop."""
        response = self.net([("Content-Disposition", 'attachment; filename="a\x00b\x07c\x7fd"')])

        self.assertEqual(response.headers["Content-Disposition"], 'attachment; filename="a%00b%07c%7Fd"')
        self.assertIn("Content-Disposition", self.note())

    def test_a_lone_surrogate_is_encoded_rather_than_raising(self):
        """`quote` refuses a surrogate, and the net runs where no handler can
        answer: raising here would be the `UnicodeEncodeError` it exists to
        prevent, one layer further out."""
        response = self.net([("X-Broken", "a\udcffb")])

        self.assertEqual(response.headers["X-Broken"], "a%3Fb")
        response.headers["X-Broken"].encode("latin-1")

    def test_space_and_tab_survive_because_a_field_value_may_hold_them(self):
        response = self.net([("X-Spaced", "one two\tthree")])

        self.assertEqual(response.headers["X-Spaced"], "one two\tthree")
        self.assertIsNone(self.note())

    def test_a_sendable_response_is_not_rebuilt_at_all(self):
        """Identity, not equality: an untouched response must keep the very
        `Headers` object its handler built, repeats and order included."""
        before = Headers([("X-Repeated", "one"), ("X-Repeated", "two"), ("ETag", '"abc"')])
        response = Response(status=207)
        response.headers = before

        dispatch_module._make_headers_sendable(response)

        self.assertIs(response.headers, before)
        self.assertEqual(response.headers.getlist("X-Repeated"), ["one", "two"])
        self.assertIsNone(self.note())

    def test_a_rewrite_keeps_every_repeat_in_order(self):
        response = self.net(
            [("X-Repeated", "one"), ("Content-Disposition", "attachment; filename=€"), ("X-Repeated", "two")]
        )

        self.assertEqual(
            list(response.headers.items()),
            [
                ("X-Repeated", "one"),
                ("Content-Disposition", "attachment; filename=%E2%82%AC"),
                ("X-Repeated", "two"),
            ],
        )

    def test_the_rewrite_names_every_header_it_touched_once(self):
        response = self.net(
            [("X-Bad", "€"), ("X-Fine", "plain"), ("X-Bad", "£"), ("Content-Disposition", "€")]
        )

        self.assertEqual(response.headers["X-Fine"], "plain")
        self.assertEqual(self.note(), "percent-encoded unsendable header: Content-Disposition, X-Bad")

    def test_the_rewrite_does_not_erase_the_reason_a_handler_already_named(self):
        """A 400 says why it is a 400. The net runs after the handler on the
        same request and may only add to that line."""
        log.note("Unparsable If header at: ' [\"a6fe'")
        self.net([("Content-Disposition", "€")])

        self.assertEqual(
            self.note(),
            "Unparsable If header at: ' ['a6fe'; percent-encoded unsendable header: Content-Disposition",
        )

    def test_every_title_the_disposition_helper_can_produce_is_already_sendable(self):
        """The net is a net. `get.py` is what must not need it, so the four
        title shapes it handles reach here unchanged."""
        for title in ("data.bin", "res-€", "café.txt", "日本語.txt", "a\nb.txt", "€"):
            headers = Headers()
            headers.set("Content-Disposition", "attachment", **get_module._disposition_names(title))
            response = Response(status=200)
            response.headers = headers

            dispatch_module._make_headers_sendable(response)

            self.assertIs(response.headers, headers, title)
            self.assertIsNone(self.note(), title)
