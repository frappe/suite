"""The shapes Mail Queue keeps in its JSON fields, and the JMAP models they become.

The compose UI, the send API, replies, forwards and calendar invitations all build these, so they
are parsed on the way in rather than trusted key by key when the mail is processed.
"""

import json
from pathlib import Path
from typing import Annotated, Literal, Self

from frappe import _
from frappe.utils import random_string, validate_email_address
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from suite.mail.jmap.models import EmailAddress, EmailAttachment, EmailRecipient
from suite.utils.validation import without_blanks

# Headers the draft builder writes itself; a caller may only add its own (X-...) ones.
STANDARD_HEADERS = frozenset(
    {
        "from",
        "to",
        "cc",
        "bcc",
        "subject",
        "date",
        "message-id",
        "in-reply-to",
        "references",
        "reply-to",
        "user-agent",
        "sender",
        "return-path",
        "mime-version",
        "content-type",
        "content-transfer-encoding",
        "content-language",
        "x-mailer",
        "x-priority",
        "x-mail-queue",
    }
)


def _valid_email(value: str) -> str:
    if not validate_email_address(value):
        raise PydanticCustomError("email", _("{email} is not a valid email address"), {"email": value})
    return value


Email = Annotated[str, Field(min_length=1), AfterValidator(_valid_email)]


class Address(BaseModel):
    """A Reply-To entry. Only this app builds these, so an unknown key is a bug, not noise."""

    model_config = ConfigDict(extra="forbid")

    email: Email
    display_name: str | None = None

    def to_jmap(self) -> EmailAddress:
        return EmailAddress(name=self.display_name, email=self.email.lower())


class Recipient(Address):
    type: Literal["To", "Cc", "Bcc"]

    def to_jmap(self) -> EmailRecipient:
        return EmailRecipient(type=self.type.lower(), name=self.display_name, email=self.email.lower())


class Attachment(BaseModel):
    """An uploaded blob, or a site file uploaded when the mail is processed.

    Unknown keys are ignored: the send API passes its callers' attachments through as they are.
    """

    disposition: Literal["attachment", "inline"] = "attachment"
    cid: str = Field(default_factory=lambda: random_string(10))
    filename: str | None = None
    blob_id: str | None = None
    type: str | None = None
    size: int | None = None
    file_url: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _blank_means_absent(cls, data):
        # The compose UI sends every key and leaves the unused ones "" or None.
        return without_blanks(data)

    @model_validator(mode="after")
    def _one_source(self) -> Self:
        if self.blob_id:
            if not self.type:
                raise PydanticCustomError("blob_type", _("type is required for blob attachments"))
            self.file_url = None
        elif self.file_url:
            if not self.file_url.startswith(("/files", "/private/files")):
                raise PydanticCustomError(
                    "file_url",
                    _("{file_url} is not a site file; it must start with /files/ or /private/files/"),
                    {"file_url": self.file_url},
                )
            self.filename = self.filename or Path(self.file_url).name
            self.type = self.size = None
        else:
            raise PydanticCustomError("attachment_source", _("either blob_id or file_url is required"))
        return self

    @property
    def is_private_file(self) -> bool:
        return not self.blob_id and self.file_url.startswith("/private/files")

    def to_jmap(self) -> EmailAttachment:
        return EmailAttachment(
            name=self.filename,
            type=self.type,
            cid=self.cid,
            blob_id=self.blob_id,
            disposition=self.disposition,
        )


def _each_blob_once(attachments: list[Attachment]) -> list[Attachment]:
    seen = set()
    unique = []
    for attachment in attachments:
        if attachment.blob_id:
            if attachment.blob_id in seen:
                continue
            seen.add(attachment.blob_id)
        unique.append(attachment)
    return unique


def _custom_headers_only(headers: dict[str, str]) -> dict[str, str]:
    for key in headers:
        if key.lower() in STANDARD_HEADERS:
            raise PydanticCustomError(
                "standard_header",
                _("{header} is a standard email header and cannot be overridden; use a custom X- header"),
                {"header": key},
            )
    return headers


# A row without a type or an address is refused, never skipped: skipping would send the mail
# without someone the sender meant to reach.
Recipients = list[Recipient]
Attachments = Annotated[list[Attachment], AfterValidator(_each_blob_once)]
Headers = Annotated[dict[str, str], AfterValidator(_custom_headers_only)]


def to_json(items: list[BaseModel]) -> str:
    """The rows as the JSON field stores them."""

    return json.dumps([item.model_dump() for item in items])
