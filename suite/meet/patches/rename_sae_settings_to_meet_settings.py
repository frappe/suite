import frappe


def execute() -> None:
	"""Rename the settings DocType before its new schema is synced."""
	if frappe.db.exists("DocType", "Sae Settings"):
		frappe.rename_doc("DocType", "Sae Settings", "Meet Settings", force=True)

	frappe.clear_cache(doctype="Meet Settings")
