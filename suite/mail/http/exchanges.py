"""Named reads for the user's import and export jobs."""

from typing import Literal, NotRequired, TypedDict, cast

import frappe
from frappe.client import get_value

from suite.composition.http import Route
from suite.mail.api import account
from suite.mail.http.calendar import ExchangeFilters, ExchangeName
from suite.mail.http.shapes import AccountInput

ExchangeType = Literal["Mail Exchange", "Contacts Exchange", "Calendar Exchange"]


class MailImport(AccountInput):
    format: Literal["eml", "jmap", "mbox", "maildir", "maildir-nested"]
    file: str
    mailbox: NotRequired[str | None]
    seen: NotRequired[bool]


class MailFilter(TypedDict, total=False):
    inMailbox: str
    after: str
    before: str
    hasAttachment: str | bool
    isRead: str | bool


class MailExport(AccountInput):
    format: Literal["jmap", "mbox", "maildir", "maildir-nested"]
    archive_type: Literal[".zip", ".tgz", ".tar.gz"]
    sort: Literal["Received At (ASC)", "Received At (DESC)"]
    limit: NotRequired[int | None]
    filter: NotRequired[MailFilter | None]


class ContactsImport(AccountInput):
    format: Literal["vcf", "jmap"]
    file: str
    address_book: NotRequired[str | None]


class ContactsFilter(TypedDict, total=False):
    inAddressBook: str
    name: str
    email: str


class ContactsExport(AccountInput):
    format: Literal["jmap", "vcf"]
    archive_type: Literal[".zip", ".tgz", ".tar.gz"]
    limit: NotRequired[int | None]
    filter: NotRequired[ContactsFilter | None]


class OngoingExchange(TypedDict):
    doctype: ExchangeType
    fieldname: Literal["name"]
    filters: ExchangeFilters


class JobInput(TypedDict):
    doctype: ExchangeType
    name: str


class JobListInput(TypedDict):
    doctype: ExchangeType
    operation: Literal["Import", "Export"]
    status: NotRequired[str]
    start: NotRequired[int]
    page_length: NotRequired[int]


class Job(TypedDict):
    name: str
    status: str
    operation: str
    started_at: str | None
    completed_at: str | None
    output: str | None
    import_format: str | None
    export_format: str | None
    export_archive_type: str | None


class JobPage(TypedDict):
    items: list[Job]
    total: int


class Attachment(TypedDict):
    file_name: str
    file_url: str
    file_type: str | None
    file_size: int


FIELDS = tuple(Job.__annotations__)


@frappe.whitelist(methods=["GET"])
def exchange(doctype: ExchangeType, name: str) -> Job:
    doc = frappe.get_doc(doctype, name)
    doc.check_permission("read")
    return cast(Job, {field: doc.get(field) for field in FIELDS})


@frappe.whitelist(methods=["GET"])
def exchange_attachment(doctype: ExchangeType, name: str) -> Attachment | None:
    exchange(doctype, name)
    return (
        get_value(
            "File",
            list(Attachment.__annotations__),
            {"attached_to_doctype": doctype, "attached_to_name": name, "attached_to_field": "file"},
        )
        or None
    )


@frappe.whitelist(methods=["GET"])
def exchange_list(
    doctype: ExchangeType, operation: str, status: str = "", start: int = 0, page_length: int = 100
) -> JobPage:
    filters = {"user": frappe.session.user, "operation": operation}
    if status:
        filters["status"] = status
    rows = frappe.get_list(
        doctype,
        fields=list(FIELDS),
        filters=filters,
        order_by="creation desc",
        start=max(start, 0),
        page_length=max(1, min(page_length, 500)),
    )
    return {"items": rows, "total": frappe.db.count(doctype, filters)}


ROUTES = (
    Route(
        "GET",
        "exchanges/get",
        "exchange",
        kind="query",
        public_name="exchanges.get",
        query=JobInput,
        output=Job,
    ),
    Route(
        "GET",
        "exchanges/attachment",
        "exchange_attachment",
        kind="query",
        public_name="exchanges.attachment",
        query=JobInput,
        output=Attachment | None,
    ),
    Route(
        "GET",
        "exchanges",
        "exchange_list",
        kind="query",
        public_name="exchanges.list",
        query=JobListInput,
        output=JobPage,
        page={"offset": "start", "rows": "items", "total": "total"},
    ),
)
CONTRACT_ROUTES = (
    *(
        Route(
            "POST",
            f"/api/method/{handler.__module__}.{handler.__name__}",
            handler.__name__,
            kind="mutation",
            public_name=public_name,
            body=body,
            output=type(None),
            envelope="message",
            errors=(frappe.PermissionError, frappe.ValidationError),
        )
        for handler, public_name, body in (
            (account.create_mail_import, "exchanges.importMail", MailImport),
            (account.create_mail_export, "exchanges.exportMail", MailExport),
            (account.create_contacts_import, "exchanges.importContacts", ContactsImport),
            (account.create_contacts_export, "exchanges.exportContacts", ContactsExport),
        )
    ),
    Route(
        "POST",
        "/api/method/frappe.client.get_value",
        "get_value",
        id="ongoing_exchange",
        kind="query",
        public_name="exchanges.ongoing",
        body=OngoingExchange,
        output=ExchangeName | None,
        envelope="message",
        errors=(frappe.PermissionError,),
    ),
)
