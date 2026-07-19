import frappe


def execute() -> None:
	"""Rename the Meet DocTypes before their new schemas are synced."""
	if frappe.db.exists("DocType", "Sae Meeting User"):
		frappe.rename_doc("DocType", "Sae Meeting User", "Meet Room User", force=True)

	if frappe.db.exists("DocType", "Sae Meeting"):
		frappe.rename_doc("DocType", "Sae Meeting", "Meet Room", force=True)

	frappe.clear_cache(doctype="Meet Room")
