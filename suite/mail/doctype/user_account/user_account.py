# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


from uuid import uuid7

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils.caching import request_cache

from suite.mail.utils.user import is_administrator, is_system_manager


class UserAccount(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		account: DF.Link
		user: DF.Link
		user_settings: DF.Link
	# end: auto-generated types

	def autoname(self) -> None:
		self.name = str(uuid7())


@request_cache
def get_user_for_jmap_account(
	account: str, allow_system_manager: bool = True, raise_exception: bool = False
) -> str | None:
	"""Returns the user for the given JMAP account ID. If no user is found, it returns None. If raise_exception is True, it raises an exception if the account does not belong to any user."""

	if frappe.db.exists("JMAP Account", account):
		account_users = frappe.db.get_all("User Account", {"account": account}, pluck="user")

		if account_users:
			user = frappe.session.user

			if user in account_users:
				return user

			elif is_administrator(user) or (allow_system_manager and is_system_manager(user)):
				return account_users[0]

			elif raise_exception:
				frappe.throw(
					_("JMAP account {0} does not belong to the user {1}.").format(
						frappe.bold(account), frappe.bold(user)
					)
				)

		elif raise_exception:
			frappe.throw(_("JMAP account {0} does not belong to any user.").format(frappe.bold(account)))

	elif raise_exception:
		frappe.throw(_("JMAP account {0} does not exist.").format(frappe.bold(account)))


@request_cache
def get_user_jmap_accounts(user: str | None = None, raise_exception: bool = False) -> list[str]:
	"""Returns the list of JMAP accounts for the given user. If no user is provided, it defaults to the current session user.

	Cached per request: the returned list is shared, so callers must treat it as read-only.
	"""

	user = user or frappe.session.user
	accounts = frappe.db.get_all("User Account", {"user": user}, pluck="account")

	if not accounts and raise_exception:
		frappe.throw(_("User {0} does not have any JMAP accounts configured.").format(frappe.bold(user)))

	return accounts


def is_jmap_account_belongs_to_user(
	account: str, user: str | None = None, raise_exception: bool = False
) -> bool:
	"""Checks if the given JMAP account ID belongs to the specified user. If no user is provided, it defaults to the current session user."""

	user = user or frappe.session.user
	exists = bool(frappe.db.exists("User Account", {"user": user, "account": account}))

	if raise_exception and not exists:
		frappe.throw(
			_("JMAP account {0} does not belong to the user {1}.").format(
				frappe.bold(account), frappe.bold(user)
			)
		)

	return exists


def get_user_personal_jmap_account(user: str | None = None, raise_exception: bool = False) -> str | None:
	"""Returns the personal JMAP account ID for the given user. If no user is provided, it defaults to the current session user."""

	user = user or frappe.session.user
	user_accounts = get_user_jmap_accounts(user, raise_exception=raise_exception)
	personal_accounts = frappe.db.get_all(
		"JMAP Account", {"is_personal": True, "name": ("in", user_accounts)}, pluck="name"
	)

	if personal_accounts:
		if len(personal_accounts) > 1:
			if raise_exception:
				frappe.throw(
					_("User {0} has multiple personal JMAP accounts configured.").format(frappe.bold(user))
				)
		else:
			return personal_accounts[0]

	elif raise_exception:
		frappe.throw(
			_("User {0} does not have a personal JMAP account configured.").format(frappe.bold(user))
		)


def get_permission_query_condition(user: str | None = None) -> str | None:
	user = user or frappe.session.user
	if is_system_manager(user):
		return ""

	return f"""`tabUser Account`.user = '{user}'"""


def has_permission(doc: "Document", ptype: str, user: str | None = None) -> bool:
	if doc.doctype != "User Account":
		return False

	user = user or frappe.session.user
	return doc.user == user or is_system_manager(user)


def on_doctype_update() -> None:
	frappe.db.add_unique("User Account", ["user", "account"], constraint_name="unique_user_account")
