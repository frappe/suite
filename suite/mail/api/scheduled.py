# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""The Outbox: JMAP EmailSubmission objects, browsed and acted on directly.

The server's submissions are the source of truth: the listing browses all of them — held
(FUTURERELEASE), in flight, and concluded — through EmailSubmission/query with the RFC 8621
§7.3 filters (undoStatus, identity, email, thread, and a sendAt window), newest sends first.
Emails submitted by other clients appear too, and the Mail Queue is neither read nor written
here — its rows only log what this app submitted, as it was submitted. Every action is keyed
on the EmailSubmission id. Since undoStatus is a submission's only mutable property
(RFC 8621 §7.5), reschedule and send-now cancel the held submission and create a replacement.

Where the delivery actually stands is computed per recipient from the submission's
deliveryStatus — delivered (queued/yes/no/unknown), displayed (unknown/yes, a read receipt),
and the raw smtpReply — refined, while the message is still in the MTA queue, by Stalwart's
management queue API, correlated through the ENVID this app writes into every envelope. The
queue side contributes what JMAP cannot: retry counts, the next retry time, the last error of
a temporarily failing delivery, and whether "queued" means a first attempt or a retry wait. It is read
best-effort with the admin connection, exposing only messages matching the account's own
submissions; without it rows just lack the retry detail.

The referenced Email may have been deleted after scheduling (EmailSubmission/get then returns a
dangling emailId): such a delivery can still be cancelled — there is just no message to move
back to Drafts — but not resubmitted, so the resubmitting actions refuse it. Held releases that
failed (permanently or between retries) stay on the listing so the user learns the send never
landed — until they are retried or dismissed, or the server expunges the submission record
(how long finalized submissions are kept is the server's policy alone); the same goes for
every other concluded row.
"""

import re
from datetime import UTC, datetime
from uuid import uuid7

import frappe
from frappe import _
from frappe.utils import (
    cint,
    get_datetime,
    get_datetime_str,
    now,
    now_datetime,
    time_diff_in_seconds,
)

from suite.mail.jmap import (
    get_email_service,
    get_email_submission_service,
    get_jmap_set_error_message,
    get_mailbox_id_by_role,
)
from suite.mail.jmap.services.mail.submission.email_submission import EmailSubmissionService
from suite.mail.utils import log_mail_error
from suite.mail.utils.dt import UTC_DATETIME_FORMAT, from_utc_z, normalize_utc_z, to_utc_z

SUBMISSION_PROPERTIES = ["id", "emailId", "threadId", "undoStatus", "sendAt", "envelope"]
DETAIL_PROPERTIES = [*SUBMISSION_PROPERTIES, "deliveryStatus", "identityId", "dsnBlobIds", "mdnBlobIds"]
EMAIL_SUMMARY_PROPERTIES = ["id", "threadId", "subject", "from", "to", "cc", "bcc"]


UNDO_STATUSES = ("pending", "final", "canceled")

# RFC 8620 §1.2: a JMAP Id is 1 to 255 characters of [A-Za-z0-9_-].
JMAP_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,255}\Z")


@frappe.whitelist()
def get_submissions(
    account: str,
    undo_status: str | None = None,
    identity_id: str | None = None,
    email_id: str | None = None,
    thread_id: str | None = None,
    before: str | None = None,
    after: str | None = None,
    page: int = 1,
    page_length: int = 50,
) -> dict:
    """Browses one page of the account's EmailSubmission objects, newest sendAt first —
    returned as {"rows", "total"} so the listing can paginate past the server's single-query
    cap (maxObjectsInGet).

    The filters are the RFC 8621 §7.3 FilterCondition properties: `undo_status` is one of
    pending/final/canceled, `before`/`after` bound sendAt (UTC `...Z` timestamps)."""

    _validate_jmap_id(account, "account")
    _validate_jmap_id(identity_id, "identity_id")
    _validate_jmap_id(email_id, "email_id")
    _validate_jmap_id(thread_id, "thread_id")

    if undo_status and undo_status not in UNDO_STATUSES:
        frappe.throw(_("undoStatus must be one of {0}.").format(", ".join(UNDO_STATUSES)))

    before = _validate_utc_z(before, "before")
    after = _validate_utc_z(after, "after")

    page = max(cint(page), 1)
    page_length = min(max(cint(page_length), 1), 100)

    filter = {
        "undoStatus": undo_status,
        "identityIds": [identity_id] if identity_id else None,
        "emailIds": [email_id] if email_id else None,
        "threadIds": [thread_id] if thread_id else None,
        "before": before,
        "after": after,
    }
    filter = {key: value for key, value in filter.items() if value}

    service = get_email_submission_service(account)
    ids, total = service.query(
        filter or None,
        position=(page - 1) * page_length,
        limit=page_length,
        sort=[{"property": "sentAt", "isAscending": False}],
    )
    if not ids:
        return {"rows": [], "total": total}

    fetched = service.get(ids, properties=[*SUBMISSION_PROPERTIES, "deliveryStatus"])
    queue_by_envid = _queue_messages_by_envid(fetched)

    # The query's order (sentAt desc) is the listing's order; get() does not guarantee it.
    submissions_by_id = {s["id"]: s for s in fetched}
    rows = [
        _serialize_submission(submission, None, queue_by_envid.get(_envid(submission)))
        for id in ids
        if (submission := submissions_by_id.get(id))
    ]

    email_ids = list(dict.fromkeys(row["email_id"] for row in rows if row["email_id"]))
    emails_by_id = {
        e["id"]: e
        for e in (
            get_email_service(account).get(email_ids, properties=EMAIL_SUMMARY_PROPERTIES)
            if email_ids
            else []
        )
    }
    for row in rows:
        _add_email_fields(row, emails_by_id.get(row["email_id"]))

    return {"rows": rows, "total": total}


@frappe.whitelist()
def get_scheduled_mail(account: str, id: str) -> dict:
    """Returns one submission with everything EmailSubmission/get knows about it, enriched with
    the referenced Email's summary and the MTA queue's live delivery state."""

    _validate_jmap_id(account, "account")
    _validate_jmap_id(id, "id")

    service = get_email_submission_service(account)
    submissions = service.get([id], properties=DETAIL_PROPERTIES)
    if not submissions:
        frappe.throw(_("This submission no longer exists."))

    submission = submissions[0]
    queue_message = _queue_messages_by_envid([submission]).get(_envid(submission))

    row = _serialize_submission(submission, None, queue_message)
    email_id = submission.get("emailId")
    emails = (
        get_email_service(account).get([email_id], properties=EMAIL_SUMMARY_PROPERTIES) if email_id else []
    )
    _add_email_fields(row, emails[0] if emails else None)

    envelope = submission.get("envelope") or {}
    mail_from = envelope.get("mailFrom") or {}
    row.update(
        {
            "identity_email": _identity_email(service, submission.get("identityId")),
            "envelope_from": mail_from.get("email"),
            "envelope_recipients": [r.get("email") for r in envelope.get("rcptTo") or []],
            "priority": cint((mail_from.get("parameters") or {}).get("MT-PRIORITY")),
            "next_retry": normalize_utc_z((queue_message or {}).get("nextRetry")),
            "dsn_count": len(submission.get("dsnBlobIds") or []),
            "mdn_count": len(submission.get("mdnBlobIds") or []),
        }
    )
    return row


@frappe.whitelist()
def reschedule_mail(account: str, id: str, send_at: str) -> dict:
    """Moves a held submission's delivery time. `send_at` is UTC `...Z`."""

    _validate_jmap_id(account, "account")
    _validate_jmap_id(id, "id")

    service = get_email_submission_service(account)
    submission = _get_pending_submission(service, id)
    send_at = _validate_send_at(service, from_utc_z(send_at))

    created = _replace_submission(account, service, submission, hold_until=_hold_until(send_at))

    return {"id": created["id"], "send_at": to_utc_z(send_at)}


@frappe.whitelist()
def send_scheduled_mail_now(account: str, id: str) -> dict:
    """Delivers a held submission immediately."""

    _validate_jmap_id(account, "account")
    _validate_jmap_id(id, "id")

    service = get_email_submission_service(account)
    submission = _get_pending_submission(service, id)

    created = _replace_submission(account, service, submission, hold_until=None)

    return {"id": created["id"], "thread_id": submission.get("threadId")}


@frappe.whitelist()
def cancel_scheduled_mail(account: str, id: str) -> dict:
    """Cancels a held submission's delivery and moves the message back to Drafts."""

    _validate_jmap_id(account, "account")
    _validate_jmap_id(id, "id")

    service = get_email_submission_service(account)
    submission = _get_submission(service, id)

    undo_status = submission.get("undoStatus")
    if undo_status == "pending":
        service.cancel(id)
    elif undo_status != "canceled":
        frappe.throw(_("This email has already been delivered and can no longer be changed."))
    # Already canceled (e.g. a retried undo whose move below failed): skip straight to the move.

    email_id = _move_email_to_drafts(account, submission.get("emailId"))

    return {"id": email_id}


@frappe.whitelist()
def retry_failed_mail(account: str, id: str) -> dict:
    """Resubmits a finalized submission's email for immediate delivery, replacing the failed
    record so the listing shows only the live attempt."""

    _validate_jmap_id(account, "account")
    _validate_jmap_id(id, "id")

    service = get_email_submission_service(account)
    submission = _get_final_submission(service, id)

    created = service.resubmit(
        **_resubmit_args(account, submission), envelope_id=str(uuid7()), hold_until=None
    )
    service.destroy(id)

    return {"id": created["id"]}


@frappe.whitelist()
def dismiss_failed_mail(account: str, id: str) -> None:
    """Drops a finalized submission's record from the Outbox listing."""

    _validate_jmap_id(account, "account")
    _validate_jmap_id(id, "id")

    service = get_email_submission_service(account)
    _get_final_submission(service, id)
    service.destroy(id)


# --- delivery state ------------------------------------------------------------------------------

# Recipient/overall statuses, worst first. "queued" is a released delivery the MTA has not
# concluded yet (first attempt or between retries); "sent" is relayed with no confirmation;
# "displayed" means a read receipt (MDN) arrived — the furthest a delivery can get.
STATUS_SEVERITY = ("failed", "retrying", "queued", "scheduled", "cancelled", "sent", "delivered", "displayed")
PROBLEM_STATUSES = ("failed", "retrying", "queued")


def _serialize_submission(submission: dict, email: dict | None, queue_message: dict | None) -> dict:
    """One Outbox row: the submission itself plus its merged delivery state."""

    recipients_status = _recipient_states(submission, queue_message)
    retries = [r["retries"] for r in recipients_status if r["retries"] is not None]

    row = {
        "id": submission["id"],
        "email_id": submission.get("emailId"),
        "thread_id": submission.get("threadId"),
        "send_at": submission.get("sendAt"),
        # A released delivery can be cancelled for as long as it is pending; the actions
        # offered for a retrying row depend on this, not on the display status.
        "undo_status": submission.get("undoStatus"),
        "status": _overall_status(submission, recipients_status),
        "retries": max(retries) if retries else None,
        "recipients_status": recipients_status,
        "delivery_errors": [
            {"email": r["email"], "reason": r["reason"]}
            for r in recipients_status
            if r["status"] in PROBLEM_STATUSES and r["reason"]
        ],
    }
    _add_email_fields(row, email)
    return row


def _add_email_fields(row: dict, email: dict | None) -> None:
    """Fills a row's display fields from the referenced Email; when it was deleted after
    scheduling, the envelope recipients already collected in recipients_status remain."""

    if email:
        recipients = [
            {"type": rcpt_type, "email": a.get("email"), "display_name": a.get("name")}
            for rcpt_type in ("To", "Cc", "Bcc")
            for a in email.get(rcpt_type.lower()) or []
        ]
    else:
        recipients = [
            {"type": "To", "email": r["email"], "display_name": None} for r in row["recipients_status"]
        ]

    sender = (email.get("from") or [{}])[0] if email else {}
    row.update(
        {
            "thread_id": (email or {}).get("threadId") or row.get("thread_id"),
            "subject": (email or {}).get("subject"),
            "from_name": sender.get("name"),
            "from_email": sender.get("email"),
            "recipients": recipients,
            "email_deleted": email is None,
        }
    )


def _recipient_states(submission: dict, queue_message: dict | None) -> list[dict]:
    """Merges deliveryStatus and MTA-queue state into one row per recipient."""

    delivery = submission.get("deliveryStatus") or {}
    queue_recipients = (queue_message or {}).get("recipients") or {}
    envelope_emails = [r.get("email") for r in (submission.get("envelope") or {}).get("rcptTo") or []]

    emails = list(dict.fromkeys([*envelope_emails, *delivery, *queue_recipients]))
    held = _hold_active(submission)

    states = []
    for email in emails:
        status = delivery.get(email) or {}
        queued = queue_recipients.get(email) or {}
        queue_status = queued.get("status") or {}

        states.append(
            {
                "email": email,
                "status": _recipient_status(
                    held, status, queue_status.get("@type"), queued.get("retryCount")
                ),
                "reason": queue_status.get("errorMessage")
                or queue_status.get("responseMessage")
                or status.get("smtpReply"),
                # The raw DeliveryStatus, so the details page can show the exact server state.
                "smtp_reply": status.get("smtpReply"),
                "delivered": status.get("delivered"),
                "displayed": status.get("displayed"),
                "retries": queued.get("retryCount"),
                "next_retry": normalize_utc_z(queued.get("retryDue")),
            }
        )

    return states


def _recipient_status(
    held: bool, delivery: dict, queue_status: str | None, retry_count: int | None = 0
) -> str:
    """One recipient's latest place in the lifecycle, computed from the submission's
    DeliveryStatus (delivered: queued/yes/no/unknown, displayed: unknown/yes). The MTA
    queue's live state only refines what "queued" currently means — a first attempt in
    flight or a failed one waiting to retry."""

    if held:
        return "scheduled"

    if delivery.get("displayed") == "yes":
        return "displayed"  # a read receipt (MDN) arrived — implies delivery

    delivered = delivery.get("delivered")
    if delivered == "no":
        return "failed"
    if delivered == "yes":
        return "delivered"
    if delivered == "queued" or (delivered is None and queue_status):
        return "retrying" if queue_status == "TemporaryFailure" or cint(retry_count) else "queued"
    return "sent"  # "unknown": relayed with no delivery confirmation


def _overall_status(submission: dict, recipients_status: list[dict]) -> str:
    """The submission's single-word state: the worst of its recipients' states."""

    if submission.get("undoStatus") == "canceled":
        return "cancelled"
    if _hold_active(submission):
        return "scheduled"

    statuses = {r["status"] for r in recipients_status}
    return next((s for s in STATUS_SEVERITY if s in statuses), "sent")


def _hold_active(submission: dict) -> bool:
    """Whether the FUTURERELEASE hold is still in effect — pending with sendAt in the future.

    Stalwart keeps undoStatus "pending" for as long as a released message can still be pulled
    back from the queue, so pending alone does not mean scheduled: a release mid-retry is
    pending too, and must show its real delivery state.
    """

    if submission.get("undoStatus") != "pending":
        return False

    send_at = submission.get("sendAt")
    if not send_at:
        return False

    return datetime.fromisoformat(send_at.replace("Z", "+00:00")) > datetime.now(UTC)


def _envid(submission: dict) -> str | None:
    """The submission envelope's ENVID — the key that ties it to its MTA queue message."""

    parameters = ((submission.get("envelope") or {}).get("mailFrom") or {}).get("parameters") or {}
    return parameters.get("ENVID")


def _queue_messages_by_envid(submissions: list[dict]) -> dict[str, dict]:
    """The MTA queue messages behind the given submissions, keyed by ENVID.

    The outbound queue lives on the shared cluster and is not exposed to sites, so this is
    always empty: rows simply lack retry counts and live queue state.
    """

    return {}


def _identity_email(service: EmailSubmissionService, identity_id: str | None) -> str | None:
    """The sending identity's email address, when the id still resolves."""

    if not identity_id:
        return None

    return next((i.get("email") for i in service.identities if i.get("id") == identity_id), None)


# --- submission plumbing -------------------------------------------------------------------------


def _get_submission(service: EmailSubmissionService, id: str) -> dict:
    submissions = service.get([id], properties=SUBMISSION_PROPERTIES)
    if not submissions:
        frappe.throw(_("This scheduled email no longer exists."))

    return submissions[0]


def _get_pending_submission(service: EmailSubmissionService, id: str) -> dict:
    submission = _get_submission(service, id)

    undo_status = submission.get("undoStatus")
    if undo_status == "canceled":
        frappe.throw(_("This scheduled delivery has been cancelled."))
    if undo_status != "pending":
        frappe.throw(_("This email has already been delivered and can no longer be changed."))

    return submission


def _get_final_submission(service: EmailSubmissionService, id: str) -> dict:
    """A submission the server is done with — what the retry and dismiss actions operate on."""

    submission = _get_submission(service, id)
    if submission.get("undoStatus") == "pending":
        frappe.throw(_("This delivery is still pending — cancel or reschedule it instead."))

    return submission


def _validate_jmap_id(value: str | None, label: str) -> str | None:
    """A client-supplied JMAP identifier: RFC 8620 §1.2 confines an Id to 1 to 255 characters of
    [A-Za-z0-9_-], so anything else is refused before it reaches a JMAP operation. Empty
    optional filters pass through (they are dropped, not forwarded)."""

    if not value:
        return None

    if not JMAP_ID_PATTERN.fullmatch(value):
        frappe.throw(_("{0} is not a valid JMAP identifier.").format(label))

    return value


def _validate_utc_z(value: str | None, label: str) -> str | None:
    """A client-supplied sendAt bound: anything but an ISO timestamp is refused, and a valid
    one is re-serialized to the canonical UTC ``...Z`` form — the only shape that ever reaches
    the JMAP filter."""

    if not value:
        return None

    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        frappe.throw(_("{0} must be a UTC timestamp like 2026-01-31T09:30:00Z.").format(label))

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)

    return dt.astimezone(UTC).strftime(UTC_DATETIME_FORMAT)


def _validate_send_at(service: EmailSubmissionService, send_at: str) -> str:
    """Validates a new delivery time (system-time string) against the FUTURERELEASE window."""

    send_at = get_datetime_str(get_datetime(send_at))
    if get_datetime(send_at) <= now_datetime():
        frappe.throw(_("Send At must be in the future."))

    max_delay = service.max_delayed_send
    if time_diff_in_seconds(send_at, now()) > max_delay:
        frappe.throw(_("Send At cannot be more than {0} days in the future.").format(max_delay // 86400))

    return send_at


def _hold_until(send_at: str) -> int:
    """The RFC 4865 HOLDUNTIL value (epoch seconds) for a system-time `send_at` string."""

    from suite.utils.dt import convert_to_utc

    return int(convert_to_utc(get_datetime(send_at)).timestamp())


def _resubmit_args(account: str, submission: dict) -> dict:
    """The resubmit() arguments recoverable from a submission; throws when its Email is gone
    (a message that no longer exists cannot be resubmitted)."""

    email_id = submission.get("emailId")
    emails = (
        get_email_service(account).get([email_id], properties=["from", "to", "cc", "bcc"]) if email_id else []
    )
    if not emails:
        frappe.throw(_("The original message no longer exists, so it cannot be resubmitted."))

    from_email, rcpt_emails, priority = _envelope_args(submission, emails[0])
    return {
        "email_id": email_id,
        "from_email": from_email,
        "rcpt_emails": rcpt_emails,
        "priority": priority,
    }


def _replace_submission(
    account: str, service: EmailSubmissionService, submission: dict, hold_until: int | None
) -> dict:
    """Cancels the held submission and creates its replacement (reschedule / send-now)."""

    args = _resubmit_args(account, submission)

    service.cancel(submission["id"])
    try:
        return service.resubmit(**args, envelope_id=str(uuid7()), hold_until=hold_until)
    except Exception:
        # The old submission is already canceled: fail closed as a cancellation, so the
        # message lands back in Drafts instead of sitting in Sent never sending.
        log_mail_error(_("Failed to resubmit scheduled email"), frappe.get_traceback(with_context=True))
        _move_email_to_drafts(account, args["email_id"])
        frappe.throw(
            _(
                "The email could not be resubmitted; its delivery was cancelled and the message "
                "moved back to Drafts."
            )
        )


def _envelope_args(submission: dict, email: dict) -> tuple[str, list[str], int]:
    """SMTP sender, recipients, and MT-Priority for a replacement submission.

    The stored envelope is preferred — it repeats exactly what the server accepted before.
    Submissions created without one (the server derived it from the message) fall back to the
    Email's headers.
    """

    if envelope := submission.get("envelope"):
        mail_from = envelope.get("mailFrom") or {}
        parameters = mail_from.get("parameters") or {}
        rcpt_emails = [r["email"] for r in envelope.get("rcptTo") or []]
        return mail_from["email"], rcpt_emails, cint(parameters.get("MT-PRIORITY"))

    rcpt_emails = [a["email"] for key in ("to", "cc", "bcc") for a in email.get(key) or []]
    return email["from"][0]["email"], rcpt_emails, 0


def _move_email_to_drafts(account: str, email_id: str | None) -> str | None:
    """Returns a cancelled delivery's message to Drafts; a message deleted after scheduling
    (or a submission with no emailId) has nothing to move."""

    from suite.mail.doctype.mail_message.mail_message import _remove_cached_messages

    if not email_id:
        return None

    email_service = get_email_service(account)
    emails = email_service.get([email_id], properties=["mailboxIds"])
    if not emails:
        return None

    drafts_mailbox_id = get_mailbox_id_by_role(
        account, "drafts", create_if_not_exists=True, raise_exception=True
    )

    # Replace (not patch) mailboxIds so the message leaves Sent; restore $draft.
    result = email_service.update(
        [{"id": email_id, "mailbox_ids": {drafts_mailbox_id: True}, "keywords": {"$draft": True}}],
        replace_mailboxes=True,
    )
    if email_id not in result["updated"]:
        # The submission is already canceled; retrying this action skips the cancel
        # step (undoStatus is "canceled") and reattempts the move.
        frappe.throw(get_jmap_set_error_message(result, "notUpdated", email_id))

    # Evict the cached copy — it still carries the Sent mailbox and would show a
    # stale folder label in Drafts until the next sync.
    _remove_cached_messages(account, [email_id])

    # Refresh the open mailbox views (both the folder it left and the one it landed in). The
    # composer that raised the undo toast is unmounted by the time Undo runs, so the refresh
    # rides the same realtime event the message actions use.
    previous_mailbox_ids = list(emails[0].get("mailboxIds") or {})
    frappe.publish_realtime(
        "new_mail_created", list({drafts_mailbox_id, *previous_mailbox_ids}), user=frappe.session.user
    )

    return email_id
