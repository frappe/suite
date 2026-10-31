"""Slides document and composite-group wire contracts."""

from typing import Literal, NotRequired, TypedDict

from suite.composition.http import Route
from suite.slides.api.composite import composite_group, composite_manifest
from suite.slides.api.slides import save_slides
from suite.slides.doctype.presentation.presentation import (
    get_composite_presentation,
    get_editor_access,
    get_public_presentation,
    get_templates,
    get_updated_json,
    is_composite_presentation,
    update_slide_attachments,
)


class DeckInput(TypedDict):
    name: str


class Slide(TypedDict, total=False):
    name: str
    idx: int
    parent: str
    client_id: str | None
    background: str | None
    elements: str | list[dict[str, object]] | None
    thumbnail: str | None
    transition: str | None
    transition_duration: str | float | None
    fade_unmatched_elements: bool | Literal[0, 1]
    advance_after: str | float | None


class Reference(TypedDict):
    reference: str
    index: int
    presentation: str | None
    node: str | None


class ReferenceAnswer(Reference):
    readable: bool
    composite: bool | None
    slides: list[Slide] | None


class Deck(TypedDict):
    name: str
    modified: str
    modified_by: str
    node: str
    is_composite: bool | Literal[0, 1]
    theme: str | None
    slides: list[Slide]
    references: NotRequired[list[ReferenceAnswer]]


class SlideChanges(TypedDict, total=False):
    client_id: str | None
    background: str | None
    elements: str | list[dict[str, object]] | None
    transition: str | None
    transition_duration: str | float | None
    fade_unmatched_elements: bool | Literal[0, 1]
    advance_after: str | float | None


class SaveDeck(DeckInput):
    slides: list[SlideChanges]
    base_modified: str


class SavedDeck(TypedDict):
    modified: str


class Template(TypedDict):
    name: str
    title: str
    slug: str
    creation: str
    is_template: Literal[1]
    layouts: list[Slide]


class AdoptElements(TypedDict):
    presentation: str
    elements: list[dict[str, object]]


class AdoptSlide(TypedDict):
    parent: str
    slide: dict[str, object] | str


class Manifest(TypedDict):
    presentation: str
    node: str
    modified: str
    group_limit: int
    reference_count: int
    references: list[Reference]


class GroupInput(DeckInput):
    references: list[str] | str


class GroupResult(TypedDict):
    presentation: str
    node: str
    references: list[ReferenceAnswer]


class AccessInput(TypedDict):
    presentation_id: str


CONTRACT_ROUTES = (
    Route(
        "GET",
        "/api/method/suite.slides.doctype.presentation.presentation.get_public_presentation",
        "get_public_presentation",
        query=DeckInput,
        output=Deck,
        kind="query",
        public_name="documents.get",
        allow_guest=True,
        envelope="message",
    ),
    Route(
        "GET",
        "/api/method/suite.slides.doctype.presentation.presentation.get_composite_presentation",
        "get_composite_presentation",
        query=DeckInput,
        output=Deck,
        kind="query",
        public_name="documents.composite",
        allow_guest=True,
        envelope="message",
    ),
    Route(
        "GET",
        "/api/method/suite.slides.doctype.presentation.presentation.is_composite_presentation",
        "is_composite_presentation",
        query=DeckInput,
        output=bool,
        kind="query",
        public_name="documents.isComposite",
        allow_guest=True,
        envelope="message",
    ),
    Route(
        "POST",
        "/api/method/suite.slides.api.slides.save_slides",
        "save_slides",
        body=SaveDeck,
        output=SavedDeck,
        kind="mutation",
        public_name="documents.save",
        allow_guest=True,
        envelope="message",
    ),
    Route(
        "GET",
        "/api/method/suite.slides.doctype.presentation.presentation.get_templates",
        "get_templates",
        output=list[Template],
        kind="query",
        public_name="templates.list",
        envelope="message",
    ),
    Route(
        "POST",
        "/api/method/suite.slides.doctype.presentation.presentation.get_updated_json",
        "get_updated_json",
        body=AdoptElements,
        output=list[dict[str, object]],
        kind="mutation",
        public_name="media.adoptElements",
        envelope="message",
    ),
    Route(
        "POST",
        "/api/method/suite.slides.doctype.presentation.presentation.update_slide_attachments",
        "update_slide_attachments",
        body=AdoptSlide,
        output=dict[str, object],
        kind="mutation",
        public_name="media.adoptSlide",
        envelope="message",
    ),
    Route(
        "GET",
        "/api/method/suite.slides.api.composite.composite_manifest",
        "composite_manifest",
        query=DeckInput,
        output=Manifest,
        kind="query",
        public_name="composites.manifest",
        allow_guest=True,
        envelope="message",
    ),
    Route(
        "POST",
        "/api/method/suite.slides.api.composite.composite_group",
        "composite_group",
        body=GroupInput,
        output=GroupResult,
        kind="query",
        public_name="composites.group",
        allow_guest=True,
        envelope="message",
    ),
    Route(
        "GET",
        "/api/method/suite.slides.doctype.presentation.presentation.get_editor_access",
        "get_editor_access",
        query=AccessInput,
        output=Literal["edit", "view", "none"],
        kind="query",
        public_name="documents.access",
        allow_guest=True,
        envelope="message",
    ),
)
