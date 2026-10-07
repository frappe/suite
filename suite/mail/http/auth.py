"""Public Mail setup and recovery contracts."""

from typing import NotRequired, TypedDict

import frappe

from suite.composition.http import Route, RouteKind
from suite.mail.api import get_branding, get_signup_domains, get_signup_settings
from suite.mail.api.account import (
    create_account,
    get_account_request,
    get_account_setup_options,
    get_user_for_reset_password_key,
    resend_otp,
    send_reset_password_link,
    signup,
    validate_email_assigned,
    verify_otp,
)
from suite.mail.http.shapes import Flag


class Branding(TypedDict):
    brand_name: str | None
    brand_html: str | None
    favicon: str | None


class SignupSettings(TypedDict):
    allow_signup: Flag


class EmailInput(TypedDict):
    email: str


class Signup(TypedDict):
    username: str
    domain: str
    email: str


class OtpRequest(TypedDict):
    account_request: str


class VerifyOtp(OtpRequest):
    otp: str


class RequestKey(TypedDict):
    request_key: str


class AccountRequest(TypedDict):
    backup_email: str | None
    account: str | None
    is_verified: Flag
    is_expired: Flag


class Option(TypedDict):
    value: str
    label: str


class AccountOptions(TypedDict):
    locales: list[Option]
    time_zones: list[Option]


class CreateAccount(RequestKey):
    first_name: str
    last_name: str
    password: str
    locale: NotRequired[str | None]
    time_zone: NotRequired[str | None]


class ResetLink(TypedDict):
    user: str


class ResetKey(TypedDict):
    key: str


_OPERATIONS: tuple[tuple[str, str, RouteKind, str, object, object], ...] = (
    (
        "get_branding",
        "/api/method/suite.mail.api.get_branding",
        "query",
        "public.branding",
        None,
        Branding,
    ),
    (
        "get_signup_settings",
        "/api/method/suite.mail.api.get_signup_settings",
        "query",
        "public.signupSettings",
        None,
        SignupSettings,
    ),
    (
        "get_signup_domains",
        "/api/method/suite.mail.api.get_signup_domains",
        "query",
        "public.signupDomains",
        None,
        list[str],
    ),
    (
        "validate_email_assigned",
        "/api/method/suite.mail.api.account.validate_email_assigned",
        "query",
        "public.checkEmail",
        EmailInput,
        type(None),
    ),
    ("signup", "/api/method/suite.mail.api.account.signup", "mutation", "public.signup", Signup, str),
    (
        "resend_otp",
        "/api/method/suite.mail.api.account.resend_otp",
        "mutation",
        "public.resendCode",
        OtpRequest,
        type(None),
    ),
    (
        "verify_otp",
        "/api/method/suite.mail.api.account.verify_otp",
        "mutation",
        "public.verifyCode",
        VerifyOtp,
        str,
    ),
    (
        "get_account_request",
        "/api/method/suite.mail.api.account.get_account_request",
        "query",
        "public.accountRequest",
        RequestKey,
        AccountRequest | None,
    ),
    (
        "get_account_setup_options",
        "/api/method/suite.mail.api.account.get_account_setup_options",
        "query",
        "public.accountOptions",
        RequestKey,
        AccountOptions,
    ),
    (
        "create_account",
        "/api/method/suite.mail.api.account.create_account",
        "mutation",
        "public.createAccount",
        CreateAccount,
        type(None),
    ),
    (
        "send_reset_password_link",
        "/api/method/suite.mail.api.account.send_reset_password_link",
        "mutation",
        "public.sendResetLink",
        ResetLink,
        str,
    ),
    (
        "get_user_for_reset_password_key",
        "/api/method/suite.mail.api.account.get_user_for_reset_password_key",
        "query",
        "public.resetAccount",
        ResetKey,
        str | None,
    ),
)


CONTRACT_ROUTES = tuple(
    Route(
        "POST",
        path,
        handler,
        id=handler,
        kind=kind,
        public_name=public_name,
        body=body,
        output=output,
        envelope="message",
        allow_guest=True,
        errors=(
            frappe.PermissionError,
            frappe.AuthenticationError,
            frappe.ValidationError,
        ),
    )
    for handler, path, kind, public_name, body, output in _OPERATIONS
)
