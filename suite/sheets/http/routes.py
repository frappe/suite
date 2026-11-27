"""Wire contracts for Sheets bodies and editor assistance, and the routes an agent writes cells with."""

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
from suite.sheets.api import ai_assist, get_ai_settings, get_conversion, get_sheet, save_ai_settings
from suite.sheets.content import agent
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


class SheetConversion(TypedDict):
    state: Literal["converted", "pending", "refused"]
    # A refused sheet's outcome code, such as `too_large`
    outcome: NotRequired[str]
    reason: NotRequired[str]


class AISettings(TypedDict):
    enabled: bool
    model: str
    keyIsSet: bool


class SaveAISettings(TypedDict, total=False):
    api_key: str
    enabled: Literal[0, 1]
    model: str


class SheetDocument(TypedDict):
    name: str


class AssistInput(TypedDict):
    name: str
    prompt: str
    selection: str
    cells: NotRequired[str]


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


# A cell's value as an agent sends it: null leaves the cell, and "" clears it
Value = str | int | float | bool | None


class SheetCells(TypedDict):
    name: str
    rows: NotRequired[list[list[Value]]]


class CreateSpreadsheet(TypedDict):
    parent: str
    title: str
    sheets: list[SheetCells]


class WriteCells(TypedDict):
    sheet: str
    start: str
    rows: list[list[Value]]


class AppendRows(TypedDict):
    sheet: str
    rows: list[list[Value]]


class WrittenSpreadsheet(drive.NodeShape):
    """The spreadsheet's node as Drive answers it, and the revision the write made."""

    rev: int


class TypedSheet(TypedDict):
    name: str
    rows: list[list[str]]


class SpreadsheetCells(TypedDict):
    sheets: list[TypedSheet]


WRITE_REFUSALS = (agent.SheetsRefused, agent.WriteRefused, agent.WriteBusy)

# As in Drive's handlers, a body field is annotated to take anything and checked in the handler: a narrow
# annotation refuses a wrong type before the handler runs, with no message
Given = str | int | float | bool | list | dict | None
# Each write and read takes the site's one converter, so a loop gone wrong stops here
WRITES_A_MINUTE = 30
write_limit = rate_limit(limit=WRITES_A_MINUTE, seconds=60, ip_based=False, user_based=True)
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
def spreadsheet_create(parent: Given = None, title: Given = None, sheets: Given = None) -> WrittenSpreadsheet:
    """Create a spreadsheet holding sheets of typed cells, as an agent does."""
    node, rev = agent.create(text(parent, "parent"), text(title, "title"), sheets)
    return {**drive.get_node(node), "rev": rev}


@frappe.whitelist(methods=["POST"])
@write_limit
@refusing
def spreadsheet_cells_write(
    node: str, sheet: Given = None, start: Given = None, rows: Given = None
) -> WrittenSpreadsheet:
    """Type a block of cells into a sheet from one cell, leaving the cells around it."""
    rev = agent.write_cells(node, sheet, start, rows)
    return {**drive.get_node(node), "rev": rev}


@frappe.whitelist(methods=["POST"])
@write_limit
@refusing
def spreadsheet_rows_append(node: str, sheet: Given = None, rows: Given = None) -> WrittenSpreadsheet:
    """Type rows into a sheet below its last used row."""
    rev = agent.append_rows(node, sheet, rows)
    return {**drive.get_node(node), "rev": rev}


@frappe.whitelist(methods=["POST"])
@write_limit
@refusing
def spreadsheet_sheet_add(node: str, name: Given = None, rows: Given = None) -> WrittenSpreadsheet:
    """Add a sheet after the others, empty or holding rows from A1."""
    rev = agent.add_sheet(node, name, rows)
    return {**drive.get_node(node), "rev": rev}


@frappe.whitelist(methods=["GET"])
@read_limit
@refusing
def spreadsheet_read(node: str) -> SpreadsheetCells:
    """Answer a spreadsheet's sheets as the cells typed in them, in the form a write takes."""
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
    raise frappe.DoesNotExistError(_("That Sheets address does not exist"))


SHEETS_ERRORS = (
    # A field that is missing or wrong, which `refusing` answers as Drive does
    drive.DriveError,
    frappe.RateLimitExceededError,
    drive.DriveNotFound,
    drive.DriveForbidden,
    drive.DriveLocked,
    drive.DriveLinkExpired,
    *WRITE_REFUSALS,
)

ROUTES = (
    Route(
        "POST",
        "spreadsheets",
        "spreadsheet_create",
        body=CreateSpreadsheet,
        output=WrittenSpreadsheet,
        errors=(*SHEETS_ERRORS, drive.DriveConflict),
        kind="mutation",
        public_name="spreadsheets.create",
    ),
    Route(
        "POST",
        "spreadsheets/{node}/cells",
        "spreadsheet_cells_write",
        body=WriteCells,
        output=WrittenSpreadsheet,
        errors=SHEETS_ERRORS,
        kind="mutation",
        public_name="spreadsheets.writeCells",
    ),
    Route(
        "POST",
        "spreadsheets/{node}/rows",
        "spreadsheet_rows_append",
        body=AppendRows,
        output=WrittenSpreadsheet,
        errors=SHEETS_ERRORS,
        kind="mutation",
        public_name="spreadsheets.appendRows",
    ),
    Route(
        "POST",
        "spreadsheets/{node}/sheets",
        "spreadsheet_sheet_add",
        body=SheetCells,
        output=WrittenSpreadsheet,
        errors=SHEETS_ERRORS,
        kind="mutation",
        public_name="spreadsheets.addSheet",
    ),
    Route(
        "GET",
        "spreadsheets/{node}",
        "spreadsheet_read",
        output=SpreadsheetCells,
        errors=SHEETS_ERRORS,
        kind="query",
        public_name="spreadsheets.read",
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
        "/api/method/suite.sheets.api.get_conversion",
        "get_conversion",
        query=SheetDocument,
        output=SheetConversion,
        kind="query",
        public_name="documents.conversion",
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
