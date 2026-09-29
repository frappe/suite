"""The WebDAV switches, and the two settings documents that hold them.

`Drive Disk Settings` is the site's Single (§3.13) and holds the site switch.
`Drive Settings` is one row per user (§3.14) and holds the per-user opt-in.
The DAV dispatcher reads both on every request, and the §11.2 settings routes
read and write them through the functions below.

A Drive admin is a caller with write on `Drive Disk Settings`. That is the one
rule every admin-only Drive setting shares, and `is_drive_admin` is its only
spelling.
"""

import frappe
from frappe import _
from frappe.utils import cint

from suite.drive._core.errors import DriveForbidden
from suite.drive.webdav import ALLOWED_METHODS, parse_webdav_methods

# What a Drive admin reads from `Drive Disk Settings` beyond what everyone reads.
# The rest of the Single is dropped in Cleanup (§3.13) and is not published.
ADMIN_SITE_FIELDS = ("webdav_enabled", "webdav_allowed_methods", "default_personal_quota", "shared_quota")


def is_drive_admin() -> bool:
    """Whether the session user has write on `Drive Disk Settings`."""
    return bool(frappe.has_permission("Drive Disk Settings", "write"))


def user_settings(user: str) -> dict:
    """One user's `Drive Settings` row, or the field defaults when it has none.

    `writer_settings` is stored as JSON text and answered as the object it
    holds.
    """
    row = frappe.db.get_value(
        "Drive Settings", user, ("webdav_enabled", "writer_settings"), as_dict=True
    ) or frappe.new_doc("Drive Settings")
    return {
        "webdav_enabled": bool(row.webdav_enabled),
        "writer_settings": frappe.parse_json(row.writer_settings) or {},
    }


def set_user_webdav_enabled(user: str, enabled: bool) -> None:
    """Write one user's DAV opt-in, and create their row on the first write.

    Two first writes can both find no row. The row is named by `user`, so the
    second insert fails on the name. That insert runs in a savepoint, and the
    loser then updates the row the winner made.
    """
    if not frappe.db.exists("Drive Settings", user):
        frappe.db.savepoint("drive_settings_first_write")
        try:
            frappe.get_doc(
                {"doctype": "Drive Settings", "user": user, "webdav_enabled": int(enabled)}
            ).insert()
            return
        except frappe.DuplicateEntryError:
            frappe.db.rollback(save_point="drive_settings_first_write")
    settings = frappe.get_doc("Drive Settings", user)
    settings.webdav_enabled = int(enabled)
    settings.save()


def site_settings() -> dict:
    """The site's Drive settings as the session user may read them.

    Everyone reads `preview_size` and whether they are an admin. Only an admin
    reads the WebDAV switch, the method allow-list, and the quota defaults.

    A Single stores every value as text, and a `Long Int` loads back as a
    string. Each number is cast here, so the answer carries integers.
    """
    settings = frappe.get_cached_doc("Drive Disk Settings")
    admin = is_drive_admin()
    answer = {"is_admin": admin, "preview_size": cint(settings.preview_size)}
    if admin:
        answer |= {
            "webdav_enabled": bool(cint(settings.webdav_enabled)),
            "webdav_allowed_methods": settings.webdav_allowed_methods or "",
            "default_personal_quota": cint(settings.default_personal_quota),
            "shared_quota": cint(settings.shared_quota),
        }
    return answer


def set_global_webdav_enabled(enabled: bool) -> None:
    """Turn the site's DAV mount on or off. A Drive admin only.

    The refusal comes before any write.
    """
    if not is_drive_admin():
        raise DriveForbidden(_("Only a Drive admin can turn WebDAV on or off for the site"))
    frappe.db.set_single_value("Drive Disk Settings", "webdav_enabled", int(enabled))
    frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")


def webdav_access() -> dict:
    """What the WebDAV settings panel shows the session user.

    Empty when the site switch is off and the caller is no admin: the client
    hides the whole panel then. An admin sees the switch while it is off.
    While it is on, everyone also gets the connection details. The API secret
    is never read here.
    """
    from frappe.twofactor import should_run_2fa

    user = frappe.session.user
    admin = is_drive_admin()
    enabled = global_webdav_enabled()
    if not enabled and not admin:
        return {}

    access = {"globally_enabled": enabled, "is_admin": admin}
    if enabled:
        access |= {
            "server_url": frappe.utils.get_url("/dav/"),
            "username": user,
            "enabled_for_user": user_webdav_enabled(user),
            "two_factor_blocked": bool(should_run_2fa(user)),
            "api_key": frappe.db.get_value("User", user, "api_key"),
        }
    return access


def global_webdav_enabled() -> bool:
    return bool(frappe.get_cached_doc("Drive Disk Settings").get("webdav_enabled"))


def allowed_webdav_methods() -> tuple[str, ...]:
    """The admin-configured method allow-list, narrowed to what DAV implements.

    An empty setting means the admin has not narrowed anything, so the answer
    is every implemented method. The stored value is validated on save, but
    unknown tokens (e.g. written directly to the DB) are ignored rather than
    failing every request."""
    raw = frappe.get_cached_doc("Drive Disk Settings").get("webdav_allowed_methods")
    methods, unknown = parse_webdav_methods(raw)
    if unknown and methods == ("OPTIONS",):
        # nothing valid beyond the implied OPTIONS - treat as unconfigured
        # rather than locking the whole site down to the handshake
        methods = ALLOWED_METHODS
    # the admin's list narrows the implemented surface; it never widens it
    return tuple(method for method in methods if method in ALLOWED_METHODS)


def allow_header_without(method: str) -> str:
    """The `Allow` value for a URL that takes everything except `method`.

    RFC 7231 §6.5.5 makes `Allow` mandatory on a 405. A resource-level refusal
    (PUT at a collection, MKCOL where something already exists) without it
    tells the client the request failed but not what to send instead, and
    Windows retries the same verb. The answer is the site's offered list minus
    the one verb this URL will not take.
    """
    return ", ".join(offered for offered in allowed_webdav_methods() if offered != method)


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
