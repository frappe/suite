import frappe

DOCTYPE = "Screened Email Address"


def execute() -> None:
	"""Backfill `account` from the legacy `account_id` column on Screened Email Address.

	The `account_id` -> `account` refactor dropped `account_id` from the doctype but leaves
	the orphaned DB column behind, so existing rows have an empty `account`. Copy the value
	over, first dropping rows that would duplicate an existing `(email, account)` pair — the
	same de-duplication the controller enforces on save.

	Idempotent: once the orphaned column is gone (or every row is backfilled) this is a no-op.
	"""

	if not frappe.db.has_column(DOCTYPE, "account_id"):
		return

	delete_duplicates()
	backfill_account()


def delete_duplicates() -> None:
	"""Drop empty-`account` rows whose (email, account_id) is already covered by a sibling."""

	s = frappe.qb.DocType(DOCTYPE).as_("s")
	t = frappe.qb.DocType(DOCTYPE).as_("t")

	# A sibling covers the row when it shares its (email, account_id) and outranks it: either a
	# row already populated with that account, or an earlier still-empty row (smaller `name`
	# wins, matching the original loop's "keep first").
	populated_sibling = t.account.isnotnull() & (t.account != "") & (t.account == s.account_id)
	earlier_empty_sibling = is_empty(t.account) & (t.account_id == s.account_id) & (t.name < s.name)

	victims = (
		frappe.qb.from_(s)
		.join(t)
		.on((t.email == s.email) & (t.name != s.name) & (populated_sibling | earlier_empty_sibling))
		.where(is_empty(s.account))
		.select(s.name)
		.distinct()
		.run(pluck="name")
	)

	if victims:
		table = frappe.qb.DocType(DOCTYPE)
		frappe.qb.from_(table).delete().where(table.name.isin(victims)).run()


def backfill_account() -> None:
	"""Set `account` = `account_id` on the surviving empty-`account` rows."""

	table = frappe.qb.DocType(DOCTYPE)
	(
		frappe.qb.update(table)
		.set(table.account, table.account_id)
		.where(is_empty(table.account) & table.account_id.isnotnull() & (table.account_id != ""))
		.run()
	)


def is_empty(field):
	"""Match a column that is NULL or the empty string."""

	return field.isnull() | (field == "")
