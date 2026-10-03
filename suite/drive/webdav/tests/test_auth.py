from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils.password import update_password

from suite.drive.webdav import auth
from suite.drive.webdav.errors import AuthRequired, Forbidden
from suite.drive.webdav.tests.utils import (
    ensure_system_settings_saveable,
    ensure_user_with_password,
    set_dav_request,
)

PASSWORD = "webdav-auth-pw-9000"


def make_user(slug: str) -> str:
    # tracker state is keyed by user in redis, so every test gets its own user
    email = f"webdav-auth-{slug}@example.com"
    ensure_user_with_password(email, PASSWORD)
    return email


def authenticate(user: str | None, password: str = "", header: str | None = None):
    headers = {"Authorization": header} if header else {}
    if header:
        set_dav_request("PROPFIND", "/dav/", headers=headers)
    else:
        set_dav_request("PROPFIND", "/dav/", user=user, password=password)
    return auth.authenticate(frappe.local.request)


class TestWebDAVAuth(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_system_settings_saveable()

    def tearDown(self):
        frappe.set_user("Administrator")
        super().tearDown()

    def test_missing_header_challenges_without_tracking(self):
        user = make_user("probe")
        with self.change_settings(
            "System Settings", allow_consecutive_login_attempts=3, allow_login_after_fail=60
        ):
            for _ in range(5):
                set_dav_request("PROPFIND", "/dav/")
                with self.assertRaises(AuthRequired) as ctx:
                    auth.authenticate(frappe.local.request)
                self.assertIn("WWW-Authenticate", ctx.exception.headers)
            # unauthenticated probes must not have locked the account
            self.assertEqual(authenticate(user, PASSWORD), user)

    def test_malformed_headers_challenge(self):
        for header in ("Basic", "Basic !!!not-base64!!!", "Bearer abc", "Basic " + "af"):
            with self.assertRaises(AuthRequired):
                authenticate(None, header=header)

    def test_wrong_password_tracks_and_locks_out(self):
        user = make_user("lockout")
        with self.change_settings(
            "System Settings", allow_consecutive_login_attempts=3, allow_login_after_fail=60
        ):
            # frappe locks only once failures exceed the threshold; case
            # variants resolve to the same account and must share the counter
            for variant in (user, user.upper(), user.title(), user):
                with self.assertRaises(AuthRequired):
                    authenticate(variant, "wrong-password")
            with self.assertRaises(Forbidden) as ctx:
                authenticate(user, PASSWORD)
            self.assertIn("Retry-After", ctx.exception.headers)

    def test_lockout_uses_isolated_key_space(self):
        # WebDAV failures must not feed frappe's web-login lockout counter
        user = make_user("isolate")
        with self.change_settings(
            "System Settings", allow_consecutive_login_attempts=3, allow_login_after_fail=60
        ):
            with self.assertRaises(AuthRequired):
                authenticate(user, "wrong-password")
            # the failure lands under the namespaced key, never frappe's web-login key
            self.assertIsNone(frappe.cache.hget("login_failed_count", user))
            self.assertIsNotNone(frappe.cache.hget("login_failed_count", f"{auth.LOCKOUT_KEY_NS}{user}"))

    def test_correct_password_returns_canonical_user(self):
        user = make_user("ok")
        self.assertEqual(authenticate(user, PASSWORD), user)

    def test_verification_cache_skips_check_password(self):
        user = make_user("cache")
        self.assertEqual(authenticate(user, PASSWORD), user)
        with patch("suite.drive.webdav.auth.check_password", side_effect=AssertionError) as checker:
            self.assertEqual(authenticate(user, PASSWORD), user)
            checker.assert_not_called()

    def test_cache_is_stale_safe_after_password_change(self):
        user = make_user("rotate")
        self.assertEqual(authenticate(user, PASSWORD), user)
        update_password(user, "a-brand-new-password")
        try:
            with self.assertRaises(AuthRequired):
                authenticate(user, PASSWORD)
            self.assertEqual(authenticate(user, "a-brand-new-password"), user)
        finally:
            update_password(user, PASSWORD)

    def test_password_with_colon_and_unicode(self):
        user = make_user("unicode")
        password = "pä:ss:wörd"
        update_password(user, password)
        auth._delete_cache(user)
        self.assertEqual(authenticate(user, password), user)

    def test_disabled_account_is_indistinguishable_from_wrong_password(self):
        # a correct password for a disabled account must not be confirmable
        user = make_user("disabled")
        frappe.db.set_value("User", user, "enabled", 0)
        try:
            with self.assertRaises(AuthRequired) as ctx:
                authenticate(user, PASSWORD)
            self.assertEqual(str(ctx.exception), "Incorrect user or password.")
            self.assertNotIn("disabled", str(ctx.exception))
            self.assertIn("WWW-Authenticate", ctx.exception.headers)
        finally:
            frappe.db.set_value("User", user, "enabled", 1)

    def test_two_factor_user_is_indistinguishable_from_wrong_password(self):
        # a correct password for a 2FA account must not be confirmable over DAV
        user = make_user("twofactor")
        with patch("frappe.twofactor.should_run_2fa", return_value=True):
            with self.assertRaises(AuthRequired) as ctx:
                authenticate(user, PASSWORD)
        self.assertEqual(str(ctx.exception), "Incorrect user or password.")
        self.assertNotIn("two-factor", str(ctx.exception))
        self.assertIn("WWW-Authenticate", ctx.exception.headers)

    def test_disable_user_pass_login_is_forbidden(self):
        user = make_user("nopass")
        with self.change_settings("System Settings", disable_user_pass_login=1):
            with self.assertRaises(Forbidden):
                authenticate(user, PASSWORD)

    def _make_api_keys(self, user: str) -> tuple[str, str]:
        from frappe.core.doctype.user.user import generate_keys

        with self.set_user("Administrator"):
            secret = generate_keys(user)["api_secret"]
        return frappe.db.get_value("User", user, "api_key"), secret

    def test_api_key_secret_authenticates(self):
        user = make_user("apikey")
        api_key, secret = self._make_api_keys(user)
        self.assertEqual(authenticate(api_key, secret), user)

    def test_api_key_wrong_secret_challenges_and_tracks(self):
        user = make_user("apikey-bad")
        api_key, _secret = self._make_api_keys(user)
        with self.change_settings(
            "System Settings", allow_consecutive_login_attempts=3, allow_login_after_fail=60
        ):
            with self.assertRaises(AuthRequired) as ctx:
                authenticate(api_key, "not-the-secret")
            self.assertEqual(str(ctx.exception), "Incorrect user or password.")
            self.assertIsNotNone(frappe.cache.hget("login_failed_count", f"{auth.LOCKOUT_KEY_NS}{api_key}"))

    def test_api_keys_bypass_two_factor(self):
        # API credentials are their own factor — the working path for 2FA accounts
        user = make_user("apikey-2fa")
        api_key, secret = self._make_api_keys(user)
        with patch("frappe.twofactor.should_run_2fa", return_value=True):
            self.assertEqual(authenticate(api_key, secret), user)
            with self.assertRaises(AuthRequired):
                authenticate(user, PASSWORD)  # the password path stays blocked

    def test_api_keys_work_when_password_login_disabled(self):
        user = make_user("apikey-nopass")
        api_key, secret = self._make_api_keys(user)
        with self.change_settings("System Settings", disable_user_pass_login=1):
            self.assertEqual(authenticate(api_key, secret), user)
            with self.assertRaises(Forbidden):
                authenticate(user, PASSWORD)

    def test_api_key_of_disabled_account_is_rejected(self):
        user = make_user("apikey-disabled")
        api_key, secret = self._make_api_keys(user)
        frappe.db.set_value("User", user, "enabled", 0)
        try:
            with self.assertRaises(AuthRequired) as ctx:
                authenticate(api_key, secret)
            self.assertEqual(str(ctx.exception), "Incorrect user or password.")
        finally:
            frappe.db.set_value("User", user, "enabled", 1)

    def test_guest_and_empty_credentials_challenge(self):
        for user, password in (("Guest", "x"), ("", "x"), ("someone@example.com", "")):
            with self.assertRaises(AuthRequired):
                authenticate(user, password)
