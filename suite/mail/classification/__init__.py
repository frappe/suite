# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Sorting incoming mail into categories: Primary, Promotions, Social, Updates and Forums.

A message is classified when it is first pulled from the JMAP server, and its category is kept
there as a keyword (see `Category.keyword`). The keyword is the record of the work: a message that
carries one is not classified again, whichever site or device fetches it next.

Classification is layered, cheapest first. Each layer names a category or passes the message on:

1. `headers` - what the message's headers say about how it was sent.
2. (planned) a locally trained heuristic classifier.
3. (planned) a model.

A message no layer claims is Primary.
"""

from collections.abc import Callable

import frappe
from frappe import _
from jmap.batch import ReadOnlyAccountError

from suite.mail.classification.category import Category, get_category
from suite.mail.classification.headers import classify_by_headers
from suite.mail.jmap import SuiteJMAPClient, chunked_set
from suite.mail.utils import get_config, log_mail_error

__all__ = [
    "EMAIL_PROPERTIES",
    "Category",
    "classify",
    "classify_emails",
    "get_category",
    "is_enabled",
]

# What the layers read of an Email beyond what a message is fetched with anyway.
EMAIL_PROPERTIES = ["headers"]

LAYERS: tuple[Callable[[dict], Category | None], ...] = (classify_by_headers,)

# Mail the user wrote has no category, and mail thrown out or held as spam is not worth giving
# one: moved back to the inbox it is fetched afresh, and classified then.
UNCLASSIFIED_ROLES = frozenset({"sent", "drafts", "junk", "trash"})


def is_enabled() -> bool:
    """Whether Mail Settings has incoming mail classified."""

    return bool(get_config("enable_email_classification"))


def classify(email: dict) -> Category:
    """The category of `email`, an Email in JMAP wire form."""

    for layer in LAYERS:
        if category := layer(email):
            return category

    return Category.PRIMARY


def classify_emails(client: SuiteJMAPClient, account: str, emails: list[dict], mailboxes: list[dict]) -> None:
    """Give a category to each of `emails` that has none, on the server and in place.

    `emails` are as fetched - wire form, with `EMAIL_PROPERTIES` among their properties - and
    `mailboxes` the account's. An email gains its category keyword here only once the server has
    taken it, so what is cached afterwards never claims more than the server holds: where the
    write is refused (a shared account the user may only read) the mail stays unclassified.

    Never raises. Classification is a nicety on the way to showing mail, not a reason to fail it.
    """

    try:
        skipped = {m["id"] for m in mailboxes if (m.get("role") or "").lower() in UNCLASSIFIED_ROLES}
        categories = {email["id"]: classify(email) for email in emails if _awaits_category(email, skipped)}
        if not categories:
            return

        result = chunked_set(
            client,
            lambda b, chunk: b.mail.email.set(update=chunk),
            {id: {f"keywords/{category.keyword}": True} for id, category in categories.items()},
        )

        for email in emails:
            if email["id"] in result.updated:
                email["keywords"] = {**(email.get("keywords") or {}), categories[email["id"]].keyword: True}
    except ReadOnlyAccountError:
        pass
    except Exception:
        log_mail_error(_("Failed to classify emails"), frappe.get_traceback(with_context=True))


def _awaits_category(email: dict, skipped_mailboxes: set[str]) -> bool:
    keywords = email.get("keywords") or {}
    if keywords.get("$draft") or get_category(keywords):
        return False

    return skipped_mailboxes.isdisjoint(id for id, held in (email.get("mailboxIds") or {}).items() if held)
