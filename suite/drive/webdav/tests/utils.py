import base64

import frappe
from frappe.utils.password import update_password
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request, Response

from suite.drive.webdav.dispatch import DAVResponseException, handle_before_request
from suite.tests.utils import ensure_user


def ensure_system_settings_saveable() -> None:
    """CI sites skip the setup wizard, leaving System Settings' mandatory
    language/time_zone empty — any later save (e.g. change_settings) then hits
    MandatoryError. Backfill the effective defaults so the doc round-trips."""
    current = frappe.db.get_value("System Settings", "System Settings", ["language", "time_zone"])
    language, time_zone = current or (None, None)
    if not language:
        frappe.db.set_single_value("System Settings", "language", "en")
    if not time_zone:
        frappe.db.set_single_value("System Settings", "time_zone", frappe.utils.get_system_timezone())
    if not language or not time_zone:
        frappe.clear_document_cache("System Settings", "System Settings")


def error_logs(filters: dict, field: str = "name") -> list:
    """Error Log rows matching ``filters``. They live in Frappe's log database, not ``frappe.db``,
    and outlast a rollback."""

    return frappe.get_all("Error Log", filters=filters, pluck=field)


def delete_error_logs(filters: dict) -> None:
    for name in error_logs(filters):
        frappe.get_doc("Error Log", name).delete()


def ensure_user_with_password(email: str, password: str) -> None:
    ensure_user(email)
    update_password(email, password)


def enable_user_webdav(user: str, commit: bool = False) -> None:
    """Flip the (opt-in, default-off) per-user toggle for a test user."""
    if not frappe.db.exists("Drive Settings", user):
        frappe.get_doc({"doctype": "Drive Settings", "user": user}).insert(ignore_permissions=True)
    frappe.db.set_value("Drive Settings", user, "webdav_enabled", 1, update_modified=False)
    if commit:
        frappe.db.commit()


def basic_header(user: str, password: str) -> str:
    return "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()


def set_dav_request(
    method: str,
    path: str,
    *,
    user: str | None = None,
    password: str = "",
    headers: dict[str, str] | None = None,
    data: bytes = b"",
    content_type: str | None = None,
) -> Request:
    headers = dict(headers or {})
    if user is not None:
        headers["Authorization"] = basic_header(user, password)
    builder = EnvironBuilder(method=method, path=path, headers=headers, data=data, content_type=content_type)
    frappe.local.request = Request(builder.get_environ())
    return frappe.local.request


def dispatch(*args, **kwargs) -> Response | None:
    """Run the before_request hook; return the DAV response, or None on passthrough."""
    set_dav_request(*args, **kwargs)
    try:
        handle_before_request()
    except DAVResponseException as e:
        return e.response
    return None


def make_ctx(method: str, path: str, user: str, **kwargs):
    """DavContext for calling a verb handler directly (dispatcher bypassed)."""
    from suite.drive.webdav import context, pathmap

    pathmap.reset_memo()
    request = set_dav_request(method, path, **kwargs)
    frappe.set_user(user)
    return context.build(request, user)


def write_file_fixture(parent: str, name: str, data: bytes, mime_type: str = "text/plain"):
    """A Drive file whose bytes really exist on local disk."""
    from suite.drive.utils import create_drive_file
    from suite.drive.utils.files import FileManager

    manager = FileManager()

    def entity_path(file):
        relative = manager.get_disk_path(file)
        full = manager.site_folder / relative
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_bytes(data)
        return "/" + str(relative)

    return create_drive_file(name, parent, "Text", entity_path, mime_type, len(data))
