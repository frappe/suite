import frappe


def execute() -> None:
	frappe.db.delete("Module Def", {"name": "Frappe Writer", "app_name": "suite"})
