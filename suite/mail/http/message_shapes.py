"""Message and submission wire shapes."""

from typing import Literal, NotRequired, TypedDict

from suite.mail.http.shapes import Flag


class Recipient(TypedDict):
    type: Literal["To", "Cc", "Bcc"]
    email: str
    display_name: str | None


class RecipientInput(TypedDict):
    email: str
    display_name: NotRequired[str | None]


class ReplyAddress(TypedDict):
    email: str
    display_name: str | None


class MailboxRef(TypedDict):
    mailbox: str
    mailbox_id: str
    mailbox_name: str | None


class Attachment(TypedDict):
    filename: str | None
    type: str
    size: int
    blob_id: str
    disposition: str | None
    cid: str
    url: str | None
    part_id: NotRequired[str | None]
    charset: NotRequired[str | None]
    language: NotRequired[str | None]
    location: NotRequired[str | None]


class Copy(TypedDict):
    name: str
    id: str
    thread_id: str
    from_name: str | None
    from_email: str
    received_at: str
    mailboxes: list[MailboxRef]
    seen: Flag
    junk: Flag
    flagged: Flag
    draft: Flag
    # From a sender nobody has allowed or denied yet: the mail waits in the Inbox, marked new.
    unscreened: NotRequired[Flag]


class Message(Copy):
    message_id: str | None
    subject: str | None
    html_body: str | None
    text_body: str | None
    preview: str
    recipients: list[Recipient]
    reply_to: list[ReplyAddress]
    attachments: list[Attachment]
    dsn_blob_id: str | None
    duplicates: NotRequired[list[Copy]]
    user_image: NotRequired[str | None]


class AccountTag(TypedDict, total=False):
    account: str
    account_name: str
    view_mailbox: str
    inbox: str | None
    archive: str | None
    trash: str | None


class Thread(Copy, AccountTag):
    subject: str | None
    preview: str
    recipients: list[Recipient]
    attachments: list[Attachment]
    messages: list[Message]
    user_image: NotRequired[str | None]


class ThreadPage(TypedDict):
    rows: list[Thread]
    mailbox: str
    has_more: bool


class UnifiedThreadPage(TypedDict):
    rows: list[Thread]
    has_more: bool


class SearchRow(AccountTag):
    name: str
    id: str
    subject: str | None
    preview: str
    recipients: list[Recipient]
    sent_at: str | None
    received_at: str
    from_name: str | None
    from_email: str
    thread_id: str
    mailboxes: list[MailboxRef]
    attachments: list[Attachment]
    seen: Flag
    user_image: NotRequired[str | None]


class SearchPage(TypedDict):
    rows: list[SearchRow]
    total: int


SearchFilter = TypedDict(
    "SearchFilter",
    {
        "text": str,
        "from": str,
        "to": str,
        "cc": str,
        "bcc": str,
        "subject": str,
        "body": str,
        "before": str,
        "after": str,
        "inMailbox": str,
        "inMailboxOtherThan": list[str],
        "hasAttachment": bool | str,
        "isRead": bool | str,
        "hasKeyword": str,
        "notKeyword": str,
        "someInThreadHaveKeyword": str,
        "minSize": int,
        "maxSize": int,
        "operator": str,
        "conditions": list["SearchFilter"],
        "all_accounts": str | bool,
    },
    total=False,
)


class DraftResult(TypedDict):
    name: str
    id: str | None
    status: str
    error: str | None
    thread_id: str | None
    submission_id: str | None
    send_at: str | None
    undo_send_period: int | None


Status = Literal["failed", "retrying", "queued", "scheduled", "cancelled", "sent", "delivered", "displayed"]


class DeliveryError(TypedDict):
    email: str | None
    reason: str


class RecipientState(TypedDict):
    email: str | None
    status: Status
    reason: str | None
    smtp_reply: str | None
    delivered: str | None
    displayed: str | None
    retries: int | None
    next_retry: str | None


class Submission(TypedDict):
    id: str
    email_id: str | None
    thread_id: str | None
    send_at: str | None
    undo_status: Literal["pending", "final", "canceled"] | None
    status: Status
    retries: int | None
    recipients_status: list[RecipientState]
    delivery_errors: list[DeliveryError]
    subject: str | None
    from_name: str | None
    from_email: str | None
    recipients: list[Recipient]
    email_deleted: bool


class SubmissionDetail(Submission):
    identity_email: str | None
    envelope_from: str | None
    envelope_recipients: list[str | None]
    priority: int
    next_retry: str | None
    dsn_count: int
    mdn_count: int


class SubmissionPage(TypedDict):
    rows: list[Submission]
    total: int
