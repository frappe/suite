# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import base64

import frappe
from frappe import _
from frappe.model.document import Document
from jmap.push import PushKeyPair

from suite.mail.directory import get_active_domain_names
from suite.suite_core.utils import is_suite_cloud_configured


class MailSettings(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        from suite.mail.doctype.mail_client_configuration.mail_client_configuration import (
            MailClientConfiguration,
        )

        allow_signup: DF.Check
        custom_event_invites: DF.Check
        default_disk_quota_gb: DF.Int
        default_gravatar: DF.Literal[
            "404", "mp", "identicon", "monsterid", "wavatar", "retro", "robohash", "blank"
        ]
        enable_gravatar: DF.Check
        enable_jmap_push_encryption: DF.Check
        exchange_export_batch_size: DF.Int
        exchange_export_timeout: DF.Int
        exchange_import_timeout: DF.Int
        exchange_max_export: DF.Int
        exchange_max_import: DF.Int
        expand_mailing_list_participants: DF.Check
        jmap_push_auth: DF.Password | None
        jmap_push_p256dh: DF.Data | None
        jmap_push_private_key: DF.Password | None
        log_file_count: DF.Int
        log_level: DF.Literal["ERROR", "WARNING", "INFO", "DEBUG"]
        log_max_file_size_mb: DF.Int
        mail_client_configurations: DF.Table[MailClientConfiguration]
        max_email_sync: DF.Int
        max_mailing_list_participants: DF.Int
        max_message_payload_size_mb: DF.Int
        max_push_notifications: DF.Int
        process_pending_emails_batch_size: DF.Int
        process_pending_emails_max_batch_size: DF.Int
        process_pending_emails_timeout: DF.Int
        scan_message_timeout: DF.Int
        server_url: DF.Data | None
        show_calendar_client_config: DF.Check
        show_mail_client_config: DF.Check
        signup_domains: DF.SmallText | None
        spamd_host: DF.Data | None
        spamd_hybrid_scanning_threshold: DF.Float
        spamd_port: DF.Int
        spamd_scanning_mode: DF.Literal["Exclude Attachments", "Include Attachments", "Hybrid Approach"]
        verify_ssl: DF.Check
    # end: auto-generated types

    def validate(self) -> None:
        if not frappe.flags.in_migrate:
            self.validate_jmap_push_subscription_keys()
            self.validate_signup()

    def on_update(self) -> None:
        self.clear_cache()
        frappe.clear_document_cache(self.doctype)
        if self.has_value_changed("server_url"):
            # Mail and Calendar are offered on a site with a JMAP server, so the launcher's answer changes.
            from suite.api.account import forget_logged_in_users

            forget_logged_in_users()

    def validate_signup(self) -> None:
        """Validates the Signup."""

        if not self.allow_signup:
            self.signup_domains = ""
            return

        # Only a change to the signup fields is checked against Suite Cloud: the client would
        # otherwise use the credentials from before this save, refusing the save that fixes them.
        if not (self.has_value_changed("allow_signup") or self.has_value_changed("signup_domains")):
            return

        is_suite_cloud_configured(raise_exception=True)  # the domains are Suite Cloud's to tell

        if not self.signup_domains:
            frappe.throw(_("Please add at least one Signup Domain."))

        signup_domains = self.signup_domains.split("\n")

        if not signup_domains:
            frappe.throw(_("Invalid Signup Domains format. Please provide one domain per line."))

        # Accounts can only be created on active domains, so signup is offered on those alone.
        site_domains = set(get_active_domain_names())
        valid_signup_domains = []
        for domain in signup_domains:
            domain = domain.strip().lower()
            if domain:
                if domain not in site_domains:
                    frappe.throw(
                        _("Domain {0} is not an active mail domain of this site.").format(frappe.bold(domain))
                    )
                valid_signup_domains.append(domain)

        self.signup_domains = "\n".join(valid_signup_domains)

    def validate_jmap_push_subscription_keys(self) -> None:
        """Validates site-level JMAP push subscription encryption keys."""

        p256dh = (self.jmap_push_p256dh or "").strip()
        auth = (self.get_password("jmap_push_auth") if self.jmap_push_auth else "").strip()
        private_key = (
            self.get_password("jmap_push_private_key") if self.jmap_push_private_key else ""
        ).strip()

        set_count = sum([bool(p256dh), bool(auth), bool(private_key)])
        if set_count not in (0, 3):
            frappe.throw(
                _(
                    "JMAP Push Subscription keys are incomplete. Use Actions → Generate JMAP Push Keys to regenerate them."
                )
            )

        if self.enable_jmap_push_encryption and set_count != 3:
            frappe.throw(
                _(
                    "Push encryption is enabled but the JMAP Push Subscription keys are not configured. Use Actions → Generate JMAP Push Keys to generate them, or disable Enable Push Encryption."
                )
            )

        if set_count == 0:
            return

        try:
            pair = PushKeyPair(private_key, auth)
            public_key = _unbase64(p256dh)
        except ValueError as e:  # binascii.Error included
            frappe.throw(_("Invalid JMAP Push Subscription keys: {0}").format(e))

        # Either half may have been stored with base64 padding; compare the key bytes.
        if _unbase64(pair.keys.p256dh) != public_key:
            frappe.throw(
                _("The JMAP Push Subscription Private Key does not correspond to the P256DH public key.")
            )

    @frappe.whitelist()
    def generate_jmap_push_keys(self) -> None:
        """Generates new JMAP push subscription encryption keys and saves them."""

        self._generate_jmap_push_keys()
        frappe.msgprint(_("JMAP Push keys generated successfully."), alert=True)

    def _generate_jmap_push_keys(self) -> None:
        """Generates a new ECDH P-256 key pair and auth secret for JMAP push encryption and saves them."""

        pair = PushKeyPair.generate()

        self.jmap_push_p256dh = pair.keys.p256dh
        self.jmap_push_private_key = pair.private_key
        self.jmap_push_auth = pair.auth

        self.flags.ignore_mandatory = True
        self.flags.ignore_validate = True
        self.save()

    def clear_cache(self) -> None:
        """Clears the Cache."""

        frappe.cache.delete_value("mail-settings")


def _unbase64(text: str) -> bytes:
    """URL-safe base64 to bytes, whether or not the text kept its padding."""

    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def get_signup_domains() -> list:
    """Returns the signup domains."""

    settings = frappe.get_cached_doc("Mail Settings")
    return settings.signup_domains.split("\n") if settings.signup_domains else []
