# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from uuid import uuid7

import frappe
from frappe import _
from frappe.model.document import Document

from suite.mail.doctype.user_account.user_account import get_user_jmap_accounts
from suite.mail.utils.user import is_system_manager


class MailSyncHistory(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		account: DF.Link
		last_received_at: DF.Datetime | None
		last_received_mail: DF.Data | None
		source: DF.Data
	# end: auto-generated types

	"""Per-source inbound-pull watermark, shared per JMAP account ID — every user with
	access to the account shares the same last-received state for a given source."""

	def autoname(self) -> None:
		self.name = str(uuid7())

	def before_insert(self) -> None:
		self.validate_duplicate()

	def validate_duplicate(self) -> None:
		"""Validate if the Mail Sync History already exists."""

		if frappe.db.exists(
			"Mail Sync History",
			{"account": self.account, "source": self.source},
		):
			frappe.throw(_("Mail Sync History already exists for this account and source."))


def create_mail_sync_history(
	account: str,
	source: str,
	last_received_at: str | None = None,
	commit: bool = False,
) -> "MailSyncHistory":
	"""Create a Mail Sync History."""

	doc = frappe.new_doc("Mail Sync History")
	doc.account = account
	doc.source = source
	doc.last_received_at = last_received_at
	doc.insert(ignore_permissions=True)

	if commit:
		frappe.db.commit()

	return doc


def get_mail_sync_history(account: str, source: str) -> "MailSyncHistory":
	"""Returns the Mail Sync History for the given account and source."""

	if name := frappe.db.exists("Mail Sync History", {"account": account, "source": source}):
		return frappe.get_doc("Mail Sync History", name)

	return create_mail_sync_history(account, source, commit=True)


def get_permission_query_condition(user: str | None = None) -> str | None:
	user = user or frappe.session.user
	if is_system_manager(user):
		return ""

	accounts = get_user_jmap_accounts(user)
	if not accounts:
		return "1=0"

	return f"""`tabMail Sync History`.account in ({", ".join(frappe.db.escape(account) for account in accounts)})"""


def has_permission(doc: "Document", ptype: str, user: str | None = None) -> bool:
	if doc.doctype != "Mail Sync History":
		return False

	user = user or frappe.session.user

	if is_system_manager(user):
		return True

	accounts = get_user_jmap_accounts(user)
	if not accounts:
		return False

	return doc.account in accounts
