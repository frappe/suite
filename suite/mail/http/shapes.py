"""JSON shapes shared by Mail account and mailbox readers."""

from typing import Literal, NotRequired, TypedDict

Flag = Literal[0, 1]


class AccountInput(TypedDict):
    account: str


class UserAccount(TypedDict):
    account: str
    id: str
    _name: str | None
    is_personal: bool
    in_mail: bool
    in_calendar: bool
    jmap_account: str | None
    default_outgoing_email: str | None
    on_mark_as_junk: str | None
    enable_screening: bool
    block_remote_images: bool


class UserInfo(TypedDict):
    name: str
    email: str
    full_name: str
    first_name: str | None
    last_name: str | None
    enabled: Flag
    user_image: str | None
    user_type: str
    username: str | None
    api_key: str | None
    time_zone: str
    system_time_zone: str
    group_messages_by: str | None
    show_reading_pane: Flag
    undo_send_period: str | None
    user_settings: str
    is_suite_admin: bool
    is_system_manager: bool
    is_jmap_configured: bool
    max_attachment_size: int
    is_suite_cloud_configured: bool
    accounts: list[UserAccount]


class AutomationRules(TypedDict):
    emails_from: str
    subject_contains: str
    match_if: Literal["any", "all"]
    mark_as_read: bool
    add_star: bool


class Mailbox(TypedDict):
    name: str
    id: str
    _name: str
    role: Literal["inbox", "sent", "drafts", "trash", "junk", "archive", "important"] | None
    total_emails: int
    total_threads: int
    unread_threads: int
    # What the folder is called in the unified views; None for the Screener.
    slug: str | None
    subscribed: bool
    icon: NotRequired[str | None]
    color: NotRequired[Literal["Blue", "Green", "Amber", "Red", "Purple"] | None]
    disable_push_notification: NotRequired[Flag]
    automation_rules: NotRequired[AutomationRules | None]


class UnifiedFolder(TypedDict):
    slug: str
    name: str
    role: str | None
    unread_threads: int
    accounts: list[str]
    icon: str | None
    color: Literal["Blue", "Green", "Amber", "Red", "Purple"] | None


class AddressBook(TypedDict):
    name: str
    id: str
    _name: str
    default: Flag


class Address(TypedDict):
    display_name: str | None
    email: str


class Identity(TypedDict):
    name: str
    account: str
    id: str
    _name: str
    email: str
    bcc: list[Address]
    reply_to: list[Address]
    html_signature: str
    text_signature: str
    may_delete: Flag
    owner: str
    modified_by: str
    creation: str
    modified: str


class ParticipantIdentity(TypedDict):
    name: str
    account: str
    id: str
    _name: str
    email: str
    default: Flag
    owner: str
    modified_by: str
    creation: str
    modified: str


class ScreenedAddress(TypedDict):
    email: str
    action: Literal["Reject", "Spam", "Accepted"]
    creation: str
    modified: str


class SieveScript(TypedDict):
    name: str
    account: str
    id: str
    _name: str
    active: Flag
    blob_id: str
    content: str
    read_only: bool
    creation: str
    modified: str


class ScreenAddresses(AccountInput):
    emails: list[str]
    action: NotRequired[Literal["Reject", "Spam", "Accepted"]]
    override: NotRequired[bool]


class UnscreenAddresses(AccountInput):
    emails: list[str]


class CalendarClientConfig(TypedDict, total=False):
    server_url: str
    calendar_url: str
    username: str


class EmailSuggestionsInput(AccountInput):
    text: str
    limit: NotRequired[int]


class EmailSuggestion(TypedDict):
    name: str | None
    email: str
    user_image: NotRequired[str | None]


class AttachmentBytesInput(AccountInput):
    blob_id: str


class ZipAttachment(TypedDict):
    blob_id: str
    filename: NotRequired[str | None]


class AttachmentsZipInput(AccountInput):
    attachments: list[ZipAttachment]
