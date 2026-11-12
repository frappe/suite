"""Typed scene reads and writes. Creation and titles belong to Drive."""

from typing import TypedDict

import frappe

from suite import draw
from suite.composition.http import Route


class SaveDrawing(TypedDict):
    content: str
    base_modified: str


@frappe.whitelist(methods=["GET"])
def document(node: str) -> draw.DrawingBody:
    return draw.get_drawing(node)


@frappe.whitelist(methods=["PUT"])
def save_document(node: str, content: str, base_modified: str) -> draw.DrawingBody:
    return draw.save_drawing(node, content, base_modified)


@frappe.whitelist(allow_guest=True, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
def unknown(**kwargs):
    raise draw.DrawingNotFound("Not found")


ROUTES = (
    Route(
        "GET",
        "documents/{node}",
        "document",
        output=draw.DrawingBody,
        kind="query",
        public_name="documents.get",
        errors=(draw.DrawingNotFound, frappe.PermissionError),
    ),
    Route(
        "PUT",
        "documents/{node}",
        "save_document",
        body=SaveDrawing,
        output=draw.DrawingBody,
        kind="mutation",
        public_name="documents.save",
        errors=(draw.DrawingNotFound, draw.DrawingConflict, frappe.PermissionError, frappe.ValidationError),
    ),
)
