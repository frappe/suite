"""REST adapters for Suite-owned account and site workflows."""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict

import frappe
from frappe import _

from suite.api import account
from suite.composition.http import BadRequest, Route

Given = str | int | float | bool | list | dict | None


class AccountRoles(TypedDict):
    system_manager: bool


class Account(TypedDict):
    name: str
    email: str
    full_name: str
    avatar: str | None
    roles: AccountRoles
    is_jmap_configured: bool


class Site(TypedDict):
    is_onboarded: bool
    can_onboard: bool
    workspace_name: str
    workspace_logo: str


class CompleteOnboarding(TypedDict):
    is_onboarded: Literal[True]
    timezone: NotRequired[str]


class UpdateSiteSettings(TypedDict):
    workspace_name: str
    workspace_logo: NotRequired[str]


class User(TypedDict):
    name: str
    email: str
    full_name: str
    user_image: str | None
    is_admin: bool


class Invitation(TypedDict):
    name: str
    email: str
    creation: str
    invited_by: str
    invited_by_name: str | None


class InviteUsers(TypedDict):
    emails: str


class InvitationResult(TypedDict):
    disabled_user_emails: list[str]
    accepted_invite_emails: list[str]
    pending_invite_emails: list[str]
    invited_emails: list[str]


ROUTES = (
    Route("GET", "account", "account_get", allow_guest=True, output=Account | None),
    Route("GET", "site", "site_get", output=Site),
    Route(
        "PATCH",
        "site",
        "site_patch",
        body=CompleteOnboarding | UpdateSiteSettings,
        errors=(BadRequest, frappe.PermissionError),
        output=Site,
    ),
    Route("GET", "users", "users_get", errors=(frappe.PermissionError,), output=list[User]),
    Route(
        "GET",
        "invitations",
        "invitations_get",
        errors=(frappe.PermissionError,),
        output=list[Invitation],
    ),
    Route(
        "POST",
        "invitations",
        "invitations_post",
        body=InviteUsers,
        errors=(BadRequest, frappe.PermissionError),
        output=InvitationResult,
    ),
)


@frappe.whitelist(allow_guest=True, methods=["GET"])
def account_get() -> Account | None:
    row = account.get_logged_in_user()
    if row is None:
        # Frappe omits `data` when a handler returns None. Keep the v2 success
        # envelope explicit because null is the signed-out account value.
        frappe.local.response["data"] = None
        return None
    return {**row, "roles": {"system_manager": "System Manager" in row.get("roles", [])}}


@frappe.whitelist(methods=["GET"])
def site_get() -> Site:
    return {**account.get_onboarding_state(), **account.get_workspace()}


@frappe.whitelist(methods=["PATCH"])
def site_patch(
    is_onboarded: Given = None,
    timezone: Given = None,
    workspace_name: Given = None,
    workspace_logo: Given = None,
) -> Site:
    onboarding = is_onboarded is not None or timezone is not None
    settings = workspace_name is not None or workspace_logo is not None
    if onboarding == settings:
        frappe.throw(_("Change onboarding or site settings in one request"), BadRequest)
    if onboarding:
        if is_onboarded is not True:
            frappe.throw(_("A site can only be marked onboarded"), BadRequest)
        account.mark_onboarded(timezone=_optional_text(timezone, "timezone"))
    else:
        account.update_workspace(
            _required_text(workspace_name, "workspace_name"),
            _optional_text(workspace_logo, "workspace_logo") or "",
        )
    return site_get()


@frappe.whitelist(methods=["GET"])
def users_get() -> list[User]:
    return account.get_users()


@frappe.whitelist(methods=["GET"])
def invitations_get() -> list[Invitation]:
    return account.get_pending_invites()


@frappe.whitelist(methods=["POST"])
def invitations_post(emails: Given = None) -> InvitationResult:
    return account.invite_users(_required_text(emails, "emails"))


@frappe.whitelist(allow_guest=True, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
def unknown() -> None:
    raise frappe.DoesNotExistError(_("That Suite address does not exist"))


def _optional_text(value: Given, name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        frappe.throw(_("Suite argument {0} is invalid").format(name), BadRequest)
    return value


def _required_text(value: Given, name: str) -> str:
    answer = _optional_text(value, name)
    if not answer or not answer.strip():
        frappe.throw(_("Suite argument {0} is required").format(name), BadRequest)
    return answer
