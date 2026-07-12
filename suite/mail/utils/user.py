from typing import Literal

import frappe
from frappe import _
from frappe.core.doctype.user.user import generate_keys
from frappe.query_builder import Table
from frappe.utils.caching import request_cache

from suite.mail.storage import get_data_store
from suite.mail.storage.data_store import Entity
from suite.mail.utils import reconnect_on_failure, user_context


def is_administrator(user: str) -> bool:
	"""Returns True if the user is Administrator else False."""

	return user == "Administrator"


@request_cache
def has_role(user: str, roles: str | list) -> bool:
	"""Returns True if the user has any of the given roles else False."""

	if isinstance(roles, str):
		roles = [roles]

	user_roles = frappe.get_roles(user)
	for role in roles:
		if role in user_roles:
			return True

	return False


@request_cache
def is_system_manager(user: str) -> bool:
	"""Returns True if the user is Administrator or System Manager else False."""

	return is_administrator(user) or has_role(user, "System Manager")


@request_cache
def is_mail_admin(user: str) -> bool:
	"""Returns True if the user is a Mail Admin else False."""

	return has_role(user, "Mail Admin")


def is_user_enabled(user: str) -> bool:
	"""Returns True if the user account is enabled else False."""

	return bool(frappe.db.get_value("User", user, "enabled"))


def has_user_settings(user: str, raise_exception: bool = False) -> bool:
	"""Returns True if the user has User Settings else False."""

	if frappe.db.exists("User Settings", {"user": user}):
		return True

	if raise_exception:
		frappe.throw(_("User {0} does not have User Settings configured.").format(frappe.bold(user)))

	return False


def is_jmap_configured(user: str, raise_exception: bool = False) -> bool:
	"""Returns True if the user has JMAP settings configured else False."""

	if frappe.db.exists("User Settings", {"user": user, "username": ["!=", None]}):
		return True

	if raise_exception:
		frappe.throw(_("User {0} does not have JMAP settings configured.").format(frappe.bold(user)))

	return False


@request_cache
def get_user_account_ids(user: str) -> list[str]:
	"""Returns the JMAP account IDs the user has access to.

	The IDs are read from the user's cached JMAP session (populated whenever a JMAP
	connection is established). This is the source of truth for which JMAP Account
	a user may read/write, since those documents are shared per JMAP account ID.
	"""

	from suite.mail.doctype.user_account.user_account import get_user_jmap_accounts

	return get_user_jmap_accounts(user)


def get_account_user(account: str, user: str | None = None) -> str:
	"""Resolve the user whose JMAP connection authenticates requests for ``account``.

	Defaults to the explicitly provided ``user`` or the session user. An Administrator or
	System Manager may not personally have JMAP access to the account, so for them we fall
	back to any user linked to the account via User Account.
	"""

	if user:
		return user

	user = frappe.session.user
	if is_system_manager(user):
		if linked := frappe.db.get_value("User Account", {"account": account}, "user"):
			return linked

	return user


def get_account_emails(account: str) -> list[str]:
	"""Returns the list of email addresses associated with the account."""

	from suite.mail.jmap import get_identities

	emails = []
	for identity in get_identities(account):
		emails.append(identity["email"])

	return emails


def get_user_email_address(user: str) -> str | None:
	"""Returns the primary email address of the user."""

	return frappe.db.get_value("User", user, "email")


@frappe.whitelist(methods=["POST"])
def generate_user_keys(user: str) -> dict:
	"""Generates API and Secret keys for the user."""

	session_user = frappe.session.user
	if is_system_manager(session_user) or session_user == user:
		with user_context("Administrator"):
			return generate_keys(user)

	frappe.throw(_("Not permitted"), frappe.PermissionError)


def get_sync_state(account: str, type: Literal["email"]) -> str | None:
	"""Returns the Sync State for the given account and type."""

	store = get_data_store(account)
	value = store.get(Entity.STATE, f"{type}_current_state")

	return value


def update_sync_state(account: str, type: Literal["email"], state: str) -> None:
	"""Updates the Sync State for the given account and type.

	The state (and its last-update timestamp, used to throttle scheduled syncs) lives in
	the per-account data store, shared across every user of the account.
	"""

	store = get_data_store(account)
	current_state = store.get(Entity.STATE, f"{type}_current_state")
	store.set_many(
		Entity.STATE,
		{
			f"{type}_previous_state": current_state,
			f"{type}_current_state": state,
			f"{type}_state_last_update": frappe.utils.now(),
		},
	)


@reconnect_on_failure()
def clear_sync_state(account: str, type: Literal["email"]) -> None:
	"""Clear the Sync State for the given account and type."""

	store = get_data_store(account)
	store.delete(Entity.STATE, f"{type}_current_state")
	store.delete(Entity.STATE, f"{type}_previous_state")
	store.delete(Entity.STATE, f"{type}_state_last_update")
