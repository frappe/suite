import frappe

from suite.drive.webdav import ALLOWED_METHODS, RELINKED_METHODS, parse_webdav_methods


def global_webdav_enabled() -> bool:
    return bool(frappe.get_cached_doc("Drive Disk Settings").get("webdav_enabled"))


def allowed_webdav_methods() -> tuple[str, ...]:
    """The admin-configured method allow-list; empty setting = all methods.
    The stored value is validated on save, but unknown tokens (e.g. written
    directly to the DB) are ignored rather than failing every request."""
    raw = frappe.get_cached_doc("Drive Disk Settings").get("webdav_allowed_methods")
    methods, unknown = parse_webdav_methods(raw)
    if unknown and methods == ("OPTIONS",):
        # nothing valid beyond the implied OPTIONS - treat as unconfigured
        # rather than locking the whole site down to the handshake
        methods = ALLOWED_METHODS
    # the admin's list narrows the relinked surface; it never widens it
    return tuple(method for method in methods if method in RELINKED_METHODS)


def dav_compliance(methods: tuple[str, ...]) -> str:
    """Advertise lock support (class 2) only when LOCK/UNLOCK are allowed —
    clients like Finder trust this header to decide read-write behavior."""
    return "1, 2, 3" if "LOCK" in methods and "UNLOCK" in methods else "1, 3"


def user_webdav_enabled(user: str) -> bool:
    # opt-in: only an explicit enable grants access, so a lazily-missing
    # Drive Settings row reads as disabled
    return bool(frappe.db.get_value("Drive Settings", user, "webdav_enabled"))
