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

from suite.mail.directory import create_account, delete_account_by_email, get_domains
from suite.mail.utils import get_config, is_stalwart_configured, log_mail_error
from suite.mail.utils.logger import log_admin_action
from suite.mail.utils.validation import is_subaddressed_email
from suite.utils import execute_with_logging, generate_otp
from suite.utils.user import is_suite_admin, is_system_manager

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
    def _quota_gb(self) -> float | None:
        """The quota to create the account with: the request's, else Mail Settings' default.

        Unset in both places, Suite Cloud applies the site's own default.
        """

        return flt(self.quota_gb) or flt(get_config("default_disk_quota_gb")) or None

    def before_insert(self) -> None:
        is_stalwart_configured(raise_exception=True)
        self.validate_backup_email()
        self.set_request_key()
        self.set_expires_at()
        self.set_ip_address()
        self.validate_invited_by()
        self.validate_account()
        self.validate_aliases()
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

        server_domains = {domain["domain"] for domain in get_domains()}
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

    def validate_groups(self) -> None:
        """Validates the groups the account will join and normalizes them (addresses)."""

        if not self.groups:
            return

        from suite.mail.suite_cloud import get_client

        groups = [g.strip().lower() for g in self._groups]
        site_groups = {g["email"] for g in get_client().call("mail.groups.list_groups")}
        for group in groups:
            if group not in site_groups:
                frappe.throw(_("Group {0} does not exist.").format(frappe.bold(group)))
        self.groups = "\n".join(groups)

    def validate_mailing_lists(self) -> None:
        """Validates the mailing lists the account will be a recipient of and normalizes them."""

        if not self.mailing_lists:
            return

        from suite.mail.suite_cloud import get_client

        lists = [ml.strip().lower() for ml in self._mailing_lists]
        site_lists = {ml["email"] for ml in get_client().call("mail.mailing_lists.list_mailing_lists")}
        for mailing_list in lists:
            if mailing_list not in site_lists:
                frappe.throw(_("Mailing list {0} does not exist.").format(frappe.bold(mailing_list)))
        self.mailing_lists = "\n".join(lists)

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

        # Steps 1 and 2: the account, its aliases, group and list memberships and a Suite app
        # password are created on the cluster through Suite Cloud in one call.
        account = execute_with_logging(
            func=lambda: create_account(
                email=self.account,
                password=password,
                display_name=f"{first_name} {last_name}" if last_name else first_name,
                aliases=self._aliases,
                groups=self._surviving("mail.groups.list_groups", self._groups),
                mailing_lists=self._surviving("mail.mailing_lists.list_mailing_lists", self._mailing_lists),
                disk_quota_gb=self._quota_gb,
                locale=locale,
                time_zone=time_zone,
            ),
            title="Failed to create the mail account",
            user_message=_("Failed to create the mail account, check error log for details."),
            module="Mail",
        )
        app_password = account["app_password"]

        # Steps 3 and 4 happen on this site, outside the cluster's transaction: if either fails, the
        # cluster account is removed again so a retry does not run into "already exists".
        try:
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
        except Exception:
            self._discard_cluster_account()
            raise

        # Step - 5: Create Push Subscription
        if frappe.utils.get_url().startswith("https"):
            execute_with_logging(
                func=lambda: self._create_push_subscription(user),
                title="Failed to create push subscription",
                module="Mail",
            )

    def _surviving(self, method: str, wanted: list[str]) -> list[str]:
        """The groups or lists named at invite time that still exist.

        A group deleted between the invitation and its acceptance must not stop the person from
        getting their mailbox; the missing membership is logged for the admin instead.
        """

        if not wanted:
            return wanted
        existing = {row["email"] for row in get_client().call(method)}
        missing = [address for address in wanted if address.lower() not in existing]
        if missing:
            log_mail_error(
                title=f"Invite for {self.account} named memberships that no longer exist",
                message=", ".join(missing),
            )
        return [address for address in wanted if address.lower() in existing]

    def _discard_cluster_account(self) -> None:
        """Best effort: a failure here is logged, the original error is what the caller sees."""

        try:
            delete_account_by_email(self.account)
        except Exception:
            log_mail_error(
                title=f"Failed to remove the cluster account {self.account} after a failed creation",
                message=frappe.get_traceback(),
            )

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
