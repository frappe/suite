"""HTTP Basic authentication against Frappe credentials.

The Basic pair is either the Frappe username and password, or the user's
api_key:api_secret — tried in that order of specificity: a key lookup first
(keys are generated hashes, never emails), then the password path. API
credentials are their own factor, so they work for 2FA accounts and when
password login is disabled site-wide — the same stance frappe's token auth
takes. Passwords are verified with frappe's own check_password; a short-lived
HMAC cache skips the deliberately-slow hash verification that clients would
otherwise trigger on every single request.
"""

import base64
import binascii
import hashlib
import hmac
import secrets

import frappe
from frappe.auth import MAX_PASSWORD_SIZE, LoginAttemptTracker
from frappe.utils import cint
from frappe.utils.password import check_password, get_decrypted_password, passlibctx
from werkzeug.wrappers import Request

from suite.drive.webdav.errors import AuthRequired, Forbidden

REALM = "Frappe Drive"
CRED_CACHE_TTL = 600
# WebDAV lockout counters live in their own key space so a brute force against
# /dav cannot lock a user out of the web UI (frappe's login shares one hash)
LOCKOUT_KEY_NS = "webdav:"


def authenticate(request: Request) -> str:
    """Return the canonical user for this request's Basic credentials, or raise 401/403."""
    credentials = _parse_basic(request.headers.get("Authorization"))
    if not credentials:
        # Windows always probes unauthenticated first: challenge without
        # touching the login-attempt tracker, or normal connects lock accounts.
        raise _challenge("Authentication required.")

    user, password = credentials
    if not user or not password or user == "Guest" or len(password) > MAX_PASSWORD_SIZE:
        raise _challenge("Incorrect user or password.")

    trackers = _trackers(user)
    if _locked_out(trackers):
        raise Forbidden(
            "Too many failed login attempts. Try again later.",
            headers={"Retry-After": str(_lock_interval())},
        )

    api_user = _api_key_user(user)
    if api_user is not None:
        # API credentials are their own factor: the 2FA and
        # disable_user_pass_login gates below govern password logins only
        if _api_secret_valid(api_user.name, password) and cint(api_user.enabled):
            for tracker in trackers:
                tracker.add_success_attempt()
            return api_user.name
        # a matching key with a wrong secret (or a disabled account) must be
        # indistinguishable from any other bad credential
        _record_failure(trackers)
        raise _challenge("Incorrect user or password.")

    if frappe.get_system_settings("disable_user_pass_login"):
        raise Forbidden("Password login is disabled on this site, so WebDAV is unavailable.")

    canonical = _verify_cached(user, password)
    verified_now = False
    if not canonical:
        try:
            canonical = check_password(user, password, delete_tracker_cache=False)
        except frappe.AuthenticationError:
            # wrong password, unknown user and passwordless (social-login) user
            # are indistinguishable on purpose — including by timing: check_password
            # skips the slow hash when no stored hash exists, so equalize it here
            if not _stored_hash_fingerprint(user):
                _equalize_hash_timing(password)
            _record_failure(trackers)
            _delete_cache(user)
            raise _challenge("Incorrect user or password.") from None
        verified_now = True

    # Policy checks run on every request, never cached. A blocked account
    # (disabled, or 2FA which WebDAV clients cannot perform) must return the
    # SAME generic challenge as a wrong password: a distinguishable reply would
    # confirm the password is correct — a credential oracle the block cannot
    # otherwise leak.
    if not cint(frappe.db.get_value("User", canonical, "enabled")):
        _record_failure(trackers)
        _delete_cache(user)
        raise _challenge("Incorrect user or password.")

    if _requires_two_factor(canonical):
        # correct password, but not a tracker failure (would lock a real user
        # whose client is merely mis-pointed at WebDAV)
        _delete_cache(user)
        raise _challenge("Incorrect user or password.")

    # only cache credentials that are actually allowed to authenticate
    if verified_now:
        _store_cache(user, password, canonical)
    for tracker in trackers:
        tracker.add_success_attempt()
    return canonical


def _parse_basic(header: str | None) -> tuple[str, str] | None:
    if not header:
        return None
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "basic" or not token:
        return None
    try:
        raw = base64.b64decode(token.strip())
    except binascii.Error, ValueError:
        return None
    try:
        decoded = raw.decode("utf-8")
    except UnicodeDecodeError:
        decoded = raw.decode("latin-1")
    if ":" not in decoded:
        return None
    user, _, password = decoded.partition(":")
    return user.strip(), password


def _challenge(message: str) -> AuthRequired:
    return AuthRequired(
        message,
        headers={"WWW-Authenticate": f'Basic realm="{REALM}", charset="UTF-8"'},
    )


def _requires_two_factor(user: str) -> bool:
    from frappe.twofactor import should_run_2fa

    return bool(should_run_2fa(user))


# --- api_key:api_secret (generated from the WebDAV settings panel) ---


def _api_key_user(api_key: str) -> frappe._dict | None:
    """The user owning this api_key, or None to fall through to password auth.
    Keys are generated hashes and never contain '@', so email logins skip the
    lookup entirely."""
    if "@" in api_key:
        return None
    return frappe.db.get_value("User", {"api_key": api_key}, ["name", "enabled"], as_dict=True)


def _api_secret_valid(user: str, presented: str) -> bool:
    stored = get_decrypted_password("User", user, fieldname="api_secret", raise_exception=False)
    return bool(stored) and hmac.compare_digest(presented.encode(), stored.encode())


# --- login-attempt tracking (its own key space; see LOCKOUT_KEY_NS) ---


def _trackers(user: str) -> list[LoginAttemptTracker]:
    # the DB resolves user names case-insensitively, so case variants of one
    # account must share a counter (the credential cache lowercases the same way)
    keys = [LOCKOUT_KEY_NS + user.lower()]
    if request_ip := getattr(frappe.local, "request_ip", None):
        keys.append(LOCKOUT_KEY_NS + request_ip)
    interval = _lock_interval()
    attempts = _max_attempts()
    if attempts:
        return [LoginAttemptTracker(key, attempts, interval) for key in keys]
    return [LoginAttemptTracker(key) for key in keys]


def _locked_out(trackers: list[LoginAttemptTracker]) -> bool:
    if not _max_attempts():
        return False
    return any(not tracker.is_user_allowed() for tracker in trackers)


def _record_failure(trackers: list[LoginAttemptTracker]) -> None:
    for tracker in trackers:
        tracker.add_failure_attempt()


def _max_attempts() -> int:
    return cint(frappe.get_system_settings("allow_consecutive_login_attempts"))


def _lock_interval() -> int:
    return cint(frappe.get_system_settings("allow_login_after_fail")) or 60


# --- timing equalization (see the authenticate() failure path) ---
# A passlib hash of a throwaway secret, computed once, so the no-stored-hash
# failure path can spend the same verify time as a wrong-password path.
_DUMMY_HASH: str | None = None


def _equalize_hash_timing(password: str) -> None:
    global _DUMMY_HASH
    try:
        if _DUMMY_HASH is None:
            _DUMMY_HASH = passlibctx.hash("webdav-timing-equalizer")
        passlibctx.verify(password, _DUMMY_HASH)
    except Exception:
        pass


# --- credential cache (skip passlib on the hot path) ---
# HMAC-SHA256 with a fresh 128-bit salt per entry: the cache exists to remove
# the slow hash, and the short TTL bounds exposure if Redis itself is owned.
# Entries are bound to a fingerprint of the stored password hash, so a password
# change invalidates them immediately (one indexed __Auth read per hit).


def _cache_key(user: str) -> str:
    return f"webdav_cred:{user.lower()}"


def _verify_cached(user: str, password: str) -> str | None:
    payload = frappe.cache.get_value(_cache_key(user))
    if not payload:
        return None
    try:
        salt_hex, digest_hex, fingerprint, canonical = payload.split(":", 3)
        digest = hmac.new(bytes.fromhex(salt_hex), password.encode("utf-8"), hashlib.sha256)
    except ValueError, AttributeError:
        return None
    if not hmac.compare_digest(digest.hexdigest(), digest_hex):
        return None
    if fingerprint != _stored_hash_fingerprint(canonical):
        # password changed since the entry was stored
        _delete_cache(user)
        return None
    return canonical


def _store_cache(user: str, password: str, canonical: str) -> None:
    # fingerprint by the User row's real name — the submitted casing can miss
    # on a case-sensitive __Auth lookup
    fingerprint = _stored_hash_fingerprint(canonical)
    if not fingerprint:
        return
    salt = secrets.token_bytes(16)
    digest = hmac.new(salt, password.encode("utf-8"), hashlib.sha256).hexdigest()
    frappe.cache.set_value(
        _cache_key(user),
        f"{salt.hex()}:{digest}:{fingerprint}:{canonical}",
        expires_in_sec=CRED_CACHE_TTL,
    )


def _stored_hash_fingerprint(user: str) -> str | None:
    auth_table = frappe.qb.DocType("__Auth")
    result = (
        frappe.qb.from_(auth_table)
        .select(auth_table.password)
        .where(
            (auth_table.doctype == "User")
            & (auth_table.name == user)
            & (auth_table.fieldname == "password")
            & (auth_table.encrypted == 0)
        )
        .limit(1)
        .run()
    )
    if not result:
        return None
    return hashlib.sha256(result[0][0].encode()).hexdigest()[:16]


def _delete_cache(user: str) -> None:
    frappe.cache.delete_value(_cache_key(user))
