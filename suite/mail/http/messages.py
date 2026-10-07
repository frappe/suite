"""Contracts for message, thread, screener and scheduled delivery operations."""

from collections.abc import Callable
from typing import Literal, NotRequired, TypedDict

import frappe

from suite.composition.http import Route, RouteKind
from suite.mail.api import mail, scheduled
from suite.mail.doctype.mail_message.mail_message import bulk_delete as delete_messages
from suite.mail.http.message_shapes import (
    Attachment,
    DraftResult,
    Message,
    RecipientInput,
    SearchFilter,
    SearchPage,
    SubmissionDetail,
    SubmissionPage,
    ThreadPage,
    UnifiedThreadPage,
)
from suite.mail.http.shapes import AccountInput


class ThreadInput(AccountInput):
    thread_id: str


class Window(TypedDict):
    limit: int
    start: NotRequired[int]
    filter_by: NotRequired[str | None]


class ThreadsInput(AccountInput, Window):
    mailbox: str


class UnifiedThreadsInput(Window):
    folder: str


class SearchInput(AccountInput):
    filter: NotRequired[SearchFilter | None]
    limit: NotRequired[int]
    start: NotRequired[int]
    all_accounts: NotRequired[bool]


class IdInput(AccountInput):
    id: str


class IdsInput(AccountInput):
    ids: list[str]


class NameInput(TypedDict):
    name: str


class NamesInput(TypedDict):
    names: list[str]


class SeenInput(IdsInput):
    seen: bool


class FlagInput(IdsInput):
    flagged: bool


class FlagResult(TypedDict):
    ids: list[str]
    flagged: bool


class MoveInput(IdsInput):
    mailbox: str
    clear_junk: NotRequired[bool]


class FolderInput(IdsInput):
    mailbox_id: str


class Membership(TypedDict):
    id: str
    mailbox_ids: list[str]
    junk: int


class SetFoldersInput(AccountInput):
    mails: list[Membership]
    screen_action: NotRequired[str | None]


class SpamInput(IdsInput):
    spam: bool
    screen_action: NotRequired[str | None]


class EmptyInput(AccountInput):
    mailbox: str


class SendersInput(AccountInput):
    from_emails: list[str]


class AllowInput(SendersInput):
    destination: NotRequired[Literal["inbox", "archive", "trash"]]


class UndoScreenInput(SendersInput):
    ids: list[str]


class DraftAttachment(TypedDict, total=False):
    filename: str
    file_url: str
    blob_id: str
    type: str
    size: int | str
    disposition: str | None
    cid: str


class ComposeInput(AccountInput):
    from_email: str
    to: list[RecipientInput]
    cc: list[RecipientInput]
    bcc: list[RecipientInput]
    subject: str | None
    html_body: str | None
    from_name: NotRequired[str]
    attachments: NotRequired[list[DraftAttachment] | None]
    send_at: NotRequired[str | None]
    undo_send: NotRequired[bool]


class CreateInput(ComposeInput):
    in_reply_to: NotRequired[str | None]
    in_reply_to_id: NotRequired[str | None]
    forwarded_from_id: NotRequired[str | None]
    save_as_draft: NotRequired[bool]


class UpdateInput(ComposeInput):
    id: str
    submit: NotRequired[bool]


class SubmissionsInput(AccountInput):
    undo_status: NotRequired[str | None]
    identity_id: NotRequired[str | None]
    email_id: NotRequired[str | None]
    thread_id: NotRequired[str | None]
    before: NotRequired[str | None]
    after: NotRequired[str | None]
    start: NotRequired[int]
    page_length: NotRequired[int]


class RescheduleInput(IdInput):
    send_at: str


class IdResult(TypedDict):
    id: str | None


class RescheduleResult(IdResult):
    send_at: str


class SendResult(IdResult):
    thread_id: str | None


class MimeField(TypedDict):
    label: str
    value: str | None
    description: NotRequired[str]


MimeMessage = TypedDict(
    "MimeMessage",
    {
        "message": str,
        "message_id": MimeField,
        "created_at": MimeField,
        "subject": MimeField,
        "from": MimeField,
        "to": MimeField,
        "cc": MimeField,
        "bcc": MimeField,
        "spf": NotRequired[MimeField],
        "dkim": NotRequired[MimeField],
        "dmarc": NotRequired[MimeField],
    },
)


class BlobInput(AccountInput):
    blob_id: str


class DeliveryRecipient(TypedDict):
    email: str
    action: str
    status: str
    diagnostic_code: str
    remote_mta: str
    will_retry_until: str


class DeliveryReport(TypedDict):
    reporting_mta: str
    arrival_date: str
    recipients: list[DeliveryRecipient]


_OPERATIONS: tuple[
    tuple[Callable[..., object], RouteKind, str, object, object, dict[str, str] | None], ...
] = (
    (
        mail.get_threads,
        "query",
        "threads.list",
        ThreadsInput,
        ThreadPage,
        {"offset": "start", "rows": "rows", "more": "has_more"},
    ),
    (
        mail.get_unified_threads,
        "query",
        "unified.threads",
        UnifiedThreadsInput,
        UnifiedThreadPage,
        {"offset": "start", "rows": "rows", "more": "has_more"},
    ),
    (mail.get_thread, "query", "threads.get", ThreadInput, list[Message], None),
    (
        mail.search_mails,
        "query",
        "messages.search",
        SearchInput,
        SearchPage,
        {"offset": "start", "rows": "rows", "total": "total"},
    ),
    (mail.get_mime_message, "query", "messages.mime", NameInput, MimeMessage, None),
    (mail.get_delivery_status, "query", "messages.deliveryStatus", BlobInput, DeliveryReport, None),
    (mail.create_mail, "mutation", "messages.create", CreateInput, DraftResult, None),
    (mail.update_draft_mail, "mutation", "messages.updateDraft", UpdateInput, DraftResult, None),
    (mail.delete_mail, "mutation", "messages.deleteDraft", IdInput, type(None), None),
    (mail.set_flagged, "mutation", "messages.flag", FlagInput, FlagResult, None),
    (mail.set_mails_seen, "mutation", "messages.seen", SeenInput, list[str], None),
    (mail.move_mails, "mutation", "messages.move", MoveInput, type(None), None),
    (mail.add_mails_to_mailbox, "mutation", "messages.addToFolder", FolderInput, type(None), None),
    (
        mail.remove_mails_from_mailbox,
        "mutation",
        "messages.removeFromFolder",
        FolderInput,
        type(None),
        None,
    ),
    (mail.set_mails_mailboxes, "mutation", "messages.setFolders", SetFoldersInput, type(None), None),
    (mail.set_mails_spam_status, "mutation", "messages.spam", SpamInput, list[str], None),
    (mail.empty_user_mailbox, "mutation", "mailboxes.empty", EmptyInput, type(None), None),
    (
        mail.allow_screening_senders,
        "mutation",
        "screener.allow",
        AllowInput,
        dict[str, list[str]],
        None,
    ),
    (
        mail.screen_out_senders,
        "mutation",
        "screener.reject",
        SendersInput,
        dict[str, list[str]],
        None,
    ),
    (mail.undo_screening_verdict, "mutation", "screener.undo", UndoScreenInput, type(None), None),
    (
        scheduled.get_submissions,
        "query",
        "scheduled.list",
        SubmissionsInput,
        SubmissionPage,
        {"offset": "start", "rows": "rows", "total": "total"},
    ),
    (scheduled.get_scheduled_mail, "query", "scheduled.get", IdInput, SubmissionDetail, None),
    (
        scheduled.reschedule_mail,
        "mutation",
        "scheduled.reschedule",
        RescheduleInput,
        RescheduleResult,
        None,
    ),
    (scheduled.send_scheduled_mail_now, "mutation", "scheduled.sendNow", IdInput, SendResult, None),
    (scheduled.cancel_scheduled_mail, "mutation", "scheduled.cancel", IdInput, IdResult, None),
    (scheduled.retry_failed_mail, "mutation", "scheduled.retry", IdInput, IdResult, None),
    (scheduled.dismiss_failed_mail, "mutation", "scheduled.dismiss", IdInput, type(None), None),
)


CONTRACT_ROUTES = (
    *(
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
    ),
    Route(
        "POST",
        "/api/method/suite.mail.doctype.mail_message.mail_message.bulk_delete",
        "delete_messages",
        kind="mutation",
        public_name="messages.delete",
        body=NamesInput,
        output=type(None),
        envelope="message",
    ),
    Route(
        "POST",
        "/api/method/suite.mail.api.mail.fetch_mail_as_eml",
        "fetch_mail_as_eml",
        kind="query",
        public_name="messages.download",
        body=NameInput,
        response_bytes=True,
    ),
)
