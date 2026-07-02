import frappe

from suite.mail.doctype.jmap_account.jmap_account import sync_jmap_accounts
from suite.mail.utils import log_error


def execute() -> None:
	"""Create the User Account links and populate the new JMAP Account identity fields.

	The Account Settings -> JMAP Account rename (rename_account_settings_to_jmap_account)
	keeps every row and its configured values (screening, remote-image blocking, junk
	handling, outgoing settings, last active sieve) intact. But the rename also introduced
	identity fields (account_id, _name, is_personal, is_readonly) that are empty on existing
	rows, and the per-user "User Account" links don't exist yet.

	Existing rows are already named by the bare account ID (the shared-per-account reshape
	shipped in an earlier release), so account_id is backfilled from the doc name inline: this
	keeps each row the canonical, valid document for its account, which is what stops
	sync_jmap_accounts from creating a fresh, empty duplicate and wiping the user's config.

	The rest needs a live JMAP session, which isn't reliably reachable during `bench migrate`,
	so it's deferred to a background job: reconnect per configured user (username set), run
	sync_jmap_accounts to create the User Account links and add docs for any brand-new
	accounts, then backfill the session-derived identity fields on the pre-existing docs
	without touching their configuration.
	"""

	backfill_account_id_from_name()

	frappe.enqueue(sync_configured_users, queue="long", enqueue_after_commit=True)


def backfill_account_id_from_name() -> None:
	"""Set account_id = name on rows where it's blank; the doc name is already the account ID."""

	JMAP_ACCOUNT = frappe.qb.DocType("JMAP Account")
	(
		frappe.qb.update(JMAP_ACCOUNT)
		.set(JMAP_ACCOUNT.account_id, JMAP_ACCOUNT.name)
		.where((JMAP_ACCOUNT.account_id.isnull()) | (JMAP_ACCOUNT.account_id == ""))
	).run()


def sync_configured_users() -> None:
	"""Run sync_jmap_accounts for every user that has JMAP configured (username set)."""

	users = frappe.get_all("User Settings", filters={"username": ["is", "set"]}, pluck="user")

	for user in users:
		try:
			connection = frappe.get_doc("User Settings", {"user": user}).connection
			if not connection:
				continue

			accounts = connection.accounts
			sync_jmap_accounts(user, accounts)
			backfill_identity_fields(accounts)
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			log_error("JMAP Account Sync Error", f"Failed to sync JMAP accounts for user {user}")


def backfill_identity_fields(accounts: dict[str, dict]) -> None:
	"""Populate the session-derived identity fields on existing JMAP Account docs.

	sync_jmap_accounts only sets these when it inserts a new doc, so pre-existing (renamed)
	docs need them filled in here. Configured values are left untouched.
	"""

	for account_id, details in accounts.items():
		if not frappe.db.exists("JMAP Account", account_id):
			continue

		frappe.db.set_value(
			"JMAP Account",
			account_id,
			{
				"account_id": account_id,
				"_name": details["name"],
				"is_personal": details["isPersonal"],
				"is_readonly": details["isReadOnly"],
			},
			update_modified=False,
		)
