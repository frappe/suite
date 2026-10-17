"""Typed Suite administration workflows delegated to the Mail public interface."""

from typing import TypedDict

import frappe

from suite import mail
from suite.composition.http import Route


class CreationResult(TypedDict):
    success: bool
    user: str
    status: str
    error: str | None
    temporary_password: str | None
    expires_at: str | None


class UserInput(TypedDict):
    user: str


class RecreateInput(UserInput):
    address: str


class DeleteInput(UserInput):
    confirmation: str


class TemporaryCredential(TypedDict):
    user: str
    temporary_password: str
    expires_at: str


class OnboardingOptions(TypedDict):
    cloud: bool
    domains: list[str]
    account: str | None
    ready: bool


class OnboardingInput(TypedDict):
    address: str
    password: str


class ProviderHealth(TypedDict):
    cloud: bool
    suspended: bool
    stale: bool
    fetched_at: str | None
    alerts: list[str]


ROUTES = (
    Route(
        "GET",
        "admin/health",
        "admin_health_get",
        output=ProviderHealth,
        kind="query",
        public_name="admin.health",
        errors=(frappe.PermissionError,),
    ),
    Route(
        "POST",
        "users/{user}/temporary-password",
        "temporary_password_post",
        body=UserInput,
        output=TemporaryCredential,
        kind="mutation",
        public_name="users.replaceTemporaryPassword",
        errors=(frappe.PermissionError, frappe.ValidationError),
    ),
    Route(
        "POST",
        "users/{user}/mail-account",
        "mail_account_post",
        body=RecreateInput,
        output=CreationResult,
        kind="mutation",
        public_name="users.recreateMail",
        errors=(frappe.PermissionError, frappe.ValidationError),
    ),
    Route(
        "DELETE",
        "users/{user}/mail-account",
        "mail_account_delete",
        body=DeleteInput,
        output=CreationResult,
        kind="mutation",
        public_name="users.deleteMail",
        errors=(frappe.PermissionError, frappe.ValidationError),
    ),
    Route(
        "GET",
        "onboarding/mail",
        "onboarding_get",
        output=OnboardingOptions,
        kind="query",
        public_name="site.mailOnboarding",
        errors=(frappe.PermissionError, frappe.ValidationError),
    ),
    Route(
        "POST",
        "onboarding/mail",
        "onboarding_post",
        body=OnboardingInput,
        output=CreationResult,
        kind="mutation",
        public_name="site.setupMail",
        errors=(frappe.PermissionError, frappe.ValidationError),
    ),
)


@frappe.whitelist(methods=["POST"])
def temporary_password_post(user: str) -> TemporaryCredential:
    return mail.administer_account("replace_temporary", user=user)


@frappe.whitelist(methods=["POST"])
def mail_account_post(user: str, address: str) -> CreationResult:
    return mail.administer_account("recreate", user=user, address=address)


@frappe.whitelist(methods=["DELETE"])
def mail_account_delete(user: str, confirmation: str) -> CreationResult:
    return mail.administer_account("delete", user=user, confirmation=confirmation)


@frappe.whitelist(methods=["GET"])
def onboarding_get() -> OnboardingOptions:
    return mail.administer_account("onboarding_options")


@frappe.whitelist(methods=["POST"])
def onboarding_post(address: str, password: str) -> CreationResult:
    return mail.administer_account("onboard", address=address, password=password)


@frappe.whitelist(methods=["GET"])
def admin_health_get() -> ProviderHealth:
    from suite.suite_core.administration import require_admin

    require_admin()
    return mail.provider_health(domains=True)
