"""Public Mail setup and recovery contracts."""

from typing import NotRequired, TypedDict

import frappe

from suite.composition.http import Route, RouteKind
from suite.mail.account_setup import (
    AccountActivationFailed,
    DriveSetupFailed,
    InvitationClosed,
    MailboxSetupFailed,
    WeakPassword,
)
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


class AccountRequest(TypedDict):
    backup_email: str | None
    account: str | None
    is_verified: Flag
    is_expired: Flag
    workspace_name: str
    workspace_logo: str
    invited_by_name: str
    invited_by_image: str | None
    invited_by_email: str
    is_admin: Flag
    # The site's first Admin: the invitation opens the site wizard, which creates the account.
    sets_up_site: Flag
    # UTC, like every other timestamp the client reads.
    expires_at: str | None


class Option(TypedDict):
    value: str
    label: str


class AccountOptions(TypedDict):
    locales: list[Option]
    time_zones: list[Option]


class CreateAccount(TypedDict):
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

# An invitation, or a confirmed signup, by its request key: what it is, the choices for the new
# account, and creating that account.
ROUTES = (
    Route(
        "GET",
        "invitations/{request_key}",
        "get_account_request",
        kind="query",
        public_name="public.accountRequest",
        output=AccountRequest | None,
        allow_guest=True,
        errors=(frappe.RateLimitExceededError,),
    ),
    Route(
        "GET",
        "invitations/{request_key}/options",
        "get_account_setup_options",
        kind="query",
        public_name="public.accountOptions",
        output=AccountOptions,
        allow_guest=True,
        errors=(InvitationClosed, frappe.RateLimitExceededError),
    ),
    Route(
        "POST",
        "invitations/{request_key}/account",
        "create_account",
        kind="mutation",
        public_name="public.createAccount",
        body=CreateAccount,
        output=type(None),
        allow_guest=True,
        # The invitation page marks the setup row that failed (§4.1).
        errors=(
            frappe.DoesNotExistError,
            InvitationClosed,
            WeakPassword,
            DriveSetupFailed,
            MailboxSetupFailed,
            AccountActivationFailed,
            frappe.RateLimitExceededError,
        ),
    ),
)
