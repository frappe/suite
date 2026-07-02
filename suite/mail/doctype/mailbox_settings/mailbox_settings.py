# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from uuid import uuid7

import frappe
from frappe import _
from frappe.model.document import Document

from suite.mail.doctype.user_account.user_account import get_user_jmap_accounts
from suite.mail.utils.user import is_system_manager

# Fields that feed the Mailbox section of the frappe_mail_automation sieve script; a change to any of
# them regenerates the script.
AUTOMATION_FIELDS = ("emails_from", "subject_contains", "match_if", "mark_as_read", "add_star")


class MailboxSettings(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		account: DF.Link
		add_star: DF.Check
		color: DF.Literal["Gray", "Blue", "Green", "Amber", "Red", "Purple"]
		disable_push_notification: DF.Check
		emails_from: DF.SmallText | None
		mailbox_id: DF.Data
		mark_as_read: DF.Check
		match_if: DF.Literal["any", "all"]
		subject_contains: DF.SmallText | None
	# end: auto-generated types

	"""Per-mailbox settings, shared per JMAP account ID — every user with access to the
	account sees the same mailbox icons, colors, and push-notification preferences."""

	def autoname(self) -> None:
		self.name = str(uuid7())

	def validate(self) -> None:
		self.validate_duplicate()

	def on_update(self) -> None:
		# Regenerate the automation sieve when a folder's automation rules change through the document
		# lifecycle (e.g. a save from Desk). The high-volume API path writes via db_set — which bypasses
		# this hook — and rebuilds explicitly once after its structural writes. Skipped during migrate
		# (no JMAP round-trips) and when a caller paused builds for a bulk write.
		if frappe.flags.in_migrate or frappe.flags.get("skip_automation_sieve_build"):
			return

		if any(self.has_value_changed(field) for field in AUTOMATION_FIELDS):
			from suite.mail.doctype.sieve_script.sieve_script import maybe_build_automation_sieve

			maybe_build_automation_sieve(self.account)

	def validate_duplicate(self) -> None:
		"""Checks for duplicate Mailbox Settings for the same account and mailbox ID."""

		existing = frappe.db.exists(
			"Mailbox Settings",
			{
				"name": ["!=", self.name],
				"account": self.account,
				"mailbox_id": self.mailbox_id,
			},
		)

		if existing:
			frappe.throw(
				_("Mailbox Settings for account {0} with mailbox ID {1} already exists.").format(
					frappe.bold(self.account), frappe.bold(self.mailbox_id)
				),
				title=_("Duplicate Mailbox Settings"),
			)

	def _db_set(
		self,
		update_modified: bool = True,
		commit: bool = False,
		notify: bool = False,
		**kwargs,
	) -> None:
		"""Updates the document with the given key-value pairs."""

		self.db_set(kwargs, update_modified=update_modified, notify=notify, commit=commit)


def get_mailbox_settings(
	account: str, mailbox_id: str, raise_exception: bool = True
) -> MailboxSettings | None:
	"""Fetches the Mailbox Settings for a given account and mailbox ID."""

	if settings := frappe.db.get_value("Mailbox Settings", {"account": account, "mailbox_id": mailbox_id}):
		return frappe.get_doc("Mailbox Settings", settings)

	if raise_exception:
		frappe.throw(
			_("Mailbox Settings for account {0} with mailbox ID {1} not found.").format(
				frappe.bold(account), frappe.bold(mailbox_id)
			)
		)


def automation_rules_to_settings(rules: dict | None) -> dict:
	"""Flatten a rule dict (or None) into the Mailbox Settings automation fields.

	A falsy `rules` clears the fields, so removing a mailbox's automation in the UI also clears its
	backup.
	"""

	rules = rules or {}
	return {
		"emails_from": rules.get("emails_from") or "",
		"subject_contains": rules.get("subject_contains") or "",
		"match_if": rules.get("match_if") or "any",
		"mark_as_read": 1 if rules.get("mark_as_read") else 0,
		"add_star": 1 if rules.get("add_star") else 0,
	}


def set_mailbox_settings(account: str, mailbox_id: str, **kwargs) -> None:
	"""Sets the Mailbox Settings for a given account and mailbox ID. Creates a new document if it doesn't exist."""

	settings = get_mailbox_settings(account, mailbox_id, raise_exception=False)

	if not settings:
		settings = frappe.new_doc("Mailbox Settings")
		settings.account = account
		settings.mailbox_id = mailbox_id
		settings.insert()

	mailbox_fields = ["subscribed", "parent", "_name", "role", "sort_order"]
	filtered_kwargs = {k: v for k, v in kwargs.items() if k not in mailbox_fields}

	if filtered_kwargs:
		settings._db_set(**filtered_kwargs)

	if any(field in kwargs for field in mailbox_fields):
		mailbox = frappe.get_doc("Mailbox", f"{account}|{mailbox_id}")
		for field in mailbox_fields:
			if field in kwargs:
				setattr(mailbox, field, kwargs[field])
		mailbox.save()


def on_doctype_update() -> None:
	# Mailbox settings are shared per account, so uniqueness is on (account, mailbox_id).
	frappe.db.add_unique(
		"Mailbox Settings", ["account", "mailbox_id"], constraint_name="unique_account_mailbox"
	)


def get_permission_query_condition(user: str | None = None) -> str | None:
	user = user or frappe.session.user
	if is_system_manager(user):
		return ""

	accounts = get_user_jmap_accounts(user)
	if not accounts:
		return "1=0"

	return f"""`tabMailbox Settings`.account in ({", ".join(frappe.db.escape(account) for account in accounts)})"""


def has_permission(doc: "Document", ptype: str, user: str | None = None) -> bool:
	if doc.doctype != "Mailbox Settings":
		return False

	user = user or frappe.session.user

	if is_system_manager(user):
		return True

	accounts = get_user_jmap_accounts(user)
	if not accounts:
		return False

	return doc.account in accounts
