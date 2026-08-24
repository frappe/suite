# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


from uuid import uuid7

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import (
    add_to_date,
    cint,
    flt,
    get_datetime,
    get_url,
    now,
    now_datetime,
    random_string,
    sha256_hash,
    validate_email_address,
)

from suite.mail.stalwart import create_account, create_app_password, get_roles
from suite.mail.utils import get_config, is_stalwart_configured
from suite.mail.utils.logger import log_admin_action
from suite.mail.utils.validation import is_subaddressed_email
from suite.utils import execute_with_logging, generate_otp
from suite.utils.user import is_suite_admin, is_system_manager

STALWART_DEFAULT_USER_ROLES = ["User"]

# How long a signup OTP stays valid. Only its hash is kept (in cache); the code itself
# travels by email and is never stored.
OTP_TTL_SECONDS = 10 * 60


def _lines(value: str | None) -> list[str]:
    """Splits a newline-separated field into its entries, dropping blanks and duplicates."""

    return list(dict.fromkeys(line.strip() for line in (value or "").split("\n") if line.strip()))


def otp_cache_key(account_request: str) -> str:
    """Returns the cache key holding the signup OTP hash for an account request."""

    return f"account_request_otp_hash:{account_request}"


class MailAccountRequest(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        account: DF.Data
        aliases: DF.SmallText | None
        backup_email: DF.Data
        expires_at: DF.Datetime | None
        groups: DF.SmallText | None
        invited_by: DF.Link | None
        ip_address: DF.Data | None
        is_admin: DF.Check
        is_verified: DF.Check
        mailing_lists: DF.SmallText | None
        quota_gb: DF.Float
        request_key: DF.Data | None
        roles: DF.SmallText | None
        send_invite: DF.Check
    # end: auto-generated types

    # The freshly generated signup OTP, stashed by `set_otp` for the very next
    # `send_verification_email` on this instance - it only ever travels by email.
    _signup_otp: str | None = None

    def autoname(self) -> None:
        self.name = str(uuid7())

    @property
    def is_expired(self) -> bool:
        return bool(self.expires_at and get_datetime(self.expires_at) < now_datetime())

    @property
    def _roles(self) -> list[str]:
        """Returns the list of roles for the account request."""

        if roles := _lines(self.roles):
            return roles

        return list(STALWART_DEFAULT_USER_ROLES)

    @property
    def domain(self) -> str:
        """Returns the domain of the primary account."""

        return self.account.split("@", 1)[1] if self.account and "@" in self.account else ""

    @property
    def _aliases(self) -> list[str]:
        """Returns the additional email addresses to attach as aliases to the account."""

        return _lines(self.aliases)

    @property
    def _groups(self) -> list[str]:
        """Returns the ids of the groups the account is added to on creation."""

        return _lines(self.groups)

    @property
    def _mailing_lists(self) -> list[str]:
        """Returns the ids of the mailing lists the account is added to on creation."""

        return _lines(self.mailing_lists)

    @property
    def _quota(self) -> int:
        """Returns the disk quota in bytes to create the account with.

        An unset quota falls back to the configured default, which ``get_config`` resolves from Mail
        Settings first and the site config second. An explicit ``0`` means unlimited and is left alone.
        """

        quota_gb = self.quota_gb if self.quota_gb is not None else get_config("default_disk_quota_gb")
        return cint(flt(quota_gb) * 1024**3)

    def before_insert(self) -> None:
        is_stalwart_configured(raise_exception=True)
        self.validate_backup_email()
        self.set_request_key()
        self.set_expires_at()
        self.set_ip_address()
        self.validate_invited_by()
        self.validate_account()
        self.validate_aliases()
        self.validate_roles()
        self.validate_groups()
        self.validate_mailing_lists()

    def after_insert(self) -> None:
        if self.send_invite:
            self.send_verification_email()

    def validate_backup_email(self) -> None:
        """Validates the backup email."""

        if not self.backup_email:
            frappe.throw(_("Backup Email is required."))

        self.backup_email = self.backup_email.strip().lower()
        validate_email_address(self.backup_email, throw=True)

    def set_request_key(self) -> None:
        """Sets a random key for the request."""

        self.request_key = random_string(32)

    def set_expires_at(self) -> None:
        """Sets the expiry date of the account request."""

        if not self.expires_at:
            self.expires_at = add_to_date(now(), days=1)

    def set_ip_address(self) -> None:
        """Sets the IP address of the request."""

        self.ip_address = frappe.local.request_ip

    def validate_invited_by(self) -> None:
        """Records who created the request. A self-signup has no inviter - an empty
        invited_by is what distinguishes it from an admin-created request."""

        if self.flags.self_signup:
            self.invited_by = None
            return

        user = frappe.session.user

        if is_system_manager(user):
            self.invited_by = self.invited_by or user
        else:
            self.invited_by = user

    def validate_account(self) -> None:
        """Validates the primary account email."""

        self.account = self.account.strip().lower()
        validate_email_address(self.account, throw=True)
        is_subaddressed_email(self.account, raise_exception=True)

        if frappe.db.exists("User", {"email": self.account}):
            frappe.throw(_("User with email {0} already exists.").format(frappe.bold(self.account)))

    def validate_aliases(self) -> None:
        """Validates the additional email aliases and normalizes them.

        Each alias must be a valid, non-subaddressed email on a domain that exists on the server.
        Blanks, duplicates and any alias equal to the primary account are dropped.
        """

        if not self.aliases:
            return

        from suite.mail.stalwart import get_domains

        server_domains = {domain["name"] for domain in get_domains()}

        seen = set()
        cleaned = []
        for alias in self.aliases.split("\n"):
            alias = alias.strip().lower()
            if not alias or alias == self.account or alias in seen:
                continue

            validate_email_address(alias, throw=True)
            is_subaddressed_email(alias, raise_exception=True)

            domain = alias.split("@", 1)[1]
            if domain not in server_domains:
                frappe.throw(_("Alias domain {0} does not exist on the server.").format(frappe.bold(domain)))

            seen.add(alias)
            cleaned.append(alias)

        self.aliases = "\n".join(cleaned)

    def validate_roles(self) -> None:
        """Validates the roles."""

        roles_to_assign = self._roles
        server_roles = {r["description"] for r in get_roles()}

        for role in roles_to_assign:
            if role not in server_roles:
                frappe.throw(_("Role {0} does not exist on the server.").format(frappe.bold(role)))

        self.roles = "\n".join(roles_to_assign)

    def validate_groups(self) -> None:
        """Validates the groups the account will join and normalizes them."""

        if not self.groups:
            return

        from suite.mail.stalwart import get_all_groups

        group_ids = self._groups
        server_group_ids = {str(g["id"]) for g in get_all_groups(properties=["id"])}

        for group_id in group_ids:
            if group_id not in server_group_ids:
                frappe.throw(_("Group {0} does not exist on the server.").format(frappe.bold(group_id)))

        self.groups = "\n".join(group_ids)

    def validate_mailing_lists(self) -> None:
        """Validates the mailing lists the account will be a recipient of and normalizes them."""

        if not self.mailing_lists:
            return

        from suite.mail.stalwart import manage_get_all

        list_ids = self._mailing_lists
        server_list_ids = {str(ml["id"]) for ml in manage_get_all("MailingList", properties=["id"])}

        for list_id in list_ids:
            if list_id not in server_list_ids:
                frappe.throw(_("Mailing list {0} does not exist on the server.").format(frappe.bold(list_id)))

        self.mailing_lists = "\n".join(list_ids)

    def validate_expired(self) -> None:
        """Forbids action if the request has expired."""

        if self.is_expired:
            frappe.throw(_("This request has expired. Please create a new one."))

    def set_otp(self) -> None:
        """Generates a fresh signup OTP, caching only its hash (see `verify_otp`).

        The code itself is stashed transiently on the document so the very next
        `send_verification_email` on this instance can email it - it is never persisted.
        """

        otp = str(generate_otp(length=6))
        frappe.cache.set_value(
            otp_cache_key(self.name),
            sha256_hash(otp),
            expires_in_sec=OTP_TTL_SECONDS,
        )
        self._signup_otp = otp

    @frappe.whitelist()
    def send_verification_email(self) -> None:
        """Send verification email to the user."""

        self.validate_expired()
        self.validate_backup_email()

        # A freshly generated OTP (see set_otp) takes precedence over the invite link:
        # the caller is walking the code-verification flow, not the signup-link flow.
        if self._signup_otp:
            self._send_otp_email()
        elif self.invited_by:
            self._send_invite_email()

    def _send_otp_email(self) -> None:
        """Emails the pending signup OTP to the backup email, consuming it."""

        frappe.sendmail(
            recipients=self.backup_email,
            subject=_("Frappe Mail - Verification Code"),
            template="generic",
            args={
                "title": _("Your verification code is {0}.").format(self._signup_otp),
                "description": _(
                    "Enter this code to verify your email address. It expires in {0} minutes."
                ).format(OTP_TTL_SECONDS // 60),
            },
            now=True,
        )
        self._signup_otp = None

    def _send_invite_email(self) -> None:
        """Emails the invite link to the backup email."""

        frappe.sendmail(
            recipients=self.backup_email,
            subject=_("You have been invited by {0} to join Frappe Mail").format(self.invited_by),
            template="generic",
            args={
                "title": _("You have been invited by {0} to join Frappe Mail.").format(self.invited_by),
                "description": _("Please confirm your email address by clicking the button below."),
                "button": _("Verify Account"),
                "link": get_url("/mail/signup/" + self.request_key),
            },
            now=True,
        )
        frappe.msgprint(_("Verification email sent successfully."), indicator="green", alert=True)

        # Sending an invite link is worth recording, but only when an administrator did it: the
        # signup OTP flow reaches this as Guest and is not part of the admin trail.
        if is_suite_admin(frappe.session.user) or is_system_manager(frappe.session.user):
            log_admin_action("send invite email", self.account)

    @frappe.whitelist()
    def force_verify_and_create_account(
        self,
        first_name: str,
        last_name: str | None,
        password: str,
        locale: str | None = None,
        time_zone: str | None = None,
    ) -> None:
        """Force verify and create account for invited user."""

        user = frappe.session.user
        if not is_system_manager(user) and not is_suite_admin(user):
            frappe.throw(_("You are not authorized to perform this action."))

        if self.is_verified:
            frappe.throw(_("This account request is already verified."))

        self.db_set("is_verified", 1)
        self.create_account(first_name, last_name, password, locale, time_zone)

    def create_account(
        self,
        first_name: str,
        last_name: str | None,
        password: str,
        locale: str | None = None,
        time_zone: str | None = None,
    ) -> None:
        """Create mail account for the user.

        ``locale`` and ``time_zone`` come from whoever completes the request — the admin on a forced
        creation, the invited user on the setup form — and fall back to the server defaults when blank.
        """

        if not self.is_verified:
            frappe.throw(_("Account request is not verified. Please verify your email first."))

        if not password:
            frappe.throw(_("Password is required to create account."))

        self.validate_expired()

        is_stalwart_configured(raise_exception=True)
        self.validate_account()

        # Step - 1: Create Account on Stalwart
        account_id = execute_with_logging(
            func=lambda: create_account(
                name=self.account.split("@")[0],
                domain=self.domain,
                password=password,
                description=f"{first_name} {last_name}" if last_name else first_name,
                aliases=self._aliases,
                groups=[],
                roles=self._roles,
                quota=self._quota,
                locale=locale,
                timezone=time_zone,
            ),
            title="Failed to create account on Stalwart",
            user_message=_("Failed to create account on the server, check error log for details."),
            module="Mail",
        )

        # Step - 2: Create App Password on Stalwart
        app_password = execute_with_logging(
            func=lambda: create_app_password(self.account),
            title="Failed to create app password on Stalwart",
            user_message=_("Failed to create app password on the server, check error log for details."),
            module="Mail",
        )

        # Step - 3: Create User
        user = execute_with_logging(
            func=lambda: create_user(
                self.account,
                first_name,
                last_name,
                password,
                ["Suite User", "Suite Admin"] if self.is_admin else ["Suite User"],
            ),
            title="Failed to create user",
            user_message=_("Failed to create user, check error log for details."),
            module="Mail",
        )

        # Step - 4: Update User Settings
        execute_with_logging(
            func=lambda: self._update_user_settings(user, app_password),
            title="Failed to update user settings",
            user_message=_("Failed to update user settings, check error log for details."),
            module="Mail",
        )

        # Step - 5: Create Push Subscription
        if frappe.utils.get_url().startswith("https"):
            execute_with_logging(
                func=lambda: self._create_push_subscription(user),
                title="Failed to create push subscription",
                module="Mail",
            )

        # Step - 6: Join the groups and mailing lists picked when the request was created. Logged but
        # not thrown: the account already exists, so a stale group or list must not fail the signup.
        if account_id and self._groups:
            execute_with_logging(
                func=lambda: self._join_groups(account_id),
                title="Failed to add account to groups on Stalwart",
                module="Mail",
            )

        if self._mailing_lists:
            execute_with_logging(
                func=lambda: self._join_mailing_lists(),
                title="Failed to add account to mailing lists on Stalwart",
                module="Mail",
            )

    def _join_groups(self, account_id: str) -> None:
        """Adds the created account to each of the requested groups."""

        from suite.mail.stalwart import add_group_members

        for group_id in self._groups:
            add_group_members(group_id, [account_id])

    def _join_mailing_lists(self) -> None:
        """Adds the account's primary address as a recipient of each requested mailing list."""

        from suite.mail.stalwart import add_list_recipients

        for list_id in self._mailing_lists:
            add_list_recipients(list_id, [self.account])

    def _update_user_settings(self, user: str, app_password: str) -> None:
        """Updates the user settings with the app password and backup email."""

        user_settings = frappe.get_doc("User Settings", {"user": user})
        user_settings.username = self.account
        user_settings.app_password = app_password
        user_settings.backup_email = self.backup_email
        user_settings.save(ignore_permissions=True)

    def _create_push_subscription(self, user: str) -> None:
        """Creates a push subscription for the user."""

        ps = frappe.new_doc("Push Subscription")
        ps.user = user
        ps.insert(ignore_permissions=True)


def create_user(
    email: str,
    first_name: str,
    last_name: str | None = None,
    password: str | None = None,
    roles: list[str] | None = None,
) -> str:
    """Creates a User document"""

    if frappe.db.exists("User", {"email": email}):
        frappe.throw(_("User with email {0} already exists.").format(frappe.bold(email)))

    user = frappe.new_doc("User")
    user.first_name = first_name
    user.last_name = last_name
    user.username = email
    user.email = email
    user.owner = email
    user.send_welcome_email = 0
    if roles:
        user.append_roles(*roles)
    if password:
        user.new_password = password
    user.insert(ignore_permissions=True)

    return user.name
