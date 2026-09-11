from typing import Literal

import frappe
from frappe import _
from frappe.utils import cint
from frappe.utils.caching import request_cache

from suite.mail.store import Entity, get_data_store
from suite.utils import reconnect_on_failure
from suite.utils.dt import utcnow
from suite.utils.user import is_system_manager

# Undo send: the choices offered for how long a plain Send is held before delivery (User
# Settings.undo_send_period). The same list backs the Select's options and the Mail UI's dropdown.
UNDO_SEND_PERIODS = (5, 10, 20, 30)
DEFAULT_UNDO_SEND_PERIOD = 5


def has_user_settings(user: str, raise_exception: bool = False) -> bool:
    """Returns True if the user has User Settings else False."""

    if frappe.db.exists("User Settings", {"user": user}):
        return True

    if raise_exception:
        frappe.throw(_("User {0} does not have User Settings configured.").format(frappe.bold(user)))

    return False


def get_undo_send_period(user: str) -> int:
    """Returns the seconds the user's plain Send is held so it can be undone.

    Falls back to the default when the user has no settings row yet or the stored value is off
    the list (a direct DB edit): the hold must never be zero or unbounded.
    """

    period = cint(frappe.db.get_value("User Settings", {"user": user}, "undo_send_period"))
    return period if period in UNDO_SEND_PERIODS else DEFAULT_UNDO_SEND_PERIOD


def get_jmap_configured_users() -> list[str]:
    """Returns enabled users that have JMAP credentials configured.

    The enabled flag lives on User — User Settings has no such field — so the two doctypes
    must be joined to filter on it.
    """

    USER = frappe.qb.DocType("User")
    USER_SETTINGS = frappe.qb.DocType("User Settings")

    return (
        frappe.qb.from_(USER_SETTINGS)
        .join(USER)
        .on(USER.name == USER_SETTINGS.user)
        .select(USER_SETTINGS.user)
        .where((USER.enabled == 1) & (USER_SETTINGS.username != "") & (USER_SETTINGS.username.isnotnull()))
    ).run(pluck="user")


def is_jmap_configured(user: str, raise_exception: bool = False) -> bool:
    """Returns True if the user has JMAP settings configured else False."""

    if frappe.db.exists("User Settings", {"user": user, "username": ["!=", None]}):
        return True

    if raise_exception:
        frappe.throw(_("User {0} does not have JMAP settings configured.").format(frappe.bold(user)))

    return False


@request_cache
def get_user_account_ids(user: str) -> list[str]:
    """Returns the JMAP account IDs the user has access to.

    The IDs are read from the user's cached JMAP session (populated whenever a JMAP
    connection is established). This is the source of truth for which JMAP Account
    a user may read/write, since those documents are shared per JMAP account ID.
    """

    from suite.mail.doctype.user_account.user_account import get_user_jmap_accounts

    return get_user_jmap_accounts(user)


def get_account_user(account: str, user: str | None = None) -> str:
    """Resolve the user whose JMAP connection authenticates requests for ``account``.

    Defaults to the explicitly provided ``user`` or the session user. An Administrator or
    System Manager may not personally have JMAP access to the account, so for them we fall
    back to any user linked to the account via User Account.
    """

    if user:
        return user

    from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account

    user = frappe.session.user
    if is_system_manager(user):
        if linked := get_user_for_jmap_account(account, ignore_permissions=True):
            return linked

    return user


def get_account_email(user: str | None = None) -> str | None:
    """The address of the user's mail account: their login on the cluster, kept in User Settings."""

    user = user or frappe.session.user
    return frappe.db.get_value("User Settings", {"user": user}, "username")


def get_account_emails(account: str) -> list[str]:
    """Returns the list of email addresses associated with the account."""

    from suite.mail.jmap import get_identities

    emails = []
    for identity in get_identities(account):
        emails.append(identity["email"])

    return emails


def get_user_email_address(user: str) -> str | None:
    """Returns the primary email address of the user."""

    return frappe.db.get_value("User", user, "email")


def get_sync_state(account: str, type: Literal["email"]) -> str | None:
    """Returns the Sync State for the given account and type."""

    store = get_data_store(account)
    value = store.get(Entity.STATE, f"{type}_current_state")

    return value


def update_sync_state(account: str, type: Literal["email"], state: str) -> None:
    """Updates the Sync State for the given account and type.

    The state (and its last-update timestamp, used to throttle scheduled syncs) lives in
    the per-account data store, shared across every user of the account.
    """

    store = get_data_store(account)
    current_state = store.get(Entity.STATE, f"{type}_current_state")
    store.set_many(
        Entity.STATE,
        {
            f"{type}_previous_state": current_state,
            f"{type}_current_state": state,
            f"{type}_state_last_update": utcnow(),
        },
    )


@reconnect_on_failure()
def clear_sync_state(account: str, type: Literal["email"]) -> None:
    """Clear the Sync State for the given account and type."""

    store = get_data_store(account)
    store.delete(Entity.STATE, f"{type}_current_state")
    store.delete(Entity.STATE, f"{type}_previous_state")
    store.delete(Entity.STATE, f"{type}_state_last_update")
