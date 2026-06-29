import frappe


def execute() -> None:
	"""Delete the Server module after its DocTypes were moved to Mail.

	On upgraded sites the relocated DocTypes (and the Server workspace sidebar)
	may still be stored with ``module = "Server"``. The controllers now live only
	under ``suite.mail.doctype.*`` and the ``suite/server`` package is gone, so
	the stale module must be retagged before anything tries to resolve it. These
	are plain DB updates and never load the relocated controllers.
	"""
	frappe.db.set_value("DocType", {"module": "Server"}, "module", "Mail", update_modified=False)
	frappe.db.set_value("Workspace Sidebar", {"module": "Server"}, "module", "Mail", update_modified=False)
	frappe.db.delete("Module Def", {"name": "Server", "app_name": "suite"})
