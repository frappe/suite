"""Account preferences and credentials, with normal document validation."""

import json
from typing import Literal, NotRequired, TypedDict, cast

import frappe
from frappe import _

from suite.composition.http import Route
from suite.mail.classification import normalize_tabs
from suite.mail.doctype.user_account.user_account import is_jmap_account_belongs_to_user
from suite.mail.http.auth import AccountOptions
from suite.mail.http.shapes import AccountInput, Flag


class UserPreferences(TypedDict, total=False):
    group_by_date: Flag
    show_reading_pane: Flag
    undo_send_period: Literal["5", "10", "20", "30"]
    # The categories the Inbox is split into; empty for no split. Primary leads whenever any other is
    # on, whether or not it is listed.
    inbox_tabs: list[Literal["primary", "updates", "forums", "promotions", "social"]]
    # Off, the Inbox is one list; the choice of tabs is kept for when it is on again.
    split_inbox: Flag


class Credentials(TypedDict):
    server_url: str | None
    username: str | None
    backup_email: str | None
    has_password: bool


class UpdateCredentials(TypedDict):
    username: str | None
    backup_email: str | None
    app_password: NotRequired[str]


class AccountPreferences(TypedDict):
    create_contacts_after_email_submit: Flag
    destroy_email_after_submit: Flag
    destroy_newsletter_after_submit: Flag
    keep_forwarded_email_in_thread: Flag
    enable_screening: Flag
    block_remote_images: Flag
    on_block_old_mail: Literal["Ask", "Move to Junk", "Keep"]
    default_outgoing_email: str | None


class AccountChanges(TypedDict, total=False):
    create_contacts_after_email_submit: Flag
    destroy_email_after_submit: Flag
    destroy_newsletter_after_submit: Flag
    keep_forwarded_email_in_thread: Flag
    enable_screening: Flag
    block_remote_images: Flag
    on_block_old_mail: Literal["Ask", "Move to Junk", "Keep"]
    default_outgoing_email: str | None


class UpdateAccount(AccountInput):
    changes: AccountChanges


class RegionalChanges(TypedDict):
    locale: str
    time_zone: str


class RegionalPreferences(RegionalChanges, AccountOptions):
    pass


@frappe.whitelist(methods=["GET"])
def regional_preferences() -> RegionalPreferences:
    from suite.mail.directory import get_account_metadata
    from suite.mail.suite_cloud import get_client
    from suite.mail.utils.user import get_account_email

    email = get_account_email(frappe.session.user)
    if not email:
        frappe.throw(_("No personal Mail account"))
    account = get_client().call("mail.accounts.get_account", email=email)
    options = get_account_metadata()
    return {
        "locale": account.get("locale") or "en-US",
        "time_zone": account.get("time_zone") or "UTC",
        "locales": options["locales"],
        "time_zones": options["time_zones"],
    }


@frappe.whitelist(methods=["PATCH"])
def update_regional_preferences(locale: str, time_zone: str) -> None:
    from suite.mail.directory import get_account_metadata
    from suite.mail.suite_cloud import get_client
    from suite.mail.utils.user import get_account_email

    email = get_account_email(frappe.session.user)
    if not email:
        frappe.throw(_("No personal Mail account"))
    options = get_account_metadata()
    if locale not in {option["value"] for option in options["locales"]} or time_zone not in {
        option["value"] for option in options["time_zones"]
    }:
        frappe.throw(_("Invalid regional preference"))
    get_client().call("mail.accounts.update_account", email=email, locale=locale, time_zone=time_zone)


class Subscription(TypedDict):
    name: str
    subscribed: Flag


def _user_settings():
    name = frappe.db.get_value("User Settings", {"user": frappe.session.user}, "name")
    return frappe.get_doc("User Settings", name)


@frappe.whitelist(methods=["GET"])
def credentials() -> Credentials:
    doc = _user_settings()
    doc.check_permission("read")
    return {
        "server_url": doc.server_url,
        "username": doc.username,
        "backup_email": doc.backup_email,
        "has_password": bool(doc.get_password("app_password", raise_exception=False)),
    }


@frappe.whitelist(methods=["PATCH"])
def update_credentials(
    username: str | None, backup_email: str | None, app_password: str | None = None
) -> None:
    doc = _user_settings()
    doc.check_permission("write")
    doc.username = username
    doc.backup_email = backup_email
    if app_password is not None:
        doc.app_password = app_password
    doc.save()


@frappe.whitelist(methods=["PATCH"])
def update_preferences(
    group_by_date: Flag | None = None,
    show_reading_pane: Flag | None = None,
    undo_send_period: str | None = None,
    inbox_tabs: list[str] | None = None,
    split_inbox: Flag | None = None,
) -> None:
    changes = {
        key: value
        for key, value in {
            "group_by_date": group_by_date,
            "show_reading_pane": show_reading_pane,
            "undo_send_period": undo_send_period,
            "split_inbox": split_inbox,
        }.items()
        if value is not None
    }
    if inbox_tabs is not None:
        changes["inbox_tabs"] = json.dumps([tab.value for tab in normalize_tabs(inbox_tabs)])
    doc = _user_settings()
    doc.check_permission("write")
    doc.update(changes)
    doc.save()


def _account(account: str):
    is_jmap_account_belongs_to_user(account, raise_exception=True)
    name = frappe.db.get_value("JMAP Account", {"account_id": account}, "name")
    return frappe.get_doc("JMAP Account", name)


@frappe.whitelist(methods=["GET"])
def account_preferences(account: str) -> AccountPreferences:
    doc = _account(account)
    doc.check_permission("read")
    return cast(AccountPreferences, {field: doc.get(field) for field in AccountPreferences.__annotations__})


@frappe.whitelist(methods=["PATCH"])
def update_account_preferences(account: str, changes: AccountChanges) -> None:
    if not changes.keys() <= AccountChanges.__annotations__.keys():
        frappe.throw("Unknown account preference")
    doc = _account(account)
    doc.check_permission("write")
    doc.update(changes)
    doc.save()


@frappe.whitelist(methods=["PATCH"])
def subscribe_mailbox(name: str, subscribed: Flag) -> None:
    doc = frappe.get_doc("Mailbox", name)
    doc.check_permission("write")
    doc.subscribed = subscribed
    doc.save()


ROUTES = (
    Route(
        "GET",
        "settings/regional",
        "regional_preferences",
        kind="query",
        public_name="settings.regional",
        output=RegionalPreferences,
    ),
    Route(
        "PATCH",
        "settings/regional",
        "update_regional_preferences",
        kind="mutation",
        public_name="settings.updateRegional",
        body=RegionalChanges,
        output=type(None),
    ),
    Route(
        "GET",
        "settings/credentials",
        "credentials",
        kind="query",
        public_name="settings.credentials",
        output=Credentials,
    ),
    Route(
        "PATCH",
        "settings/credentials",
        "update_credentials",
        kind="mutation",
        public_name="settings.updateCredentials",
        body=UpdateCredentials,
        output=type(None),
    ),
    Route(
        "PATCH",
        "settings/preferences",
        "update_preferences",
        kind="mutation",
        public_name="settings.updatePreferences",
        body=UserPreferences,
        output=type(None),
    ),
    Route(
        "GET",
        "settings/account",
        "account_preferences",
        kind="query",
        public_name="settings.account",
        query=AccountInput,
        output=AccountPreferences,
    ),
    Route(
        "PATCH",
        "settings/account",
        "update_account_preferences",
        kind="mutation",
        public_name="settings.updateAccount",
        body=UpdateAccount,
        output=type(None),
    ),
    Route(
        "PATCH",
        "settings/mailbox",
        "subscribe_mailbox",
        kind="mutation",
        public_name="mailboxes.subscribe",
        body=Subscription,
        output=type(None),
    ),
)
