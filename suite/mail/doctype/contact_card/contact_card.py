# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
from uuid import uuid7

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint
from jmap import MethodError

from suite.mail.doctype.address_book.address_book import validate_address_book_name_format
from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.jmap import (
    chunked_set,
    format_method_error,
    format_set_error,
    get_account_client,
    get_cached_address_books,
)
from suite.mail.store import Entity, get_data_store, get_email_address_index
from suite.mail.utils import log_mail_error
from suite.mail.utils.dt import normalize_utc_z
from suite.utils import parse_filters
from suite.utils.dt import utcnow


class ContactCard(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        from suite.mail.doctype.contact_card_address.contact_card_address import ContactCardAddress
        from suite.mail.doctype.contact_card_address_book.contact_card_address_book import (
            ContactCardAddressBook,
        )
        from suite.mail.doctype.contact_card_email.contact_card_email import ContactCardEmail
        from suite.mail.doctype.contact_card_phone.contact_card_phone import ContactCardPhone

        account: DF.Link
        address_books: DF.Table[ContactCardAddressBook]
        addresses: DF.Table[ContactCardAddress]
        created_at: DF.Data | None
        email: DF.Data | None
        emails: DF.Table[ContactCardEmail]
        full_name: DF.Data | None
        id: DF.Data | None
        kind: DF.Data | None
        name_breakup: DF.JSON | None
        phone: DF.Data | None
        phones: DF.Table[ContactCardPhone]
        uid: DF.Data | None
        updated_at: DF.Data | None
    # end: auto-generated types

    @property
    def address_book_ids(self) -> list[str]:
        """Returns a list of address book IDs associated with this contact card."""

        address_book_ids = []
        for address_book in self.address_books:
            address_book_id = address_book.get("address_book_id")
            if not address_book_id:
                frappe.throw(_("Row #{0}: Address Book ID is required.").format(address_book.idx))
            address_book_ids.append(address_book_id)

        return address_book_ids

    @property
    def formatted_emails(self) -> list[dict] | None:
        """Returns emails in the format required by JMAP API."""

        if self.emails:
            emails = []
            for email in self.emails:
                emails.append(
                    {
                        "type": email.type,
                        "label": email.label,
                        "address": email.address,
                    }
                )

            return emails

    @property
    def formatted_phones(self) -> list[dict] | None:
        """Returns phones in the format required by JMAP API."""

        if self.phones:
            phones = []
            for phone in self.phones:
                phones.append(
                    {
                        "type": phone.type,
                        "label": phone.label,
                        "number": phone.number,
                    }
                )

            return phones

    @property
    def formatted_addresses(self) -> list[dict] | None:
        """Returns addresses in the format required by JMAP API."""

        if self.addresses:
            addresses = []
            for address in self.addresses:
                addresses.append(
                    {
                        "type": address.type,
                        "street": address.street,
                        "locality": address.locality,
                        "region": address.region,
                        "country": address.country,
                        "postcode": address.postcode,
                        "time_zone": address.time_zone,
                    }
                )

            return addresses

    def db_insert(self, *args, **kwargs) -> None:
        self.id = add_contact_card(
            self.account,
            self.address_book_ids,
            self.full_name,
            self.formatted_emails,
            self.formatted_phones,
            self.formatted_addresses,
            self.kind,
        )
        self.name = f"{self.account}|{self.id}"

    def load_from_db(self) -> ContactCard:
        account, id = parse_contact_card_name(self.name)
        if contact_cards := get_contact_cards(account, [id]):
            return super(Document, self).__init__(contact_cards[0])

        frappe.throw(
            _("Contact Card with ID {0} not found in account {1}.").format(
                frappe.bold(id), frappe.bold(account)
            ),
            title=_("Contact Card Not Found"),
        )

    def db_update(self) -> None:
        account, id = parse_contact_card_name(self.name)
        update_contact_card(
            account,
            id,
            self.address_book_ids,
            self.full_name,
            self.formatted_emails,
            self.formatted_phones,
            self.formatted_addresses,
            self.kind,
        )
        self.reload()

    def delete(self) -> None:
        account, id = parse_contact_card_name(self.name)
        delete_contact_cards(account, [id])

    @staticmethod
    def get_list(filters=None, page_length=20, **kwargs) -> list:
        filters = parse_filters(filters)

        id = filters.get("id")
        account = filters.get("account")

        if not account:
            frappe.msgprint(_("Please select an account to view contact cards."), alert=True)
            return []

        if id:
            contact_cards = get_contact_cards(account, [id])
            total = len(contact_cards)
        else:
            if address_book := filters.get("address_book"):
                validate_address_book_name_format(address_book)
                filters["address_book"] = address_book.split("|")[1]

            filter = {
                prop: value
                for field, prop in {
                    "address_book": "inAddressBook",
                    "full_name": "name",
                    "email": "email",
                    "phone": "phone",
                }.items()
                if (value := filters.get(field))
            }
            limit = cint(kwargs.get("start")) + page_length
            contact_cards, total = fetch_contact_cards(account, filter, limit=limit)

        frappe.cache.set_value(_get_total_cache_key(account), total, expires_in_sec=600)

        if not contact_cards:
            frappe.msgprint(_("No contact card found."), alert=True)

        return contact_cards

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

    def validate(self) -> None:
        self.validate_address_books()

    def validate_address_books(self) -> None:
        """Validates that at least one address book is associated with the contact card."""

        if not self.address_books:
            frappe.throw(_("A contact card must belong to at least one address book."))

        for ab in self.address_books:
            validate_address_book_name_format(ab.address_book)
            ab.address_book_id = ab.address_book.split("|")[1]


def parse_contact_card_name(name: str) -> tuple[str, str]:
    """Splits a Contact Card name `account|id` into its bare `account` and `id`."""

    account, id = name.split("|")
    return account, id


@frappe.whitelist()
def bulk_delete(names: str | list[str]) -> None:
    """Delete multiple Contact Cards based on their names."""

    if isinstance(names, str):
        names = json.loads(names)

    accounts_map = {}
    for name in names:
        account, id = parse_contact_card_name(name)
        accounts_map.setdefault(account, []).append(id)

    for account, ids in accounts_map.items():
        delete_contact_cards(account, ids)

    frappe.msgprint(_("Contact Cards deleted successfully."), alert=True)


@frappe.whitelist()
def add_contact_card(
    account: str,
    address_book_ids: list[str],
    full_name: str | None = None,
    emails: list[dict] | None = None,
    phones: list[dict] | None = None,
    addresses: list[dict] | None = None,
    kind: str | None = None,
) -> str:
    """Adds a contact card for the given account with the specified parameters."""

    creation_id = str(uuid7())
    contact_card = _card_create_payload(
        creation_id, address_book_ids, full_name, emails, phones, addresses, kind
    )

    client = get_account_client(account)
    title = _("Contact Card Creation Error")
    try:
        with client.batch() as b:
            h = b.contacts.contact_card.set(create={creation_id: contact_card})
        response = h.result
    except MethodError as e:
        frappe.throw(_(format_method_error(e)), title=title)

    if id := response.created_id(creation_id):
        return id

    frappe.throw(_(format_set_error(response.not_created.get(creation_id))), title=title)


@frappe.whitelist()
def bulk_add_contact_cards(account: str, contact_cards: list[dict], raise_exception: bool = True) -> None:
    """Adds multiple contact cards for the given account and returns their IDs."""

    for card in contact_cards:
        if not card.get("creation_id"):
            card["creation_id"] = str(uuid7())

    creates = {
        card["creation_id"]: _card_create_payload(
            card["creation_id"],
            card["address_book_ids"],
            card.get("full_name"),
            card.get("emails"),
            card.get("phones"),
            card.get("addresses"),
            card.get("kind"),
        )
        for card in contact_cards
    }

    client = get_account_client(account)
    result = chunked_set(client, lambda b, chunk: b.contacts.contact_card.set(create=chunk), creates)

    title = _("Contact Card Creation Error")
    if result.not_created:
        if raise_exception:
            frappe.throw(_("One or more contact cards failed to create"), title=title)


@frappe.whitelist()
def fetch_contact_cards(
    account: str,
    filter: dict | None = None,
    position: int = 0,
    limit: int = 50,
    sort: list[dict] | None = None,
) -> tuple[list[dict], int]:
    """Returns a list of contact cards and total count based on the provided filter."""

    contact_cards = []
    client = get_account_client(account)
    data = _query_contact_cards(client, filter, position, limit, sort)

    ids = data.get("ids", [])
    total = data.get("total", 0)

    contact_cards.extend(get_contact_cards(account, ids))

    return contact_cards[:limit], total


@frappe.whitelist()
def get_contact_cards(account: str, ids: list[str]) -> list[dict]:
    """Returns a list of contact cards for the provided IDs in the same order as ids."""

    # Ownership has to be settled before the cache is read, not just before the fetch: the only
    # check used to sit inside the "ids_to_fetch" branch, so a request whose ids were all cached
    # returned another account's contacts without ever being authorized.
    get_user_for_jmap_account(account, raise_exception=True)

    cached_contact_cards = _get_cached_contact_cards(account, ids)

    contact_cards = {}
    ids_to_fetch = []
    for id in ids:
        if cached_contact_card := cached_contact_cards.get(id):
            contact_cards[id] = cached_contact_card
        else:
            ids_to_fetch.append(id)

    if ids_to_fetch:
        client = get_account_client(account)
        with client.batch() as b:
            h = b.contacts.contact_card.get(ids=ids_to_fetch, properties=CARD_PROPERTIES)

        cards = [c.to_wire() for c in h.result.items]
        address_book_map = {ab["id"]: ab["name"] for ab in get_cached_address_books(account)}

        contact_cards_to_cache = {}
        for card in cards:
            contact_card = format_contact_card(account, address_book_map, card)
            contact_cards_to_cache[contact_card["id"]] = contact_card
            contact_cards[contact_card["id"]] = contact_card

        if contact_cards_to_cache:
            _cache_contact_cards(account, contact_cards_to_cache)

    return [contact_cards[id] for id in ids if id in contact_cards]


@frappe.whitelist()
def update_contact_card(
    account: str,
    id: str,
    address_book_ids: list[str],
    full_name: str | None = None,
    emails: list[dict] | None = None,
    phones: list[dict] | None = None,
    addresses: list[dict] | None = None,
    kind: str | None = None,
) -> None:
    """Updates an existing contact card with the given parameters."""

    contact_card = _card_update_payload(address_book_ids, full_name, emails, phones, addresses, kind)

    client = get_account_client(account)
    title = _("Contact Card Update Error")
    try:
        with client.batch() as b:
            h = b.contacts.contact_card.set(update={id: contact_card})
        response = h.result
    except MethodError as e:
        frappe.throw(_(format_method_error(e)), title=title)

    if id not in response.updated:
        frappe.throw(_(format_set_error(response.not_updated.get(id))), title=title)

    _remove_cached_contact_cards(account, [id])


def contact_card_update_address_books(
    account: str,
    ids: list[str],
    add_address_book_id: str | None = None,
    remove_address_book_id: str | None = None,
    move_to_address_book_id: str | None = None,
) -> None:
    """
    Updates addressBookIds for the provided contact cards.

    Behavior:
    - add_address_book_id: adds the contact to an address book
    - remove_address_book_id: removes the contact from an address book
    - add + remove: moves contact between address books (patch-based)
    - move_to_address_book_id: replaces addressBookIds entirely
    """

    if move_to_address_book_id and (add_address_book_id or remove_address_book_id):
        raise ValueError(
            "Cannot specify 'move_to_address_book_id' together with 'add_address_book_id' or 'remove_address_book_id'."
        )

    if not any([add_address_book_id, remove_address_book_id, move_to_address_book_id]):
        raise ValueError(
            "At least one of 'add_address_book_id', 'remove_address_book_id', or 'move_to_address_book_id' must be specified."
        )

    if move_to_address_book_id:
        payload = {"addressBookIds": {move_to_address_book_id: True}, "updated": utcnow()}
    else:
        payload = {"updated": utcnow()}
        if add_address_book_id:
            payload[f"addressBookIds/{add_address_book_id}"] = True
        if remove_address_book_id:
            payload[f"addressBookIds/{remove_address_book_id}"] = None

    client = get_account_client(account)
    result = chunked_set(
        client, lambda b, chunk: b.contacts.contact_card.set(update={id: payload for id in chunk}), ids
    )

    title = _("Contact Card Update Error")
    if not result.updated:
        error = result.not_updated.get(ids[0]) or next(iter(result.not_updated.values()), None)
        frappe.throw(_(format_set_error(error)), title=title)

    _remove_cached_contact_cards(account, ids)


@frappe.whitelist()
def contact_card_add_to_address_book(account: str, ids: list[str], address_book_id: str) -> None:
    """Adds the provided contact cards to an address book."""

    return contact_card_update_address_books(account, ids, add_address_book_id=address_book_id)


@frappe.whitelist()
def contact_card_remove_from_address_book(
    account: str,
    ids: list[str],
    address_book_id: str,
) -> None:
    """Removes the provided contact cards from an address book."""

    return contact_card_update_address_books(account, ids, remove_address_book_id=address_book_id)


@frappe.whitelist()
def contact_card_move_between_address_books(
    account: str, ids: list[str], from_address_book_id: str, to_address_book_id: str
) -> None:
    """Moves contact cards from one address book to another."""

    return contact_card_update_address_books(
        account,
        ids,
        add_address_book_id=to_address_book_id,
        remove_address_book_id=from_address_book_id,
    )


@frappe.whitelist()
def contact_card_move_to_address_book(
    account: str,
    ids: list[str],
    address_book_id: str,
) -> None:
    """Moves contact cards to the given address book, replacing all others."""

    return contact_card_update_address_books(account, ids, move_to_address_book_id=address_book_id)


@frappe.whitelist()
def delete_contact_cards(account: str, ids: list[str]) -> None:
    """Deletes contact cards for the given account by its IDs."""

    client = get_account_client(account)
    chunked_set(client, lambda b, chunk: b.contacts.contact_card.set(destroy=chunk), ids)
    _remove_cached_contact_cards(account, ids)


def _get_total_cache_key(account: str) -> str:
    """Returns a cache key for total contact cards count for the given account."""

    return f"{account}:contact_cards:total"


def _get_cached_contact_cards(account: str, ids: list[str]) -> dict[str, dict | None]:
    """Returns a dictionary of cached contact cards for the given account and IDs."""

    store = get_data_store(account)
    return store.get_many(Entity.CONTACT_CARD, keys=ids)


def _cache_contact_cards(account: str, contact_cards: dict[str, dict]) -> None:
    """Caches contact cards for the given account, and indexes their addresses for search."""

    store = get_data_store(account)
    store.set_many(Entity.CONTACT_CARD, items=contact_cards)

    # Feed contact addresses into the shared address index; never let indexing break caching.
    # Uncounted: the whole address book is re-cached on every contact sync, and a contact card says
    # who someone is, not how much mail they are on — counting it would rank contacts the user never
    # writes to above the addresses they actually correspond with.
    try:
        get_email_address_index(account).index_addresses(
            _contact_addresses(contact_cards.values()), count=False
        )
    except Exception:
        log_mail_error(
            _("Failed to index contact addresses for search"), frappe.get_traceback(with_context=True)
        )


def _remove_cached_contact_cards(account: str, ids: list[str]) -> None:
    """Removes cached contact cards for the given account and IDs.

    Addresses are left in the search index on purpose: it is cumulative, and an address from a
    removed contact is almost always still valid elsewhere.
    """

    store = get_data_store(account)
    store.delete_many(Entity.CONTACT_CARD, keys=ids)


def _contact_addresses(contact_cards: list[dict]) -> list[dict]:
    """Flatten cached contact cards into {name, email} address dicts, one per email address."""

    addresses = []
    for contact_card in contact_cards:
        name = contact_card.get("full_name")
        for email in contact_card.get("emails") or []:
            addresses.append({"name": name, "email": email.get("address")})

    return addresses


# Every JSContact property, requested explicitly so a server trimming its default set
# cannot silently drop fields the formatter reads.
CARD_PROPERTIES = [
    # --- JMAP-specific ---
    "id",
    "addressBookIds",
    "blobId",
    # --- JSContact core fields ---
    "uid",
    "kind",
    "prodId",
    "version",
    "created",
    "updated",
    "fullName",
    "name",
    "nickNames",
    "categories",
    "notes",
    "anniversaries",
    "urls",
    "relatedTo",
    "organizations",
    "titles",
    "roles",
    "emails",
    "phones",
    "addresses",
    "onlineServices",
    "preferredLanguages",
    "speakToAs",
    "gender",
    "timeZones",
    "photos",
    "members",
    "preferredContactChannels",
    "localizations",
    "extensions",
]


def _query_contact_cards(
    client, filter: dict | None = None, position: int = 0, limit: int = 50, sort: list[dict] | None = None
) -> dict:
    """Queries contact card ids with pagination, fetching the total only on the first page."""

    ids = []
    total = None
    batch_size = min(limit, client.capabilities.limits.max_objects_in_get)

    while len(ids) < limit:
        current_batch_size = min(batch_size, limit - len(ids))
        kwargs = {}
        if filter is not None:
            kwargs["filter"] = filter
        if sort is not None:
            kwargs["sort"] = sort

        with client.batch() as b:
            h = b.contacts.contact_card.query(
                position=position, limit=current_batch_size, calculate_total=total is None, **kwargs
            )

        response = h.result
        ids.extend(response.ids)

        if total is None:
            total = response.total

        if len(response.ids) < current_batch_size or (total is not None and len(ids) >= total):
            break

        position += len(response.ids)

    return {"ids": ids[:limit], "total": total}


def _card_create_payload(
    creation_id: str,
    address_book_ids: list[str],
    full_name: str | None = None,
    emails: list[dict] | None = None,
    phones: list[dict] | None = None,
    addresses: list[dict] | None = None,
    kind: str | None = None,
) -> dict:
    """ContactCard/set create payload in JSContact form."""

    timestamp = utcnow()
    return {
        "@type": "Card",
        "version": "1.0",
        "uid": creation_id,
        "kind": kind or "individual",
        "name": _name_map(full_name),
        "emails": _emails_map(emails),
        "phones": _phones_map(phones),
        "addresses": _addresses_map(addresses),
        "addressBookIds": {id: True for id in address_book_ids},
        "created": timestamp,
        "updated": timestamp,
    }


def _card_update_payload(
    address_book_ids: list[str],
    full_name: str | None = None,
    emails: list[dict] | None = None,
    phones: list[dict] | None = None,
    addresses: list[dict] | None = None,
    kind: str | None = None,
) -> dict:
    """ContactCard/set update payload in JSContact form."""

    return {
        "kind": kind or "individual",
        "name": _name_map(full_name),
        "emails": _emails_map(emails),
        "phones": _phones_map(phones),
        "addresses": _addresses_map(addresses),
        "addressBookIds": {id: True for id in address_book_ids},
        "updated": utcnow(),
    }


def _name_map(full_name: str | None = None) -> dict:
    if full_name:
        given, surname = full_name.split(" ", 1) if " " in full_name else (full_name, None)
        return {
            "@type": "Name",
            "full": full_name,
            "components": [{"kind": "given", "value": given}, {"kind": "surname", "value": surname}],
            "isOrdered": True,
        }

    return {}


def _emails_map(emails: list[dict] | None = None) -> dict[str, dict] | None:
    if emails:
        return {
            str(uuid7()): {
                "address": email["address"],
                "label": email.get("label"),
                "contexts": {email["type"]: True},
            }
            for email in emails
        }


def _phones_map(phones: list[dict] | None = None) -> dict[str, dict] | None:
    if phones:
        return {
            str(uuid7()): {
                "number": phone["number"],
                "label": phone.get("label"),
                "contexts": {phone["type"]: True},
            }
            for phone in phones
        }


def _addresses_map(addresses: list[dict] | None = None) -> dict[str, dict] | None:
    if addresses:
        addresses_map = {}
        for counter, address in enumerate(addresses):
            components = []
            for field, key in {
                "street": "name",
                "locality": "locality",
                "region": "region",
                "postcode": "postcode",
                "country": "country",
            }.items():
                components.append({"kind": key, "value": address.get(field)})

            addresses_map[f"{counter}"] = {
                "components": components,
                "timeZone": address.get("time_zone"),
                "contexts": {address["type"]: True},
            }

        return addresses_map


def format_contact_card(account: str, address_book_map: dict, contact_card: dict) -> dict:
    """Formats contact card data for display."""

    full_name = None
    if contact_name := contact_card.get("name"):
        if components := contact_name.get("components"):
            if contact_name.get("full"):
                full_name = contact_name["full"]
            elif contact_name.get("isOrdered", False):
                full_name = " ".join([component["value"] for component in components])
            else:
                given = next(
                    (component["value"] for component in components if component["kind"] == "given"),
                    "",
                )
                surname = next(
                    (component["value"] for component in components if component["kind"] == "surname"),
                    "",
                )
                full_name = f"{given} {surname}".strip()

    address_books = []
    for address_book_id in contact_card["addressBookIds"].keys():
        address_books.append(
            {
                "address_book": f"{account}|{address_book_id}",
                "address_book_id": address_book_id,
                "address_book_name": address_book_map.get(address_book_id),
            }
        )

    emails = []
    for email in contact_card.get("emails", {}).values():
        address = email.get("address")
        contexts = email.get("contexts", {})
        type = next(context for context in contexts.keys()) if contexts else None
        emails.append(
            {
                "type": type,
                "address": address,
                "label": email.get("label"),
                "contexts": json.dumps(contexts, indent=4),
            }
        )

    phones = []
    for phone in contact_card.get("phones", {}).values():
        number = phone.get("number")
        contexts = phone.get("contexts", {})
        type = next(context for context in contexts.keys()) if contexts else None
        phones.append(
            {
                "type": type,
                "number": number,
                "label": phone.get("label"),
                "contexts": json.dumps(contexts, indent=4),
            }
        )

    addresses = []
    for address in contact_card.get("addresses", {}).values():
        time_zone = address.get("timeZone")
        contexts = address.get("contexts", {})
        component_map = {c["kind"]: c["value"] for c in address.get("components", [])}

        addresses.append(
            {
                "type": next(iter(contexts), None),
                "street": component_map.get("name"),
                "locality": component_map.get("locality"),
                "region": component_map.get("region"),
                "postcode": component_map.get("postcode"),
                "country": component_map.get("country"),
                "time_zone": time_zone,
                "contexts": json.dumps(contexts, indent=4),
            }
        )

    creation = normalize_utc_z(contact_card.get("created"))
    modified = normalize_utc_z(contact_card.get("updated"))

    return {
        "name": f"{account}|{contact_card['id']}",
        "account": account,
        "id": contact_card["id"],
        "uid": contact_card.get("uid"),
        "kind": contact_card.get("kind"),
        "name_breakup": json.dumps(contact_card.get("name", {}), indent=4),
        "full_name": full_name,
        "address_books": address_books,
        "emails": emails,
        "phones": phones,
        "addresses": addresses,
        "created_at": creation,
        "updated_at": modified,
        # Fallback stays in the ``...Z`` shape so the field parses with one rule whether or
        # not the server supplied real timestamps.
        "creation": creation or modified or utcnow(),
        "modified": modified or creation or utcnow(),
    }


def has_permission(doc: Document, ptype: str, user: str | None = None) -> bool:
    if doc.doctype != "Contact Card":
        return False

    return bool(get_user_for_jmap_account(doc.account, raise_exception=False))
