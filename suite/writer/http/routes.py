"""Wire shapes for Writer document bodies and named saves."""

import functools
from collections.abc import Callable
from datetime import UTC
from typing import Literal, NotRequired, TypedDict
from zoneinfo import ZoneInfo

import frappe
from frappe import _
from frappe.utils import get_datetime, get_system_timezone

from suite import drive
from suite.composition.http import Route
from suite.content import log
from suite.content.conversions import ConversionStatus, conversion_status
from suite.writer import content as writer_content
from suite.writer.api.docs import OldBody, VersionConversion, convert_version, old_body
from suite.writer.content import markdown as markdown_body


class WriterRow(TypedDict):
    name: str
    collab: NotRequired[int]
    content: NotRequired[str | None]
    html: NotRequired[str | None]
    ycomments: NotRequired[str | None]
    settings: NotRequired[str | dict[str, object] | None]
    conversion: NotRequired[ConversionStatus]
    content_modified: NotRequired[str]


class SaveSettings(TypedDict):
    data: str


class CreateFromMarkdown(TypedDict):
    parent: str
    title: str
    markdown: str


class WriteMarkdown(TypedDict):
    markdown: str
    mode: Literal["replace", "append"]


class WrittenDocument(TypedDict):
    node: str
    rev: int


class OldBodyQuery(TypedDict):
    node: str


class ConvertVersion(TypedDict):
    node: str
    seq: int


@frappe.whitelist(allow_guest=True, methods=["GET"])
def document(name: str) -> WriterRow:
    doc = frappe.get_doc("Writer Document", name)
    doc.check_permission("read")
    doc.apply_fieldlevel_read_permissions()
    row = doc.as_dict()
    if frappe.session.user == "Guest" and not _may_comment(doc.node):
        # A public reader sees the document, not its discussion
        row.pop("ycomments", None)

    if doc.node and not log.find(writer_content.APP, doc.node):
        row["conversion"] = conversion_status(writer_content.APP, doc.node)

    # A save moves only the node's `content_modified`, never the row's `modified`
    saved = doc.node and frappe.db.get_value("Drive Node", doc.node, "content_modified")
    if saved:
        zone = ZoneInfo(get_system_timezone())
        row["content_modified"] = get_datetime(saved).replace(tzinfo=zone).astimezone(UTC).isoformat()

    return row


def _may_comment(node: str | None) -> bool:
    try:
        drive.check(node, drive.COMMENT)
    except drive.DriveError:
        return False
    return True


@frappe.whitelist(methods=["POST"])
def document_settings(name: str, data: str) -> None:
    """Save a document's editor settings."""
    frappe.get_doc("Writer Document", name).update_settings(data)


def refusing(handler: Callable) -> Callable:
    """Throw a workflow's refusal again, as the answer carries the message of a thrown error only."""

    @functools.wraps(handler)
    def answered(*args: object, **kwargs: object) -> object:
        try:
            return handler(*args, **kwargs)
        except frappe.ValidationError as refusal:
            # A refusal is an answer, not a crash, so it carries no server traceback
            frappe.local.flags.disable_traceback = True
            frappe.throw(str(refusal), type(refusal))

    return answered


@frappe.whitelist(methods=["POST"])
@refusing
def document_create(parent: str, title: str, markdown: str) -> WrittenDocument:
    """Create a document from Markdown, as an agent does."""
    return markdown_body.create(parent, title, markdown)


@frappe.whitelist(methods=["POST"])
@refusing
def document_write(node: str, markdown: str, mode: Literal["replace", "append"]) -> WrittenDocument:
    """Replace a document's body with Markdown, or append it."""
    return markdown_body.write(node, markdown, mode)


@frappe.whitelist(allow_guest=True, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
def unknown() -> None:
    """Answer an address no route names as not found."""
    raise frappe.DoesNotExistError(_("That Writer address does not exist"))


MARKDOWN_ERRORS = (
    drive.DriveNotFound,
    drive.DriveForbidden,
    drive.DriveLocked,
    markdown_body.MarkdownRefused,
    markdown_body.WriteRefused,
    markdown_body.WriteBusy,
)

ROUTES = (
    Route(
        "GET",
        "documents/{name}",
        "document",
        output=WriterRow,
        errors=(frappe.DoesNotExistError, frappe.PermissionError),
        kind="query",
        public_name="documents.get",
        allow_guest=True,
    ),
    Route(
        "POST",
        "documents/{name}/settings",
        "document_settings",
        body=SaveSettings,
        output=type(None),
        errors=(frappe.DoesNotExistError, drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        kind="mutation",
        public_name="documents.updateSettings",
    ),
    Route(
        "POST",
        "documents",
        "document_create",
        body=CreateFromMarkdown,
        output=WrittenDocument,
        errors=MARKDOWN_ERRORS,
        kind="mutation",
        public_name="documents.create",
    ),
    Route(
        "POST",
        "documents/{node}/body",
        "document_write",
        body=WriteMarkdown,
        output=WrittenDocument,
        errors=MARKDOWN_ERRORS,
        kind="mutation",
        public_name="documents.write",
    ),
)

CONTRACT_ROUTES = (
    Route(
        "GET",
        "/api/v2/method/suite.writer.api.docs.old_body",
        "old_body",
        query=OldBodyQuery,
        output=OldBody,
        kind="query",
        public_name="documents.oldBody",
        allow_guest=True,
    ),
    Route(
        "POST",
        "/api/v2/method/suite.writer.api.docs.convert_version",
        "convert_version",
        body=ConvertVersion,
        output=VersionConversion,
        kind="mutation",
        public_name="versions.convert",
        allow_guest=True,
    ),
)
