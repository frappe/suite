import frappe
from frappe import _

from suite.mail.doctype.sieve_script.sieve_script import SieveScript, build_automation_sieve


@frappe.whitelist()
def get_sieve_scripts(account: str) -> list[dict]:
	"""Return the sieve scripts for the account"""

	ids = [d["id"] for d in SieveScript._fetch_sieve_scripts(account)[0]]
	return SieveScript._get_sieve_scripts(account, ids, True)


@frappe.whitelist()
def create_sieve_script(account: str, _name: str, content: str, active: bool) -> None:
	"""Create a sieve script for the account"""

	SieveScript._add_sieve_script(account, _name, content, active)


@frappe.whitelist()
def update_sieve_script(account: str, id: str, _name: str, content: str, active: bool = False) -> None:
	"""Update a sieve script for the account"""

	SieveScript._update_sieve_script(account, id, _name, content, active)


@frappe.whitelist()
def delete_sieve_script(account: str, id: str) -> None:
	"""Delete a sieve script for the account"""

	SieveScript._delete_sieve_scripts(account, [id])


@frappe.whitelist()
def create_automation_script(account: str, active: bool = False) -> None:
	"""Create (and optionally activate) the frappe_mail_automation sieve script for the account.

	Backs the "Enable Folder Automation" action. Delegates to `build_automation_sieve`, which creates
	the script if it doesn't exist and regenerates all four sections from their persistent backups
	(Mailbox Settings + Screened Email Address).
	"""

	build_automation_sieve(account, activate=active)


@frappe.whitelist()
def rebuild_automation_script_for_account(account: str) -> None:
	"""Rebuild the frappe_mail_automation script from its backups for the session account.

	Backs the manual "Rebuild Automation" action, for when the script was deleted or edited by a
	third-party client.
	"""

	build_automation_sieve(account)
