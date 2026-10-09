"""REST adapters for Suite-owned account and site workflows."""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict

import frappe
from frappe import _
from frappe.auth import LoginManager
from frappe.core.doctype.user.user import get_timezones, switch_theme, update_password
from frappe.handler import logout
from frappe.push_notification import subscribe, unsubscribe
from frappe.translate import get_boot_translations

from suite.api import account, people
from suite.api.admin_lifecycle import ROUTES as LIFECYCLE_ROUTES
from suite.api.admin_lifecycle import (
    admin_health_get,
    mail_account_delete,
    mail_account_post,
    onboarding_get,
    onboarding_post,
    temporary_password_post,
)
from suite.api.admin_storage import ROUTES as STORAGE_ROUTES
from suite.api.admin_storage import (
    storage_buffers,
    storage_default,
    storage_get,
    storage_limits,
    storage_refresh,
)
from suite.api.admin_transfer import ROUTES as TRANSFER_ROUTES
from suite.api.admin_transfer import user_transfer, user_transfer_preview
from suite.api.preferences import (
    Language,
    PreferenceChanges,
    Preferences,
    ThemeChange,
    get_preferences,
    languages,
    update_preferences,
)
from suite.composition.http import BadRequest, Route
from suite.utils.user import generate_user_keys

Given = str | int | float | bool | list | dict | None


class AccountRoles(TypedDict):
    system_manager: bool
    suite_admin: bool


class Account(TypedDict):
    name: str
    email: str
    full_name: str
    avatar: str | None
    roles: AccountRoles
    is_jmap_configured: bool
    must_change_password: bool
    setup_required: bool


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
    enabled: bool
    account: str | None
    setup_status: str
    must_change_password: bool


class UserChanges(TypedDict):
    user: str
    is_admin: NotRequired[bool]
    enabled: NotRequired[bool]
    full_name: NotRequired[str]


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


class PeopleQuery(TypedDict, total=False):
    q: str
    cursor: str


class UserKeysInput(TypedDict):
    user: str


class UserKeys(TypedDict):
    api_key: str
    api_secret: str


class Timezones(TypedDict):
    timezones: list[str]


class PasswordChange(TypedDict):
    old_password: str
    new_password: str


class PasswordReset(TypedDict):
    key: str
    new_password: str


class LoginInput(TypedDict):
    usr: str
    pwd: str


login = LoginManager.login


class PushToken(TypedDict):
    fcm_token: str
    project_name: str


class PushResult(TypedDict):
    success: bool
    message: str


CONTRACT_ROUTES = (
    Route(
        "POST",
        "/api/v2/method/login",
        "login",
        id="frappe.login",
        body=LoginInput,
        output=object,
        kind="mutation",
        public_name="auth.login",
        allow_guest=True,
    ),
    Route(
        "POST",
        "/api/v2/method/logout",
        "logout",
        id="frappe.logout",
        output=object,
        kind="mutation",
        public_name="auth.logout",
    ),
    Route(
        "GET",
        "/api/v2/method/frappe.translate.get_boot_translations",
        "get_boot_translations",
        id="frappe.translate.get_boot_translations",
        output=dict[str, str],
        kind="query",
        public_name="translations.get",
        allow_guest=True,
    ),
    Route(
        "GET",
        "/api/method/frappe.push_notification.subscribe",
        "subscribe",
        query=PushToken,
        output=PushResult,
        kind="mutation",
        public_name="push.subscribe",
        envelope="message",
    ),
    Route(
        "GET",
        "/api/method/frappe.push_notification.unsubscribe",
        "unsubscribe",
        query=PushToken,
        output=PushResult,
        kind="mutation",
        public_name="push.unsubscribe",
        envelope="message",
    ),
    Route(
        "POST",
        "/api/v2/method/frappe.core.doctype.user.user.switch_theme",
        "switch_theme",
        id="frappe.user.switch_theme",
        body=ThemeChange,
        output=type(None),
        kind="mutation",
        public_name="preferences.setTheme",
    ),
    Route(
        "POST",
        "/api/method/frappe.core.doctype.user.user.update_password",
        "update_password",
        id="frappe.user.reset_password",
        kind="mutation",
        public_name="account.resetPassword",
        envelope="message",
        body=PasswordReset,
        output=str,
        errors=(
            frappe.AuthenticationError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/frappe.core.doctype.user.user.get_timezones",
        "get_timezones",
        id="frappe.user.get_timezones",
        kind="query",
        public_name="locales.timezones",
        envelope="message",
        output=Timezones,
    ),
    Route(
        "POST",
        "/api/method/frappe.core.doctype.user.user.update_password",
        "update_password",
        id="frappe.user.update_password",
        kind="mutation",
        public_name="account.changePassword",
        envelope="message",
        body=PasswordChange,
        output=str,
        errors=(
            frappe.AuthenticationError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/v2/method/suite.utils.user.generate_user_keys",
        "generate_user_keys",
        id="suite.generate_user_keys",
        kind="mutation",
        public_name="account.generateKeys",
        body=UserKeysInput,
        output=UserKeys,
        errors=(frappe.PermissionError,),
    ),
)


ROUTES = (
    *LIFECYCLE_ROUTES,
    *TRANSFER_ROUTES,
    *STORAGE_ROUTES,
    Route(
        "GET",
        "preferences",
        "get_preferences",
        output=Preferences,
        kind="query",
        public_name="preferences.get",
    ),
    Route(
        "PATCH",
        "preferences",
        "update_preferences",
        body=PreferenceChanges,
        output=Preferences,
        kind="mutation",
        public_name="preferences.update",
    ),
    Route(
        "GET", "languages", "languages", output=list[Language], kind="query", public_name="locales.languages"
    ),
    Route(
        "GET",
        "account",
        "account_get",
        allow_guest=True,
        output=Account | None,
        kind="query",
        public_name="account.get",
    ),
    Route("GET", "site", "site_get", output=Site, kind="query", public_name="site.get"),
    Route(
        "PATCH",
        "site",
        "site_patch",
        body=CompleteOnboarding | UpdateSiteSettings,
        errors=(BadRequest, frappe.PermissionError),
        output=Site,
        kind="mutation",
        public_name={
            "CompleteOnboarding": "site.completeOnboarding",
            "UpdateSiteSettings": "site.updateSettings",
        },
    ),
    Route(
        "GET",
        "users",
        "users_get",
        errors=(frappe.PermissionError,),
        output=list[User],
        kind="query",
        public_name="users.list",
    ),
    Route(
        "GET",
        "invitations",
        "invitations_get",
        errors=(frappe.PermissionError,),
        output=list[Invitation],
        kind="query",
        public_name="invitations.list",
    ),
    Route(
        "PATCH",
        "users",
        "users_patch",
        body=UserChanges,
        output=list[User],
        errors=(BadRequest, frappe.PermissionError, frappe.ValidationError, frappe.DoesNotExistError),
        kind="mutation",
        public_name="users.update",
    ),
    Route(
        "POST",
        "invitations",
        "invitations_post",
        body=InviteUsers,
        errors=(BadRequest, frappe.PermissionError),
        output=InvitationResult,
        kind="mutation",
        public_name="invitations.create",
    ),
    Route(
        "GET",
        "people",
        "people_get",
        errors=(BadRequest, people.BadCursor, frappe.PermissionError),
        query=PeopleQuery,
        output=people.PeoplePage,
        kind="query",
        public_name="people.list",
        page={"cursor": "cursor", "rows": "rows", "next": "next_cursor"},
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
    from suite.suite_core.account_state import read
    from suite.suite_core.utils import is_suite_cloud_configured

    lifecycle = read(row["name"])
    configured = is_suite_cloud_configured() and row["name"] != "Administrator"
    return {
        **row,
        "must_change_password": bool(lifecycle.get("must_change_password")),
        "setup_required": bool(
            configured
            and (
                lifecycle.get("status") in ("Setup failed", "Deleted", "Deletion failed")
                or not row.get("is_jmap_configured")
            )
        ),
        "roles": {
            "system_manager": "System Manager" in row.get("roles", []),
            "suite_admin": row["name"] == "Administrator" or "Suite Admin" in row.get("roles", []),
        },
    }


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


@frappe.whitelist(methods=["PATCH"])
def users_patch(
    user: Given = None, is_admin: Given = None, enabled: Given = None, full_name: Given = None
) -> list[User]:
    from suite.suite_core.administration import update_user

    if (is_admin is None and enabled is None and full_name is None) or any(
        value is not None and not isinstance(value, bool) for value in (is_admin, enabled)
    ):
        frappe.throw(_("Choose an Admin role or an access status"), BadRequest)
    return update_user(
        _required_text(user, "user"),
        is_admin=is_admin,
        enabled=enabled,
        full_name=_optional_text(full_name, "full_name"),
    )


@frappe.whitelist(methods=["GET"])
def invitations_get() -> list[Invitation]:
    return account.get_pending_invites()


@frappe.whitelist(methods=["POST"])
def invitations_post(emails: Given = None) -> InvitationResult:
    return account.invite_users(_required_text(emails, "emails"))


@frappe.whitelist(methods=["GET"])
def people_get(q: Given = None, cursor: Given = None) -> people.PeoplePage:
    return people.search(_optional_text(q, "q"), _optional_text(cursor, "cursor"))


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
