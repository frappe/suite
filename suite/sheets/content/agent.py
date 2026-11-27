"""Writing and reading a spreadsheet's cells in a request with no tab open, as an agent does.

The converter child does the work on the doc (frontend/src/apps/sheets/collab/agent.ts): it checks the
agent's values, and a write's update is the one a tab's typing would make, on the write's own session. It
words nothing, so a refusal it names is worded here.
"""

import base64
import json
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import cast

import frappe
import pycrdt
from frappe import _
from frappe.utils.file_lock import LockTimeoutError
from frappe.utils.synchronization import filelock

from suite import content, drive
from suite.content import ChainBroken, checker, convert, jobs
from suite.sheets.content import APP, CONVERTER_BUILD, EDITOR
from suite.sheets.content.readable_copy import NEEDS_BUILD

# A Drive title is a Data field, which holds this many characters
TITLE_MAX = 140
# The layer's refusals that pass by themselves: another push holds the spreadsheet, a compaction makes
# room, or a restore is landing or landed under the write
PASSING = ("busy", "compacting", "restoring", "restored")
# Adding rows and adding a sheet pick their place from a read, so two at once would land rows on the same
# row, or pass the sheet cap or both take one name. They take turns on one lock for the site, as every
# write waits on its one converter anyway: one waits this long for the turn, then answers busy
TURN_LOCK = "sheets_agent_turn"
TURN_WAIT_S = 10
TURN_RETRY_MS = 1000
# A values read holds the site's one converter this long at most; the typed read and writes keep the default
VALUES_TIMEOUT_S = 10
# A values read killed for time or ended by the child's memory cap fails the same way at the same rev, so
# it is refused there without the converter for this long
TOO_HEAVY_S = 3600
TOO_HEAVY_KEY = "sheets_agent_too_heavy:{node}"
# What agent.ts refuses, by its reason; `sheet` and `cell` name where
REASONS = {
    "no_sheets": "sheets must list at least one sheet",
    "too_many_sheets": "A spreadsheet holds at most 200 sheets",
    "name": "A sheet's name must be 1 to 31 characters, with none of [ ] : * ? / \\",
    "taken": "The spreadsheet already has a sheet named {sheet}",
    "no_sheet": "The spreadsheet has no sheet named {sheet}",
    "start": "start must be a cell such as B2, inside the sheet",
    "rows": "rows must be a list of rows, each a list of values",
    "value": "A value must be text, a number, true, false or null",
    "too_long": "{cell} on {sheet}: a cell holds at most 32,767 characters",
    "too_many_cells": "A write holds at most 10,000 cells",
    "past_grid": "The rows run past the last row or column of {sheet}",
    "merged": "{cell} on {sheet} is under a merged cell: send null for it",
    "protected": "{cell} on {sheet} is protected",
    "too_large": "The spreadsheet is too large to read in one call",
    "too_many_values": "A values read shows at most 50,000 cells with a value: read the spreadsheet as typed",
    "too_heavy": "The formulas take too long or too much memory to work out here: read the spreadsheet as typed",
}


class SheetsRefused(frappe.ValidationError):
    """The cells hold what a spreadsheet can't keep."""

    http_status_code = 422


class WriteRefused(frappe.ValidationError):
    """The spreadsheet refuses the write, for the reason a tab's edit gets."""

    http_status_code = 409


class WriteBusy(frappe.ValidationError):
    """The spreadsheet or the converter is busy; the same call works later."""

    http_status_code = 429

    def __init__(self, *args: object, retry_ms: int | None = None) -> None:
        super().__init__(*args)
        self.retry_ms = retry_ms


class Unchanged(Exception):
    """The write holds only what the cells hold already."""


@dataclass(frozen=True)
class Logged:
    """A spreadsheet's log as it stands: the rev at its head, its checkpoint and the rows after it."""

    head: int
    checkpoint: bytes | None
    rows: list[bytes]


def create(parent: str, title: str, sheets: object) -> tuple[str, int]:
    """Create a spreadsheet in the folder `parent` holding `sheets`, and answer its node and rev."""
    if len(title) > TITLE_MAX:
        raise frappe.ValidationError(_("title must be {0} characters or fewer").format(TITLE_MAX))

    # Before the converter runs, so a user who can't add here takes none of its turn
    drive.check(parent, drive.UPLOAD)
    write = {"kind": "sheets", "sheets": sheets}
    # On an empty doc first: the write's session commits the new node, so a refused one would stay
    answered({"write": write})
    node = drive.create_document(parent, title, content_doctype=EDITOR.doctype)
    return node, push(node, write)


def write_cells(node: str, sheet: object, start: object, rows: object) -> int:
    """Type `rows` into the sheet named `sheet` from the cell `start`, and answer the rev that makes."""
    writable(node)
    return push(node, {"kind": "cells", "sheet": sheet, "start": start, "rows": rows})


def append_rows(node: str, sheet: object, rows: object) -> int:
    """Type `rows` into the sheet named `sheet` below its last used row, and answer the rev that makes."""
    writable(node)
    return in_turn(node, {"kind": "rows", "sheet": sheet, "rows": rows})


def add_sheet(node: str, name: object, rows: object) -> int:
    """Add a sheet named `name` after the others, holding `rows` from A1, and answer the rev that makes."""
    writable(node)
    sheet = {"name": name}
    if rows is not None:
        sheet["rows"] = rows

    return in_turn(node, {"kind": "sheets", "sheets": [sheet]})


def in_turn(node: str, write: dict) -> int:
    """Push `write` while no other write that picks its place from a read runs, and answer its rev."""
    try:
        # Around the whole write: its read starts a new snapshot, so it sees what the last one pushed
        with filelock(TURN_LOCK, timeout=TURN_WAIT_S):
            return push(node, write)
    except LockTimeoutError:
        raise WriteBusy(
            _("Another write that adds rows or a sheet is landing. Try again."), retry_ms=TURN_RETRY_MS
        ) from None


def read(node: str) -> dict:
    """Answer each sheet's cells as typed, from A1 to its last used row, in the form a write takes."""
    logged = readable(node)
    return {"sheets": answered({"read": True}, logged.checkpoint, logged.rows)["sheets"]}


def values(node: str) -> dict:
    """Answer each sheet's cells as a tab shows them, in the typed read's shape: a formula as its result."""
    logged = readable(node)
    too_heavy = TOO_HEAVY_KEY.format(node=node)
    if frappe.cache.get_value(too_heavy) == logged.head:
        raise SheetsRefused(_(REASONS["too_heavy"]))

    try:
        answer = asked({"values": True}, logged.checkpoint, logged.rows, VALUES_TIMEOUT_S)
    except checker.CheckerBusy:
        raise no_answer() from None
    except checker.CheckerFailed as failed:
        if not isinstance(failed.__cause__, subprocess.TimeoutExpired | subprocess.CalledProcessError):
            raise no_answer() from None

        # Only the refusal is kept: a write moves the head, and the next read tries again
        frappe.cache.set_value(too_heavy, logged.head, expires_in_sec=TOO_HEAVY_S)
        raise SheetsRefused(_(REASONS["too_heavy"])) from None

    return {"sheets": answer["sheets"]}


def readable(node: str) -> Logged:
    """Answer the log of the spreadsheet the user can read, as it stands."""
    if drive.check(node, drive.READ) != EDITOR.doctype:
        raise drive.DriveNotFound(_("That spreadsheet was not found"))

    return logged_parts(node)


def writable(node: str) -> None:
    """Refuse a write to what isn't a spreadsheet the user can edit."""
    if drive.check(node, drive.EDIT) != EDITOR.doctype:
        raise drive.DriveNotFound(_("That spreadsheet was not found"))


def logged_parts(node: str) -> Logged:
    """Answer the spreadsheet's log as it stands."""
    log = content.find(APP, node)
    try:
        snapshot = log and content.read(APP, log.id)
    except ChainBroken:
        # A push or a compaction landed between the read's queries, twice; the next read finds the rows whole
        raise WriteBusy(_("The spreadsheet changed during the read. Try again.")) from None

    if not snapshot:
        jobs.request_conversion(APP, node)
        raise WriteBusy(_("This spreadsheet is not converted yet. Try again in a minute."))

    return Logged(snapshot.head_rev, snapshot.checkpoint, snapshot.payloads())


def answered(header: dict, checkpoint: bytes | None = None, rows: Sequence[bytes] = ()) -> dict:
    """Ask the converter child for the agent's `header` on a doc's parts, and answer its reply."""
    try:
        return asked(header, checkpoint, rows)
    except checker.CheckerFailed:
        # Busy, out of time or crashed: the spreadsheet is not at fault, so the same call works later
        raise no_answer() from None


def no_answer() -> WriteBusy:
    """Answer the refusal for a converter that gave no answer."""
    return WriteBusy(_("The converter gave no answer. Try again in a moment."))


def asked(
    header: dict, checkpoint: bytes | None, rows: Sequence[bytes], timeout_s: float | None = None
) -> dict:
    """Answer the converter child's reply to `header` on a doc's parts; its failure stays CheckerFailed."""
    try:
        # The child's JSON.parse takes no NaN or Infinity, and a refusal names a bad value better than a crash
        json.dumps(header, allow_nan=False)
    except ValueError:
        raise SheetsRefused(_(REASONS["value"])) from None

    answer = checker.ask(
        CONVERTER_BUILD, header, checkpoint, rows, minimum=convert.NODE_MIN, timeout_s=timeout_s
    )
    if answer is None:
        raise RuntimeError(NEEDS_BUILD)

    refused = answer.get("refused")
    if refused:
        words = {"sheet": refused.get("sheet"), "cell": refused.get("cell")}
        raise SheetsRefused(_(REASONS[refused["reason"]]).format(**words))

    return answer


def push(node: str, write: dict) -> int:
    """Push `write` to the spreadsheet as the request's user, and answer the rev it makes."""
    try:
        return content.write(APP, node, writing(write))
    except Unchanged:
        # A write sent again after a lost answer lands as nothing, and answers where the spreadsheet is
        log = content.find(APP, node)
        if not log:
            raise drive.DriveNotFound(_("That spreadsheet was not found")) from None

        return int(log.head_rev)
    except content.Refusal as refusal:
        reason = refusal.body["collab"]
        if reason == "not_found":
            # The spreadsheet went away after the access check
            raise drive.DriveNotFound(_("That spreadsheet was not found")) from None

        if reason == "paused" and refusal.body.get("reason") == "restoring":
            reason = "restoring"

        if reason in PASSING:
            raise WriteBusy(reason, retry_ms=cast("int | None", refusal.body.get("retry_ms"))) from None

        if reason == "unconverted":
            jobs.request_conversion(APP, node)

        raise WriteRefused(reason) from None


def writing(write: dict) -> Callable[[pycrdt.Doc], None]:
    """Answer the change that applies the child's update for `write` to the doc as it stands."""

    def change(state: pycrdt.Doc) -> None:
        # The child makes the update on the write's session, so it lands as that session's own
        update = answered({"write": write, "client": state.client_id}, state.get_update())["update"]
        if update is None:
            raise Unchanged

        state.apply_update(base64.b64decode(update))

    return change
