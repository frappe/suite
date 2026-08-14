# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
from uuid import uuid7

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, today
from jmap import MethodError

from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.jmap import chunked_set, format_method_error, format_set_error, get_account_client
from suite.utils import parse_filters


class Identity(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        from suite.mail.doctype.email_address.email_address import EmailAddress

        _name: DF.Data | None
        account: DF.Link
        bcc: DF.Table[EmailAddress]
        email: DF.Data
        html_signature: DF.HTMLEditor | None
        id: DF.Data | None
        may_delete: DF.Check
        reply_to: DF.Table[EmailAddress]
        text_signature: DF.Code | None
    # end: auto-generated types

    @property
    def _bcc(self) -> list[dict]:
        """Returns the BCC list in the JMAP required format."""

        bcc = []
        for b in self.bcc:
            bcc.append({"name": b.display_name, "email": b.email})
        return bcc

    @property
    def _reply_to(self) -> list[dict]:
        """Returns the Reply-To list in the JMAP required format."""

        reply_to = []
        for r in self.reply_to:
            reply_to.append({"name": r.display_name, "email": r.email})
        return reply_to

    def db_insert(self, *args, **kwargs) -> None:
        self.id = add_identity(
            self.account,
            self.email,
            self._name,
            self._reply_to,
            self._bcc,
            self.text_signature,
            self.html_signature,
        )
        self.name = f"{self.account}|{self.id}"

    def load_from_db(self) -> Identity:
        account, id = parse_identity_name(self.name)
        identity = get_identity(account, id)
        return super(Document, self).__init__(identity)

    def db_update(self) -> None:
        account, id = parse_identity_name(self.name)
        update_identity(
            account,
            id,
            self._name,
            self._reply_to,
            self._bcc,
            self.text_signature,
            self.html_signature,
        )
        self.reload()

    def delete(self) -> None:
        account, id = parse_identity_name(self.name)
        delete_identities(account, [id])

    @staticmethod
    def get_list(filters=None, page_length=20, **kwargs) -> list:
        filters = parse_filters(filters)
        id = filters.get("id")
        account = filters.get("account")

        if not account:
            frappe.msgprint(_("Please select an account to view identities."), alert=True)
            return []

        identities = []
        if id:
            if identity := get_identity(account, id, raise_exception=False):
                identities.append(identity)
        else:
            identities = fetch_identities(account, limit=page_length)

        if not identities:
            frappe.msgprint(_("No identities found."), alert=True)

        return identities

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
    """Returns a cache key for total identities count for the given account."""

    return f"{account}:identities:total"


def parse_identity_name(name: str) -> tuple[str, str]:
    """Splits an Identity name `account|id` into its bare `account` and `id`."""

    account, id = name.split("|")
    return account, id


@frappe.whitelist()
def bulk_delete(names: str | list[str]) -> None:
    """Deletes multiple identities given their names."""

    if isinstance(names, str):
        names = json.loads(names)

    accounts_map = {}
    for name in names:
        account, id = parse_identity_name(name)
        accounts_map.setdefault(account, []).append(id)

    for account, ids in accounts_map.items():
        delete_identities(account, ids)

    frappe.msgprint(_("Identities deleted successfully."), alert=True)


@frappe.whitelist()
def add_identity(
    account: str,
    email: str,
    name: str | None = None,
    reply_to: list[dict] | None = None,
    bcc: list[dict] | None = None,
    text_signature: str | None = None,
    html_signature: str | None = None,
) -> str:
    """Adds an identity for the given account with the specified parameters."""

    creation_id = str(uuid7())
    identity = {
        "email": email,
        "name": name,
        "replyTo": reply_to,
        "bcc": bcc,
        "textSignature": text_signature,
        "htmlSignature": html_signature,
    }

    client = get_account_client(account)
    title = _("Identity Creation Error")
    try:
        with client.batch() as b:
            h = b.submission.identity.set(create={creation_id: identity})
        response = h.result
    except MethodError as e:
        frappe.throw(_(format_method_error(e)), title=title)

    if id := response.created_id(creation_id):
        return id

    frappe.throw(_(format_set_error(response.not_created.get(creation_id))), title=title)


@frappe.whitelist()
def get_identity(account: str, id: str, raise_exception: bool = True) -> dict | None:
    """Returns identity details for the given account and id."""

    client = get_account_client(account)
    with client.batch() as b:
        h = b.submission.identity.get(ids=[id])

    if identities := h.result.items:
        return format_identity(account, identities[0].to_wire())

    if raise_exception:
        frappe.throw(
            _("Identity with ID {0} not found in account {1}.").format(frappe.bold(id), frappe.bold(account)),
            title=_("Identity Not Found"),
        )


@frappe.whitelist()
def update_identity(
    account: str,
    id: str,
    name: str | None = None,
    reply_to: list[dict] | None = None,
    bcc: list[dict] | None = None,
    text_signature: str | None = None,
    html_signature: str | None = None,
) -> None:
    """Updates an existing identity with the given parameters."""

    identity = {
        "name": name,
        "replyTo": reply_to,
        "bcc": bcc,
        "textSignature": text_signature,
        "htmlSignature": html_signature,
    }

    client = get_account_client(account)
    title = _("Identity Update Error")
    try:
        with client.batch() as b:
            h = b.submission.identity.set(update={id: identity})
        response = h.result
    except MethodError as e:
        frappe.throw(_(format_method_error(e)), title=title)

    if id not in response.updated:
        frappe.throw(_(format_set_error(response.not_updated.get(id))), title=title)


@frappe.whitelist()
def delete_identities(account: str, ids: list[str]) -> None:
    """Deletes identities for the given account and list of identity IDs."""

    client = get_account_client(account, ignore_permissions=True)
    result = chunked_set(client, lambda b, chunk: b.submission.identity.set(destroy=chunk), ids)

    if result.not_destroyed:
        error_messages = []
        for id, error in result.not_destroyed.items():
            error_messages.append(f"{id}: {format_set_error(error)}")
        frappe.throw(
            _("Identity Deletion Error(s):<br>{0}").format("<br>".join(error_messages)),
            title=_("Identity Deletion Error"),
        )


@frappe.whitelist()
def fetch_identities(account: str, page: int = 1, limit: int = 10) -> list:
    """Returns a list of identities for the given account."""

    client = get_account_client(account, ignore_permissions=True)
    with client.batch() as b:
        h = b.submission.identity.get()

    identities = [i.to_wire() for i in h.result.items]
    formatted_identities = [format_identity(account, identity) for identity in identities]
    frappe.cache.set_value(_get_total_cache_key(account), len(identities), expires_in_sec=600)

    start = (page - 1) * limit
    end = start + limit

    return formatted_identities[start:end]


def format_identity(account: str, identity: dict) -> dict:
    """Formats identity data for display."""

    bcc = []
    for b in identity["bcc"] or []:
        bcc.append({"display_name": b["name"], "email": b["email"].lower()})

    reply_to = []
    for r in identity["replyTo"] or []:
        reply_to.append({"display_name": r["name"], "email": r["email"].lower()})

    return {
        "name": f"{account}|{identity['id']}",
        "account": account,
        "id": identity["id"],
        "_name": identity["name"],
        "email": identity["email"].lower(),
        "bcc": bcc,
        "reply_to": reply_to,
        "html_signature": identity["htmlSignature"],
        "text_signature": identity["textSignature"],
        "may_delete": cint(identity["mayDelete"]),
        "owner": frappe.session.user,
        "modified_by": frappe.session.user,
        "creation": today(),
        "modified": today(),
    }


def has_permission(doc: Document, ptype: str, user: str | None = None) -> bool:
    if doc.doctype != "Identity":
        return False

    return bool(get_user_for_jmap_account(doc.account, raise_exception=False))
