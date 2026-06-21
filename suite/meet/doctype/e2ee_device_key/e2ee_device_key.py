# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class E2EEDeviceKey(Document):
	pass


def on_update(doc: "E2EEDeviceKey", method: str | None = None) -> None:
	"""Stamp created_at on first save (not on subsequent updates)."""
	if not doc.created_at:
		doc.db_set("created_at", frappe.utils.now_datetime(), update_modified=False)
