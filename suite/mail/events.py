from typing import Any

import frappe
from frappe import _
from frappe.core.doctype.user.user import _get_user_for_update_password
from frappe.core.doctype.user.user import update_password as update_frappe_password
from frappe.model.document import Document

from suite.mail.directory import delete_account as delete_mail_account
from suite.mail.directory import set_account_enabled
from suite.mail.directory import update_password as update_mail_password
from suite.mail.utils.user import is_jmap_configured
from suite.suite_core.utils import is_suite_cloud_configured
from suite.utils import execute_with_logging


def create_user_settings(doc: Document, method: str | None = None) -> None:
    """Create User Settings for the new user if not already present."""

    if not frappe.db.exists("User Settings", {"user": doc.name}):
        settings = frappe.new_doc("User Settings")
        settings.user = doc.name
        settings.insert(ignore_permissions=True, ignore_mandatory=True)


def delete_user_accounts(doc: Document, method: str | None = None) -> None:
    """Delete User Accounts when the user is deleted."""

    for account in frappe.db.get_all("User Account", filters={"user": doc.name}, pluck="name"):
        frappe.delete_doc("User Account", account, ignore_permissions=True, delete_permanently=True)


def delete_user_settings(doc: Document, method: str | None = None) -> None:
    """Delete User Settings when the user is deleted."""

    for settings in frappe.db.get_all("User Settings", filters={"user": doc.name}, pluck="name"):
        frappe.delete_doc("User Settings", settings, ignore_permissions=True, delete_permanently=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def update_password(
    new_password: str, logout_all_sessions: int = 0, key: str | None = None, old_password: str | None = None
) -> Any:
    """Override the default update_password whitelisted method to update the password on Stalwart server when the user updates their password."""

    previous = frappe.flags.in_update_password
    frappe.flags.in_update_password = True
    try:
        return _update_password(new_password, logout_all_sessions, key, old_password)
    finally:
        frappe.flags.in_update_password = previous


def _update_password(
    new_password: str, logout_all_sessions: int, key: str | None, old_password: str | None
) -> Any:
    from frappe.auth import MAX_PASSWORD_SIZE

    if len(new_password) > MAX_PASSWORD_SIZE:
        frappe.throw(_("Password size exceeded the maximum allowed size."))

    if not is_suite_cloud_configured():
        return update_frappe_password(
            new_password=new_password,
            logout_all_sessions=logout_all_sessions,
            key=key,
            old_password=old_password,
        )

    result = _get_user_for_update_password(key, old_password)
    user = result.get("user")
    if user:
        from frappe.utils.password import check_password

        from suite.suite_core.account_state import read

        if read(user).get("must_change_password"):
            try:
                unchanged = check_password(user, new_password) == user
            except frappe.AuthenticationError:
                unchanged = False
            if unchanged:
                frappe.throw(_("Choose a password different from your temporary password"))
            # Frappe's ordinary password flow logs in again (and commits its
            # session) before returning. Keep first-change policy and local
            # credentials in the caller's transaction until provider unlock
            # succeeds; otherwise a failed Mail change leaves a partial login.
            from frappe.core.doctype.user.user import handle_password_test_fail, test_password_strength
            from frappe.utils import today
            from frappe.utils.password import update_password as set_local_password

            from suite.mail.account_lifecycle import complete_password_change

            strength = test_password_strength(new_password)
            feedback = strength.get("feedback")
            if feedback and not feedback.get("password_policy_validation_passed", False):
                handle_password_test_fail(feedback)
            set_local_password(user, new_password)
            frappe.db.set_value("User", user, {"reset_password_key": "", "last_password_reset_date": today()})
            complete_password_change(user, new_password, allow_expired=bool(key))
            if frappe.session.user == "Guest":
                frappe.local.login_manager.login_as(user)
            return "/home"

    result = update_frappe_password(
        new_password=new_password, logout_all_sessions=logout_all_sessions, key=key, old_password=old_password
    )

    if user and is_jmap_configured(user):
        from suite.mail.account_lifecycle import complete_password_change

        complete_password_change(user, new_password, allow_expired=bool(key))

    return result


def update_account_password(doc: Document, method: str | None = None) -> None:
    """Updates the password on Stalwart server when the user updates their password."""

    if (
        frappe.flags.in_update_password
        or doc.flags.in_insert
        or not doc.enabled
        or not is_suite_cloud_configured()
        or not is_jmap_configured(doc.name)
    ):
        return

    user = doc.name
    new_password = doc._User__new_password

    if not new_password:
        return

    # An Admin password edit cannot clear first-login gating or unlock Mail.
    update_mail_password(user, new_password=new_password)


def delete_push_subscriptions_on_disable(doc: Document, method: str | None = None) -> None:
    """Delete this site's push subscriptions on the mail server when the user is disabled.

    Only the subscriptions wearing the site's device client id go; the user's custom ones stay.
    Ordered ahead of apply_disabled_account_role: that role may revoke the account's access on
    Stalwart, after which the JMAP delete would be refused.
    """

    if doc.flags.in_insert or doc.enabled or not doc.has_value_changed("enabled"):
        return
    if not is_jmap_configured(doc.name):
        return

    from suite.mail.doctype.push_subscription.push_subscription import delete_site_push_subscriptions

    user = doc.name
    execute_with_logging(
        lambda: delete_site_push_subscriptions(user),
        title="Failed to delete push subscriptions on mail server",
        with_context=False,
        module="Mail",
    )


def clear_sessions_on_disable(doc: Document, method: str | None = None) -> None:
    """Log the user out everywhere when they are disabled.

    Clears both the user's Frappe sessions and their cached JMAP session so a disabled user
    loses access immediately instead of continuing on an existing session until it expires.
    """

    if doc.flags.in_insert or doc.enabled or not doc.has_value_changed("enabled"):
        return

    from frappe.sessions import clear_sessions

    from suite.mail.jmap import clear_jmap_session

    clear_sessions(user=doc.name, force=True)
    clear_jmap_session(doc.name)


def apply_disabled_account_role(doc: Document, method: str | None = None) -> None:
    """Locks the user's mail account when the user is disabled.

    Suite Cloud swaps the account onto its locked role: it keeps receiving mail but can no
    longer log in, send or read.
    """

    if (
        doc.flags.in_insert
        or doc.enabled
        or not doc.has_value_changed("enabled")
        or not is_suite_cloud_configured()
        or not is_jmap_configured(doc.name)
    ):
        return

    # A failed provider lock must fail the workflow, never report a completed
    # suspension while existing Mail clients can still send (§4.2).
    set_account_enabled(doc.name, False)


def remove_disabled_account_role(doc: Document, method: str | None = None) -> None:
    """Unlocks the user's mail account when the user is re-enabled."""

    if (
        doc.flags.in_insert
        or not doc.enabled
        or not doc.has_value_changed("enabled")
        or not is_suite_cloud_configured()
        or not is_jmap_configured(doc.name)
    ):
        return

    # Propagate readiness/unlock failures so User/root changes roll back and
    # the account remains disabled with a retryable error (§4.2).
    from suite.suite_core.account_state import read

    if not read(doc.name).get("must_change_password"):
        set_account_enabled(doc.name, True)


def delete_account(doc: Document, method: str | None = None) -> None:
    if not is_suite_cloud_configured() or not is_jmap_configured(doc.name):
        return

    user = doc.name
    execute_with_logging(
        lambda: delete_mail_account(user),
        title="Failed to delete the mail account",
        with_context=False,
        module="Mail",
    )

    # The cached JMAP session carries the account's ids. Left behind, a user recreated on the same
    # address would inherit the deleted account's ids and every call would be scoped to an account
    # the server no longer considers theirs.
    from suite.mail.jmap import clear_jmap_session

    clear_jmap_session(user)
