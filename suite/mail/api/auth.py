import frappe
from frappe import _

from suite.mail.doctype.user_account.user_account import get_user_jmap_accounts
from suite.mail.utils.rate_limiter import dynamic_rate_limit
from suite.mail.utils.user import get_account_emails, is_jmap_configured


@frappe.whitelist(methods=["POST"])
@dynamic_rate_limit()
def validate(email: str) -> None:
	"""Validates if the email is associated with the user."""

	validate_user()
	validate_email_ownership(email)


def validate_user() -> None:
	"""Validates if the user has permission to access the app."""

	is_jmap_configured(frappe.session.user, raise_exception=True)


def validate_email_ownership(email: str) -> None:
	"""Validates if the email is associated with any account of the user."""

	email = email.strip().lower()
	if not email:
		frappe.throw(_("Email address is required."), frappe.MandatoryError)

	accounts = get_user_jmap_accounts()
	for account in accounts:
		if email in get_account_emails(account):
			return

	frappe.throw(
		_("Email address '{0}' is not associated with any account of the user '{1}'.").format(
			email, frappe.bold(frappe.session.user)
		),
		frappe.PermissionError,
	)
