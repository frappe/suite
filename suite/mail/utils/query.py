import frappe

from suite.calendar.doctype.calendar.calendar import fetch_calendars
from suite.mail.doctype.address_book.address_book import fetch_address_books
from suite.mail.doctype.mailbox.mailbox import fetch_mailboxes
from suite.mail.doctype.user_account.user_account import get_user_jmap_accounts
from suite.utils.user import is_system_manager


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_user_accounts(
    doctype: str | None = None,
    txt: str | None = None,
    searchfield: str | None = None,
    start: int = 0,
    page_len: int = 20,
    filters: dict | None = None,
) -> list:
    """Returns a list of accounts for the user."""

    filters = filters or {}
    user = filters.get("user") or frappe.session.user

    if not user or user in ("Guest", "Administrator"):
        return []

    if user != frappe.session.user and not is_system_manager(frappe.session.user):
        return []

    result = []
    for account in get_user_jmap_accounts(user):
        if txt and txt.lower() not in account.lower():
            continue

        result.append([account])

    return result[start : start + page_len]


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_account_mailboxes(
    doctype: str | None = None,
    txt: str | None = None,
    searchfield: str | None = None,
    start: int = 0,
    page_len: int = 20,
    filters: dict | None = None,
) -> list:
    """Returns a list of mailboxes for the account."""

    filters = filters or {}
    account = filters.get("account")

    if not account:
        return []

    result = []
    # The whole list rather than fetch_mailboxes' first page: a parent picker that only offers
    # the folders sorting first is one you cannot reach the rest of the account with.
    if mailboxes := fetch_mailboxes(account, limit=None):
        for mailbox in mailboxes:
            if txt and txt.lower() not in mailbox["name"].lower():
                continue

            result.append([mailbox["name"]])

    return result[start : start + page_len]


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_account_address_books(
    doctype: str | None = None,
    txt: str | None = None,
    searchfield: str | None = None,
    start: int = 0,
    page_len: int = 20,
    filters: dict | None = None,
) -> list:
    """Returns a list of address books for the account."""

    filters = filters or {}
    account = filters.get("account")

    if not account:
        return []

    result = []
    if address_books := fetch_address_books(account):
        for address_book in address_books:
            if txt and txt.lower() not in address_book["name"].lower():
                continue

            result.append([address_book["name"]])

    return result[start : start + page_len]


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_account_calendars(
    doctype: str | None = None,
    txt: str | None = None,
    searchfield: str | None = None,
    start: int = 0,
    page_len: int = 20,
    filters: dict | None = None,
) -> list:
    """Returns a list of calendars for the account."""

    filters = filters or {}
    account = filters.get("account")

    if not account:
        return []

    result = []
    if calendars := fetch_calendars(account):
        for calendar in calendars:
            if txt and txt.lower() not in calendar["name"].lower():
                continue

            result.append([calendar["name"]])

    return result[start : start + page_len]
