# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
from uuid import uuid7

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, today

from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.jmap import get_mailbox_service
from suite.utils import parse_filters

DEFAULT_MAILBOX_GAP = 1000
MINIMUM_MAILBOX_GAP = 1
REBALANCE_MAILBOX_WINDOW = 10


class Mailbox(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		_name: DF.Data
		_parent: DF.Link | None
		account: DF.Link
		id: DF.Data | None
		may_add_items: DF.Check
		may_create_child: DF.Check
		may_delete: DF.Check
		may_read_items: DF.Check
		may_remove_items: DF.Check
		may_rename: DF.Check
		may_set_keywords: DF.Check
		may_set_seen: DF.Check
		may_submit: DF.Check
		parent_id: DF.Data | None
		role: DF.Literal["", "inbox", "important", "sent", "drafts", "junk", "archive", "trash"]
		sort_order: DF.Int
		subscribed: DF.Check
		total_emails: DF.Int
		total_threads: DF.Int
		unread_emails: DF.Int
		unread_threads: DF.Int
	# end: auto-generated types

	def db_insert(self, *args, **kwargs) -> None:
		parent = self._parent.split("|")[1] if self._parent else None
		self.id = add_mailbox(
			self.account, self._name, self.role, parent, self.sort_order, bool(self.subscribed)
		)
		self.name = f"{self.account}|{self.id}"

	def load_from_db(self) -> "Mailbox":
		account, id = parse_mailbox_name(self.name)
		mailbox = get_mailbox(account, id)
		return super(Document, self).__init__(mailbox)

	def db_update(self) -> None:
		account, id = parse_mailbox_name(self.name)
		parent = self._parent.split("|")[1] if self._parent else None
		update_mailbox(account, id, self._name, self.role, parent, self.sort_order, bool(self.subscribed))
		self.reload()

	def delete(self) -> None:
		account, id = parse_mailbox_name(self.name)
		delete_mailboxes(account, [id])

	@staticmethod
	def get_list(filters=None, page_length=20, **kwargs) -> list:
		filters = parse_filters(filters)
		id = filters.get("id")
		account = filters.get("account")

		if not account:
			frappe.msgprint(_("Please select an account to view mailboxes."), alert=True)
			return []

		mailboxes = []
		if id:
			if mailbox := get_mailbox(account, id, raise_exception=False):
				mailboxes.append(mailbox)
		else:
			mailboxes = fetch_mailboxes(account, limit=page_length)

		if not mailboxes:
			frappe.msgprint(_("No mailboxes found."), alert=True)

		return mailboxes

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


def _get_total_cache_key(account: str) -> str:
	"""Returns a cache key for total mailbox count for the given account."""

	return f"{account}:mailboxes:total"


def parse_mailbox_name(name: str) -> tuple[str, str]:
	"""Splits a Mailbox name `account|id` into its bare `account` and `id`."""

	account, id = name.split("|")
	return account, id


@frappe.whitelist()
def bulk_delete(names: str | list[str]) -> None:
	"""Deletes multiple mailboxes given their names."""

	if isinstance(names, str):
		names = json.loads(names)

	accounts_map = {}
	for name in names:
		account, id = parse_mailbox_name(name)
		accounts_map.setdefault(account, []).append(id)

	for account, ids in accounts_map.items():
		delete_mailboxes(account, ids)

	frappe.msgprint(_("Mailboxes deleted successfully."), alert=True)


@frappe.whitelist()
def add_mailbox(
	account: str,
	name: str,
	role: str | None = None,
	parent: str | None = None,
	sort_order: int = 0,
	subscribed: bool = True,
) -> str:
	"""Adds a mailbox for the given account with the specified parameters."""

	creation_id = str(uuid7())
	mailbox = {
		"creation_id": creation_id,
		"name": name,
		"role": role,
		"parent_id": parent,
		"sort_order": sort_order,
		"is_subscribed": subscribed,
	}

	service = get_mailbox_service(account)
	response = service.create([mailbox])

	title = _("Mailbox Creation Error")
	if response.get("created"):
		service.invalidate_cache(service.account, key="mailboxes")
		return response["created"][creation_id]["id"]
	elif response.get("notCreated"):
		frappe.throw(_(response["notCreated"][creation_id]["description"]), title=title)
	else:
		frappe.throw(_(response["description"]), title=title)


@frappe.whitelist()
def get_mailbox(account: str, id: str, raise_exception: bool = False) -> dict | None:
	"""Returns mailbox details for the given account and id."""

	service = get_mailbox_service(account)
	if mailboxes := service.get([id]):
		return format_mailbox(account, mailboxes[0])

	if raise_exception:
		frappe.throw(
			_("Mailbox with ID {0} not found in account {1}.").format(frappe.bold(id), frappe.bold(account)),
			title=_("Mailbox Not Found"),
		)


@frappe.whitelist()
def update_mailbox(
	account: str,
	id: str,
	name: str,
	role: str | None = None,
	parent: str | None = None,
	sort_order: int = 0,
	subscribed: bool = True,
) -> None:
	"""Updates an existing mailbox with the given parameters."""

	title = _("Mailbox Update Error")
	if parent and id == parent:
		frappe.throw(_("Mailbox cannot be a parent of itself."), title=title)

	mailbox = {
		"id": id,
		"name": name,
		"role": role,
		"parent_id": parent,
		"sort_order": sort_order,
		"is_subscribed": subscribed,
	}

	service = get_mailbox_service(account)
	response = service.update([mailbox])

	if not response.get("updated"):
		if response.get("notUpdated"):
			frappe.throw(_(response["notUpdated"][id]["description"]), title=title)
		else:
			frappe.throw(_(response["description"]), title=title)

	service.invalidate_cache(service.account, key="mailboxes")


@frappe.whitelist()
def delete_mailboxes(account: str, ids: list[str], remove_emails: bool = True) -> None:
	"""Deletes a mailbox for the given account by its ID."""

	service = get_mailbox_service(account)
	response = service.delete(ids, remove_emails=remove_emails)

	if response.get("notDestroyed"):
		error_messages = []
		for id, error in response["notDestroyed"].items():
			error_messages.append(f"{id}: {error['description']}")
		frappe.throw(
			_("Mailbox Deletion Error(s):<br>{0}").format("<br>".join(error_messages)),
			title=_("Mailbox Deletion Error"),
		)

	# Drop the stale list so later lookups (e.g. sieve regeneration) don't see the deleted mailbox.
	service.invalidate_cache(service.account, key="mailboxes")


@frappe.whitelist()
def fetch_mailboxes(account: str, page: int = 1, limit: int = 10) -> list:
	"""Returns a list of mailboxes for the given account."""

	service = get_mailbox_service(account)
	mailboxes = service.get()
	formatted_mailboxes = [format_mailbox(account, mailbox) for mailbox in mailboxes]
	sorted_mailboxes = sorted(
		formatted_mailboxes, key=lambda m: (m["sort_order"], get_sort_order(m["role"]), m["_name"], m["id"])
	)
	frappe.cache.set_value(_get_total_cache_key(account), len(mailboxes), expires_in_sec=600)

	start = (page - 1) * limit
	end = start + limit

	return sorted_mailboxes[start:end]


@frappe.whitelist()
def update_mailbox_position(
	account: str, target_mailbox_id: str, prior_mailbox_id: str | None = None
) -> None:
	"""Updates the position of the target mailbox to be after the prior mailbox."""

	def get_updates(
		mailboxes: list[dict], target_mailbox_id: str, prior_mailbox_id: str | None
	) -> dict[str, int]:
		"""Returns the sort order updates required to move the target mailbox after the prior mailbox."""

		index = {m["id"]: i for i, m in enumerate(mailboxes)}

		if target_mailbox_id not in index:
			frappe.throw(_("Target mailbox ID {0} not found.").format(frappe.bold(target_mailbox_id)))

		mailboxes.pop(index[target_mailbox_id])
		index = {m["id"]: i for i, m in enumerate(mailboxes)}

		# Prior mailbox is None, place at start
		if prior_mailbox_id is None:
			lower = None
			upper = mailboxes[0]["sortOrder"] if mailboxes else None
			insert_index = 0

		# Prior mailbox is specified, place after it
		else:
			if prior_mailbox_id not in index:
				frappe.throw(_("Prior mailbox ID {0} not found.").format(frappe.bold(prior_mailbox_id)))

			prior_index = index[prior_mailbox_id]
			lower = mailboxes[prior_index]["sortOrder"]
			insert_index = prior_index + 1
			upper = mailboxes[insert_index]["sortOrder"] if insert_index < len(mailboxes) else None

		# Case - 1: Both lower and upper bounds exist and have enough gap, create in between
		if lower is not None and upper is not None and upper - lower > MINIMUM_MAILBOX_GAP:
			new_sort = (lower + upper) // 2
			return {target_mailbox_id: new_sort}

		# Case - 2: Only lower bound exists, place after it
		if lower is not None and upper is None:
			return {target_mailbox_id: lower + DEFAULT_MAILBOX_GAP}

		# Case - 3: Only upper bound exists, place before it
		if lower is None and upper is not None:
			return {target_mailbox_id: upper - DEFAULT_MAILBOX_GAP}

		# Case - 4: Neither bound exists, place at start
		if lower is None and upper is None:
			return {target_mailbox_id: 0}

		# If there is no gap, rebalance
		start = max(0, insert_index - REBALANCE_MAILBOX_WINDOW)
		end = min(len(mailboxes), insert_index + REBALANCE_MAILBOX_WINDOW)

		window = mailboxes[start:end]

		base = window[0]["sortOrder"]
		base = (base // DEFAULT_MAILBOX_GAP) * DEFAULT_MAILBOX_GAP

		updates: dict[str, int] = {}
		current = base

		target_slot = insert_index - start

		for i, m in enumerate(window):
			if i == target_slot:
				current += DEFAULT_MAILBOX_GAP

			current += DEFAULT_MAILBOX_GAP
			if m["sortOrder"] != current:
				updates[m["id"]] = current

		target_sort_order = base + DEFAULT_MAILBOX_GAP * (target_slot + 1)
		updates[target_mailbox_id] = target_sort_order

		return updates

	service = get_mailbox_service(account)
	mailboxes = sorted(
		service.get(), key=lambda m: (m["sortOrder"], get_sort_order(m["role"]), m["name"], m["id"])
	)
	updates = get_updates(mailboxes, target_mailbox_id, prior_mailbox_id)

	result = {"updated": [], "notUpdated": {}}
	for batch in service.batch_dict(updates, service.max_objects_in_set):
		response = service._call(
			capabilities=service.capabilities,
			method_calls=[
				[
					f"{service.type}/set",
					{
						"accountId": service.account,
						"update": {k: {"sortOrder": v} for k, v in batch.items()},
					},
					"0",
				]
			],
		)

		if method_responses := response.get("methodResponses"):
			result["updated"].extend(method_responses[0][1].get("updated", {}).keys())
			if not_updated := method_responses[0][1].get("notUpdated", {}):
				result["notUpdated"].update(not_updated)

	title = _("Mailbox Position Update Error")
	if not result.get("updated"):
		frappe.throw(_(result["description"]), title=title)


def format_mailbox(account: str, mailbox: dict) -> dict:
	"""Formats mailbox data for display."""

	sort_order = cint(mailbox["sortOrder"])
	if _parent := mailbox["parentId"]:
		_parent = f"{account}|{_parent}"
	rights = mailbox.get("myRights") or {}

	return {
		"name": f"{account}|{mailbox['id']}",
		"account": account,
		"id": mailbox["id"],
		"_name": mailbox["name"],
		"_parent": _parent,
		"parent_id": mailbox["parentId"],
		"role": mailbox["role"],
		"sort_order": sort_order,
		"subscribed": bool(mailbox["isSubscribed"]),
		"total_emails": cint(mailbox["totalEmails"]),
		"unread_emails": cint(mailbox["unreadEmails"]),
		"total_threads": cint(mailbox["totalThreads"]),
		"unread_threads": cint(mailbox["unreadThreads"]),
		"may_read_items": cint(rights.get("mayReadItems", False)),
		"may_add_items": cint(rights.get("mayAddItems", False)),
		"may_remove_items": cint(rights.get("mayRemoveItems", False)),
		"may_set_seen": cint(rights.get("maySetSeen", False)),
		"may_set_keywords": cint(rights.get("maySetKeywords", False)),
		"may_create_child": cint(rights.get("mayCreateChild", False)),
		"may_rename": cint(rights.get("mayRename", False)),
		"may_delete": cint(rights.get("mayDelete", False)),
		"may_submit": cint(rights.get("maySubmit", False)),
		"creation": today(),
		"modified": today(),
	}


def get_sort_order(role: str | None = None) -> int:
	"""Returns the sort order for the mailbox based on its role."""

	role_order = ["inbox", "important", "sent", "drafts", "junk", "archive", "trash"]

	if not role or role not in role_order:
		return len(role_order) + 1

	return role_order.index(role)


def has_permission(doc: "Document", ptype: str, user: str | None = None) -> bool:
	if doc.doctype != "Mailbox":
		return False

	return bool(get_user_for_jmap_account(doc.account, raise_exception=False))
