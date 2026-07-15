import frappe
from frappe import _
from frappe.core.doctype.user.user import generate_keys
from frappe.utils.caching import request_cache

from suite.utils import user_context


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


def is_user_enabled(user: str) -> bool:
	"""Returns True if the user account is enabled else False."""

	return bool(frappe.db.get_value("User", user, "enabled"))


@frappe.whitelist(methods=["POST"])
def generate_user_keys(user: str) -> dict:
	"""Generates API and Secret keys for the user."""

	session_user = frappe.session.user
	if is_system_manager(session_user) or session_user == user:
		with user_context("Administrator"):
			return generate_keys(user)

	frappe.throw(_("Not permitted"), frappe.PermissionError)
