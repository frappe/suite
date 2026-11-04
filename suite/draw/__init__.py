"""Authenticated scene reads and conflict-checked saves for Draw."""

from typing import TypedDict

import frappe


class DrawingBody(TypedDict):
    name: str
    node: str
    content: str
    modified: str


class DrawingConflict(frappe.ValidationError):
    http_status_code = 409


class DrawingNotFound(frappe.ValidationError):
    http_status_code = 404


def get_drawing(node: str) -> DrawingBody:
    from suite.draw.documents import read

    return read(node)


def save_drawing(node: str, content: str, base_modified: str) -> DrawingBody:
    from suite.draw.documents import save

    return save(node, content, base_modified)
