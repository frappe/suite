import frappe
from frappe.query_builder.functions import Coalesce


def execute() -> None:
	"""Copy the legacy `Mail Sync History.account_id` value into the new `account` Link field.

	`account_id` (Data) was replaced by `account` (Link to "JMAP Account"). Since JMAP Account
	is named by its `account_id`, the stored ID is already a valid link target. Runs post_model_sync:
	the `account` column has been synced and the dropped `account_id` field survives as an orphaned
	column (Frappe never drops columns on migrate). No-op on fresh installs and on re-run.
	"""

	if not frappe.db.has_column("Mail Sync History", "account_id"):
		return

	MSH = frappe.qb.DocType("Mail Sync History")
	(
		frappe.qb.update(MSH)
		.set(MSH.account, MSH.account_id)
		.where((Coalesce(MSH.account, "") == "") & (Coalesce(MSH.account_id, "") != ""))
	).run()
