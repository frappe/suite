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

from collections.abc import Iterator
from contextlib import contextmanager, suppress
from datetime import UTC, datetime
from typing import Literal
from uuid import NAMESPACE_OID, uuid5, uuid7

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
from jmap import MethodError
from jmap.core.invocation import Handle
from jmap.models.responses import SetResponse
from pydantic import BaseModel, model_validator
from redis.exceptions import LockError

from suite.mail.jmap import (
    SuiteJMAPClient,
    build_submission_envelope,
    check_delayed_send,
    format_method_error,
    get_account_client,
    get_cached_identities,
    get_identity_id_by_email,
    get_mailbox_id_by_role,
    get_max_delayed_send,
    get_set_error_message,
    omit_none,
)
from suite.mail.utils import log_mail_error
from suite.mail.utils.dt import from_utc_z, normalize_utc_z, to_utc_z
from suite.mail.utils.validation import JMAPId, UtcZ
from suite.utils.validation import parse, without_blanks

SUBMISSION_PROPERTIES = ["id", "emailId", "threadId", "undoStatus", "sendAt", "envelope"]
DETAIL_PROPERTIES = [*SUBMISSION_PROPERTIES, "deliveryStatus", "identityId", "dsnBlobIds", "mdnBlobIds"]
EMAIL_SUMMARY_PROPERTIES = ["id", "threadId", "subject", "from", "to", "cc", "bcc"]

# Method errors that say the account (or the object) is not there — as opposed to a server
# that could not answer just now.
GONE_ERRORS = ("accountNotFound", "notFound")

# How a lookup reads a call the server refused: "empty" as nothing found whatever the error
# (a listing shows what it can), "gone" as nothing found only when the error says so, and
# "throw" never.
Refused = Literal["empty", "gone", "throw"]

# How long a retry waits for another retry of the same record to finish (seconds), and how long
# one may hold the record: past every request it makes timing out.
RETRY_LOCK_WAIT = 10
RETRY_LOCK_TIMEOUT = 600


class SubmissionFilter(BaseModel):
    """The listing's RFC 8621 §7.3 FilterCondition, from its query parameters. Empty ones are dropped."""

    undo_status: Literal["pending", "final", "canceled"] | None = None
    identity_id: JMAPId | None = None
    email_id: JMAPId | None = None
    thread_id: JMAPId | None = None
    before: UtcZ | None = None
    after: UtcZ | None = None

    @model_validator(mode="before")
    @classmethod
    def _blank_means_absent(cls, data):
        return without_blanks(data)

    def to_jmap(self) -> dict:
        filter = {
            "undoStatus": self.undo_status,
            "identityIds": [self.identity_id] if self.identity_id else None,
            "emailIds": [self.email_id] if self.email_id else None,
            "threadIds": [self.thread_id] if self.thread_id else None,
            "before": self.before,
            "after": self.after,
        }
        return {key: value for key, value in filter.items() if value}


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

    _validate_ids(account=account)
    filter = parse(
        SubmissionFilter,
        {
            "undo_status": undo_status,
            "identity_id": identity_id,
            "email_id": email_id,
            "thread_id": thread_id,
            "before": before,
            "after": after,
        },
    ).to_jmap()

    page = max(cint(page), 1)
    page_length = min(max(cint(page_length), 1), 100)

    client = get_account_client(account)
    ids, total = _query_submissions(
        client,
        filter or None,
        position=(page - 1) * page_length,
        limit=page_length,
        sort=[{"property": "sentAt", "isAscending": False}],
    )
    if not ids:
        return {"rows": [], "total": total}

    fetched = _get_submissions(client, ids, [*SUBMISSION_PROPERTIES, "deliveryStatus"], refused="empty")
    queue_by_envid = _queue_messages_by_envid(fetched)

    # The query's order (sentAt desc) is the listing's order; get() does not guarantee it.
    submissions_by_id = {s["id"]: s for s in fetched}
    rows = [
        _serialize_submission(submission, None, queue_by_envid.get(_envid(submission)))
        for id in ids
        if (submission := submissions_by_id.get(id))
    ]

    email_ids = list(dict.fromkeys(row["email_id"] for row in rows if row["email_id"]))
    emails = _get_emails(client, email_ids, EMAIL_SUMMARY_PROPERTIES, refused="empty")
    emails_by_id = {e["id"]: e for e in emails}
    for row in rows:
        _add_email_fields(row, emails_by_id.get(row["email_id"]))

    return {"rows": rows, "total": total}


@frappe.whitelist()
def get_scheduled_mail(account: str, id: str) -> dict:
    """Returns one submission with everything EmailSubmission/get knows about it, enriched with
    the referenced Email's summary and the MTA queue's live delivery state."""

    _validate_ids(account=account, id=id)

    client = get_account_client(account)
    submissions = _get_submissions(client, [id], DETAIL_PROPERTIES)
    if not submissions:
        frappe.throw(_("This submission no longer exists."))

    submission = submissions[0]
    queue_message = _queue_messages_by_envid([submission]).get(_envid(submission))

    row = _serialize_submission(submission, None, queue_message)
    emails = _get_emails(client, [submission.get("emailId")], EMAIL_SUMMARY_PROPERTIES)
    _add_email_fields(row, emails[0] if emails else None)

    envelope = submission.get("envelope") or {}
    mail_from = envelope.get("mailFrom") or {}
    row.update(
        {
            "identity_email": _identity_email(account, submission.get("identityId")),
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

    _validate_ids(account=account, id=id)

    client = get_account_client(account)
    submission = _get_pending_submission(client, id)
    send_at = _validate_send_at(client, account, from_utc_z(send_at))

    created = _replace_submission(client, account, submission, hold_until=_hold_until(send_at))

    return {"id": created["id"], "send_at": to_utc_z(send_at)}


@frappe.whitelist()
def send_scheduled_mail_now(account: str, id: str) -> dict:
    """Delivers a held submission immediately."""

    _validate_ids(account=account, id=id)

    client = get_account_client(account)
    submission = _get_pending_submission(client, id)

    created = _replace_submission(client, account, submission, hold_until=None)

    return {"id": created["id"], "thread_id": submission.get("threadId")}


@frappe.whitelist()
def cancel_scheduled_mail(account: str, id: str) -> dict:
    """Cancels a held submission's delivery and moves the message back to Drafts."""

    _validate_ids(account=account, id=id)

    client = get_account_client(account)
    submission = _get_submission(client, id)

    undo_status = submission.get("undoStatus")
    if undo_status == "pending":
        _cancel_submission(client, id)
    elif undo_status != "canceled":
        frappe.throw(_("This email has already been delivered and can no longer be changed."))
    # Already canceled (e.g. a retried undo whose move below failed): skip straight to the move.

    email_id = _move_email_to_drafts(client, account, submission.get("emailId"))

    return {"id": email_id}


@frappe.whitelist()
def retry_failed_mail(account: str, id: str) -> dict:
    """Resubmits a finalized submission's email for immediate delivery, replacing the failed
    record so the listing shows only the live attempt. A record that was already retried - by
    a retry that could not remove it - is only removed."""

    _validate_ids(account=account, id=id)

    client = get_account_client(account)
    with _retrying(account, id):
        submission = _get_final_submission(client, id)
        args = _resubmit_args(client, submission)

        if replacement := _replacement_of(client, submission):
            # Already retried: the email went out again as `replacement`, and only the removal
            # of this record failed. Sending it once more would send the email twice, so the
            # retry that is left to do is the removal.
            _drop_retried_record(client, id)
            return {"id": replacement["id"]}

        created = _resubmit(
            client, account, **args, envelope_id=_retry_envelope_id(submission), hold_until=None
        )
        _drop_retried_record(client, id)

    return {"id": created["id"]}


@frappe.whitelist()
def dismiss_failed_mail(account: str, id: str) -> None:
    """Drops a finalized submission's record from the Outbox listing."""

    _validate_ids(account=account, id=id)

    client = get_account_client(account)
    _get_final_submission(client, id)
    _destroy_submission(client, id)


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


def _identity_email(account: str, identity_id: str | None) -> str | None:
    """The sending identity's email address, when the id still resolves."""

    if not identity_id:
        return None

    try:
        identities = get_cached_identities(account)
    except MethodError:
        # The address is one detail of the row: a refused Identity/get must not cost the rest.
        return None

    return next((i.get("email") for i in identities if i.get("id") == identity_id), None)


# --- submission plumbing -------------------------------------------------------------------------


def _query_page(
    client: SuiteJMAPClient, filter: dict | None, position: int, limit: int, sort: list[dict] | None
) -> dict:
    """One raw EmailSubmission/query response body (ids, total, limit) — the single wire
    call behind `_query_submissions`, kept separate so the paging logic can be exercised
    against a fake server."""

    with client.batch() as b:
        h = b.submission.email_submission.query(
            position=position, limit=limit, calculate_total=True, **omit_none(filter=filter, sort=sort)
        )

    if h.error:
        # Only the listing queries: a refused query reads as an Outbox with nothing in it.
        return {"ids": [], "total": 0}

    return h.result.to_wire()


def _query_submissions(
    client: SuiteJMAPClient,
    filter: dict | None = None,
    position: int = 0,
    limit: int | None = None,
    sort: list[dict] | None = None,
) -> tuple[list[str], int]:
    """Returns one page of ids of submissions matching `filter` (e.g. {"undoStatus":
    "pending"}), in `sort` order (e.g. [{"property": "sentAt", "isAscending": False}]),
    plus the server's total match count.

    The page is filled across follow-up queries when the server enforces a lower limit
    than requested (it then echoes the limit it used, RFC 8620 §5.5) — otherwise a clamp
    below the page length would silently shrink the page and strand the rows behind it,
    since the pager advances in strides of the full page."""

    limit = limit or client.capabilities.limits.max_objects_in_get
    # One id past the page is a look-ahead: whether more matches exist is then known even
    # when the server's total is missing or zero-valued.
    target = limit + 1

    ids: list[str] = []
    total = None
    while len(ids) < target:
        remaining = target - len(ids)
        body = _query_page(client, filter, position + len(ids), remaining, sort)

        batch = (body.get("ids") or [])[:remaining]
        served_limit = min(int(body.get("limit") or remaining), remaining)
        if total is None and body.get("total") is not None:
            total = int(body["total"])

        ids.extend(batch)
        # A batch below the enforced limit is the end of the results; one that merely
        # filled a clamp is not — loop on for the rest of the page.
        if not batch or len(batch) < served_limit:
            break
        if total is not None and position + len(ids) >= total:
            break

    has_more = len(ids) > limit
    ids = ids[:limit]

    if total is None:
        # calculateTotal is requested, but RFC 8620 §5.5 lets a server omit total; the
        # floor then sits one past a full page, so the pager can still advance.
        total = position + len(ids) + (1 if has_more else 0)

    return ids, int(total)


def _get_submissions(
    client: SuiteJMAPClient, ids: list[str], properties: list[str], refused: Refused = "gone"
) -> list[dict]:
    with client.batch() as b:
        h = b.submission.email_submission.get(ids=ids, properties=properties)

    if h.error:
        return _refused_lookup(h.error, refused)

    return [s.to_wire() for s in h.result.items]


def _get_emails(
    client: SuiteJMAPClient, ids: list[str | None], properties: list[str], refused: Refused = "gone"
) -> list[dict]:
    if not (ids := [id for id in ids if id]):
        return []

    with client.batch() as b:
        h = b.mail.email.get(ids=ids, properties=properties)

    if h.error:
        return _refused_lookup(h.error, refused)

    return [e.to_wire() for e in h.result.items]


def _refused_lookup(error: MethodError, refused: Refused) -> list:
    """What a get the server refused reads as: nothing found where `refused` allows it — the
    caller then answers as it does for an object that no longer exists. Otherwise the server's
    reason is thrown: a server that is failing must not pass for a deletion."""

    if refused == "empty" or (refused == "gone" and error.type in GONE_ERRORS):
        return []

    frappe.throw(format_method_error(error))


def _cancel_submission(client: SuiteJMAPClient, submission_id: str) -> None:
    """Cancels a held (FUTURERELEASE) submission by setting its undoStatus to 'canceled' —
    the only mutable property per RFC 8621 §7.5."""

    with client.batch() as b:
        h = b.submission.email_submission.set(update={submission_id: {"undoStatus": "canceled"}})

    result = _set_result(h)
    if submission_id not in result.updated:
        raise ValueError(get_set_error_message(result, "update", submission_id))


def _destroy_submission(client: SuiteJMAPClient, submission_id: str) -> None:
    """Destroys a submission object (its record, not the message) — used to drop a finalized
    delivery from the Outbox listing."""

    with client.batch() as b:
        h = b.submission.email_submission.set(destroy=[submission_id])

    result = _set_result(h)
    if submission_id not in result.destroyed:
        raise ValueError(get_set_error_message(result, "destroy", submission_id))


def _resubmit(
    client: SuiteJMAPClient,
    account: str,
    email_id: str,
    from_email: str,
    rcpt_emails: list[str],
    envelope_id: str,
    priority: int = 0,
    hold_until: int | None = None,
) -> dict:
    """Creates a new submission for an already-stored email (reschedule / send-now: the old
    submission must be canceled first, since undoStatus is the only mutable property).

    Returns the created object; its echoed undoStatus is unreliable (Stalwart echoes "final"
    for held submissions) — use a get for the real state.
    """

    identity_id = get_identity_id_by_email(account, from_email, raise_exception=True)
    submit_ref = f"submit-{envelope_id}"

    with client.batch() as b:
        h = b.submission.email_submission.set(
            create={
                submit_ref: {
                    "identityId": identity_id,
                    "emailId": email_id,
                    "envelope": build_submission_envelope(
                        from_email, rcpt_emails, envelope_id, priority, hold_until
                    ),
                }
            }
        )

    result = _set_result(h)
    created = result.created.get(submit_ref)
    if not created:
        raise ValueError(get_set_error_message(result, "create", submit_ref))

    return created.to_wire()


def _drop_retried_record(client: SuiteJMAPClient, submission_id: str) -> None:
    """Removes the record a retry replaced. The email is already resubmitted: failing here
    would invite a second retry. A record that could not be removed stays on the listing, where
    retrying it again only comes back here (see _replacement_of)."""

    try:
        _destroy_submission(client, submission_id)
    except Exception:
        log_mail_error(
            _("Failed to remove the old record of a retried email"),
            frappe.get_traceback(with_context=True),
        )


@contextmanager
def _retrying(account: str, submission_id: str) -> Iterator[None]:
    """Holds the retry of one record to a single request at a time: looking for its replacement
    and creating one must not interleave with another request doing the same, or both find
    none and both send."""

    lock = frappe.cache.lock(
        f"mail-outbox-retry:{frappe.local.site}:{account}:{submission_id}", timeout=RETRY_LOCK_TIMEOUT
    )
    if not lock.acquire(blocking=True, blocking_timeout=RETRY_LOCK_WAIT):
        frappe.throw(_("This email is already being sent again."))

    try:
        yield
    finally:
        # A lock that ran out is no longer ours to release, and no reason to fail the retry.
        with suppress(LockError):
            lock.release()


def _retry_envelope_id(submission: dict) -> str:
    """The ENVID of the submission that a retry of `submission` creates. It is derived from the
    failed record's own, so that record's replacement can be told from every other submission
    of the same email - another client's, an older retry's."""

    retried = _envid(submission) or "|".join(
        str(submission.get(key) or "") for key in ("id", "emailId", "sendAt")
    )
    return str(uuid5(NAMESPACE_OID, f"suite.mail.outbox.retry:{retried}"))


def _replacement_of(client: SuiteJMAPClient, submission: dict) -> dict | None:
    """The submission a retry of `submission` already created, if the server holds one.

    Read from the server like everything else here. Not knowing is not "none" - a lookup the
    server refuses is thrown, since a retry sent on a guess is an email sent twice."""

    with client.batch() as b:
        h = b.submission.email_submission.query(filter={"emailIds": [submission["emailId"]]})
    if h.error:
        frappe.throw(format_method_error(h.error))

    ids = [str(id) for id in h.result.ids if str(id) != submission["id"]]
    if not ids:
        return None

    envelope_id = _retry_envelope_id(submission)
    others = _get_submissions(client, ids, SUBMISSION_PROPERTIES, refused="throw")
    return next((other for other in others if _envid(other) == envelope_id), None)


def _set_result(handle: Handle[SetResponse]) -> SetResponse:
    """An EmailSubmission/set's response. A set the server refused outright raises the same
    ValueError as one that refused the object, carrying the server's reason."""

    if handle.error:
        raise ValueError(format_method_error(handle.error))

    return handle.result


def _get_submission(client: SuiteJMAPClient, id: str) -> dict:
    submissions = _get_submissions(client, [id], SUBMISSION_PROPERTIES)
    if not submissions:
        frappe.throw(_("This scheduled email no longer exists."))

    return submissions[0]


def _get_pending_submission(client: SuiteJMAPClient, id: str) -> dict:
    submission = _get_submission(client, id)

    undo_status = submission.get("undoStatus")
    if undo_status == "canceled":
        frappe.throw(_("This scheduled delivery has been cancelled."))
    if undo_status != "pending":
        frappe.throw(_("This email has already been delivered and can no longer be changed."))

    return submission


def _get_final_submission(client: SuiteJMAPClient, id: str) -> dict:
    """A submission the server is done with — what the retry and dismiss actions operate on."""

    submission = _get_submission(client, id)
    if submission.get("undoStatus") == "pending":
        frappe.throw(_("This delivery is still pending — cancel or reschedule it instead."))

    return submission


def _validate_ids(**ids: str) -> None:
    """Refuses client-supplied JMAP identifiers, keyed by the parameter that carried them."""

    parse(dict[str, JMAPId], ids)


def _validate_send_at(client: SuiteJMAPClient, account: str, send_at: str) -> str:
    """Validates a new delivery time (system-time string) against the FUTURERELEASE window."""

    send_at = get_datetime_str(get_datetime(send_at))
    if get_datetime(send_at) <= now_datetime():
        frappe.throw(_("Send At must be in the future."))

    check_delayed_send(time_diff_in_seconds(send_at, now()), get_max_delayed_send(client, account))

    return send_at


def _hold_until(send_at: str) -> int:
    """The RFC 4865 HOLDUNTIL value (epoch seconds) for a system-time `send_at` string."""

    from suite.utils.dt import convert_to_utc

    return int(convert_to_utc(get_datetime(send_at)).timestamp())


def _resubmit_args(client: SuiteJMAPClient, submission: dict) -> dict:
    """The _resubmit() arguments recoverable from a submission; throws when its Email is gone
    (a message that no longer exists cannot be resubmitted)."""

    email_id = submission.get("emailId")
    emails = _get_emails(client, [email_id], ["from", "to", "cc", "bcc"])
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
    client: SuiteJMAPClient, account: str, submission: dict, hold_until: int | None
) -> dict:
    """Cancels the held submission and creates its replacement (reschedule / send-now)."""

    args = _resubmit_args(client, submission)

    _cancel_submission(client, submission["id"])
    try:
        return _resubmit(client, account, **args, envelope_id=str(uuid7()), hold_until=hold_until)
    except Exception:
        # The old submission is already canceled: fail closed as a cancellation, so the
        # message lands back in Drafts instead of sitting in Sent never sending.
        log_mail_error(_("Failed to resubmit scheduled email"), frappe.get_traceback(with_context=True))
        _move_email_to_drafts(client, account, args["email_id"])
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


def _move_email_to_drafts(client: SuiteJMAPClient, account: str, email_id: str | None) -> str | None:
    """Returns a cancelled delivery's message to Drafts; a message deleted after scheduling
    (or a submission with no emailId) has nothing to move."""

    from suite.mail.doctype.mail_message.mail_message import _remove_cached_messages

    # Nothing to move must mean the message is known to be gone: after a refused lookup it
    # may still sit in Sent, and answering as if it were handled would read as moved.
    emails = _get_emails(client, [email_id], ["mailboxIds"], refused="throw")
    if not emails:
        return None

    drafts_mailbox_id = get_mailbox_id_by_role(
        account, "drafts", create_if_not_exists=True, raise_exception=True
    )

    # Replace (not patch) mailboxIds so the message leaves Sent; restore $draft on its own, so the
    # flags the message carries ($seen, $flagged, ...) stay.
    with client.batch() as b:
        h = b.mail.email.set(
            update={email_id: {"mailboxIds": {drafts_mailbox_id: True}, "keywords/$draft": True}}
        )
    if h.error:
        frappe.throw(format_method_error(h.error))
    if email_id not in h.result.updated:
        # The submission is already canceled; retrying this action skips the cancel
        # step (undoStatus is "canceled") and reattempts the move.
        frappe.throw(get_set_error_message(h.result, "update", email_id))

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
