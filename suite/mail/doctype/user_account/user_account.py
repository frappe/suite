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


def get_jmap_account_owner(account: str) -> str | None:
    """The user to act on the account as, whoever is asking; nobody, if no user is linked.

    Of several linked users that is the one whose login it is. A single linked user is returned
    as they are, and may only have a share in the account — a group's one member here, say. So
    this finds who to ask, not whether they own it: a caller that needs an owner asks that user's
    session whether the account is personal to them.
    """

    users = frappe.db.get_all("User Account", {"account": account}, pluck="user")
    return _account_owner(account, users) if users else None


def _account_owner(account: str, users: list[str]) -> str:
    """Of the users linked to an account, the one whose login it is — the rest have something in
    it shared with them, and acting as one of them would reach only that. A team account nobody
    logs into as has no owner, and any member will do."""

    if len(users) > 1:
        name = frappe.db.get_value("JMAP Account", account, "_name")
        if owner := frappe.db.get_value("User Settings", {"user": ("in", users), "username": name}, "user"):
            return owner
    return users[0]


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
