"""Wire shapes for Writer document bodies and named saves."""

from datetime import UTC
from typing import NotRequired, TypedDict
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
    if doc.node and not log.find(writer_content.APP, doc.node):
        row["conversion"] = conversion_status(writer_content.APP, doc.node)

    # A save moves only the node's `content_modified`, never the row's `modified`
    saved = doc.node and frappe.db.get_value("Drive Node", doc.node, "content_modified")
    if saved:
        zone = ZoneInfo(get_system_timezone())
        row["content_modified"] = get_datetime(saved).replace(tzinfo=zone).astimezone(UTC).isoformat()

    return row


@frappe.whitelist(methods=["POST"])
def document_settings(name: str, data: str) -> None:
    """Save a document's editor settings."""
    frappe.get_doc("Writer Document", name).update_settings(data)


@frappe.whitelist(allow_guest=True, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
def unknown() -> None:
    """Answer an address no route names as not found."""
    raise frappe.DoesNotExistError(_("That Writer address does not exist"))


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
