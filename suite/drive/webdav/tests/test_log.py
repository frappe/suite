from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

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
