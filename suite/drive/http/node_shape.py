"""The §11.3 node shape as types.

They stand apart from `shapes` so that Drive's package root exports `NodeShape`
without loading the node workflows `shapes` imports.
"""

from typing import NotRequired, TypedDict

from suite.drive._core.audience import AudienceKind
from suite.drive._core.people import Person


class AccessShape(TypedDict, total=False):
    role: int
    via_link: str | None
    source_node: str | None
    source_principal: str | None
    # Manage checks pass: `role` is MANAGE, or a Suite Admin's override (ADR 0001).
    can_manage: bool


class AudienceShape(TypedDict):
    """How widely a node is shared. It names nobody, so any reader may see it."""

    # The widest reach: public on the web, the organization, a share link, or people.
    kind: AudienceKind
    # The people who hold a grant, their own or through a group, owner included.
    people: int


class BreadcrumbShape(TypedDict):
    name: str
    title: str
    # A file under a content document has the document as its last crumb, and
    # a document is not a folder a client can list or link to as one.
    kind: str
    # The caller's role at this step, so a client knows what it may do in the
    # folder a node sits in (Duplicate needs UPLOAD there) without another read.
    role: int


class PreviewShape(TypedDict):
    url: str
    expires: int


class NodeShape(TypedDict):
    name: str
    title: str
    kind: str
    parent_node: str | None
    root: str
    state: str
    # The node whose trashing trashed this one: its own name on a trash root,
    # an ancestor's inside a trashed folder, None while Active (§3.1).
    trash_root: str | None
    size: int
    mime: str | None
    url: str | None
    content_doctype: str | None
    content_docname: str | None
    is_template: int
    # The user whose row this is, published as a person, never as a bare id.
    owner: Person
    creation: str | None
    modified: str | None
    content_modified: str | None
    access: NotRequired[AccessShape]
    audience: NotRequired[AudienceShape]
    breadcrumbs: NotRequired[list[BreadcrumbShape]]
    # A folder's files at every depth, trashed ones left out, in bytes. Only folders carry it.
    contents_size: NotRequired[int]
    preview: NotRequired[PreviewShape | None]
    opened_at: NotRequired[str | None]
    # The caller's own star. Reads (a detail, a children page, a view) carry
    # it; a write answers without it.
    favourite: NotRequired[bool]
