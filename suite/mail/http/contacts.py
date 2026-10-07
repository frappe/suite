"""Named contact and address book reads and edits."""

from collections.abc import Callable
from typing import NotRequired, TypedDict, cast

import frappe

from suite.composition.http import Route, RouteKind
from suite.mail.api import contacts
from suite.mail.doctype.address_book import address_book
from suite.mail.doctype.contact_card import contact_card
from suite.mail.http.contact_shapes import (
    AddressBook,
    BookMembership,
    Contact,
    ContactFilter,
    ContactPage,
    Email,
    Phone,
    PostalAddress,
    RecipientContact,
)
from suite.mail.http.shapes import AccountInput, Flag


class ContactPageInput(AccountInput):
    filter: NotRequired[ContactFilter | None]
    limit: NotRequired[int]
    start: NotRequired[int]


class CardInput(AccountInput):
    id: str


class CardChanges(TypedDict, total=False):
    full_name: str | None
    kind: str | None
    emails: list[Email]
    phones: list[Phone]
    addresses: list[PostalAddress]
    address_books: list[BookMembership]


class UpdateCard(CardInput):
    changes: CardChanges


class CreateCard(AccountInput):
    address_book_ids: list[str]
    full_name: NotRequired[str | None]
    kind: NotRequired[str | None]
    emails: NotRequired[list[Email] | None]
    phones: NotRequired[list[Phone] | None]
    addresses: NotRequired[list[PostalAddress] | None]


class CardIds(AccountInput):
    ids: list[str]


class Membership(CardIds):
    address_book_id: str


class CountInput(AccountInput):
    address_book: str


class CreateBook(AccountInput):
    name: str
    description: NotRequired[str | None]
    sort_order: NotRequired[int]
    default: NotRequired[bool]
    subscribed: NotRequired[bool]


class BookChanges(TypedDict, total=False):
    _name: str
    description: str | None
    sort_order: int
    default: bool | Flag
    subscribed: bool | Flag


class UpdateBook(CardInput):
    changes: BookChanges


@frappe.whitelist(methods=["GET"])
def contact(account: str, id: str) -> Contact:
    doc = frappe.get_doc("Contact Card", f"{account}|{id}")
    doc.check_permission("read")
    return cast(Contact, {field: doc.as_dict().get(field) for field in Contact.__annotations__})


@frappe.whitelist(methods=["PATCH"])
def update_contact(account: str, id: str, changes: CardChanges) -> None:
    if not changes.keys() <= CardChanges.__annotations__.keys():
        frappe.throw("Unknown contact field")
    doc = frappe.get_doc("Contact Card", f"{account}|{id}")
    doc.check_permission("write")
    doc.update(changes)
    doc.save()


@frappe.whitelist(methods=["GET"])
def book(account: str, id: str) -> AddressBook:
    doc = frappe.get_doc("Address Book", f"{account}|{id}")
    doc.check_permission("read")
    return cast(AddressBook, {field: doc.get(field) for field in AddressBook.__annotations__})


@frappe.whitelist(methods=["PATCH"])
def update_book(account: str, id: str, changes: BookChanges) -> None:
    if not changes.keys() <= BookChanges.__annotations__.keys():
        frappe.throw("Unknown address book field")
    doc = frappe.get_doc("Address Book", f"{account}|{id}")
    doc.check_permission("write")
    doc.update(changes)
    doc.save()


ROUTES = (
    Route(
        "GET",
        "contacts/card",
        "contact",
        kind="query",
        public_name="contacts.get",
        query=CardInput,
        output=Contact,
    ),
    Route(
        "PATCH",
        "contacts/card",
        "update_contact",
        kind="mutation",
        public_name="contacts.update",
        body=UpdateCard,
        output=type(None),
    ),
    Route(
        "GET",
        "address-books/book",
        "book",
        kind="query",
        public_name="addressBooks.get",
        query=CardInput,
        output=AddressBook,
    ),
    Route(
        "PATCH",
        "address-books/book",
        "update_book",
        kind="mutation",
        public_name="addressBooks.update",
        body=UpdateBook,
        output=type(None),
    ),
)
_OPERATIONS: tuple[
    tuple[Callable[..., object], RouteKind, str, object, object, dict[str, str] | None], ...
] = (
    (
        contacts.get_contact_cards,
        "query",
        "contacts.list",
        ContactPageInput,
        ContactPage,
        {"offset": "start", "rows": "rows", "total": "total"},
    ),
    (contacts.get_contacts, "query", "contacts.emails", ContactPageInput, list[RecipientContact], None),
    (
        contacts.get_address_book_contact_count,
        "query",
        "addressBooks.contactCount",
        CountInput,
        int,
        None,
    ),
    (contact_card.add_contact_card, "mutation", "contacts.create", CreateCard, str, None),
    (contact_card.delete_contact_cards, "mutation", "contacts.delete", CardIds, type(None), None),
    (
        contact_card.contact_card_add_to_address_book,
        "mutation",
        "contacts.addToBook",
        Membership,
        type(None),
        None,
    ),
    (
        contact_card.contact_card_remove_from_address_book,
        "mutation",
        "contacts.removeFromBook",
        Membership,
        type(None),
        None,
    ),
    (address_book.add_address_book, "mutation", "addressBooks.create", CreateBook, str, None),
    (address_book.delete_address_books, "mutation", "addressBooks.delete", CardIds, type(None), None),
)


CONTRACT_ROUTES = tuple(
    Route(
        "POST",
        f"/api/method/{handler.__module__}.{handler.__name__}",
        handler.__name__,
        kind=kind,
        public_name=public_name,
        body=body,
        output=output,
        envelope="message",
        page=page,
        errors=(frappe.PermissionError, frappe.ValidationError),
    )
    for handler, kind, public_name, body, output, page in _OPERATIONS
)
