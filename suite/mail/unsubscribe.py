# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Unsubscribing from a sender's list, as a message's List-Unsubscribe header offers it (RFC 2369),
one click where the sender allows it (RFC 8058). Decided in the mail-ux ticket 033.

Only mail carrying the header offers it, and never mail in Junk: unsubscribing tells the sender the
address is read, which is the last thing to tell a spammer. Where a sender offers several ways, the
surest goes: one click, POSTed from this server, never the browser; then a mail to the list's
address, from the address the message came to and kept nowhere (a request to a machine, not mail
the person wrote); then the sender's page, which the person opens and does themselves. Mail already
received stays where it is. A message unsubscribed from carries `$unsubscribed` (RFC 9979).

The hold for Undo is the client's, as for a permanent delete (see commitAfterUndo): by the time a
request reaches `unsubscribe` it is meant.
"""

from typing import Literal, TypedDict
from urllib.parse import parse_qs, unquote, urlparse

import frappe
from frappe import _

from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.jmap import chunked_get, get_account_client, get_mailbox_id_by_role
from suite.mail.utils import log_mail_error
from suite.mail.utils.user import get_account_emails
from suite.suite_core.public_http import request_public

UNSUBSCRIBED = "$unsubscribed"
ONE_CLICK_BODY = b"List-Unsubscribe=One-Click"
HEADERS = ["header:List-Unsubscribe:asURLs", "header:List-Unsubscribe-Post:asText"]


class Option(TypedDict):
    """How a message can be unsubscribed from: `one_click` an https URL taking the RFC 8058 POST,
    `mailto` an address to write to, `link` a page to open. `unsubscribed` once it has been."""

    one_click: str | None
    mailto: str | None
    link: str | None
    unsubscribed: bool


# `already`: the message was unsubscribed from before, and nothing was sent again — a request held
# for Undo can be sent twice when a page closes after sending it but before forgetting it.
Via = Literal["one_click", "mailto", "already"]


class UnsubscribeFailed(frappe.ValidationError):
    """The sender's server refused the request or didn't answer; nothing is marked."""


def options(account: str, ids: list[str]) -> dict[str, Option]:
    """How each of the given messages can be unsubscribed from, keyed by id. A message offering no
    way, or lying in Junk, has no entry. Reads only."""

    _check_owner(account)
    if not ids:
        return {}
    junk = get_mailbox_id_by_role(account, "junk")
    return {
        email["id"]: option
        for email in _read(account, list(dict.fromkeys(ids)), ["keywords", "mailboxIds"])
        if not _is_junk(email, junk) and (option := _option(email))
    }


def unsubscribe(account: str, id: str) -> Via:
    """Unsubscribes from the list the message came from, by one click or by mail, and marks it
    `$unsubscribed`. Returns which way went. A sender offering only a page has nothing to do here
    (the person opens it); one offering nothing, or a message in Junk, is refused. Raises
    UnsubscribeFailed when the sender's server refuses or doesn't answer."""

    _check_owner(account)
    emails = _read(account, [id], ["keywords", "mailboxIds", "to", "cc"])
    email = emails[0] if emails else None
    if not email or _is_junk(email, get_mailbox_id_by_role(account, "junk")):
        raise frappe.ValidationError(_("This mail can't be unsubscribed from."))
    option = _option(email)
    if not option or not (option["one_click"] or option["mailto"]):
        raise frappe.ValidationError(_("This mail can't be unsubscribed from here."))
    if option["unsubscribed"]:
        return "already"

    via: Via
    if option["one_click"]:
        _post_one_click(option["one_click"])
        via = "one_click"
    else:
        _write_to(account, option["mailto"] or "", _addressed_to(account, email))
        via = "mailto"

    # Sent by now: a mark that fails to save is logged, not reported as a failed unsubscribe.
    _mark_unsubscribed(account, id)
    return via


def _check_owner(account: str) -> None:
    get_user_for_jmap_account(account, allow_system_manager=False, raise_exception=True)


def _read(account: str, ids: list[str], properties: list[str]) -> list[dict]:
    client = get_account_client(account)
    return [
        email.to_wire()
        for email in chunked_get(
            client,
            lambda b, chunk: b.mail.email.get(ids=chunk, properties=["id", *HEADERS, *properties]),
            ids,
        )
    ]


def _is_junk(email: dict, junk: str | None) -> bool:
    return bool((email.get("keywords") or {}).get("$junk")) or bool(
        junk and junk in (email.get("mailboxIds") or {})
    )


def _option(email: dict) -> Option | None:
    urls = [url for url in (email.get(HEADERS[0]) or []) if url]
    if not urls:
        return None
    post = (email.get(HEADERS[1]) or "").strip().lower()
    https = next((url for url in urls if url.lower().startswith("https://")), None)
    return {
        # RFC 8058: one click only by https, and only where the sender says the POST will do.
        "one_click": https if https and post == "list-unsubscribe=one-click" else None,
        "mailto": next((url for url in urls if url.lower().startswith("mailto:")), None),
        "link": https or next((url for url in urls if url.lower().startswith("http://")), None),
        "unsubscribed": bool((email.get("keywords") or {}).get(UNSUBSCRIBED)),
    }


def _post_one_click(url: str) -> None:
    # RFC 8058: a POST with the one-click body and nothing that says who is asking — no cookies, no
    # credentials. Redirects aren't followed; a sender that answers with one has taken the request.
    try:
        response = request_public(
            "POST",
            url,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            body=ONE_CLICK_BODY,
            max_bytes=1024,
        )
    except Exception as error:
        log_mail_error(_("Failed to unsubscribe"), f"{url}: {error!r}")
        raise UnsubscribeFailed(_("Couldn't unsubscribe: the sender didn't answer.")) from error
    if response.status >= 400:
        log_mail_error(_("Failed to unsubscribe"), f"{url}: HTTP {response.status}")
        raise UnsubscribeFailed(_("Couldn't unsubscribe: the sender refused the request."))


def _addressed_to(account: str, email: dict) -> str:
    """The account's address the message came to, which is how the list knows whom to drop; the
    account's first address where the list wrote to it as someone else (a group, a Bcc)."""

    own = get_account_emails(account)
    lowered = {address.lower(): address for address in own}
    for recipient in (email.get("to") or []) + (email.get("cc") or []):
        if (address := (recipient.get("email") or "").lower()) in lowered:
            return lowered[address]
    if not own:
        frappe.throw(_("This account has no address to write from."))
    return own[0]


def _write_to(account: str, mailto: str, from_email: str) -> None:
    from suite.mail.doctype.mail_queue.mail_queue import MailQueue

    target = urlparse(mailto)
    address = unquote(target.path).strip()
    if not address or "@" not in address:
        raise UnsubscribeFailed(_("Couldn't unsubscribe: the sender's address is invalid."))
    query = parse_qs(target.query)
    # Submitted here and now rather than queued, so the mark below follows a request that went: one
    # queued could still fail in the worker, long after the person was told it was done.
    queued = MailQueue._create(
        user=get_user_for_jmap_account(account, raise_exception=True),
        account=account,
        from_email=from_email,
        recipients=[{"display_name": None, "email": address, "type": "To"}],
        subject=(query.get("subject") or ["unsubscribe"])[0],
        text_body=(query.get("body") or ["unsubscribe"])[0],
        via_api=True,
        delivery_mode="Immediate",
        # A request to a machine, not mail the person wrote: kept nowhere once sent.
        destroy_after_submit=True,
    )
    if frappe.db.get_value("Mail Queue", queued.name, "status") != "Submitted":
        raise UnsubscribeFailed(_("Couldn't unsubscribe: the request could not be sent."))


def _mark_unsubscribed(account: str, id: str) -> None:
    """Marks the message, all of it best-effort: the request has gone by now, and nothing here may
    turn a done unsubscribe into a failed one, inviting another."""

    # Imported here: mail_message imports a great deal.
    from suite.mail.doctype.mail_message.mail_message import _remove_cached_messages

    def uncache() -> None:
        try:
            _remove_cached_messages(account, [id])
        except Exception:
            log_mail_error(_("Failed to mark mail unsubscribed"), frappe.get_traceback(with_context=True))

    uncache()
    try:
        with get_account_client(account).batch() as b:
            marked = b.mail.email.set(update={id: {f"keywords/{UNSUBSCRIBED}": True}})
        if id not in marked.result.updated:
            log_mail_error(_("Failed to mark mail unsubscribed"), str(marked.result.not_updated))
    except Exception:
        log_mail_error(_("Failed to mark mail unsubscribed"), frappe.get_traceback(with_context=True))
    finally:
        uncache()
