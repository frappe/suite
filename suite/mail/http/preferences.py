"""Account preferences and credentials, with normal document validation."""

from typing import Literal, NotRequired, TypedDict

import frappe

from suite.composition.http import Route
from suite.mail.doctype.user_account.user_account import is_jmap_account_belongs_to_user
from suite.mail.http.shapes import AccountInput, Flag


class UserPreferences(TypedDict, total=False):
    group_messages_by: Literal["None", "Day", "Month"] | None
    show_reading_pane: Flag
    undo_send_period: Literal["5", "10", "20", "30"]


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
    default_outgoing_email: str | None
    on_mark_as_junk: Literal["Junk Sender's Mail", "Ask to Block Sender"]


class AccountChanges(TypedDict, total=False):
    create_contacts_after_email_submit: Flag
    destroy_email_after_submit: Flag
    destroy_newsletter_after_submit: Flag
    keep_forwarded_email_in_thread: Flag
    enable_screening: Flag
    block_remote_images: Flag
    default_outgoing_email: str | None
    on_mark_as_junk: Literal["Junk Sender's Mail", "Ask to Block Sender"]


class UpdateAccount(AccountInput):
    changes: AccountChanges


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
    group_messages_by: str | None = None,
    show_reading_pane: Flag | None = None,
    undo_send_period: str | None = None,
) -> None:
    changes = {
        key: value
        for key, value in {
            "group_messages_by": group_messages_by,
            "show_reading_pane": show_reading_pane,
            "undo_send_period": undo_send_period,
        }.items()
        if value is not None
    }
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
    return {field: doc.get(field) for field in AccountPreferences.__annotations__}


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
