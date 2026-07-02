import frappe


def execute() -> None:
	"""Rename the legacy "Account Settings" DocType to "JMAP Account".

	Runs pre_model_sync (after refactor_account_settings has reshaped the documents by
	account ID, while the table is still named "Account Settings") so the existing table
	and DocType record are renamed before the new "JMAP Account" schema is synced. No-op
	on fresh installs, where the DocType is created directly as "JMAP Account".
	"""

	if not frappe.db.exists("DocType", "Account Settings"):
		return

	frappe.rename_doc("DocType", "Account Settings", "JMAP Account", force=True)
	frappe.clear_cache(doctype="JMAP Account")
