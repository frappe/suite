# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Bounces: the delivery reports (RFC 3464) mailed back about mail an account sent.

Stalwart v0.16 never updates an EmailSubmission's deliveryStatus or dsnBlobIds after a delivery
fails, so the report that lands in the Inbox is the only record of the failure. A report names
the envelope it is about by its Original-Envelope-Id: the ENVID Suite gives every submission,
which is also the name of the Mail Queue row that sent it.

A bounce cannot join the sent message's thread: it carries no In-Reply-To or References, and the
server threads by subject as well, which a report never shares. It is linked instead, both ways:
a report names its sent message (`get_delivery_report`), and a submission finds its reports
(`get_reports`).
"""

from datetime import datetime, timedelta

import frappe
from frappe import _

from suite.mail.doctype.mail_message.mail_message import fetch_blobs, get_messages, query_message_ids
from suite.mail.utils.delivery_status import parse_bounce_reasons, parse_delivery_status
from suite.mail.utils.dt import to_utc_z

# The names MTAs send delivery reports under; a report comes from the null sender, and its From
# is one of these at the reporting host.
REPORTERS = ("mailer-daemon", "postmaster")

# How many of the newest bounces a lookup reads.
MAX_BOUNCES = 50

# A bounce can arrive in the very second its send is released, and the server's `after` filter is
# strict and counts whole seconds, so a lookup starts a little before the earliest send.
SEND_MARGIN = timedelta(minutes=1)


def dsn_blob_id(message: dict) -> str | None:
    """The blob id of a bounce's `message/delivery-status` part, if `message` carries one."""

    for attachment in message.get("attachments") or []:
        if (attachment.get("type") or "").lower() == "message/delivery-status" and attachment.get("blob_id"):
            return attachment["blob_id"]
    return None


def get_delivery_report(account: str, id: str) -> dict:
    """The delivery report bounce `id` carries, and the thread and submission of the sent message
    it is about, where this site sent it."""

    messages = get_messages(account, [id])
    blob_id = dsn_blob_id(messages[0]) if messages else None
    if not blob_id:
        frappe.throw(_("This message carries no delivery report."), frappe.DoesNotExistError)

    report = read_report(messages[0], fetch_blobs(account, [blob_id])[blob_id])
    sent = (
        frappe.db.get_value(
            "Mail Queue",
            {"name": report["original_envelope_id"], "account": account},
            ["thread_id", "submission_id"],
            as_dict=True,
        )
        if report["original_envelope_id"]
        else None
    )
    return {
        **report,
        "sent_thread_id": sent.thread_id if sent else None,
        "submission_id": sent.submission_id if sent else None,
    }


def get_reports(account: str, envelope_ids: list[str], sent_at: str) -> dict[str, list[dict]]:
    """The delivery reports on the envelopes `envelope_ids`, newest first per envelope, read off
    the bounces received since the earliest of them was sent, at `sent_at` (UTC `...Z`). Each
    report carries its bounce's thread_id."""

    wanted = {envid for envid in envelope_ids if envid}
    if not wanted:
        return {}

    filter = {
        "operator": "AND",
        "conditions": [
            {"after": to_utc_z(datetime.fromisoformat(sent_at.replace("Z", "+00:00")) - SEND_MARGIN)},
            {"operator": "OR", "conditions": [{"from": reporter} for reporter in REPORTERS]},
        ],
    }
    ids = query_message_ids(account, filter, limit=MAX_BOUNCES)["ids"]
    bounces = [
        (message, blob_id) for message in get_messages(account, ids) if (blob_id := dsn_blob_id(message))
    ]
    blobs = fetch_blobs(account, [blob_id for _message, blob_id in bounces]) if bounces else {}

    reports: dict[str, list[dict]] = {}
    for message, blob_id in bounces:
        report = read_report(message, blobs[blob_id])
        if report["original_envelope_id"] in wanted:
            reports.setdefault(report["original_envelope_id"], []).append(
                {**report, "thread_id": message["thread_id"]}
            )
    return reports


def read_report(message: dict, delivery_status: bytes) -> dict:
    """The report in a bounce's `delivery_status` part, each recipient given a `reason`: the
    server's Diagnostic-Code, or else what the bounce's text says about that recipient."""

    report = parse_delivery_status(delivery_status)
    reasons = parse_bounce_reasons(message.get("text_body") or "")
    for recipient in report["recipients"]:
        recipient["reason"] = recipient["diagnostic_code"] or reasons.get(recipient["email"].lower(), "")
    return report
