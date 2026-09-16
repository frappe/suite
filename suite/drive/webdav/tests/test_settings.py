from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.drive.api.product import set_settings, set_webdav_enabled, webdav_config
from suite.drive.webdav.settings import (
    allowed_webdav_methods,
    dav_compliance,
    global_webdav_enabled,
    user_webdav_enabled,
)
from suite.tests.utils import ensure_user

USER = "webdav-settings-user@example.com"
FRESH = "webdav-settings-fresh@example.com"


class TestWebDAVSettings(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(USER)
        ensure_user(FRESH)

    def setUp(self):
        super().setUp()
        self._set_global(0)
        # `allowed_webdav_methods` reads this Single, and nothing else in the
        # class establishes it. A site or an earlier module that left a list
        # behind would silently change what every case here is measuring.
        self._set_method_list("")

    def tearDown(self):
        self._set_global(0)
        self._set_method_list("")
        frappe.set_user("Administrator")
        # the opt-in cases write `Drive Settings` for a real user, and
        # `IntegrationTestCase` rolls back only once the class is finished
        frappe.db.delete("Drive Settings", {"user": ["in", (USER, FRESH)]})
        frappe.set_user("Administrator")
        super().tearDown()

    def _set_global(self, value: int):
        frappe.db.set_single_value("Drive Disk Settings", "webdav_enabled", value)
        frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")

    def _set_method_list(self, value: str):
        frappe.db.set_single_value("Drive Disk Settings", "webdav_allowed_methods", value)
        frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")

    def test_config_is_empty_for_users_while_disabled(self):
        with self.set_user(USER):
            self.assertEqual(webdav_config(), {})

    def test_config_shows_admin_the_toggle_while_disabled(self):
        config = webdav_config()  # Administrator
        self.assertEqual(config, {"globally_enabled": False, "is_admin": True})

    def test_config_for_enabled_user(self):
        self._set_global(1)
        with self.set_user(USER):
            config = webdav_config()
        self.assertTrue(config["globally_enabled"])
        self.assertFalse(config["is_admin"])
        self.assertTrue(config["server_url"].endswith("/dav/"))
        self.assertEqual(config["username"], USER)
        # per-user access is opt-in: off until the user flips it
        self.assertFalse(config["enabled_for_user"])
        self.assertFalse(config["two_factor_blocked"])

        with self.set_user(USER):
            set_settings({"webdav_enabled": 1})
            self.assertTrue(webdav_config()["enabled_for_user"])

    def test_config_flags_two_factor(self):
        self._set_global(1)
        with patch("frappe.twofactor.should_run_2fa", return_value=True), self.set_user(USER):
            self.assertTrue(webdav_config()["two_factor_blocked"])

    def test_set_webdav_enabled_is_admin_only(self):
        with self.set_user(USER), self.assertRaises(frappe.PermissionError):
            set_webdav_enabled(True)
        self.assertFalse(global_webdav_enabled())

        set_webdav_enabled(True)  # Administrator
        self.assertTrue(global_webdav_enabled())
        set_webdav_enabled(False)
        self.assertFalse(global_webdav_enabled())

    def test_user_opt_in_via_set_settings(self):
        # default-off is covered by test_missing_settings_row_defaults_to_disabled;
        # earlier tests in this class may already have opted USER in
        with self.set_user(USER):
            set_settings({"webdav_enabled": 1})
            self.assertTrue(user_webdav_enabled(USER))
            set_settings({"webdav_enabled": 0})
            self.assertFalse(user_webdav_enabled(USER))

    def test_missing_settings_row_defaults_to_disabled(self):
        frappe.db.delete("Drive Settings", {"user": FRESH})
        self.assertFalse(user_webdav_enabled(FRESH))

    def test_method_list_validation_and_normalization(self):
        doc = frappe.get_doc("Drive Disk Settings")
        try:
            # normalized to canonical order with OPTIONS and GET->HEAD implied
            doc.webdav_allowed_methods = "propfind get"
            doc.save()
            self.assertEqual(doc.webdav_allowed_methods, "OPTIONS, GET, HEAD, PROPFIND")

            doc.webdav_allowed_methods = ""
            doc.save()
            self.assertEqual(doc.webdav_allowed_methods, "")

            doc.webdav_allowed_methods = "PROPFIND, TRACE, BREW"
            with self.assertRaises(frappe.ValidationError) as caught:
                doc.save()
            self.assertIn("TRACE", str(caught.exception))
            self.assertIn("PROPFIND", str(caught.exception))  # valid list is spelled out
        finally:
            doc.reload()
            doc.webdav_allowed_methods = ""
            doc.save()

    def test_allowed_methods_runtime_gate(self):
        """The stored list narrows the implemented surface, and never widens it.

        Ticket 25 relinked the write verbs, so the ceiling is now
        `ALLOWED_METHODS` itself: an admin who narrows nothing gets a
        read-write mount, and one who names a subset gets exactly that subset.
        """
        from suite.drive.webdav import ALLOWED_METHODS

        self.assertEqual(allowed_webdav_methods(), ALLOWED_METHODS)

        frappe.db.set_single_value(
            "Drive Disk Settings", "webdav_allowed_methods", "OPTIONS, GET, HEAD, PROPFIND"
        )
        frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
        try:
            methods = allowed_webdav_methods()
            self.assertEqual(methods, ("OPTIONS", "GET", "HEAD", "PROPFIND"))
            # no locking offered -> no class 2 advertised
            self.assertEqual(dav_compliance(methods), "1, 3")
            self.assertEqual(dav_compliance(ALLOWED_METHODS), "1, 2, 3")

            # the write verbs are real now, so a list naming them offers them
            frappe.db.set_single_value(
                "Drive Disk Settings", "webdav_allowed_methods", "PUT, LOCK, UNLOCK, PROPFIND"
            )
            frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
            self.assertEqual(allowed_webdav_methods(), ("OPTIONS", "PUT", "PROPFIND", "LOCK", "UNLOCK"))

            # unvalidated garbage in the DB must not take every request down
            frappe.db.set_single_value("Drive Disk Settings", "webdav_allowed_methods", "BREW")
            frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
            self.assertEqual(allowed_webdav_methods(), ALLOWED_METHODS)
        finally:
            frappe.db.set_single_value("Drive Disk Settings", "webdav_allowed_methods", "")
            frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
