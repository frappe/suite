# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
import re
from contextlib import contextmanager
from uuid import uuid7

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, today

from suite.mail.doctype.mailbox_settings.mailbox_settings import get_mailbox_settings
from suite.mail.doctype.screened_email_address.screened_email_address import get_screened_email_addresses
from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.jmap import (
	get_mailbox_id_by_name,
	get_mailbox_id_by_role,
	get_mailbox_name_by_id,
	get_mailboxes,
	get_sieve_script_service,
)
from suite.mail.utils.user import get_account_emails
from suite.utils import execute_with_logging, parse_filters


class SieveScript(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		_name: DF.Data
		account: DF.Link
		active: DF.Check
		blob_id: DF.Data | None
		content: DF.Code
		id: DF.Data | None
		read_only: DF.Check
	# end: auto-generated types

	def db_insert(self, *args, **kwargs) -> None:
		self.id = SieveScript._add_sieve_script(self.account, self._name, self.content, bool(self.active))
		self.name = f"{self.account}|{self.id}"

	def load_from_db(self) -> "SieveScript":
		account, id = parse_sieve_script_name(self.name)
		if scripts := SieveScript._get_sieve_scripts(account, [id], download_content=True):
			return super(Document, self).__init__(scripts[0])

		frappe.throw(
			_("Sieve Script with ID {0} not found in account {1}.").format(
				frappe.bold(id), frappe.bold(account)
			),
			title=_("Sieve Script Not Found"),
		)

	def db_update(self) -> None:
		account, id = parse_sieve_script_name(self.name)
		SieveScript._update_sieve_script(account, id, self._name, self.content, bool(self.active))
		self.reload()

	def delete(self) -> None:
		account, id = parse_sieve_script_name(self.name)

		if self.active:
			frappe.throw(_("Cannot delete an active sieve script. Please deactivate it first."))

		SieveScript._delete_sieve_scripts(account, [id])

	@staticmethod
	def get_list(filters=None, page_length=20, **kwargs) -> list:
		filters = parse_filters(filters)
		id = filters.get("id")
		account = filters.get("account")

		if not account:
			frappe.msgprint(_("Please select an account to view the Sieve Scripts."), alert=True)
			return []

		scripts = []
		if id:
			scripts = SieveScript._get_sieve_scripts(account, [id])
			total = len(scripts)
		else:
			filter = {}
			if value := filters.get("_name"):
				filter["name"] = value
			if value := filters.get("active"):
				filter["isActive"] = bool(cint(value))

			limit = cint(kwargs.get("start")) + page_length
			scripts, total = SieveScript._fetch_sieve_scripts(account, filter, limit=limit)

		frappe.cache.set_value(_get_total_cache_key(account), total, expires_in_sec=600)

		if not scripts:
			frappe.msgprint(_("No sieve scripts found."), alert=True)

		return scripts

	@staticmethod
	def get_count(filters=None, **kwargs) -> int:
		filters = parse_filters(filters)
		account = filters.get("account")

		if account:
			if get_user_for_jmap_account(account, raise_exception=False):
				return cint(frappe.cache.get_value(_get_total_cache_key(account)))

		return 0

	@staticmethod
	def get_stats(**kwargs) -> dict:
		return {}

	@classmethod
	def _add_sieve_script(
		cls,
		account: str,
		name: str,
		content: str,
		active: bool = False,
	) -> str:
		"""Adds a sieve script for the given account with the specified parameters."""

		if not content or not content.strip():
			frappe.throw(_("Sieve script content cannot be empty."))

		if name == AUTOMATION_SCRIPT_NAME and not frappe.flags.allow_automation_script_creation:
			frappe.throw(_("Not allowed to create automation script."))

		creation_id = str(uuid7())
		service = get_sieve_script_service(account)
		sieve_script = {
			"creation_id": creation_id,
			"name": name,
			"content": content,
			"is_active": active,
		}
		response = service.create([sieve_script])

		title = _("Sieve Script Creation Error")
		if response.get("created"):
			return response["created"][creation_id]["id"]
		elif response.get("notCreated"):
			frappe.throw(_(response["notCreated"][creation_id]["description"]), title=title)
		else:
			frappe.throw(_(response["description"]), title=title)

	@classmethod
	def _fetch_sieve_scripts(
		cls,
		account: str,
		filter: dict | None = None,
		position: int = 0,
		limit: int = 50,
	) -> tuple[list, int]:
		"""Returns a list of sieve scripts for the given account."""

		scripts = []
		service = get_sieve_script_service(account)
		data = service.query(filter, position, limit)

		ids = data.get("ids", [])
		total = data.get("total", 0)

		scripts.extend(SieveScript._get_sieve_scripts(account, ids))

		return scripts[:limit], total

	@classmethod
	def _get_sieve_scripts(cls, account: str, ids: list[str], download_content: bool = False) -> list[dict]:
		"""Returns a list of sieve scripts for the provided IDs in the same order as ids."""

		sieve_scripts = {}
		service = get_sieve_script_service(account)
		scripts = service.get(ids)

		if download_content:
			blobs = [(s["blobId"], None) for s in scripts if s["blobId"]]
			data = service.download_blobs_concurrently(blobs)

			for script in scripts:
				script["content"] = data.get(script["blobId"], b"").decode("utf-8")

		for script in scripts:
			script = format_sieve_script(account, script)
			sieve_scripts[script["id"]] = script

		return [sieve_scripts[id] for id in ids if id in sieve_scripts]

	@classmethod
	def _validate_sieve_script(cls, account: str, content: str) -> None:
		"""Validates a sieve script for the given account."""

		if not content or not content.strip():
			frappe.throw(_("Sieve script content cannot be empty."))

		service = get_sieve_script_service(account)
		response = service.validate(content)

		if error := response.get("error"):
			frappe.throw(
				_("{0}: {1}").format(error.get("type"), error.get("description")),
				title=_("Sieve Script Validation Error"),
			)

	@classmethod
	def _update_sieve_script(
		cls,
		account: str,
		id: str,
		name: str,
		content: str,
		active: bool = False,
	) -> None:
		"""Updates a sieve script for the given account and ID with the specified parameters."""

		if not content or not content.strip():
			frappe.throw(_("Sieve script content cannot be empty."))

		service = get_sieve_script_service(account)
		scripts = service.get([id])

		if not scripts:
			frappe.throw(
				_("Sieve Script with ID {0} not found.").format(frappe.bold(id)),
				title=_("Sieve Script Not Found"),
			)

		script = scripts[0]
		deactivate = script["isActive"] and not active
		sieve_script = {"id": id, "name": name, "content": content, "is_active": bool(active)}
		response = service.update([sieve_script], deactivate=deactivate)

		title = _("Sieve Script Update Error")
		if not response.get("updated"):
			if response.get("notUpdated"):
				frappe.throw(_(response["notUpdated"][id]["description"]), title=title)
			else:
				frappe.throw(_(response["description"]), title=title)

	@classmethod
	def _delete_sieve_scripts(cls, account: str, ids: list[str]) -> None:
		"""Deletes sieve scripts for the given list of IDs and account."""

		service = get_sieve_script_service(account)
		response = service.delete(ids)

		if response.get("notDestroyed"):
			error_messages = []
			for id, error in response["notDestroyed"].items():
				error_messages.append(f"{id}: {error['description']}")
			frappe.throw(
				_("Sieve Script Deletion Error(s):<br>{0}").format("<br>".join(error_messages)),
				title=_("Sieve Script Deletion Error"),
			)

	def validate(self) -> None:
		if self.read_only:
			frappe.throw(
				_("The '{0}' sieve script cannot be modified.").format(self._name),
				title=_("Read-Only Sieve Script"),
			)

	@frappe.whitelist()
	def validate_script(self) -> None:
		"""Validates the sieve script content."""

		account, _id = parse_sieve_script_name(self.name)
		self._validate_sieve_script(account, self.content)
		frappe.msgprint(_("Sieve script is valid."), indicator="green", alert=True)


def _get_total_cache_key(account: str) -> str:
	"""Returns a cache key for total sieve scripts count for the given account."""

	return f"{account}:sieve_scripts:total"


def parse_sieve_script_name(name: str) -> tuple[str, str]:
	"""Splits a Sieve Script name `account|id` into its bare `account` and `id`."""

	account, id = name.split("|")
	return account, id


@frappe.whitelist()
def bulk_delete(names: str | list[str]) -> None:
	"""Deletes multiple sieve scripts given their names."""

	if isinstance(names, str):
		names = json.loads(names)

	accounts_map = {}
	for name in names:
		account, id = parse_sieve_script_name(name)
		accounts_map.setdefault(account, []).append(id)

	for account, ids in accounts_map.items():
		SieveScript._delete_sieve_scripts(account, ids)

	frappe.msgprint(_("Sieve Scripts deleted successfully."), alert=True)


def get_active_sieve_script_id(account: str) -> str | None:
	"""Returns the ID of the currently active sieve script for the given account, if any."""

	service = get_sieve_script_service(account)
	query_result = service.query({"isActive": True})

	if query_result.get("ids") and len(query_result["ids"]) > 0:
		return query_result["ids"][0]


def is_vacation_script_active(account: str) -> bool:
	"""Whether the account's currently active sieve script is the read-only vacation script.

	Used to keep the automation sieve from being activated over an active vacation auto-responder.
	"""

	active_id = get_active_sieve_script_id(account)
	if not active_id:
		return False

	scripts = SieveScript._get_sieve_scripts(account, [active_id])
	return bool(scripts) and bool(scripts[0].get("read_only"))


def activate_last_active_sieve_script(account: str) -> None:
	"""Activates the last active sieve script for the given account, if any, and clears the last active sieve script setting."""

	sieve_script_id = frappe.db.get_value("JMAP Account", account, "last_active_sieve_script_id")
	if not sieve_script_id:
		return

	if sieve_scripts := SieveScript._get_sieve_scripts(account, [sieve_script_id], download_content=True):
		sieve_script = sieve_scripts[0]

		if (sieve_script.get("_name") or "").lower() != "vacation" and not sieve_script["active"]:
			SieveScript._update_sieve_script(
				account,
				sieve_script_id,
				sieve_script["_name"],
				sieve_script["content"],
				active=True,
			)

	set_last_active_sieve_script_id(account, None)


def set_last_active_sieve_script_id(account: str, sieve_script_id: str | None = None) -> None:
	"""Sets the given sieve script ID as the last active sieve script for the given account."""

	get_user_for_jmap_account(account, raise_exception=True)
	frappe.db.set_value(
		"JMAP Account",
		account,
		"last_active_sieve_script_id",
		sieve_script_id,
		update_modified=False,
	)


def format_sieve_script(account: str, script: dict) -> dict:
	"""Format the sieve script for display."""

	read_only = script["name"].lower() == "vacation"

	return {
		"name": f"{account}|{script['id']}",
		"account": account,
		"id": script["id"],
		"_name": script["name"],
		"active": cint(script["isActive"]),
		"blob_id": script["blobId"],
		"content": script.get("content") or "",
		"read_only": read_only,
		"creation": today(),
		"modified": today(),
	}


def has_permission(doc: "Document", ptype: str, user: str | None = None) -> bool:
	if doc.doctype != "Sieve Script":
		return False

	return bool(get_user_for_jmap_account(doc.account, raise_exception=False))


# Frappe Mail Automation Sieve Script

SCREENER_MAILBOX_NAME = "Screener"
AUTOMATION_SCRIPT_NAME = "frappe_mail_automation"
AUTOMATION_SCRIPT_REQUIRE = (
	'require ["fileinto", "imap4flags", "spamtest", "relational", "comparator-i;ascii-numeric"];'
)


def maybe_build_automation_sieve(account: str, activate: bool = False) -> None:
	"""Build the automation sieve from a document hook unless a caller paused builds for a bulk write."""

	if frappe.flags.get("skip_automation_sieve_build"):
		return

	build_automation_sieve(account, activate=activate)


def build_automation_sieve(account: str, activate: bool = False) -> None:
	"""Build the automation sieve script for the given account and optionally activate it.

	Activation is skipped while the vacation sieve script is active, so rebuilding the automation
	script (e.g. from a Mailbox Settings / Screened Email Address change) never disables the
	vacation auto-responder. The vacation flow reactivates the last active script once vacation ends.
	"""

	def _build_automation_sieve(account: str, activate: bool = False) -> None:
		doc = frappe.get_doc("Sieve Script", get_automation_script_name(account))
		doc.content = _build_automation_content(account)

		# Activate the automation script unless vacation is active. `doc.active` is the freshly loaded
		# state (load_from_db just fetched it), and only one script can be active at a time — so an
		# already-active automation script means vacation isn't, and we skip the vacation lookup. That
		# keeps the hot document-save path (where automation is already active) free of the two extra
		# JMAP round-trips `is_vacation_script_active` would otherwise make.
		if activate and not doc.active and not is_vacation_script_active(account):
			doc.active = True

		doc.save()

	execute_with_logging(
		lambda: _build_automation_sieve(account, activate=activate),
		title="Failed to build automation sieve script",
		with_context=False,
	)


@contextmanager
def pause_automation_sieve_build():
	"""Suppress the automatic `build_automation_sieve` triggered by Mailbox Settings / Screened Email
	Address document hooks, so a caller doing several writes rebuilds the script once at the end
	instead of after every write.

	Use it around bulk writes, then call `build_automation_sieve` yourself once::

	    with pause_automation_sieve_build():
	            ...several saves...
	    build_automation_sieve(account)
	"""

	previous = frappe.flags.get("skip_automation_sieve_build")
	frappe.flags.skip_automation_sieve_build = True
	try:
		yield
	finally:
		frappe.flags.skip_automation_sieve_build = previous


def get_automation_script_name(account: str) -> str:
	"""Returns the name of the automation sieve script for the given account. If it doesn't exist, it creates a new one."""

	scripts = SieveScript._fetch_sieve_scripts(account, {"name": AUTOMATION_SCRIPT_NAME}, limit=1)
	if scripts and scripts[0]:
		return scripts[0][0]["name"]

	frappe.flags.allow_automation_script_creation = True
	script_id = SieveScript._add_sieve_script(
		account, AUTOMATION_SCRIPT_NAME, content=AUTOMATION_SCRIPT_REQUIRE, active=False
	)

	return f"{account}|{script_id}"


def _build_automation_content(account: str) -> str:
	content = AUTOMATION_SCRIPT_REQUIRE + "\n"

	# Mailbox section: one block per mailbox that has automation rules in Mailbox Settings.
	for mailbox in get_mailboxes(account):
		rules = get_mailbox_automation_rules(account, mailbox["id"])
		if not rules:
			continue

		mailbox_path = get_mailbox_path(account, mailbox["_name"], raise_exception=True)
		block = rule_object_to_sieve(rules, mailbox_path)
		if block:
			content = append_sieve_block(content, f"Mailbox: {mailbox['_name']}", block)

	# Reject / Spam / Screening sections, layered on top of the mailbox rules.
	content = _apply_screening_blocks(account, content)

	return content.rstrip() + "\n"


def get_mailbox_automation_rules(account: str, mailbox_id: str) -> dict | None:
	"""Return the persisted automation rules for a mailbox as a rule dict, or None if it has none.

	This is the backup that the frappe_mail_automation Sieve script is generated from, so the script
	can be rebuilt even if a third-party client deletes it. A mailbox is considered to have no
	automation when neither a sender nor a subject condition is set.
	"""

	settings = get_mailbox_settings(account, mailbox_id, raise_exception=False)
	if not settings or not (settings.emails_from or settings.subject_contains):
		return None

	return {
		"emails_from": settings.emails_from or "",
		"subject_contains": settings.subject_contains or "",
		"match_if": settings.match_if or "any",
		"mark_as_read": bool(settings.mark_as_read),
		"add_star": bool(settings.add_star),
	}


def get_mailbox_path(account: str, mailbox_name: str, raise_exception: bool = False) -> str | None:
	"""Returns the mailbox path for the given mailbox name in the given account."""

	mailboxes = {mailbox["_name"]: mailbox for mailbox in get_mailboxes(account)}
	if mailbox_name not in mailboxes:
		if raise_exception:
			frappe.throw(
				_("Mailbox '{0}' not found in account '{1}'.").format(
					frappe.bold(mailbox_name), frappe.bold(account)
				),
				title=_("Mailbox Not Found"),
			)
		return None

	path_parts = []
	current = mailboxes[mailbox_name]

	while current:
		path_parts.append(current["_name"])
		parent_id = current.get("parent_id")
		if not parent_id:
			break

		parent_name = get_mailbox_name_by_id(account, parent_id)
		current = mailboxes.get(parent_name)

		if current is None:
			if raise_exception:
				frappe.throw(
					_("Parent mailbox with ID '{0}' not found in account '{1}'.").format(
						frappe.bold(parent_id), frappe.bold(account)
					),
					title=_("Parent Mailbox Not Found"),
				)
			return None

	return "/".join(reversed(path_parts))


def rule_object_to_sieve(automation: dict, mailbox_path: str) -> str:
	"""Converts automation rules to Sieve script format.

	Args:
	        automation: Dictionary containing automation rules with keys:
	                - emails_from: comma-separated email addresses
	                - subject_contains: comma-separated keywords
	                - mark_as_read: boolean
	                - add_star: boolean
	                - match_if: 'any' or 'all'
	        mailbox_path: Full mailbox path to file emails into

	Returns:
	        Sieve script as a string
	"""

	emails_from = [
		email.strip() for email in (automation.get("emails_from") or "").split(",") if email.strip()
	]
	subject_contains = [
		keyword.strip()
		for keyword in (automation.get("subject_contains") or "").split(",")
		if keyword.strip()
	]

	if not emails_from and not subject_contains:
		return ""

	script_parts = [""]
	conditions = []

	if emails_from:
		email_list = ", ".join(f'"{email}"' for email in emails_from)
		conditions.append(f'address :matches "from" [{email_list}]')

	if subject_contains:
		keyword_list = ", ".join(f'"{keyword}"' for keyword in subject_contains)
		conditions.append(f'header :contains "subject" [{keyword_list}]')

	match_if = automation.get("match_if", "any")
	operator = "allof" if match_if == "all" else "anyof"

	if len(conditions) == 1:
		script_parts.append(f"if {conditions[0]} {{")
	else:
		script_parts.append(f"if {operator} (")
		for i, condition in enumerate(conditions):
			if i < len(conditions) - 1:
				script_parts.append(f"  {condition},")
			else:
				script_parts.append(f"  {condition}")
		script_parts.append(") {")

	if automation.get("mark_as_read"):
		script_parts.append('  addflag "\\\\Seen";')

	if automation.get("add_star"):
		script_parts.append('  addflag "\\\\Flagged";')

	script_parts.append(f'  fileinto "{mailbox_path}";')
	script_parts.append("  stop;")
	script_parts.append("}")

	return "\n".join(script_parts)


def append_sieve_block(script: str, block_name: str, sieve_block: str) -> str:
	"""Append a labeled Sieve filter block to the script."""

	return script.rstrip() + "\n" + f"\n# {block_name}{sieve_block}"


def _apply_screening_blocks(account: str, content: str) -> str:
	"""Layer the Reject/Spam/Screening sieve blocks onto `content` and return the result.

	Rebuilt from the Screened Email Address list (+ JMAP Account) in one pass. The blocks are
	ordered by precedence: Reject (discard) sits at the very top, right after `require`, so it wins
	outright. The mailbox automation rules come next, so an explicit mailbox rule can still route mail.
	Spam (file to Junk) and the Screening gate are fallbacks below the mailbox rules — Spam first, then
	the catch-all Screening gate at the very bottom. The Screening gate routes accepted senders to the
	Inbox, screens the rest unless the mail is classified as spam, and otherwise lets the server's
	default filtering assign the mailbox (see `build_screening_gate`). The final order is
	Reject → Mailbox → Spam → Screening. A sender has at most one screening rule (uniqueness is on the
	address), so the blocks never conflict.
	"""

	content = (content or "").lstrip()

	# Remove any existing screening blocks, including the legacy block names from the pre-merge
	# "Blocked Email Address" / "Junk Email Address" doctypes, so old scripts get cleaned up.
	for name in ("Rejected Emails", "Spam Senders", "Screening", "Blocked Emails", "Junk Senders"):
		content = remove_sieve_block(content, name)

	screened = get_screened_email_addresses(account)
	reject_emails = [s.email for s in screened if s.action == "Reject"]
	spam_emails = [s.email for s in screened if s.action == "Spam"]
	accepted_emails = [s.email for s in screened if s.action == "Accepted"]

	# Reject is the most aggressive action and must win outright, so it sits at the very top — right
	# after the require statement(s), above the mailbox rules.
	reject_block = _build_screening_block("Rejected Emails", reject_emails, ["  discard;", "  stop;"])
	if reject_block:
		require_pattern = r"^(require\s+\[.*?\];\s*)+"
		match = re.match(require_pattern, content, flags=re.DOTALL)
		if match:
			insert_pos = match.end()
			content = content[:insert_pos] + "\n" + reject_block + content[insert_pos:]
		else:
			content = reject_block + content

	# Spam goes below the mailbox rules (so an explicit mailbox rule can still claim the mail) but above
	# the Screening gate.
	if spam_emails:
		junk_mailbox_path = get_junk_mailbox_path(account)
		spam_block = _build_screening_block(
			"Spam Senders",
			spam_emails,
			# Flag as junk ($junk keyword) as well as filing into Junk, so the mail is marked junk — not
			# just located there — matching what marking a mail as junk does.
			['  addflag "$junk";', f'  fileinto "{junk_mailbox_path}";', "  stop;"],
		)
		if spam_block:
			content = content.rstrip() + "\n\n" + spam_block.rstrip() + "\n"

	# Append the Screening gate last — the catch-all fallback, below every other block.
	if is_screening_enabled(account):
		gate = build_screening_gate(account, accepted_emails)
		content = content.rstrip() + "\n\n" + gate.rstrip() + "\n"

	return content.rstrip() + "\n"


def remove_sieve_block(script: str, block_name: str) -> str:
	"""Remove an entire Sieve filter block, identified by its `# <block_name>` comment header.

	A block runs from its header line up to the next block's `# ` header (or the end of the script), so
	this removes blocks that contain more than one `stop;` — such as the Screening gate's `if`/`elsif` —
	just as reliably as single-action blocks.
	"""

	pattern = rf"^# {re.escape(block_name)}\n.*?(?=^# |\Z)"
	result = re.sub(pattern, "", script, flags=re.DOTALL | re.MULTILINE)
	result = re.sub(r"\n{3,}", "\n\n", result)
	result = result.rstrip() + "\n"

	return result


def _escape_sieve_string(value: str) -> str:
	"""Escape a value for embedding in a Sieve quoted string (RFC 5228): backslash then double-quote."""

	return value.replace("\\", "\\\\").replace('"', '\\"')


def _sender_match_condition(value: str) -> str | None:
	"""Return the Sieve `address` test that matches a screened value, or None when it is blank.

	A `@domain` entry matches every sender from that domain (`address :domain :is "from" "example.com"`);
	anything else is matched as a full address (`address :is "from" "john@example.com"`). Values are
	escaped before being embedded so a stray quote or backslash can't corrupt the generated script.
	"""

	from suite.mail.utils.validation import is_domain_entry

	value = (value or "").strip()
	if not value:
		return None

	if is_domain_entry(value):
		domain = value[1:].strip()
		return f'address :domain :is "from" "{_escape_sieve_string(domain)}"' if domain else None

	return f'address :is "from" "{_escape_sieve_string(value)}"'


def _build_screening_block(block_name: str, emails: list[str], action_lines: list[str]) -> str:
	"""Build a labeled sieve block matching the given senders and running `action_lines`.

	Returns an empty string when there are no senders to match.
	"""

	conditions = [c for c in (_sender_match_condition(e) for e in emails) if c]
	if not conditions:
		return ""

	if len(conditions) == 1:
		condition_block = f"if {conditions[0]} {{"
	else:
		joined = ",\n  ".join(conditions)
		condition_block = f"if anyof (\n  {joined}\n) {{"

	return "\n".join([f"# {block_name}", condition_block, *action_lines, "}", "\n"])


def get_junk_mailbox_path(account: str) -> str:
	"""Return the mailbox path of the account's Junk mailbox (for sieve `fileinto`)."""

	mailbox_id = get_mailbox_id_by_role(account, "junk", create_if_not_exists=True, raise_exception=True)
	mailbox_name = get_mailbox_name_by_id(account, mailbox_id, raise_exception=True)

	return get_mailbox_path(account, mailbox_name, raise_exception=True)


def get_inbox_mailbox_path(account: str) -> str:
	"""Return the mailbox path of the account's Inbox mailbox (for sieve `fileinto`)."""

	mailbox_id = get_mailbox_id_by_role(account, "inbox", create_if_not_exists=True, raise_exception=True)
	mailbox_name = get_mailbox_name_by_id(account, mailbox_id, raise_exception=True)

	return get_mailbox_path(account, mailbox_name, raise_exception=True)


def is_screening_enabled(account: str) -> bool:
	"""Whether Hey-style screening is enabled for the account (JMAP Account.enable_screening)."""

	return bool(frappe.db.get_value("JMAP Account", account, "enable_screening"))


def build_screening_gate(account: str, accepted_emails: list[str]) -> str:
	"""Build the screening gate — the catch-all fallback that is the last block in the script.

	It routes mail that no earlier block (Reject, Spam, or a mailbox automation rule) already claimed:

	- Accepted senders — and the account's own identity emails, which are always trusted — are
	  delivered straight to the Inbox, so accepted mail always reaches the inbox regardless of its
	  spam score.
	- Otherwise, mail the server has not classified as spam is filed into Screening.
	- Otherwise (an unrecognised sender whose mail is classified as spam) nothing is done, so the
	  server's default filtering assigns the mailbox (e.g. Junk once the spam score exceeds the
	  configured threshold).

	Spam classification is read with the `spamtest` extension (RFC 5235), not the `X-Spam-Status`
	header: Stalwart injects the verdict into the Sieve runtime before the user's script runs, but only
	stamps the header afterwards, so the header is not visible here. `spamtest` returns a 0-10 value
	(Ham -> 1, Spam -> 10), so `:value "ge" "2"` treats anything above ham as spam.
	"""

	screening_mailbox_path = get_screening_mailbox_path(account)

	try:
		own_emails = get_account_emails(account)
	except Exception:
		own_emails = []

	trusted = list(dict.fromkeys(e.strip() for e in [*accepted_emails, *own_emails] if e and e.strip()))

	# `accepted_emails` may hold `@domain` entries, so build one address test per trusted value (own
	# identity emails are always plain addresses). Accepted mail is let through to the Inbox when the
	# sender matches any trusted value, so the tests are OR-ed.
	conditions = [c for c in (_sender_match_condition(e) for e in trusted) if c]

	if len(conditions) == 1:
		accepted_test = conditions[0]
	elif conditions:
		joined = ",\n  ".join(conditions)
		accepted_test = f"anyof (\n  {joined}\n)"
	else:
		accepted_test = None

	# Mail the server has not classified as spam (spamtest value below 2, i.e. ham or unchecked) is
	# screened; spam falls through to the server's default filtering.
	not_spam_test = 'not spamtest :value "ge" :comparator "i;ascii-numeric" "2"'

	lines = ["# Screening"]
	if accepted_test:
		# Resolve the Inbox path only when there is an accepted branch to file into — accounts with no
		# trusted senders yet never reach it, so this avoids the extra lookups (and the risk of an inbox
		# lookup/creation failure breaking a gate that does not even need the Inbox path).
		inbox_mailbox_path = get_inbox_mailbox_path(account)
		lines += [
			f"if {accepted_test} {{",
			f'  fileinto "{inbox_mailbox_path}";',
			"  stop;",
			"}",
			f"elsif {not_spam_test} {{",
		]
	else:
		# Nothing trusted yet → screen every non-spam sender (only reached after the Reject/Spam blocks).
		lines.append(f"if {not_spam_test} {{")

	lines += [
		f'  fileinto "{screening_mailbox_path}";',
		"  stop;",
		"}",
		"\n",
	]

	return "\n".join(lines)


def get_screening_mailbox_path(account: str) -> str:
	"""Return the mailbox path of the account's Screening mailbox, creating it if missing.

	Screening is not a standard JMAP role, so it is a plain named mailbox looked up by name.
	"""

	from suite.mail.doctype.mailbox.mailbox import add_mailbox
	from suite.mail.jmap.services.core import CoreService

	# The mailbox list lives in a per-process TTL cache, so a negative lookup can be stale — another
	# worker may already have created the Screener. Refresh from the server before deciding to create,
	# so we never try to recreate an existing mailbox (which JMAP rejects with "already exists").
	CoreService.invalidate_cache(account, key="mailboxes")
	if not get_mailbox_id_by_name(account, SCREENER_MAILBOX_NAME):
		add_mailbox(account, SCREENER_MAILBOX_NAME)
		CoreService.invalidate_cache(account, key="mailboxes")

	return get_mailbox_path(account, SCREENER_MAILBOX_NAME, raise_exception=True)
