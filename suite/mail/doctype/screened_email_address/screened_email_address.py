# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from uuid import uuid7

import frappe
from frappe import _
from frappe.model.document import Document

from suite.mail.doctype.user_account.user_account import get_user_jmap_accounts
from suite.utils.user import is_suite_admin, is_system_manager

# Screening actions: what happens to future mail from a screened sender. Blocking a sender is the
# Spam action — their mail goes to Junk, never discarded unseen.
SPAM = "Spam"  # file the incoming mail into the Spam (Junk) folder


class ScreenedEmailAddress(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        account: DF.Link | None
        action: DF.Literal["Spam", "Accepted"]
        email: DF.Data
    # end: auto-generated types

    def autoname(self) -> None:
        self.name = str(uuid7())

    def validate(self) -> None:
        self.validate_global_rule_permission()
        self.validate_email()
        self.validate_duplicate_email()

    def validate_global_rule_permission(self) -> None:
        """A rule without an account is global (applies to every account), so only admins may manage it."""

        if self.account:
            return

        user = frappe.session.user
        if not (is_system_manager(user) or is_suite_admin(user)):
            frappe.throw(
                _(
                    "Only a System Manager or Suite Admin can manage global screened email addresses (without an account)."
                ),
                frappe.PermissionError,
            )

    def validate_email(self) -> None:
        """Normalise and validate the screened value — a full email address or an '@domain' entry."""

        from suite.mail.utils.validation import normalize_screened_value, validate_screened_value

        self.email = normalize_screened_value(self.email)
        validate_screened_value(self.email, raise_exception=True)

    def on_update(self) -> None:
        from suite.mail.doctype.sieve_script.sieve_script import maybe_build_automation_sieve

        # Global rules (no account) affect every account, so no single script can be rebuilt here.
        # Rebuilds are deliberately not fanned out either — an admin batches their global changes and
        # then triggers "Rebuild Automation Sieves" from the list view once.
        if not self.account:
            return

        # Runs on both insert and save. `email` is set_only_once, so on an edit only the action can
        # change; regenerate on insert (no prior doc) and whenever the action is changed (e.g. switching
        # Spam <-> Accepted in Desk), since that moves the sender between sieve blocks. Skipped when a
        # caller paused builds for a bulk write (it rebuilds once at the end instead).
        if self.has_value_changed("action"):
            # Activate the automation script so the screening rule takes effect (unless vacation is active).
            maybe_build_automation_sieve(self.account, activate=True)

    def after_delete(self) -> None:
        from suite.mail.doctype.sieve_script.sieve_script import maybe_build_automation_sieve

        # Removing a global rule does not rebuild anything either — see on_update.
        if not self.account:
            return

        maybe_build_automation_sieve(self.account, activate=True)

    def validate_duplicate_email(self) -> None:
        """Validates that the same email address is not screened more than once for the same account.

        Global rules (no account) are checked against the other global rules. This validation is the
        only duplicate guard for them: the unique index on (account, email) does not apply because
        MariaDB allows multiple rows with a NULL in a unique key.
        """

        account_filter = self.account or ("is", "not set")
        if frappe.db.exists(
            "Screened Email Address",
            {"account": account_filter, "email": self.email, "name": ["!=", self.name]},
        ):
            if self.account:
                message = frappe._("The email address {0} is already screened for this account.")
            else:
                message = frappe._("The email address {0} is already screened globally.")

            frappe.throw(message.format(self.email))


def get_screened_email_addresses(account: str, action: str | None = None) -> list[dict]:
    """Returns the screened email addresses (with their action) for the given account.

    Keyed on `account` so every user with access to a shared account sees the same list. Pass
    `action` to restrict to a single action (e.g. only the Spam rules). `creation` and `modified`
    are included so the settings UI can sort by when a rule was added or last changed (default order).
    """

    filters = {"account": account}
    if action:
        filters["action"] = action

    return frappe.db.get_all(
        "Screened Email Address",
        filters=filters,
        fields=["email", "action", "creation", "modified"],
        order_by="modified desc",
    )


def get_global_screened_email_addresses() -> list[dict]:
    """Returns the global screened email addresses — rules without an account, applying to every account."""

    return frappe.db.get_all(
        "Screened Email Address",
        filters={"account": ("is", "not set")},
        fields=["email", "action", "creation", "modified"],
        order_by="modified desc",
    )


def get_global_accepted_values() -> set[str]:
    """Returns the values (lowercased) of the global Accepted rules — exact email addresses and
    '@domain' entries (prefix kept) whose senders already reach every account's inbox."""

    return {row.email.lower() for row in get_global_screened_email_addresses() if row.action == "Accepted"}


def is_globally_accepted(email: str, accepted_values: set[str] | None = None) -> bool:
    """Whether the email is covered by a global Accepted rule — its exact address or its '@domain'.

    Pass `accepted_values` (from `get_global_accepted_values`) when checking a batch, so the rules
    are fetched once.
    """

    if accepted_values is None:
        accepted_values = get_global_accepted_values()

    email = (email or "").lower()
    return email in accepted_values or "@" + email.split("@")[-1] in accepted_values


def get_effective_screened_email_addresses(account: str) -> list[dict]:
    """Returns the screened email addresses in effect for the account: the global rules overlaid with
    the account's own, where the account's rule wins when both screen the same email or domain.

    This is what the automation sieve script is built from — `get_screened_email_addresses` stays
    account-only so the settings UI never shows (or lets a user edit) the admin-managed global rules.
    Keyed case-insensitively to match the case-insensitive unique index on (account, email).
    """

    merged = {row.email.lower(): row for row in get_global_screened_email_addresses()}
    merged.update({row.email.lower(): row for row in get_screened_email_addresses(account)})

    return list(merged.values())


def get_permission_query_condition(user: str | None = None) -> str | None:
    user = user or frappe.session.user
    if is_system_manager(user) or is_suite_admin(user):
        return ""

    accounts = get_user_jmap_accounts(user)
    if not accounts:
        return "1=0"

    return f"""`tabScreened Email Address`.account in ({", ".join(frappe.db.escape(account) for account in accounts)})"""


def has_permission(doc: Document, ptype: str, user: str | None = None) -> bool:
    if doc.doctype != "Screened Email Address":
        return False

    user = user or frappe.session.user

    if is_system_manager(user) or is_suite_admin(user):
        return True

    accounts = get_user_jmap_accounts(user)
    if not accounts:
        return False

    return doc.account in accounts


def on_doctype_update() -> None:
    # Screening list is shared per account, so uniqueness is on (account, email) — one rule
    # per address regardless of action.
    frappe.db.add_unique(
        "Screened Email Address",
        ["account", "email"],
        constraint_name="unique_account_screened_email",
    )
