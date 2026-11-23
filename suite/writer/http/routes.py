"""Wire shapes for Writer document bodies and named saves."""

import functools
from collections.abc import Callable
from datetime import UTC
from pathlib import Path
from typing import Literal, NotRequired, TypedDict
from zoneinfo import ZoneInfo

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import get_datetime, get_system_timezone, get_url
from werkzeug.wrappers import Response

from suite import drive
from suite.composition.http import Route, refuse
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


class WrittenDocument(drive.NodeShape):
    """The document's node as Drive answers it, and the revision the write made."""

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


WRITE_REFUSALS = (markdown_body.MarkdownRefused, markdown_body.WriteRefused, markdown_body.WriteBusy)

# As in Drive's handlers, a body field is annotated to take anything and checked in the handler: a narrow
# annotation refuses a wrong type before the handler runs, with no message
Given = str | int | float | bool | list | dict | None
MODES: tuple[Literal["replace", "append"], ...] = ("replace", "append")
# Each write takes the site's one converter, and a replace keeps a version, so a loop gone wrong stops here
WRITES_A_MINUTE = 30
write_limit = rate_limit(limit=WRITES_A_MINUTE, seconds=60, ip_based=False, user_based=True)


def refusing(handler: Callable) -> Callable:
    """Throw a workflow's refusal again, as the answer carries the message of a thrown error only."""

    @functools.wraps(handler)
    def answered(*args: object, **kwargs: object) -> object:
        try:
            return handler(*args, **kwargs)
        except WRITE_REFUSALS as refusal:
            refuse(type(refusal), str(refusal), retry_ms=getattr(refusal, "retry_ms", None))
        except frappe.ValidationError as refusal:
            drive.throw_again(refusal)

    return answered


def text(value: Given, name: str) -> str:
    """Answer the body field `name` when it is a string, and refuse it by name when it is not."""
    if not isinstance(value, str):
        raise frappe.ValidationError(_("{0} must be a string").format(name))

    return value


@frappe.whitelist(methods=["POST"])
@write_limit
@refusing
def document_create(parent: Given = None, title: Given = None, markdown: Given = None) -> WrittenDocument:
    """Create a document from Markdown, as an agent does."""
    body = text(markdown, "markdown")
    node, rev = markdown_body.create(text(parent, "parent"), text(title, "title"), body)
    return {**drive.get_node(node), "rev": rev}


@frappe.whitelist(methods=["POST"])
@write_limit
@refusing
def document_write(node: str, markdown: Given = None, mode: Given = None) -> WrittenDocument:
    """Replace a document's body with Markdown, or append it."""
    if mode not in MODES:
        raise frappe.ValidationError(_("mode must be replace or append"))

    rev = markdown_body.write(node, text(markdown, "markdown"), mode)
    return {**drive.get_node(node), "rev": rev}


AGENT_GUIDE = Path(__file__).parents[1] / "agent-guide.md"
GUIDE_SITE = "https://suite.example.com"


@frappe.whitelist(allow_guest=True, methods=["GET"])
def agent_guide() -> Response:
    """Answer the agent guide with this site's address in its calls. It holds no data, so a guest reads it."""
    return Response(
        AGENT_GUIDE.read_text(encoding="utf-8").replace(GUIDE_SITE, get_url()), mimetype="text/markdown"
    )


@frappe.whitelist(allow_guest=True, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
def unknown() -> None:
    """Answer an address no route names as not found."""
    raise frappe.DoesNotExistError(_("That Writer address does not exist"))


MARKDOWN_ERRORS = (
    # A field that is missing or wrong, which `refusing` answers as Drive does
    drive.DriveError,
    frappe.RateLimitExceededError,
    drive.DriveNotFound,
    drive.DriveForbidden,
    drive.DriveLocked,
    drive.DriveLinkExpired,
    *WRITE_REFUSALS,
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
        errors=(*MARKDOWN_ERRORS, drive.DriveConflict),
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
    Route(
        "GET",
        "agent-guide",
        "agent_guide",
        stream=True,
        kind="query",
        public_name="agentGuide.read",
        allow_guest=True,
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
