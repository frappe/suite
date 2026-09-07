import logging
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.drive.webdav import log
from suite.drive.webdav.tests.utils import (
    dispatch,
    drop_dav_root,
    enable_user_webdav,
    ensure_user_with_password,
    personal_dav_root,
    set_global_webdav,
)

USER = "webdav-log@example.com"
PASSWORD = "webdav-log-pw-9000"


class TestWebDAVLogging(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user_with_password(USER, PASSWORD)
        enable_user_webdav(USER)
        # the mount is the caller's Personal Root: without one, the PROPFIND
        # these tests log is a 404 rather than a 207
        cls.root = personal_dav_root(USER)
        frappe.db.commit()
        cls.logger_name = f"suite.drive.webdav-{frappe.local.site}"
        # what the site held before this class ran, to be put back verbatim
        cls.previous_global = frappe.db.get_single_value("Drive Disk Settings", "webdav_enabled")

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        # `setUpClass` committed the root, so the class rollback cannot reach it
        drop_dav_root(USER)
        frappe.db.commit()
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        set_global_webdav(1)

    def tearDown(self):
        set_global_webdav(self.previous_global)
        frappe.set_user("Administrator")
        super().tearDown()

    def _with_level(self, level: str | None):
        conf = {"drive_webdav_log_level": level} if level else {}
        return patch.dict(frappe.local.conf, conf, clear=False)

    def test_enabled_by_default_at_info(self):
        with self.assertLogs(self.logger_name, level="INFO") as logs:
            dispatch("OPTIONS", "/dav")
        self.assertIn("OPTIONS /dav -> 200", logs.output[0])

    def test_off_disables_logging(self):
        with self._with_level("off"), self.assertNoLogs(self.logger_name):
            dispatch("OPTIONS", "/dav")

    def test_unrecognized_level_keeps_the_default(self):
        with self._with_level("verbose"), self.assertLogs(self.logger_name, level="INFO") as logs:
            dispatch("OPTIONS", "/dav")
        self.assertIn("OPTIONS /dav -> 200", logs.output[0])

    def test_info_logs_one_line_per_request(self):
        with self._with_level("info"), self.assertLogs(self.logger_name, level="INFO") as logs:
            dispatch("OPTIONS", "/dav")
            dispatch("PROPFIND", "/dav/", user=USER, password=PASSWORD, headers={"Depth": "0"})

        self.assertEqual(len(logs.records), 2)
        self.assertIn("OPTIONS /dav -> 200", logs.output[0])
        self.assertIn("user=-", logs.output[0])
        propfind_line = logs.output[1]
        self.assertIn("PROPFIND /dav/ -> 207", propfind_line)
        self.assertIn(f"user={USER}", propfind_line)
        self.assertIn("ms", propfind_line)
        self.assertIn("client=", propfind_line)

    def test_failures_log_at_warning_with_note_and_no_credentials(self):
        with self._with_level("warning"), self.assertLogs(self.logger_name, level="WARNING") as logs:
            dispatch("PROPFIND", "/dav/", user=USER, password="wrong-password")
            # a success at "warning" level stays silent
            dispatch("OPTIONS", "/dav")

        self.assertEqual(len(logs.records), 1)
        line = logs.output[0]
        self.assertIn("-> 401", line)
        self.assertIn("note=", line)
        self.assertNotIn("wrong-password", line)
        self.assertNotIn("Authorization", line)
        self.assertNotIn(PASSWORD, line)

    def test_debug_adds_protocol_headers(self):
        with self._with_level("debug"), self.assertLogs(self.logger_name, level="DEBUG") as logs:
            dispatch(
                "PROPFIND",
                "/dav/",
                user=USER,
                password=PASSWORD,
                headers={"Depth": "0", "If": "(<urn:uuid:dead>)"},
            )

        header_lines = [line for line in logs.output if "headers:" in line]
        self.assertEqual(len(header_lines), 1)
        self.assertIn("Depth: 0", header_lines[0])
        self.assertIn("If: (<urn:uuid:dead>)", header_lines[0])
        self.assertNotIn("Authorization", header_lines[0])

    def test_server_errors_log_at_error_level(self):
        from suite.drive.webdav import dispatch as dispatch_module

        log_filter = {"method": "WebDAV PROPFIND /dav/"}
        frappe.db.delete("Error Log", log_filter)
        try:
            with (
                self._with_level("error"),
                self.assertLogs(self.logger_name, level="ERROR") as logs,
                patch.dict(dispatch_module._HANDLERS, {"PROPFIND": ("missing_module", "handle")}),
            ):
                dispatch("PROPFIND", "/dav/", user=USER, password=PASSWORD)
        finally:
            frappe.db.delete("Error Log", log_filter)
            frappe.db.commit()

        self.assertEqual(len(logs.records), 1)
        self.assertIn("-> 500", logs.output[0])
        self.assertIn("ModuleNotFoundError", logs.output[0])


class TestNoteAppends(UnitTestCase):
    """`log.note`, site-free: the module reads one dict off `frappe.local`.

    The contract is its own test because two writers now share the line. A
    handler names its refusal, and `dispatch._make_headers_sendable` runs
    afterwards on the same request and may name a repair. Replacing rather
    than appending loses the first one, and the log then reports a repair as
    the whole reason for a 400.
    """

    def setUp(self):
        super().setUp()
        frappe.local._webdav_log = {"level": logging.INFO, "start": 0.0, "user": None, "note": None}

    def tearDown(self):
        frappe.local._webdav_log = None
        super().tearDown()

    def note(self) -> str | None:
        return frappe.local._webdav_log["note"]

    def test_the_first_reason_is_the_line(self):
        log.note("Unparsable If header")
        self.assertEqual(self.note(), "Unparsable If header")

    def test_a_second_reason_joins_the_first_rather_than_erasing_it(self):
        log.note("Unparsable If header")
        log.note("percent-encoded unsendable header: Content-Disposition")
        self.assertEqual(
            self.note(),
            "Unparsable If header; percent-encoded unsendable header: Content-Disposition",
        )

    def test_an_empty_reason_does_not_open_the_line_with_a_separator(self):
        log.note("")
        log.note("   ")
        log.note("the real reason")
        self.assertEqual(self.note(), "the real reason")

    def test_a_reason_cannot_forge_a_second_log_record(self):
        """`log_response` writes the note inside `note="..."`. The writers hand
        it exception text, and a database error quotes its statement whole."""
        log.note("(1064, 'You have an error near\n  SELECT 1\n')")

        self.assertEqual(self.note(), "(1064, 'You have an error near SELECT 1 ')")
        self.assertNotIn("\n", self.note())
        self.assertNotIn('"', self.note())

    def test_a_reason_is_bounded(self):
        log.note("x" * 500)
        self.assertEqual(self.note(), "x" * log.NOTE_LIMIT)

    def test_a_note_with_logging_off_is_dropped_rather_than_raising(self):
        """`start_request` sets the context to None at level "off"."""
        frappe.local._webdav_log = None
        log.note("no context to write to")
        self.assertIsNone(frappe.local._webdav_log)
