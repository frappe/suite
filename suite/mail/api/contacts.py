import json
import re

import frappe

from suite.mail.api.utils import get_avatar_url
from suite.mail.doctype.address_book.address_book import fetch_address_books
from suite.mail.doctype.contact_card.contact_card import bulk_add_contact_cards, fetch_contact_cards
from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.jmap import get_default_address_book_id
from suite.mail.store import Entity, get_data_store


@frappe.whitelist()
def get_address_books(account: str) -> list[dict]:
    """Returns the address books for the given account."""

    if not (address_books := fetch_address_books(account, 1, 50)):
        return []

    fields = ["name", "id", "_name", "default"]
    return [{f: d[f] for f in fields} for d in address_books]


def sanitize_filter(filter: dict | None) -> dict | None:
    """Recursively removes conditions with empty values from the given JMAP filter."""

    if not filter:
        return None

    if "conditions" in filter:
        conditions = [c for c in map(sanitize_filter, filter["conditions"] or []) if c]
        if not conditions:
            return None
        if len(conditions) == 1:
            return conditions[0]
        return {**filter, "conditions": conditions}

    return {k: v for k, v in filter.items() if v} or None


@frappe.whitelist()
def get_contact_cards(account: str, filter: dict | None = None, limit: int = 50, start: int = 0) -> dict:
    """Returns an offset page of contact summaries and the total match count."""
    filter = sanitize_filter(filter)
    cards, total = fetch_contact_cards(account, filter, max(start, 0), max(1, min(limit, 500)))
    fields = ["id", "full_name", "kind", "emails"]
    rows = [
        {
            field: card[field].capitalize() if field == "kind" and card[field] else card[field]
            for field in fields
        }
        for card in cards
    ]
    return {"rows": rows, "total": total}


@frappe.whitelist()
def get_contacts(account: str, filter: dict | None = None, limit: int = 50) -> list[dict]:
    """Returns the emails contacts for the given account."""

    contacts = []
    contact_cards = get_contact_cards(account, filter, limit)["rows"]

    for card in contact_cards:
        if emails := card.get("emails"):
            for email in emails:
                contacts.append({"full_name": card.get("full_name"), "email": email.get("address")})

    enrich_contacts_with_user_images(contacts)

    return contacts


@frappe.whitelist()
def get_contacts_from_cache(account: str, limit: int = 1000) -> list[dict]:
    """Returns all contact cards for the given account from the cache."""

    get_user_for_jmap_account(account, raise_exception=True)

    store = get_data_store(account)
    data = store.scan(Entity.CONTACT_CARD, prefix="", limit=limit)

    contacts = []
    for contact_card in data.values():
        for email in contact_card.get("emails") or []:
            contacts.append(
                {
                    "id": contact_card.get("id"),
                    "email": email.get("address"),
                    "full_name": contact_card.get("full_name"),
                }
            )

    return contacts


def enrich_contacts_with_user_images(contacts: list[dict]) -> list[dict]:
    """Enriches the given contacts with user images."""

    unique_emails = set(contact.get("email") for contact in contacts if contact.get("email"))

    user_image_map = {}
    if unique_emails:
        user_data = frappe.get_all(
            "User", filters={"name": ["in", list(unique_emails)]}, fields=["name", "user_image"]
        )
        user_image_map = {u.name: u.user_image for u in user_data if u.user_image}

    for contact in contacts:
        email = contact.get("email")
        contact["user_image"] = user_image_map.get(email) or get_avatar_url(email) if email else None


@frappe.whitelist()
def get_address_book_contact_count(account: str, address_book: str) -> int:
    """Returns the total no. of contacts for the given address book."""

    return fetch_contact_cards(account, {"inAddressBook": address_book}, 0, 1)[1]


def create_contacts_if_not_exists(account: str, recipients: list[dict] | str) -> None:
    """Creates contacts for the given recipients if they do not exist."""

    if not frappe.db.get_value("JMAP Account", account, "create_contacts_after_email_submit"):
        return

    if isinstance(recipients, str):
        recipients = json.loads(recipients)

    emails = set([recipient.get("email") for recipient in recipients if recipient.get("email")])

    new_emails = []
    for email in emails:
        if not (fetch_contact_cards(account, {"email": email}, 0, 1)[0]):
            new_emails.append(email)

    contact_cards = []
    for email in new_emails:
        contact_card = {
            "address_book_ids": [get_default_address_book_id(account)],
            "full_name": extract_name_from_email(email),
            "kind": "Individual",
            "emails": [{"address": email, "type": "Personal"}],
        }
        contact_cards.append(contact_card)

    bulk_add_contact_cards(account, contact_cards)


def extract_name_from_email(email: str) -> str:
    """Extracts a name from the given email address."""

    return re.sub(r"\b\w", lambda m: m.group().upper(), re.sub(r"[._-]", " ", email.split("@")[0]))
