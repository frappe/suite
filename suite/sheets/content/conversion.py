"""Turn an old sheet into a collaborative one.

The layer's `convert_document` (suite.content.conversions) runs the converter on the row `read_old`
answers and installs the answer in one transaction under the row's lock. The converter
(frontend/src/apps/sheets/collab/conversion.ts) reads `sheets_data` as today's editor or the develop
editor saved it; `check` refuses a state the layer can't take whole or a copy that doesn't hold it,
before anything writes. `sheets_data` is never written, so a sheet converted wrongly can be converted
again from it.
"""

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime

import frappe

from suite.content import capacity, compaction, convert, copies, updates
from suite.content.conversions import ConversionRefused
from suite.sheets import content as sheets_content
from suite.sheets.doctype.sheet.storage import decode_sheets_data

DOCTYPE = "Sheet"


@dataclass(frozen=True)
class OldSheet:
    docname: str
    legacy: dict = field(repr=False)
    fingerprint: str
    modified: datetime


@dataclass(frozen=True)
class CheckedSheet:
    html: str = field(repr=False)
    dropped: list[dict] = field(default_factory=list)


def old_row(node: str, *, lock: bool = False) -> frappe._dict | None:
    """Load `node`'s row, the lowest name of any it has, or None when it has none."""
    # Must order as app_row.body_row does, as Writer's old_row does
    lock_clause = " FOR UPDATE" if lock else ""
    found = frappe.db.sql(
        f"SELECT `name`, `modified`, `sheets_data` FROM `tab{DOCTYPE}` WHERE `node` = %s "
        f"ORDER BY `name` LIMIT 1{lock_clause}",
        node,
        as_dict=True,
    )
    return found[0] if found else None


def fingerprint_of(row: frappe._dict | dict) -> str:
    """Hash the stored body and when it last changed, so a changed sheet is converted again."""
    modified = row.get("modified")
    material = [row.get("sheets_data"), str(modified) if modified else None]
    return hashlib.sha256(json.dumps(material).encode()).hexdigest()


def read_fingerprint(node: str) -> str:
    """Hash `node`'s old body as `fingerprint_of` does, from the row alone; a gone row hashes as empty."""
    return fingerprint_of(old_row(node) or {})


def read_old(node: str, *, lock: bool = False) -> OldSheet | None:
    """Read the old body as the converter's input, or None once a purge took the row; with `lock`, lock it first."""
    row = old_row(node, lock=lock)
    if row is None:
        return None

    # convert.py reads Writer's `collab` flag off every app's input; a sheet has none
    legacy = {"sheets_data": decoded(row.sheets_data), "collab": 0}
    [[newest]] = frappe.db.sql(f"SELECT MAX(`modified`) FROM `tab{DOCTYPE}` WHERE `node` = %s", node)
    return OldSheet(row.name, legacy, fingerprint_of(row), newest)


def decoded(stored: str | None) -> str | None:
    """The stored body as plain JSON, or the envelope as stored when it can't be opened, which the converter refuses."""
    try:
        return decode_sheets_data(stored)
    except Exception:
        return stored


def check(node: str, old: OldSheet, converted: convert.Converted) -> CheckedSheet:
    """Refuse a state the room can't hold or the layer can't read whole, or a copy that doesn't hold it."""
    if len(converted.state) > capacity.STATE_MAX:
        raise ConversionRefused("too_large")

    # The pushes that edit it later are checked against the schema: a key it refuses would refuse them
    schema = sheets_content.SCHEMA
    if not schema.allows(updates.parse(converted.state), schema.version):
        raise ConversionRefused("check", "schema")

    try:
        if not compaction.compact(converted.state, [], sheets_content.PART_MAP).integrated:
            raise ConversionRefused("check", "fallback")
    except compaction.CompactionFailed as failed:
        raise ConversionRefused("check", failed.reason) from None

    clean, text = copies.cleaned(converted.html)
    if not sheets_content.is_html_complete(converted.state, clean, text):
        raise ConversionRefused("check", "copy")

    return CheckedSheet(clean)


def fix_up(node: str, old: OldSheet, checked: CheckedSheet) -> None:
    """Nothing to move: a sheet's comments are Drive's threads already, and its other stores are in the state."""
