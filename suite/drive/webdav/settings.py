import frappe

from suite.drive.webdav import ALLOWED_METHODS, RELINKED_METHODS, parse_webdav_methods


def global_webdav_enabled() -> bool:
    return bool(frappe.get_cached_doc("Drive Disk Settings").get("webdav_enabled"))


def allowed_webdav_methods() -> tuple[str, ...]:
    """The admin-configured method allow-list, narrowed to the relinked verbs.

    An empty setting means the admin has not narrowed anything, so the answer
    is every relinked method. The stored value is validated on save, but
    unknown tokens (e.g. written directly to the DB) are ignored rather than
    failing every request."""
    raw = frappe.get_cached_doc("Drive Disk Settings").get("webdav_allowed_methods")
    methods, unknown = parse_webdav_methods(raw)
    if unknown and methods == ("OPTIONS",):
        # nothing valid beyond the implied OPTIONS - treat as unconfigured
        # rather than locking the whole site down to the handshake
        methods = ALLOWED_METHODS
    # the admin's list narrows the relinked surface; it never widens it
    return tuple(method for method in methods if method in RELINKED_METHODS)


def dav_compliance(methods: tuple[str, ...]) -> str:
    """The compliance classes this site can actually honour, as a header value.

    Class 1 is PROPFIND: RFC 4918 §9.1 makes it the one request every class 1
    resource must answer, and a client that reads `DAV: 1` and then gets 405
    has been told a lie it cannot recover from. An allow-list without PROPFIND
    claims nothing, and the caller omits the header entirely.

    Class 2 is LOCK and UNLOCK, and Finder trusts it to decide whether a mount
    is read-write. Class 3 says RFC 4918 rather than RFC 2518, which is a
    statement about this implementation and rides with class 1.
    """
    if "PROPFIND" not in methods:
        return ""
    return "1, 2, 3" if "LOCK" in methods and "UNLOCK" in methods else "1, 3"


def user_webdav_enabled(user: str) -> bool:
    # opt-in: only an explicit enable grants access, so a lazily-missing
    # Drive Settings row reads as disabled
    return bool(frappe.db.get_value("Drive Settings", user, "webdav_enabled"))
