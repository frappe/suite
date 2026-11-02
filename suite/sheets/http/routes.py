"""Wire contracts for Sheets bodies and editor assistance."""

from typing import Literal, NotRequired, TypedDict

from suite.composition.http import Route
from suite.sheets.api import ai_assist, get_ai_settings, get_sheet, save_ai_settings
from suite.sheets.link_preview import get_link_preview


class SheetInput(TypedDict):
    name: str
    compressed: NotRequired[Literal[0, 1]]


class SheetBody(TypedDict):
    name: str
    title: str
    can_write: bool
    sheets_data: str | None
    owner: str
    node: str


class AISettings(TypedDict):
    enabled: bool
    model: str
    keyIsSet: bool


class SaveAISettings(TypedDict, total=False):
    api_key: str
    enabled: Literal[0, 1]
    model: str


class AssistInput(TypedDict):
    name: str
    prompt: str
    selection: str


class AssistResult(TypedDict):
    actions: list[dict[str, object]]
    model: str
    source: str


class LinkInput(TypedDict):
    url: str


class LinkPreview(TypedDict):
    title: str
    description: str
    favicon: str
    host: str


class LinkFailure(TypedDict):
    error: Literal[True]


CONTRACT_ROUTES = (
    Route(
        "GET",
        "/api/method/suite.sheets.api.get_sheet",
        "get_sheet",
        query=SheetInput,
        output=SheetBody,
        kind="query",
        public_name="documents.get",
        allow_guest=True,
        envelope="message",
    ),
    Route(
        "GET",
        "/api/method/suite.sheets.api.get_ai_settings",
        "get_ai_settings",
        output=AISettings,
        kind="query",
        public_name="assistant.settings",
        allow_guest=False,
        envelope="message",
    ),
    Route(
        "POST",
        "/api/method/suite.sheets.api.save_ai_settings",
        "save_ai_settings",
        body=SaveAISettings,
        output=AISettings,
        kind="mutation",
        public_name="assistant.updateSettings",
        allow_guest=False,
        envelope="message",
    ),
    Route(
        "POST",
        "/api/method/suite.sheets.api.ai_assist",
        "ai_assist",
        body=AssistInput,
        output=AssistResult,
        kind="query",
        public_name="assistant.ask",
        allow_guest=False,
        envelope="message",
    ),
    Route(
        "GET",
        "/api/method/suite.sheets.link_preview.get_link_preview",
        "get_link_preview",
        query=LinkInput,
        output=LinkPreview | LinkFailure,
        kind="query",
        public_name="links.preview",
        envelope="message",
    ),
)
