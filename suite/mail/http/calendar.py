"""Mail-owned calendar exchange and participant identity contracts."""

from typing import Literal, NotRequired, TypedDict

import frappe
from frappe.client import get_value

from suite.composition.http import Route
from suite.mail.api.account import create_calendar_export, create_calendar_import
from suite.mail.doctype.participant_identity.participant_identity import (
    add_participant_identity,
    bulk_delete,
    update_participant_identity,
)
from suite.mail.http.shapes import AccountInput


class CalendarImport(AccountInput):
    format: Literal["ics", "jmap"]
    file: str
    calendar: NotRequired[str | None]


class CalendarExportFilter(TypedDict, total=False):
    title: str
    inCalendar: str
    after: str
    before: str


class CalendarExport(AccountInput):
    format: Literal["ics", "jmap"]
    archive_type: Literal[".zip", ".tgz", ".tar.gz"]
    sort: Literal["Start (ASC)", "Start (DESC)"]
    limit: NotRequired[int | None]
    filter: NotRequired[CalendarExportFilter | None]


class ExchangeFilters(TypedDict):
    user: str
    account: NotRequired[str]
    operation: Literal["Import", "Export"]
    status: tuple[Literal["in"], list[Literal["Queued", "In Progress"]]]


class OngoingExchange(TypedDict):
    doctype: Literal["Calendar Exchange"]
    fieldname: Literal["name"]
    filters: ExchangeFilters


class ExchangeName(TypedDict, total=False):
    name: str


class CreateIdentity(AccountInput):
    name: str
    email: str
    default: NotRequired[bool]


class UpdateIdentity(CreateIdentity):
    id: str


class DeleteIdentities(TypedDict):
    names: list[str]


CONTRACT_ROUTES = (
    Route(
        "POST",
        "/api/method/suite.mail.api.account.create_calendar_import",
        "create_calendar_import",
        kind="mutation",
        public_name="calendar.import",
        body=CalendarImport,
        output=type(None),
        envelope="message",
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.mail.api.account.create_calendar_export",
        "create_calendar_export",
        kind="mutation",
        public_name="calendar.export",
        body=CalendarExport,
        output=type(None),
        envelope="message",
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/frappe.client.get_value",
        "get_value",
        id="ongoing_calendar_exchange",
        kind="query",
        public_name="calendar.ongoingExchange",
        body=OngoingExchange,
        output=ExchangeName | None,
        envelope="message",
        errors=(frappe.PermissionError,),
    ),
    Route(
        "POST",
        "/api/method/suite.mail.doctype.participant_identity.participant_identity.add_participant_identity",
        "add_participant_identity",
        kind="mutation",
        public_name="participantIdentities.create",
        body=CreateIdentity,
        output=str,
        envelope="message",
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.mail.doctype.participant_identity.participant_identity.update_participant_identity",
        "update_participant_identity",
        kind="mutation",
        public_name="participantIdentities.update",
        body=UpdateIdentity,
        output=type(None),
        envelope="message",
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.mail.doctype.participant_identity.participant_identity.bulk_delete",
        "bulk_delete",
        id="delete_participant_identities",
        kind="mutation",
        public_name="participantIdentities.delete",
        body=DeleteIdentities,
        output=type(None),
        envelope="message",
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
)
