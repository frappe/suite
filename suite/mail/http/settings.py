"""Contracts for account settings and their named workflows."""

from collections.abc import Callable
from typing import Literal, NotRequired, TypedDict

import frappe

from suite.composition.http import Route, RouteKind
from suite.mail.api import account, mail, sieve
from suite.mail.doctype.vacation_response import vacation_response
from suite.mail.http.shapes import AccountInput, Flag


class MailClientConfig(TypedDict):
    protocol: str
    hostname: str
    port: int
    connection_security: str


class Quota(TypedDict):
    disk_quota: int
    used_quota: int
    used_percentage: float


class Signature(TypedDict):
    identity: str
    signature: str


class AutomationRules(TypedDict):
    emails_from: str
    subject_contains: str
    match_if: Literal["any", "all"]
    mark_as_read: bool | Flag
    add_star: bool | Flag


class CreateMailbox(AccountInput):
    name: str
    parent: NotRequired[str | None]
    icon: NotRequired[str | None]
    color: NotRequired[str | None]
    disable_push_notification: NotRequired[bool]
    automation_rules: NotRequired[AutomationRules | None]


class UpdateMailbox(CreateMailbox):
    id: str
    old_name: str
    role: NotRequired[str | None]


class DeleteMailbox(AccountInput):
    id: str
    name: str


class ScreenAddress(AccountInput):
    email: str
    action: NotRequired[Literal["Reject", "Spam", "Accepted"]]


class CreateScript(AccountInput):
    _name: str
    content: str
    active: bool


class UpdateScript(CreateScript):
    id: str


class DeleteScript(AccountInput):
    id: str


class CreateAutomation(AccountInput):
    active: NotRequired[bool]


class Vacation(TypedDict):
    account: str
    enabled: bool | Flag
    from_date: str | None
    to_date: str | None
    subject: str | None
    text_body: str | None
    html_body: str | None
    creation: str | None
    modified: str | None


class UpdateVacation(AccountInput):
    enabled: bool | Flag
    from_date: NotRequired[str | None]
    to_date: NotRequired[str | None]
    subject: NotRequired[str | None]
    text_body: NotRequired[str | None]
    html_body: NotRequired[str | None]


_OPERATIONS: tuple[tuple[Callable[..., object], RouteKind, str, object, object], ...] = (
    (account.get_mail_client_config, "query", "settings.clientConfig", None, list[MailClientConfig]),
    (account.get_quota, "query", "settings.quota", AccountInput, Quota),
    (account.set_signature, "mutation", "identities.setSignature", Signature, type(None)),
    (mail.create_mailbox, "mutation", "mailboxes.create", CreateMailbox, str),
    (mail.update_mailbox, "mutation", "mailboxes.update", UpdateMailbox, type(None)),
    (mail.delete_mailbox, "mutation", "mailboxes.delete", DeleteMailbox, type(None)),
    (mail.screen_email_address, "mutation", "screening.setAddress", ScreenAddress, type(None)),
    (mail.move_screening_mails_to_inbox, "mutation", "screening.moveToInbox", AccountInput, type(None)),
    (sieve.create_sieve_script, "mutation", "sieve.create", CreateScript, type(None)),
    (sieve.update_sieve_script, "mutation", "sieve.update", UpdateScript, type(None)),
    (sieve.delete_sieve_script, "mutation", "sieve.delete", DeleteScript, type(None)),
    (sieve.create_automation_script, "mutation", "sieve.createAutomation", CreateAutomation, type(None)),
    (
        sieve.rebuild_automation_script_for_account,
        "mutation",
        "sieve.rebuildAutomation",
        AccountInput,
        type(None),
    ),
    (vacation_response.get_vacation_response, "query", "vacation.get", AccountInput, Vacation),
    (
        vacation_response.update_vacation_response,
        "mutation",
        "vacation.update",
        UpdateVacation,
        type(None),
    ),
)


CONTRACT_ROUTES = tuple(
    Route(
        "POST",
        f"/api/method/{handler.__module__}.{handler.__name__}",
        handler.__name__,
        id=handler.__name__,
        kind=kind,
        public_name=public_name,
        body=body,
        output=output,
        envelope="message",
        errors=(frappe.PermissionError, frappe.ValidationError),
    )
    for handler, kind, public_name, body, output in _OPERATIONS
)
