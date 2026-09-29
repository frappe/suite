# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


from uuid import uuid7

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils.caching import request_cache

from suite.utils.permissions import OwnerFromUser
from suite.utils.user import is_administrator, is_system_manager


class UserAccount(OwnerFromUser, Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        account: DF.Link
        user: DF.Link
        user_settings: DF.Link
    # end: auto-generated types

    def autoname(self) -> None:
        self.name = str(uuid7())


@request_cache
def get_user_for_jmap_account(
    account: str,
    allow_system_manager: bool = True,
    raise_exception: bool = False,
    ignore_permissions: bool = False,
) -> str | None:
    """Returns the user for the given JMAP account ID. If no user is found, it returns None. If raise_exception is True, it raises an exception if the account does not belong to any user.

    Pass ignore_permissions=True to resolve a linked user regardless of the session user's
    role — for background jobs and unauthenticated flows (e.g. Guest RSVP requests) that
    act on an account they don't own.
    """

    if frappe.db.exists("JMAP Account", account):
        account_users = frappe.db.get_all("User Account", {"account": account}, pluck="user")

        if account_users:
            user = frappe.session.user

            if user in account_users:
                return user

            elif (
                ignore_permissions
                or is_administrator(user)
                or (allow_system_manager and is_system_manager(user))
            ):
                return _account_owner(account, account_users)

            elif raise_exception:
                frappe.throw(
                    _("JMAP account {0} does not belong to the user {1}.").format(
                        frappe.bold(account), frappe.bold(user)
                    )
                )

        elif raise_exception:
            frappe.throw(_("JMAP account {0} does not belong to any user.").format(frappe.bold(account)))

    elif raise_exception:
        frappe.throw(_("JMAP account {0} does not exist.").format(frappe.bold(account)))


@request_cache
def get_user_jmap_accounts(user: str | None = None, raise_exception: bool = False) -> list[str]:
    """Returns the list of JMAP accounts for the given user. If no user is provided, it defaults to the current session user.

    Cached per request: the returned list is shared, so callers must treat it as read-only.
    """

    user = user or frappe.session.user
    accounts = frappe.db.get_all("User Account", {"user": user}, pluck="account")

    if not accounts and raise_exception:
        frappe.throw(_("User {0} does not have any JMAP accounts configured.").format(frappe.bold(user)))

    return accounts


def is_jmap_account_belongs_to_user(
    account: str, user: str | None = None, raise_exception: bool = False
) -> bool:
    """Checks if the given JMAP account ID belongs to the specified user. If no user is provided, it defaults to the current session user."""

    user = user or frappe.session.user
    exists = bool(frappe.db.exists("User Account", {"user": user, "account": account}))

    if raise_exception and not exists:
        frappe.throw(
            _("JMAP account {0} does not belong to the user {1}.").format(
                frappe.bold(account), frappe.bold(user)
            )
        )

    return exists


def get_user_personal_jmap_account(user: str | None = None, raise_exception: bool = False) -> str | None:
    """Returns the personal JMAP account ID for the given user. If no user is provided, it defaults to the current session user."""

    user = user or frappe.session.user
    user_accounts = get_user_jmap_accounts(user, raise_exception=raise_exception)
    personal_accounts = frappe.db.get_all(
        "JMAP Account", {"is_personal": True, "name": ("in", user_accounts)}, ["name", "_name"]
    )

    if personal_accounts:
        if account := pick_personal_account(personal_accounts, get_username(user)):
            return account
        if raise_exception:
            frappe.throw(
                _("User {0} has multiple personal JMAP accounts configured.").format(frappe.bold(user))
            )

    elif raise_exception:
        frappe.throw(
            _("User {0} does not have a personal JMAP account configured.").format(frappe.bold(user))
        )


def get_username(user: str) -> str | None:
    """The user's login on the mail server."""

    return frappe.db.get_value("User Settings", {"user": user}, "username")


def pick_personal_account(personal_accounts: list[dict], username: str | None) -> str | None:
    """Which of a user's accounts flagged personal is theirs.

    `is_personal` is the account's own flag, the same for everyone linked to it: a colleague's
    account that shares a calendar with the user is personal — to the colleague. So where the
    user has more than one, theirs is the one named after their login, and it is ambiguous only
    when none or several are.
    """

    if len(personal_accounts) == 1:
        return personal_accounts[0]["name"]
    own = [account["name"] for account in personal_accounts if username and account["_name"] == username]
    return own[0] if len(own) == 1 else None


def _account_owner(account: str, users: list[str]) -> str:
    """Of the users linked to an account, the one whose login it is — the rest have something in
    it shared with them, and acting as one of them would reach only that. A team account nobody
    logs into as has no owner, and any member will do."""

    if len(users) > 1:
        name = frappe.db.get_value("JMAP Account", account, "_name")
        if owner := frappe.db.get_value("User Settings", {"user": ("in", users), "username": name}, "user"):
            return owner
    return users[0]


def get_enabled_account_user(account: str) -> str | None:
    """A user a background job can act as on the account, or None when there is none.

    Acting as Administrator resolves the account to its owner, or for a team account to its first
    member, who may be disabled or have no login although another member could connect.
    """

    users = frappe.db.get_all("User Account", {"account": account}, pluck="user")
    if not users:
        return None

    USER_SETTINGS = frappe.qb.DocType("User Settings")
    USER = frappe.qb.DocType("User")
    logins = dict(
        (
            frappe.qb.from_(USER_SETTINGS)
            .inner_join(USER)
            .on(USER_SETTINGS.user == USER.name)
            .where(USER_SETTINGS.user.isin(users))
            .where(USER_SETTINGS.username.isnotnull() & (USER_SETTINGS.username != ""))
            .where(USER.enabled == 1)
            .select(USER_SETTINGS.user, USER_SETTINGS.username)
        ).run()
    )
    name, is_personal = frappe.db.get_value("JMAP Account", account, ["_name", "is_personal"]) or (None, 0)

    # A personal account's owner is the user whose personal account it is, decided the way the app
    # decides it everywhere else — the account need not be named after their login.
    personal_owners = (
        {user for user in logins if get_user_personal_jmap_account(user) == account} if is_personal else set()
    )

    return pick_account_user(users, logins, name, bool(is_personal), personal_owners)


def pick_account_user(
    users: list[str],
    logins: dict[str, str],
    name: str | None,
    is_personal: bool,
    personal_owners: set[str],
) -> str | None:
    """Which of an account's users to act as, given the enabled ones that can connect (user → login).

    A personal account only as its owner, one of `personal_owners`: anyone else linked to it has only
    a share, and acting as them would reach just that. A team account as the member whose login it is
    named after, or else its first member that can connect.
    """

    if is_personal:
        return next((user for user in users if user in logins and user in personal_owners), None)

    name = (name or "").casefold()
    if owner := next((user for user, login in logins.items() if name and login.casefold() == name), None):
        return owner
    return next((user for user in users if user in logins), None)


ACCOUNT_APPS_CACHE_SECONDS = 600


def account_apps_cache_key(user: str) -> str:
    return f"mail|account_apps|{user}"


def get_account_apps(user: str | None = None) -> dict[str, dict[str, bool]]:
    """For each of the user's accounts, whether it has anything for them in mail and in calendar.

    Sharing one calendar puts the sharer's whole account in the user's session, and so among
    their accounts, though nothing else in it is theirs to see. Mail lists an account only where
    the user can see a mailbox; calendar only where they can write to a calendar — one shared
    read-only shows under Shared Calendars instead. The user's own account always has both.

    Asked of the mail server per account, so kept for a few minutes, and dropped whenever the
    user's accounts change.
    """

    from suite.mail.jmap import get_calendar_service, get_mailbox_service

    user = user or frappe.session.user
    cache_key = account_apps_cache_key(user)
    if (cached := frappe.cache.get_value(cache_key)) is not None:
        return cached

    accounts = get_user_jmap_accounts(user)
    personal = get_user_personal_jmap_account(user)
    others = [account for account in accounts if account != personal]
    apps = {account: {"mail": True, "calendar": True} for account in accounts if account == personal}
    try:
        if others:
            mailboxes = get_mailbox_service(others[0]).get_across_accounts(others, ["id"])
            try:
                calendars = get_calendar_service(others[0]).get_across_accounts(others, ["myRights"])
            except NotImplementedError:
                calendars = {}
            for account in others:
                apps[account] = {
                    "mail": bool(mailboxes.get(account)),
                    "calendar": any(
                        (row.get("myRights") or {}).get("mayWriteAll") for row in calendars.get(account) or []
                    ),
                }
    except Exception:
        # Better every account listed than one hidden for a failed request. log_error keeps the
        # traceback. Kept only briefly: long enough that a mail server that is down doesn't hold
        # up every page load and fill the error log, short enough to be asked again soon.
        frappe.log_error(title="Account apps check failed")
        apps = {account: {"mail": True, "calendar": True} for account in accounts}
        frappe.cache.set_value(cache_key, apps, expires_in_sec=60)
        return apps

    frappe.cache.set_value(cache_key, apps, expires_in_sec=ACCOUNT_APPS_CACHE_SECONDS)
    return apps


def on_doctype_update() -> None:
    frappe.db.add_unique("User Account", ["user", "account"], constraint_name="unique_user_account")
