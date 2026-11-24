"""Slides document and composite-group wire contracts, and the routes an agent writes slides with."""

import functools
from collections.abc import Callable
from pathlib import Path
from typing import Literal, NotRequired, TypedDict

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import get_url
from werkzeug.wrappers import Response

from suite import drive
from suite.composition.http import Route, refuse
from suite.content.conversions import ConversionStatus
from suite.slides.api.composite import composite_group, composite_manifest
from suite.slides.api.recovery import recovery_names
from suite.slides.api.versions import VersionConversion, convert_version
from suite.slides.content import agent
from suite.slides.doctype.presentation.presentation import (
    apply_theme,
    get_composite_presentation,
    get_editor_access,
    get_public_presentation,
    get_templates,
    get_updated_json,
    is_composite_presentation,
    update_slide_attachments,
    update_theme,
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
    # a converted deck's answer has none: its rows aren't its slides (Q20')
    slides: NotRequired[list[Slide]]
    references: NotRequired[list[ReferenceAnswer]]
    is_converted: NotRequired[bool]
    conversion: NotRequired[ConversionStatus]


class SavedDeck(TypedDict):
    modified: str


class DeckTheme(DeckInput):
    theme: str


class ThemedDeck(TypedDict):
    modified: str
    base_modified: str


class Template(TypedDict):
    name: str
    node: str
    title: str
    slug: str
    creation: str
    is_template: Literal[1]
    is_converted: bool
    thumbnails: list[str]
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


class RecoveryNamesInput(TypedDict):
    presentations: list[str]
    nodes: list[str]


class RecoveryName(TypedDict):
    presentation: str
    node: str
    title: str
    can_edit: bool


class ConvertVersion(TypedDict):
    node: str
    seq: int


class CreatePresentation(TypedDict):
    parent: str
    title: str
    slides: list[dict[str, object]]
    template: NotRequired[str]


class WriteSlides(TypedDict):
    slides: list[dict[str, object]]
    mode: Literal["replace", "append"]


class WriteSlide(TypedDict):
    slide: dict[str, object]


class WrittenPresentation(drive.NodeShape):
    """The presentation's node as Drive answers it, and the revision the write made."""

    rev: int


class PresentationSlides(TypedDict):
    slides: list[dict[str, object]]


MODES: tuple[Literal["replace", "append"], ...] = ("replace", "append")
WRITE_REFUSALS = (agent.SlidesRefused, agent.WriteRefused, agent.WriteBusy)

# As in Drive's handlers, a body field is annotated to take anything and checked in the handler: a narrow
# annotation refuses a wrong type before the handler runs, with no message
Given = str | int | float | bool | list | dict | None
# Each write takes the site's one converter, and a replace keeps a version, so a loop gone wrong stops here
WRITES_A_MINUTE = 30
write_limit = rate_limit(limit=WRITES_A_MINUTE, seconds=60, ip_based=False, user_based=True)
# A read takes the converter's turn too, so one user's reads take at most a turn a second
READS_A_MINUTE = 60
read_limit = rate_limit(limit=READS_A_MINUTE, seconds=60, ip_based=False, user_based=True)


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
def presentation_create(
    parent: Given = None, title: Given = None, slides: Given = None, template: Given = None
) -> WrittenPresentation:
    """Create a presentation from slide JSON on a template, as an agent does."""
    if template is not None:
        template = text(template, "template")

    node, rev = agent.create(text(parent, "parent"), text(title, "title"), slides, template)
    return {**drive.get_node(node), "rev": rev}


@frappe.whitelist(methods=["POST"])
@write_limit
@refusing
def presentation_write(node: str, slides: Given = None, mode: Given = None) -> WrittenPresentation:
    """Replace a presentation's slides with slide JSON, or add slides after its last."""
    if mode not in MODES:
        raise frappe.ValidationError(_("mode must be replace or append"))

    rev = agent.write(node, slides, mode)
    return {**drive.get_node(node), "rev": rev}


@frappe.whitelist(methods=["POST"])
@write_limit
@refusing
def presentation_slide_write(node: str, slide_id: str, slide: Given = None) -> WrittenPresentation:
    """Replace one slide of a presentation with slide JSON, leaving the others."""
    rev = agent.write_slide(node, slide_id, slide)
    return {**drive.get_node(node), "rev": rev}


@frappe.whitelist(methods=["GET"])
@read_limit
@refusing
def presentation_read(node: str) -> PresentationSlides:
    """Answer a presentation's slides as the JSON a write takes."""
    return agent.read(node)


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
    raise frappe.DoesNotExistError(_("That Slides address does not exist"))


SLIDES_ERRORS = (
    # A field that is missing or wrong, which `refusing` answers as Drive does
    drive.DriveError,
    frappe.RateLimitExceededError,
    drive.DriveNotFound,
    drive.DriveForbidden,
    drive.DriveLocked,
    drive.DriveLinkExpired,
    # A picture a write copies under the presentation counts against the Drive's room
    drive.DriveOverQuota,
    *WRITE_REFUSALS,
)

ROUTES = (
    Route(
        "POST",
        "presentations",
        "presentation_create",
        body=CreatePresentation,
        output=WrittenPresentation,
        errors=(*SLIDES_ERRORS, drive.DriveConflict),
        kind="mutation",
        public_name="presentations.create",
    ),
    Route(
        "POST",
        "presentations/{node}/slides",
        "presentation_write",
        body=WriteSlides,
        output=WrittenPresentation,
        errors=SLIDES_ERRORS,
        kind="mutation",
        public_name="presentations.write",
    ),
    Route(
        "POST",
        "presentations/{node}/slides/{slide_id}",
        "presentation_slide_write",
        body=WriteSlide,
        output=WrittenPresentation,
        errors=SLIDES_ERRORS,
        kind="mutation",
        public_name="presentations.writeSlide",
    ),
    Route(
        "GET",
        "presentations/{node}",
        "presentation_read",
        output=PresentationSlides,
        errors=SLIDES_ERRORS,
        kind="query",
        public_name="presentations.read",
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
        "/api/method/suite.slides.doctype.presentation.presentation.apply_theme",
        "apply_theme",
        body=DeckTheme,
        output=SavedDeck,
        kind="mutation",
        public_name="documents.applyTheme",
        envelope="message",
    ),
    Route(
        "POST",
        "/api/method/suite.slides.doctype.presentation.presentation.update_theme",
        "update_theme",
        body=DeckTheme,
        output=ThemedDeck,
        kind="mutation",
        public_name="documents.updateTheme",
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
    Route(
        "POST",
        "/api/method/suite.slides.api.versions.convert_version",
        "convert_version",
        body=ConvertVersion,
        output=VersionConversion,
        kind="mutation",
        public_name="versions.convert",
        allow_guest=True,
        envelope="message",
    ),
    Route(
        "POST",
        "/api/method/suite.slides.api.recovery.recovery_names",
        "recovery_names",
        body=RecoveryNamesInput,
        output=list[RecoveryName],
        kind="query",
        public_name="recovery.names",
        envelope="message",
    ),
)
