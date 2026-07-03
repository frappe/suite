# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from uuid import uuid7

import frappe
from frappe.model.document import Document

from suite.mail.doctype.user_account.user_account import get_user_jmap_accounts
from suite.mail.utils.user import is_system_manager

# Screening actions: what happens to future mail from a screened sender.
REJECT = "Reject"  # discard the incoming mail silently
SPAM = "Spam"  # file the incoming mail into the Spam (Junk) folder


class ScreenedEmailAddress(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		account: DF.Link
		action: DF.Literal["Spam", "Reject", "Accepted"]
		email: DF.Data
	# end: auto-generated types

	def autoname(self) -> None:
		self.name = str(uuid7())

	def validate(self) -> None:
		self.validate_email()
		self.validate_duplicate_email()

	def validate_email(self) -> None:
		"""Normalise and validate the screened value — a full email address or an '@domain' entry."""

		from suite.mail.utils.validation import normalize_screened_value, validate_screened_value

		self.email = normalize_screened_value(self.email)
		validate_screened_value(self.email, raise_exception=True)

	def on_update(self) -> None:
		from suite.mail.doctype.sieve_script.sieve_script import maybe_build_automation_sieve

		# Runs on both insert and save. `email` is set_only_once, so on an edit only the action can
		# change; regenerate on insert (no prior doc) and whenever the action is changed (e.g. switching
		# Spam <-> Reject in Desk), since that moves the sender between sieve blocks. Skipped when a
		# caller paused builds for a bulk write (it rebuilds once at the end instead).
		if self.has_value_changed("action"):
			# Activate the automation script so the screening rule takes effect (unless vacation is active).
			maybe_build_automation_sieve(self.account, activate=True)

	def after_delete(self) -> None:
		from suite.mail.doctype.sieve_script.sieve_script import maybe_build_automation_sieve

		maybe_build_automation_sieve(self.account, activate=True)

	def validate_duplicate_email(self) -> None:
		"""Validates that the same email address is not screened more than once for the same account."""

		if frappe.db.exists(
			"Screened Email Address",
			{"account": self.account, "email": self.email, "name": ["!=", self.name]},
		):
			frappe.throw(
				frappe._("The email address {0} is already screened for this account.").format(self.email)
			)


def get_screened_email_addresses(account: str, action: str | None = None) -> list[dict]:
	"""Returns the screened email addresses (with their action) for the given account.

	Keyed on `account` so every user with access to a shared account sees the same list. Pass
	`action` to restrict to a single action (e.g. only the Reject rules).
	"""

	filters = {"account": account}
	if action:
		filters["action"] = action

	return frappe.db.get_all("Screened Email Address", filters=filters, fields=["email", "action"])


def get_permission_query_condition(user: str | None = None) -> str | None:
	user = user or frappe.session.user
	if is_system_manager(user):
		return ""

	accounts = get_user_jmap_accounts(user)
	if not accounts:
		return "1=0"

	return f"""`tabScreened Email Address`.account in ({", ".join(frappe.db.escape(account) for account in accounts)})"""


def has_permission(doc: "Document", ptype: str, user: str | None = None) -> bool:
	if doc.doctype != "Screened Email Address":
		return False

	user = user or frappe.session.user

	if is_system_manager(user):
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
