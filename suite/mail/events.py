from typing import Any

import frappe
from frappe import _
from frappe.core.doctype.user.user import _get_user_for_update_password
from frappe.core.doctype.user.user import update_password as update_frappe_password
from frappe.model.document import Document

from suite.mail.stalwart import add_account_role as add_stalwart_account_role
from suite.mail.stalwart import delete_account as delete_stalwart_account
from suite.mail.stalwart import remove_account_role as remove_stalwart_account_role
from suite.mail.stalwart import update_password as update_stalwart_password
from suite.mail.utils import get_config, is_stalwart_configured
from suite.mail.utils.user import is_jmap_configured
from suite.utils import execute_with_logging


def create_user_settings(doc: Document, method: str | None = None) -> None:
	"""Create User Settings for the new user if not already present."""

	if not frappe.db.exists("User Settings", {"user": doc.name}):
		settings = frappe.new_doc("User Settings")
		settings.user = doc.name
		settings.insert(ignore_permissions=True, ignore_mandatory=True)


def delete_user_accounts(doc: Document, method: str | None = None) -> None:
	"""Delete User Accounts when the user is deleted."""

	for account in frappe.db.get_all("User Account", filters={"user": doc.name}, pluck="name"):
		frappe.delete_doc("User Account", account, ignore_permissions=True, delete_permanently=True)


def delete_user_settings(doc: Document, method: str | None = None) -> None:
	"""Delete User Settings when the user is deleted."""

	for settings in frappe.db.get_all("User Settings", filters={"user": doc.name}, pluck="name"):
		frappe.delete_doc("User Settings", settings, ignore_permissions=True, delete_permanently=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def update_password(
	new_password: str, logout_all_sessions: int = 0, key: str | None = None, old_password: str | None = None
) -> Any:
	"""Override the default update_password whitelisted method to update the password on Stalwart server when the user updates their password."""

	frappe.flags.in_update_password = True

	if not is_stalwart_configured(raise_exception=False):
		return update_frappe_password(
			new_password=new_password,
			logout_all_sessions=logout_all_sessions,
			key=key,
			old_password=old_password,
		)

	result = _get_user_for_update_password(key, old_password)
	user = result.get("user")

	result = update_frappe_password(
		new_password=new_password, logout_all_sessions=logout_all_sessions, key=key, old_password=old_password
	)

	if user and is_jmap_configured(user):
		execute_with_logging(
			lambda: update_stalwart_password(user, new_password=new_password),
			title="Failed to update password on Stalwart server",
			with_context=False,
		)

	return result


def update_account_password(doc: Document, method: str | None = None) -> None:
	"""Updates the password on Stalwart server when the user updates their password."""

	if (
		frappe.flags.in_update_password
		or doc.flags.in_insert
		or not doc.enabled
		or not is_stalwart_configured(raise_exception=False)
		or not is_jmap_configured(doc.name)
	):
		return

	user = doc.name
	new_password = doc._User__new_password

	if not new_password:
		return

	execute_with_logging(
		lambda: update_stalwart_password(user, new_password=new_password),
		title="Failed to update password on Stalwart server",
		with_context=False,
	)


def clear_sessions_on_disable(doc: Document, method: str | None = None) -> None:
	"""Log the user out everywhere when they are disabled.

	Clears both the user's Frappe sessions and their cached JMAP session so a disabled user
	loses access immediately instead of continuing on an existing session until it expires.
	"""

	if doc.flags.in_insert or doc.enabled or not doc.has_value_changed("enabled"):
		return

	from frappe.sessions import clear_sessions

	from suite.mail.jmap import get_jmap_session_manager

	clear_sessions(user=doc.name, force=True)
	get_jmap_session_manager(doc.name).clear_session()


def apply_disabled_account_role(doc: Document, method: str | None = None) -> None:
	"""Apply the configured Stalwart role to the user's mail account when the user is disabled.

	The role is created manually on Stalwart with the desired allowed/disabled permissions, so
	applying it effectively restricts the disabled user's mail access. No-op if no role is configured.
	"""

	if (
		doc.flags.in_insert
		or doc.enabled
		or not doc.has_value_changed("enabled")
		or not is_stalwart_configured(raise_exception=False)
		or not is_jmap_configured(doc.name)
	):
		return

	role = get_config("disabled_account_role")
	if not role:
		return

	execute_with_logging(
		lambda: add_stalwart_account_role(doc.name, role),
		title="Failed to apply disabled account role on Stalwart server",
		with_context=False,
	)


def remove_disabled_account_role(doc: Document, method: str | None = None) -> None:
	"""Remove the configured Stalwart disabled account role when the user is re-enabled.

	This reverses apply_disabled_account_role so the user regains their mail access on enable.
	No-op if no role is configured.
	"""

	if (
		doc.flags.in_insert
		or not doc.enabled
		or not doc.has_value_changed("enabled")
		or not is_stalwart_configured(raise_exception=False)
		or not is_jmap_configured(doc.name)
	):
		return

	role = get_config("disabled_account_role")
	if not role:
		return

	execute_with_logging(
		lambda: remove_stalwart_account_role(doc.name, role),
		title="Failed to remove disabled account role on Stalwart server",
		with_context=False,
	)


def delete_account(doc: Document, method: str | None = None) -> None:
	if not is_stalwart_configured(raise_exception=False) or not is_jmap_configured(doc.name):
		return

	user = doc.name
	execute_with_logging(
		lambda: delete_stalwart_account(user),
		title="Failed to delete account on Stalwart server",
		with_context=False,
	)
