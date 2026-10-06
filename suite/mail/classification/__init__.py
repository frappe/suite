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
from jmap import MethodError
from jmap.batch import ReadOnlyAccountError

from suite.mail.classification.category import Category, get_category
from suite.mail.classification.headers import classify_by_headers
from suite.mail.jmap import SetResult, SuiteJMAPClient, chunked_set
from suite.mail.utils import get_config, log_mail_error

__all__ = [
    "EMAIL_PROPERTIES",
    "Category",
    "classify",
    "classify_emails",
    "get_category",
    "is_enabled",
    "take_echoes",
]

# What the layers read of an Email beyond what a message is fetched with anyway.
EMAIL_PROPERTIES = ["headers"]

LAYERS: tuple[Callable[[dict], Category | None], ...] = (classify_by_headers,)

# Mail the user wrote has no category, and mail thrown out or held as spam is not worth giving
# one: moved back to the inbox it is fetched afresh, and classified then.
UNCLASSIFIED_ROLES = frozenset({"sent", "drafts", "junk", "trash"})

# How long a category written to the server is waited for to come back as a change. One that
# outlasts this is treated like any other update, at the cost of fetching the message again.
ECHO_TTL = 60 * 60


# The method errors that say the server could not make a change just now, where every other says
# it will not (RFC 8620 §3.6.2). Only the first kind is worth asking again.
PASSING_ERRORS = frozenset({"serverFail", "serverUnavailable", "serverPartialFail"})


def is_enabled() -> bool:
    """Whether Mail Settings has incoming mail classified."""

    return bool(get_config("enable_email_classification"))


def classify(email: dict) -> Category:
    """The category of `email`, an Email in JMAP wire form."""

    for layer in LAYERS:
        if category := layer(email):
            return category

    return Category.PRIMARY


def classify_emails(
    client: SuiteJMAPClient, account: str, emails: list[dict], mailboxes: list[dict]
) -> set[str]:
    """Give a category to each of `emails` that has none, on the server and in place.

    `emails` are as fetched - wire form, with `EMAIL_PROPERTIES` among their properties - and
    `mailboxes` the account's. An email gains its category keyword here only once the server has
    taken it, so what is cached afterwards says what the server holds: where the write is refused
    (a shared account the user may only read) the mail stays unclassified, and where it fails
    part-way the mail written before the failure does not.

    Returns the ids of the emails still owed a category: those whose write failed in a way that
    may pass, such as the server being out of reach. An email the server refused is not among
    them, and nor is one that gets no category - asking again would be answered the same.

    Never raises. Classification is a nicety on the way to showing mail, not a reason to fail it.
    """

    try:
        skipped = {m["id"] for m in mailboxes if (m.get("role") or "").lower() in UNCLASSIFIED_ROLES}
        categories = {email["id"]: classify(email) for email in emails if _awaits_category(email, skipped)}
        if not categories:
            return set()

        # Before the write, not after: its echo can reach a worker before this request resumes.
        _expect_echoes(account, list(categories))

        owed: set[str] = set()
        try:
            written = chunked_set(
                client,
                lambda b, chunk: b.mail.email.set(update=chunk),
                {id: {f"keywords/{category.keyword}": True} for id, category in categories.items()},
            ).updated
        except ReadOnlyAccountError:
            return set()
        except Exception as error:
            # A write goes out in chunks, and the ones before the chunk that failed stay written:
            # chunked_set hands their outcome over with the error.
            applied: SetResult = getattr(error, "applied", None) or SetResult()
            written = applied.updated
            if not _is_refusal(error):
                owed = set(categories) - set(written) - set(applied.not_updated)
            log_mail_error(_("Failed to classify emails"), frappe.get_traceback(with_context=True))

        for email in emails:
            if email["id"] in written:
                email["keywords"] = {**(email.get("keywords") or {}), categories[email["id"]].keyword: True}

        return owed
    except Exception:
        log_mail_error(_("Failed to classify emails"), frappe.get_traceback(with_context=True))
        return set()


def _is_refusal(error: Exception) -> bool:
    """Whether `error`, raised by the write of a category, is the server declining to make it."""

    return isinstance(error, MethodError) and error.type not in PASSING_ERRORS


def _awaits_category(email: dict, skipped_mailboxes: set[str]) -> bool:
    keywords = email.get("keywords") or {}
    if keywords.get("$draft") or get_category(keywords):
        return False

    return skipped_mailboxes.isdisjoint(id for id, held in (email.get("mailboxIds") or {}).items() if held)


def _echo_key(account: str) -> str:
    return f"mail:classification:echo:{account}"


def _expect_echoes(account: str, ids: list[str]) -> None:
    """Note that `ids` are about to be given a category, a change the server will report back."""

    frappe.cache.sadd(_echo_key(account), *ids)
    frappe.cache.expire_key(_echo_key(account), ECHO_TTL)


def take_echoes(account: str, ids: list[str]) -> set[str]:
    """Which of `ids`, reported changed by the server, this site gave a category and has not
    heard back about. Each is forgotten as it is taken: a later change to it is someone else's."""

    expected = {frappe.safe_decode(id) for id in frappe.cache.smembers(_echo_key(account))}
    echoes = expected.intersection(ids)
    if echoes:
        frappe.cache.srem(_echo_key(account), *echoes)

    return echoes
