# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from uuid import uuid7

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, today

from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.jmap import (
    JMAP_REFUSALS,
    chunked_set,
    format_method_error,
    format_set_error,
    get_account_client,
    invalidate_jmap_mailboxes_cache,
)
from suite.mail.utils import log_mail_error
from suite.utils import parse_filters
from suite.utils.validation import JSONList

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

    def load_from_db(self) -> Mailbox:
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
def bulk_delete(names: JSONList[str]) -> None:
    """Deletes multiple mailboxes given their names."""

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
        "name": name,
        "role": role or None,
        "parentId": parent or None,
        "sortOrder": int(sort_order or 0),
        "isSubscribed": bool(subscribed or False),
    }

    client = get_account_client(account)
    title = _("Mailbox Creation Error")
    try:
        with client.batch() as b:
            h = b.mail.mailbox.set(create={creation_id: mailbox})
        response = h.result
    except JMAP_REFUSALS as e:
        frappe.throw(_(format_method_error(e)), title=title)

    if id := response.created_id(creation_id):
        invalidate_jmap_mailboxes_cache(account)
        return id

    frappe.throw(_(format_set_error(response.not_created.get(creation_id))), title=title)


@frappe.whitelist()
def get_mailbox(account: str, id: str, raise_exception: bool = False) -> dict | None:
    """Returns mailbox details for the given account and id."""

    client = get_account_client(account)
    with client.batch() as b:
        h = b.mail.mailbox.get(ids=[id])

    if mailboxes := h.result.items:
        return format_mailbox(account, mailboxes[0].to_wire())

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
        "name": name,
        "role": role or None,
        "parentId": parent or None,
        "sortOrder": int(sort_order or 0),
        "isSubscribed": bool(subscribed or False),
    }

    client = get_account_client(account)
    try:
        with client.batch() as b:
            h = b.mail.mailbox.set(update={id: mailbox})
        response = h.result
    except JMAP_REFUSALS as e:
        frappe.throw(_(format_method_error(e)), title=title)

    if id not in response.updated:
        frappe.throw(_(format_set_error(response.not_updated.get(id))), title=title)

    invalidate_jmap_mailboxes_cache(account)


@frappe.whitelist()
def delete_mailboxes(account: str, ids: list[str], remove_emails: bool = True) -> None:
    """Deletes a mailbox for the given account by its ID."""

    client = get_account_client(account)
    try:
        try:
            result = chunked_set(
                client,
                lambda b, chunk: b.mail.mailbox.set(destroy=chunk, onDestroyRemoveEmails=remove_emails),
                ids,
            )
        except JMAP_REFUSALS as e:
            frappe.throw(format_method_error(e), title=_("Mailbox Deletion Error"))

        if result.not_destroyed:
            error_messages = []
            for id, error in result.not_destroyed.items():
                error_messages.append(f"{id}: {format_set_error(error)}")
            frappe.throw(
                _("Mailbox Deletion Error(s):<br>{0}").format("<br>".join(error_messages)),
                title=_("Mailbox Deletion Error"),
            )
    finally:
        # Drop the stale list so later lookups (e.g. sieve regeneration) don't see a deleted
        # mailbox - also after a refusal, which can follow mailboxes that were deleted.
        _drop_cached_mailboxes(account)


@frappe.whitelist()
def fetch_mailboxes(account: str, page: int = 1, limit: int | None = 10) -> list:
    """Returns a list of mailboxes for the given account.

    `limit=None` returns every mailbox, and is what a caller wanting the account's folders as a
    whole asks for — the client's folder list, a link-field search: a page silently drops whatever
    sorts last, and says nothing about having done so. The default stays at ten for the callers
    that do page, this being a whitelisted endpoint.
    """

    client = get_account_client(account)
    with client.batch() as b:
        h = b.mail.mailbox.get()

    mailboxes = [m.to_wire() for m in h.result.items]
    formatted_mailboxes = [format_mailbox(account, mailbox) for mailbox in mailboxes]
    sorted_mailboxes = sorted(
        formatted_mailboxes, key=lambda m: (m["sort_order"], get_sort_order(m["role"]), m["_name"], m["id"])
    )
    frappe.cache.set_value(_get_total_cache_key(account), len(mailboxes), expires_in_sec=600)

    if limit is None:
        return sorted_mailboxes

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

    client = get_account_client(account)
    with client.batch() as b:
        h = b.mail.mailbox.get()

    def listed(sort_orders: dict[str, int]) -> list[dict]:
        """The mailboxes as they are listed once the given sort orders have replaced their own."""

        return sorted(
            mailboxes,
            key=lambda m: (
                sort_orders.get(m["id"], m["sortOrder"]),
                get_sort_order(m["role"]),
                m["name"],
                m["id"],
            ),
        )

    mailboxes = [m.to_wire() for m in h.result.items]
    updates = get_updates(listed({}), target_mailbox_id, prior_mailbox_id)

    title = _("Mailbox Position Update Error")
    try:
        try:
            result = chunked_set(
                client,
                lambda b, chunk: b.mail.mailbox.set(update={k: {"sortOrder": v} for k, v in chunk.items()}),
                updates,
            )
        except JMAP_REFUSALS as e:
            frappe.throw(format_method_error(e), title=title)

        if target_mailbox_id not in result.updated:
            # The mailbox did not move, whatever became of the neighbours renumbered for it.
            frappe.throw(_(format_set_error(result.not_updated.get(target_mailbox_id))), title=title)

        if result.not_updated:
            # Only neighbours, renumbered to make room. A neighbour left at its old sort order
            # can end up on the wrong side of the mailboxes that took theirs, so the listing
            # is checked against the one asked for.
            refusals = "\n".join(
                f"{id}: {format_set_error(error)}" for id, error in result.not_updated.items()
            )
            applied = {id: sort_order for id, sort_order in updates.items() if id in result.updated}
            if [m["id"] for m in listed(applied)] != [m["id"] for m in listed(updates)]:
                frappe.throw(
                    _("The mailboxes could not all be put in the new order: {0}").format(
                        format_set_error(next(iter(result.not_updated.values())))
                    ),
                    title=title,
                )
            log_mail_error("Mailbox Position Update", refusals)
    finally:
        # The cached mailboxes carry their sort order, and a refusal can follow moves that took.
        _drop_cached_mailboxes(account)


def _drop_cached_mailboxes(account: str) -> None:
    """Invalidates the cached mailbox list from a `finally`, where a failure of its own would
    take the place of the error being raised."""

    try:
        invalidate_jmap_mailboxes_cache(account)
    except Exception:
        log_mail_error("Failed to drop the cached mailboxes", frappe.get_traceback(with_context=True))


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


def has_permission(doc: Document, ptype: str, user: str | None = None) -> bool:
    if doc.doctype != "Mailbox":
        return False

    return bool(get_user_for_jmap_account(doc.account, raise_exception=False))
