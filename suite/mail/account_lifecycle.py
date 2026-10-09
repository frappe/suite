"""Complete provider account workflows, including first-login credential isolation."""

import secrets
from uuid import uuid4

import frappe
from frappe import _
from frappe.sessions import clear_sessions
from frappe.utils import add_to_date, now_datetime, validate_email_address
from frappe.utils.password import update_password as set_local_password

from suite.mail.directory import get_active_domain_names, provision_account, set_account_enabled
from suite.mail.jmap import clear_jmap_session
from suite.mail.suite_cloud import get_client
from suite.suite_core.account_state import read, write
from suite.suite_core.administration import require_admin
from suite.suite_core.storage import state


def provision(user: str, address: str, *, password: str, operation: str, **options) -> None:
    """Provision/restore one identity and keep it locked until explicit activation.

    Settings validate the private app credential before the provider lock. This
    credential is never disclosed to the user; the temporary Suite credential
    is a different secret and has never been a Mail-client password.
    """
    account = provision_account(
        address, secrets.token_urlsafe(48), operation=operation, disk_quota_gb=0, **options
    )
    client = get_client()
    client.call("mail.accounts.set_account_enabled", email=address, enabled=True)
    try:
        settings = frappe.get_doc("User Settings", {"user": user})
        settings.username = address
        settings.app_password = account["app_password"]
        settings.save(ignore_permissions=True)
    finally:
        client.call("mail.accounts.set_account_enabled", email=address, enabled=False)
    clear_jmap_session(user)


def replace_temporary_password(user: str) -> dict:
    caller = require_admin()
    if user in ("Guest", "Administrator"):
        frappe.throw(_("Recovery identities cannot receive temporary passwords"), frappe.PermissionError)
    if user == caller:
        frappe.throw(_("Change your own password from account settings"), frappe.PermissionError)
    if (
        "System Manager" in frappe.get_roles(user)
        and caller != "Administrator"
        and "System Manager" not in frappe.get_roles(caller)
    ):
        frappe.throw(
            _("A business Admin cannot replace a technical manager's credentials"), frappe.PermissionError
        )
    frappe.db.get_value("User", user, "name", for_update=True)
    current = read(user)
    if not current.get("account") or current.get("status") in ("Deleted", "Deletion failed", "Setup failed"):
        frappe.throw(_("Complete Mail account setup before issuing credentials"))
    # Lock and revoke first: no client may use old credentials while the new
    # Suite-only password awaits replacement. Incoming Mail remains enabled.
    set_account_enabled(user, False)
    temporary = secrets.token_urlsafe(32)
    set_local_password(user, temporary)
    clear_sessions(user=user, force=True)
    clear_jmap_session(user)
    from frappe.utils.password import remove_encrypted_password

    frappe.db.set_value("User", user, "api_key", None)
    remove_encrypted_password("User", user, "api_secret")
    frappe.db.delete("OAuth Bearer Token", {"user": user})
    expiry = add_to_date(now_datetime(), days=7)
    write(user, must_change_password=1, temporary_expires_at=expiry, status="Password change required")
    return {"user": user, "temporary_password": temporary, "expires_at": expiry.isoformat()}


def recreate(user: str, address: str) -> dict:
    caller = require_admin()
    if (
        "System Manager" in frappe.get_roles(user)
        and caller != "Administrator"
        and "System Manager" not in frappe.get_roles(caller)
    ):
        frappe.throw(
            _("A business Admin cannot replace a technical manager's credentials"), frappe.PermissionError
        )
    state(lock=True)  # Serialize address claims with invitations/direct creation.
    frappe.db.get_value("User", user, "name", for_update=True)
    if frappe.db.get_value("User", user, "enabled") != 0:
        frappe.throw(_("Keep the Suite user disabled while recreating its Mail account"))
    address = address.strip().lower()
    validate_email_address(address, throw=True)
    if address.rsplit("@", 1)[-1] not in get_active_domain_names():
        frappe.throw(_("Choose a verified, enabled business domain"))
    current = read(user)
    settings = frappe.db.get_value("User Settings", {"user": user}, "username")
    if settings and current.get("status") != "Setup failed":
        frappe.throw(_("Delete the retained Mail account before recreating it"))
    if current.get("status") == "Deletion failed":
        frappe.throw(_("Finish the failed deletion before reusing any address"))
    claimed = frappe.db.exists("User Settings", {"username": address, "user": ["!=", user]})
    if claimed or frappe.db.exists("Suite Account State", {"account": address, "status": "Deletion failed"}):
        frappe.throw(_("This address belongs to another Suite user"))
    operation = (
        current.get("operation")
        if current.get("status") == "Setup failed" and current.get("account") == address
        else uuid4().hex
    )
    write(user, account=address, operation=operation, status="Setup failed")
    # Return failure as a workflow outcome so the retry identity persists. Do
    # not turn an uncertain provider response into permission to delete/reclaim.
    try:
        provision(user, address, password=secrets.token_urlsafe(48), operation=operation)
    except Exception:
        return {
            "user": user,
            "success": False,
            "status": "Setup failed",
            "error": _("Mail account setup failed. Retry with the same address."),
            "temporary_password": None,
            "expires_at": None,
        }
    write(user, status="Active", must_change_password=0, temporary_expires_at=None)
    credential = replace_temporary_password(user)
    invalidate_measurements(user, address)
    return {**credential, "success": True, "status": "Password change required", "error": None}


def invalidate_measurements(user: str, address: str) -> None:
    import json

    doc, _policy, measurements = state(lock=True)
    measurements.get("entries", {}).pop(address, None)
    measurements.get("personal", {}).pop(user, None)
    measurements.update(site_mail=None, stale=True)
    doc.measurements = json.dumps(measurements)
    doc.save(ignore_permissions=True)


def complete_password_change(user: str, password: str, *, allow_expired: bool = False) -> None:
    """Provider remains locked through password rotation; unlock is the last effect."""
    from suite.mail.directory import update_password

    current = read(user)
    if current.get("must_change_password") and not allow_expired:
        from suite.suite_core.account_state import require_temporary_valid

        require_temporary_valid(user)
    update_password(user, new_password=password)
    # Disabled users can reset their password without being reactivated.
    if frappe.db.get_value("User", user, "enabled"):
        set_account_enabled(user, True)
    write(user, must_change_password=0, temporary_expires_at=None, status="Active")
    clear_jmap_session(user)


def delete(user: str, confirmation: str) -> dict:
    from frappe.utils.password import remove_encrypted_password

    from suite.mail.directory import delete_account_by_email
    from suite.mail.events import delete_user_accounts

    require_admin()
    frappe.db.get_value("User", user, "name", for_update=True)
    address = frappe.db.get_value("User Settings", {"user": user}, "username") or read(user).get("account")
    if (
        not address
        or confirmation.strip().lower() != address.lower()
        or frappe.db.get_value("User", user, "enabled") != 0
    ):
        frappe.throw(
            _("Disable the user and confirm the exact retained account address before deleting Mail")
        )
    write(user, account=address, status="Deletion failed")
    provider_deleted = False
    try:
        delete_account_by_email(address)
        provider_deleted = True
        settings = frappe.get_doc("User Settings", {"user": user})
        settings._db_set(username=None, app_password=None)
        remove_encrypted_password("User Settings", settings.name, "app_password")
        delete_user_accounts(frappe.get_doc("User", user))
        clear_jmap_session(user)
        clear_sessions(user=user, force=True)
        invalidate_measurements(user, address)
    except Exception:
        error = (
            _(
                "Provider Mail deletion completed, but local credential cleanup failed. Retry deletion; address reuse and reactivation remain blocked."
            )
            if provider_deleted
            else _(
                "Mail deletion is not confirmed. The user remains disabled and the address stays claimed. Retry deletion."
            )
        )
        return {
            "user": user,
            "success": False,
            "status": "Deletion failed",
            "error": error,
            "temporary_password": None,
            "expires_at": None,
        }
    write(
        user,
        account=None,
        operation=None,
        status="Deleted",
        must_change_password=0,
        temporary_expires_at=None,
    )
    clear_sessions(user=user, force=True)
    return {
        "user": user,
        "success": True,
        "status": "Deleted",
        "error": None,
        "temporary_password": None,
        "expires_at": None,
    }


def onboarding_options() -> dict:
    from suite.mail.directory import get_domains
    from suite.suite_core.utils import is_suite_cloud_configured

    require_admin()
    if not is_suite_cloud_configured():
        return {"cloud": False, "domains": [], "account": None, "ready": True}
    get_client().call("site.ping")
    domains = [
        domain["domain"] for domain in get_domains() if domain.get("enabled") and domain.get("is_verified")
    ]
    user = frappe.session.user
    account = frappe.db.get_value("User Settings", {"user": user}, "username")
    return {
        "cloud": True,
        "domains": domains,
        "account": account,
        "ready": bool(
            account
            and domains
            and read(user).get("status") not in ("Setup failed", "Deletion failed", "Deleted")
        ),
    }


def provision_first_admin(address: str, password: str) -> dict:
    from frappe.core.doctype.user.user import test_password_strength

    from suite.suite_core.utils import is_suite_cloud_configured

    user = require_admin()
    if user == "Administrator":
        frappe.throw(_("Create a business Admin first. Administrator is reserved for recovery."))
    if not is_suite_cloud_configured() or frappe.db.get_single_value("Suite Settings", "is_onboarded"):
        frappe.throw(_("Business Mail onboarding is not available on this site"))
    test_password_strength(password, user_data=[user])
    state(lock=True)
    current = read(user)
    options = onboarding_options()
    address = address.strip().lower()
    validate_email_address(address, throw=True)
    if address.rsplit("@", 1)[-1] not in options["domains"]:
        frappe.throw(_("Choose a provider-supplied or verified business domain"))
    if options["account"] and options["account"] != address:
        frappe.throw(_("Onboarding never renames an existing Mail account"))
    operation = current.get("operation") or uuid4().hex
    write(user, account=address, operation=operation, status="Setup failed")
    try:
        provision(user, address, password=password, operation=operation)
        from suite.mail.directory import update_password

        update_password(user, password)
        set_local_password(user, password)
        set_account_enabled(user, True)
    except Exception:
        return {
            "user": user,
            "success": False,
            "status": "Setup failed",
            "error": _("Business Mail setup failed. Retry without changing the address."),
            "temporary_password": None,
            "expires_at": None,
        }
    write(user, status="Active", must_change_password=0, temporary_expires_at=None)
    invalidate_measurements(user, address)
    return {
        "user": user,
        "success": True,
        "status": "Active",
        "error": None,
        "temporary_password": None,
        "expires_at": None,
    }
