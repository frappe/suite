"""Wire shapes for Writer document bodies and named saves."""

from typing import NotRequired, TypedDict

import frappe

from suite.composition.http import Route
from suite.writer.api.docs import save_comments
from suite.writer.doctype.writer_document.writer_document import WriterDocument


class WriterRow(TypedDict):
    name: str
    collab: NotRequired[int]
    content: NotRequired[str | None]
    html: NotRequired[str | None]
    ycomments: NotRequired[str | None]
    settings: NotRequired[str | dict[str, object] | None]


class SaveBody(TypedDict):
    data: str
    html: NotRequired[str]


class SaveHTML(TypedDict):
    html: str


class SaveComments(TypedDict):
    doc: str
    data: str


class SaveSettings(TypedDict):
    data: str


def document(name: str) -> WriterRow:
    doc = frappe.get_doc("Writer Document", name)
    doc.check_permission("read")
    return doc.as_dict()


save_doc = WriterDocument.save_doc
save_html = WriterDocument.save_html
update_settings = WriterDocument.update_settings

CONTRACT_ROUTES = (
    Route(
        "GET",
        "/api/v2/document/Writer Document/{name}",
        "document",
        output=WriterRow,
        kind="query",
        public_name="documents.get",
        allow_guest=True,
    ),
    Route(
        "POST",
        "/api/v2/document/Writer Document/{name}/method/save_doc",
        "save_doc",
        body=SaveBody,
        output=type(None),
        kind="mutation",
        public_name="documents.save",
        allow_guest=True,
    ),
    Route(
        "POST",
        "/api/v2/document/Writer Document/{name}/method/save_html",
        "save_html",
        body=SaveHTML,
        output=type(None),
        kind="mutation",
        public_name="documents.saveHTML",
        allow_guest=True,
    ),
    Route(
        "POST",
        "/api/v2/document/Writer Document/{name}/method/update_settings",
        "update_settings",
        body=SaveSettings,
        output=type(None),
        kind="mutation",
        public_name="documents.updateSettings",
    ),
    Route(
        "POST",
        "/api/v2/method/suite.writer.api.docs.save_comments",
        "save_comments",
        body=SaveComments,
        output=type(None),
        kind="mutation",
        public_name="comments.save",
        allow_guest=True,
    ),
)
