import json
import os
import re
from collections import defaultdict
from pathlib import Path
from unittest.mock import patch

import frappe
import pycrdt

from suite.content import checker, convert
from suite.sheets import content as sheets_content

# The layout file the registration mirrors
SCHEMA_TS = Path(__file__).parents[4] / "frontend/src/apps/sheets/collab/schema.ts"
# What today's editor saves (usePersistence `_workbookJson`): IronCalc 0.9.0 bytes for one sheet,
# Budget, with Rent 1200, Food 350.5 and =SUM(B1:B2) in B4, and B4 bold. Made by a real workbook; a
# new IronCalc that can't read 0.9.0 bytes fails the tests that use it, as it fails the editor
CURRENT_BODY = (Path(__file__).with_name("current_body.json")).read_text()
# What the develop editor saved: typed cells only, packed by sheet-codec.ts, and a sheet name IronCalc
# refuses
DEVELOP_BODY = json.dumps(
    {
        "sheet": {
            "v": 2,
            "sheets": {
                "Budget": {"rows": {"0": ["Item", "Amount"], "1": ["Rent", "1200"]}},
                "Q1/Q2": {"rows": {"2": [None, "=Budget!B2*2"]}},
            },
        },
        "formats": {"Budget": {"cells": {"A1": {"bold": True}}}},
    }
)


def require_converter(case) -> None:
    """Skip without Node or the built bundles, but fail on CI, where a skip would hide a converter that can't run."""
    if checker.usable_node(convert.NODE_MIN) and sheets_content.CONVERTER_BUILD.is_file():
        return

    reason = f"needs Node and the built bundles at {sheets_content.CONVERTER_BUILD.parent}; run bench build"
    if os.environ.get("CI"):
        case.fail(reason)

    case.skipTest(reason)


def in_job(case) -> None:
    """Run as a background job, where the content layer allows Node children."""
    job = patch.object(frappe.local, "job", frappe._dict(job_name="test_sheets_content"), create=True)
    job.start()
    case.addCleanup(job.stop)


def converted(sheets_data: str | None, max_state: int = convert.capacity.STATE_MAX):
    """Run the built converter on one stored body, as the layer does."""
    legacy = {"sheets_data": sheets_data, "collab": 0}
    return convert.convert(
        sheets_content.CONVERTER_BUILD, sheets_content.CONVERTER_VERSION, legacy, max_state
    )


def schema_roots() -> list[str]:
    """The root names schema.ts `ROOT` declares."""
    block = re.search(r"export const ROOT = \{(.*?)\} as const", SCHEMA_TS.read_text(), re.S)
    assert block is not None
    return re.findall(r"^\s*(\w+): '\w+',$", block.group(1), re.M)


def cells_of(state: bytes) -> dict[str, dict[str, str]]:
    """Each sheet's inputs by A1 position, read from a state with pycrdt alone."""
    doc: pycrdt.Doc = pycrdt.Doc()
    doc.apply_update(state)
    meta = doc.get("sheetMeta", type=pycrdt.Map).to_py()
    order = doc.get("sheets", type=pycrdt.Array).to_py()
    rows = doc.get("rows", type=pycrdt.Map).to_py()
    cols = doc.get("cols", type=pycrdt.Map).to_py()
    found: dict[str, dict[str, str]] = defaultdict(dict)
    for name in (meta[sheet]["name"] for sheet in order):
        found[name] = {}

    for key, value in doc.get("inputs", type=pycrdt.Map).to_py().items():
        sheet, row, col = key.split(":")
        position = f"{chr(65 + cols[sheet].index(col))}{rows[sheet].index(row) + 1}"
        found[meta[sheet]["name"]][position] = value

    return dict(found)
