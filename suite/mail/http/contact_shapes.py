"""Contact card and address book wire values."""

from typing import NotRequired, TypedDict

from suite.mail.http.shapes import Flag


class Email(TypedDict):
    address: str | None
    type: NotRequired[str | None]
    label: NotRequired[str | None]
    contexts: NotRequired[str | None]


class Phone(TypedDict):
    number: str | None
    type: NotRequired[str | None]
    label: NotRequired[str | None]
    contexts: NotRequired[str | None]


class PostalAddress(TypedDict, total=False):
    idx: int
    type: str | None
    street: str | None
    locality: str | None
    region: str | None
    postcode: str | None
    country: str | None
    time_zone: str | None
    contexts: str | None


class BookMembership(TypedDict):
    address_book: str
    address_book_id: str
    address_book_name: str | None


class ContactSummary(TypedDict):
    id: str
    full_name: str | None
    kind: str | None
    emails: list[Email]


class Contact(ContactSummary):
    name: str
    account: str
    uid: str | None
    name_breakup: str
    address_books: list[BookMembership]
    phones: list[Phone]
    addresses: list[PostalAddress]
    created_at: str | None
    updated_at: str | None
    creation: str
    modified: str


class RecipientContact(TypedDict):
    full_name: str | None
    email: str | None
    user_image: str | None


class ContactFilter(TypedDict, total=False):
    text: str
    email: str
    name: str
    inAddressBook: str
    notInAddressBook: str
    kind: str
    hasEmail: bool
    operator: str
    conditions: list[ContactFilter]


class ContactPage(TypedDict):
    rows: list[ContactSummary]
    total: int


class AddressBook(TypedDict):
    name: str
    account: str
    id: str
    _name: str
    sort_order: int
    description: str | None
    default: Flag
    subscribed: Flag
    may_read: Flag
    may_write: Flag
    may_admin: Flag
    may_delete: Flag
    creation: str
    modified: str
