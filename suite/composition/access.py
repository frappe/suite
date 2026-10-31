"""Authenticated access gates shared by browser, API and Drive WebDAV requests."""

import frappe
from frappe import _

from suite.suite_core.account_state import read, require_temporary_valid
from suite.suite_core.utils import is_suite_cloud_configured
from suite.utils.user import is_suite_admin


class PasswordChangeRequired(frappe.PermissionError):
    http_status_code = 403


class AccountSetupRequired(frappe.PermissionError):
    http_status_code = 403


_PASSWORD_METHODS = frozenset(
    {
        "logout",
        "login",
        "frappe.translate.get_boot_translations",
        "suite.api.routes.account_get",
        "suite.api.routes.logout",
        "frappe.handler.logout",
        "suite.mail.events.update_password",
        "frappe.core.doctype.user.user.update_password",
    }
)
# Products that run on the user's business Mail account. Drive, Writer and the
# rest of Suite work without it.
_MAIL_ACCOUNT_METHODS = ("suite.mail.", "mail.", "suite.calendar.")


def _mail_admin_method(method: str) -> bool:
    from suite.mail.http.routes import ROUTES as mail_routes

    for route in mail_routes:
        if (
            isinstance(route.public_name, str)
            and route.public_name.startswith("admin.")
            and method == f"suite.mail.http.routes.{route.handler}"
        ):
            return True
    return method.startswith("suite.mail.api.admin.")


def require_access(user: str, *, method: str = "", page: bool = False) -> None:
    if user in ("Guest", "Administrator") or not is_suite_cloud_configured():
        return
    from suite import mail

    if mail.provider_health()["suspended"]:
        frappe.throw(
            _("This site is suspended by Suite Cloud. Contact your provider."), frappe.PermissionError
        )
    current = read(user)
    if current.get("must_change_password"):
        require_temporary_valid(user)
        if method in _PASSWORD_METHODS or page:
            return
        frappe.throw(_("Change your temporary password before using Suite"), PasswordChangeRequired)
    if not method.startswith(_MAIL_ACCOUNT_METHODS):
        return
    failed = current.get("status") in ("Setup failed", "Deleted", "Deletion failed")
    account = frappe.db.get_value("User Settings", {"user": user}, "username")
    if failed or not account:
        # Remediation is available to a business Admin without a Mail account.
        # This is not a developer-mode or technical-role bypass.
        if is_suite_admin(user) and _mail_admin_method(method):
            return
        frappe.throw(_("Complete business Mail account setup before using Mail"), AccountSetupRequired)


def authenticated_request() -> None:
    request = getattr(frappe.local, "request", None)
    if not request:
        return
    path = request.path
    method = frappe.form_dict.get("cmd") or path.removeprefix("/api/v2/method/").removeprefix("/api/method/")
    # Public SPA HTML contains no product data. Its router uses the account
    # access state to show the password or Mail setup screen; data requests stay gated.
    page = request.method == "GET" and not path.startswith(
        ("/api/", "/private/", "/files/", "/backups/", "/f/")
    )
    require_access(frappe.session.user, method=method, page=page)


def on_login(login_manager) -> None:
    user = login_manager.user
    if user not in ("Guest", "Administrator") and is_suite_cloud_configured():
        require_temporary_valid(user)
        from suite import mail

        if mail.provider_health()["suspended"]:
            frappe.throw(_("This site is suspended by Suite Cloud"), frappe.AuthenticationError)


def before_login(login_manager) -> None:
    """A business address resolves its current holder, never its deleted identity."""
    address = (frappe.form_dict.get("usr") or "").strip().lower()
    if address and is_suite_cloud_configured():
        holder = frappe.db.get_value("User Settings", {"username": address}, "user")
        if holder:
            frappe.form_dict.usr = holder
