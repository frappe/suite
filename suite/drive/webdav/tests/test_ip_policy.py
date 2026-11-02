"""Exercise Frappe's real IP policy at the DAV authentication/HTTP boundary.

Only persistence and credential verification are substituted; no site or user
settings are changed. Policy decisions belong to frappe.auth.
"""

import base64
import unittest
from unittest.mock import Mock, patch

import frappe
from werkzeug.datastructures import Headers
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request, Response

from suite import mail
from suite.drive.webdav import auth, dispatch


class TestWebDAVIPPolicy(unittest.TestCase):
    def setUp(self) -> None:
        self.user = "dav-policy@example.com"
        self.user_doc = Mock(bypass_restrict_ip_check_if_2fa_enabled=0)
        self.user_doc.get_restricted_ip_list.return_value = ["192.0.2."]
        self.tracker = Mock()
        self.tracker.is_user_allowed.return_value = True
        self.db = Mock()
        self.db.get_value.return_value = 1
        self.previous_local = dict(frappe.local)
        self.addCleanup(self.restore_local)
        frappe.local.db = self.db
        frappe.local.session = frappe._dict(user="Guest", sid="original")
        frappe.local.request_ip = "198.51.100.8"
        frappe.local.response_headers = Headers()
        frappe.local.conf = frappe._dict()
        frappe.local.flags = frappe._dict()
        frappe.local.lang = "en"
        frappe.local.response = frappe._dict()
        frappe.local.message_log = []
        frappe.local.form_dict = frappe._dict()
        for target, value in (
            ("frappe.get_cached_doc", self.user_doc),
            ("frappe.log_error", None),
            ("frappe.translate.get_all_translations", {}),
            ("suite.drive.webdav.auth._trackers", [self.tracker]),
            ("suite.drive.webdav.auth.check_password", self.user),
            ("suite.drive.webdav.auth._requires_two_factor", False),
            ("suite.drive.webdav.auth._store_cache", None),
            ("suite.drive.webdav.settings.global_webdav_enabled", True),
            ("suite.drive.webdav.settings.user_webdav_enabled", True),
            ("suite.drive.webdav.settings.allowed_webdav_methods", ("PROPFIND",)),
            ("suite.drive.webdav.context.build", Mock()),
            ("suite.composition.access.require_access", None),
            ("suite.drive.webdav.log.start_request", None),
            ("suite.drive.webdav.log.note_user", None),
            ("suite.drive.webdav.log.note", None),
            ("suite.drive.webdav.log.log_response", None),
        ):
            self.enterContext(patch(target, return_value=value))
        self.enterContext(patch.object(mail, "resolve_business_user", return_value=None))
        self.enterContext(patch("frappe.get_system_settings", return_value=0))
        self.handler = self.enterContext(patch.object(dispatch, "_handler_for"))
        self.handler.return_value = lambda ctx: Response(status=207)
        self.accept = self.enterContext(patch("frappe.set_user"))

    def restore_local(self) -> None:
        for key in dict(frappe.local):
            delattr(frappe.local, key)
        for key, value in self.previous_local.items():
            setattr(frappe.local, key, value)

    def request(self, *, api: bool = False, cached: bool = False) -> Response:
        login = "api-key" if api else self.user
        token = base64.b64encode(f"{login}:secret".encode()).decode()
        frappe.local.request = Request(
            EnvironBuilder(
                path="/dav/", method="PROPFIND", headers={"Authorization": f"Basic {token}"}
            ).get_environ()
        )
        with (
            patch.object(
                auth, "_api_key_user", return_value=frappe._dict(name=self.user, enabled=1) if api else None
            ),
            patch.object(auth, "_api_secret_valid", return_value=True),
            patch.object(auth, "_verify_cached", return_value=self.user if cached else None),
        ):
            try:
                dispatch.handle_before_request()
            except dispatch.DAVResponseException as exc:
                return exc.response
        self.fail("DAV dispatch did not produce a response")

    def test_disallowed_ip_is_generic_401_before_identity_or_dispatch(self) -> None:
        for api, cached in ((False, False), (False, True), (True, False)):
            with self.subTest(api=api, cached=cached):
                response = self.request(api=api, cached=cached)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.get_data(as_text=True), "Incorrect user or password.\n")
                self.assertIn("Basic", response.headers["WWW-Authenticate"])
                self.assertNotIn("Set-Cookie", response.headers)
                self.accept.assert_not_called()
                self.handler.assert_not_called()
                self.assertEqual(dict(frappe.session), {"user": "Guest", "sid": "original"})
                self.tracker.add_success_attempt.assert_not_called()
                self.tracker.add_failure_attempt.assert_not_called()

    def test_allowed_ip_accepts_each_credential_path(self) -> None:
        frappe.local.request_ip = "192.0.2.10"
        for api, cached in ((False, False), (False, True), (True, False)):
            with self.subTest(api=api, cached=cached):
                self.assertEqual(self.request(api=api, cached=cached).status_code, 207)

    def test_rejection_preserves_an_existing_request_identity(self) -> None:
        frappe.local.session = frappe._dict(user="previous@example.com", sid="existing")
        for api in (False, True):
            with self.subTest(api=api):
                self.assertEqual(self.request(api=api).status_code, 401)
                self.assertEqual(dict(frappe.session), {"user": "previous@example.com", "sid": "existing"})
                self.accept.assert_not_called()
