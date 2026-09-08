# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import base64
import os

import frappe
from frappe import _
from frappe.model.document import Document

from suite.mail import suite_cloud
from suite.mail.directory import get_domains
from suite.mail.utils import get_config, is_stalwart_configured


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
        site_api_key: DF.Data | None
        site_api_secret: DF.Password | None
        suite_cloud_url: DF.Data | None
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

    def validate_signup(self) -> None:
        """Validates the Signup."""

        if not self.allow_signup:
            self.signup_domains = ""
            return

        is_stalwart_configured(raise_exception=True)

        if not self.signup_domains:
            frappe.throw(_("Please add at least one Signup Domain."))

        signup_domains = self.signup_domains.split("\n")

        if not signup_domains:
            frappe.throw(_("Invalid Signup Domains format. Please provide one domain per line."))

        site_domains = {d["domain"] for d in get_domains()}
        valid_signup_domains = []
        for domain in signup_domains:
            domain = domain.strip().lower()
            if domain:
                if domain not in site_domains:
                    frappe.throw(
                        _("Domain {0} is not one of this site's mail domains.").format(frappe.bold(domain))
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

        for value, label in (
            (p256dh, _("P256DH")),
            (private_key, _("Private Key")),
            (auth, _("Auth")),
        ):
            if not self._is_urlsafe_base64(value):
                frappe.throw(
                    _("The JMAP Push Subscription {0} key must be URL-safe base64 encoded.").format(
                        frappe.bold(label)
                    )
                )

        try:
            from cryptography.hazmat.primitives.asymmetric import ec
            from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

            def _b64decode(s: str) -> bytes:
                return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

            priv_bytes = _b64decode(private_key)
            priv = ec.derive_private_key(int.from_bytes(priv_bytes, "big"), ec.SECP256R1())
            computed_pub = priv.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
            expected_pub = _b64decode(p256dh)
            if computed_pub != expected_pub:
                frappe.throw(
                    _("The JMAP Push Subscription Private Key does not correspond to the P256DH public key.")
                )
        except frappe.exceptions.ValidationError:
            raise
        except Exception as e:
            frappe.throw(_("Invalid JMAP Push Subscription keys: {0}").format(str(e)))

    @frappe.whitelist()
    def validate_suite_cloud_credentials(self) -> dict:
        """Pings Suite Cloud with the configured URL, key and secret and reports what it answered.

        Reads the effective configuration, so credentials written to the site config by Frappe
        Cloud are checked too; unsaved edits on the form are not.
        """

        frappe.only_for("System Manager")
        suite_cloud.is_suite_cloud_configured(raise_exception=True)
        site = suite_cloud.get_client().call("ping")

        message = _("Connected to Suite Cloud as site {0} on cluster {1}.").format(
            frappe.bold(site.get("site")), frappe.bold(site.get("cluster") or site.get("jmap_url"))
        )
        indicator = "green"
        jmap_url = (site.get("jmap_url") or "").rstrip("/")
        server_url = (get_config("server_url") or "").rstrip("/")
        if jmap_url and jmap_url != server_url:
            message += "<br>" + _("Suite Cloud expects the JMAP URL {0}, but this site uses {1}.").format(
                frappe.bold(jmap_url), frappe.bold(server_url or _("none"))
            )
            indicator = "orange"
        frappe.msgprint(message, title=_("Suite Cloud"), indicator=indicator)
        return site

    @frappe.whitelist()
    def generate_jmap_push_keys(self) -> None:
        """Generates new JMAP push subscription encryption keys and saves them."""

        self._generate_jmap_push_keys()
        frappe.msgprint(_("JMAP Push keys generated successfully."), alert=True)

    def _generate_jmap_push_keys(self) -> None:
        """Generates a new ECDH P-256 key pair and auth secret for JMAP push encryption and saves them."""

        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

        private_key = ec.generate_private_key(ec.SECP256R1())
        private_key_bytes = private_key.private_numbers().private_value.to_bytes(32, "big")
        public_key_bytes = private_key.public_key().public_bytes(
            Encoding.X962, PublicFormat.UncompressedPoint
        )
        auth_bytes = os.urandom(16)

        self.jmap_push_p256dh = base64.urlsafe_b64encode(public_key_bytes).decode()
        self.jmap_push_private_key = base64.urlsafe_b64encode(private_key_bytes).decode()
        self.jmap_push_auth = base64.urlsafe_b64encode(auth_bytes).decode()

        self.flags.ignore_mandatory = True
        self.flags.ignore_validate = True
        self.save()

    @staticmethod
    def _is_urlsafe_base64(value: str) -> bool:
        """Returns True if the given value is URL-safe base64 encoded."""

        try:
            padding = "=" * (-len(value) % 4)
            base64.urlsafe_b64decode(f"{value}{padding}".encode())
            return True
        except Exception:
            return False

    def clear_cache(self) -> None:
        """Clears the Cache."""

        frappe.cache.delete_value("mail-settings")


def get_signup_domains() -> list:
    """Returns the signup domains."""

    settings = frappe.get_cached_doc("Mail Settings")
    return settings.signup_domains.split("\n") if settings.signup_domains else []
