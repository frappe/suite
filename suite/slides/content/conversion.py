"""Turn an old deck into a collaborative one.

The layer's `convert_document` (suite.content.conversions) runs the converter on what `read_old` answers
and installs the answer in one transaction under the row's lock. Python repairs the ids first (Q160): a
slide with no id or a used one gets a new one, as does an element whose id another element in the deck holds, and
a connector end stays on the first element its id named on that slide, the one the old view draws it to. A
refId stays: it is the link Magic Move shares across slides, never an element's id, so changing one would break
the pair (Q148). Magic Move pairs on `refId || id`, so a renamed element with no refId takes its old id as one,
unless that key already stands for another element on its slide. A table pairs on its id alone, so one that
would need a new id leaves the deck refused. The converter
(frontend/src/apps/slides/collab/conversion.ts) does the rest. The Slide rows are never written, so a
deck converted wrongly can be converted again from them.
"""

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

import frappe

from suite.content import capacity, compaction, convert, updates
from suite.content.conversions import ConversionRefused
from suite.slides import content as slides_content

DOCTYPE = "Presentation"
# Each Slide column the converter reads, by the name the deck gives it
SLIDE_COLUMNS = {
    "background": "background",
    "transition": "transition",
    "transition_duration": "transitionDuration",
    "fade_unmatched_elements": "fadeUnmatchedElements",
    "advance_after": "advanceAfter",
}
NEW_ID_LENGTH = 9
SCALAR_ID = (str, int, float)


class TableKeyLost(Exception):
    """A table holds an id that isn't its own, and Magic Move pairs a table on its id alone."""


@dataclass(frozen=True)
class OldDeck:
    docname: str
    legacy: dict = field(repr=False)
    fingerprint: str
    modified: datetime


@dataclass(frozen=True)
class CheckedDeck:
    # The rows stay the deck's readable copy, so no HTML copy is kept
    html: str = field(default="", repr=False)
    dropped: list[dict] = field(default_factory=list)


def old_row(node: str, *, lock: bool = False) -> frappe._dict | None:
    """Load `node`'s row, the lowest name of any it has, or None when it has none."""
    # Must order as app_row.body_row does
    lock_clause = " FOR UPDATE" if lock else ""
    found = frappe.db.sql(
        f"SELECT `name`, `modified`, `is_composite` FROM `tab{DOCTYPE}` WHERE `node` = %s "
        f"ORDER BY `name` LIMIT 1{lock_clause}",
        node,
        as_dict=True,
    )
    if not found:
        return None

    return found[0]


def slide_rows(docname: str) -> list[frappe._dict]:
    """Load a deck's Slide rows in their order."""
    columns = ", ".join(f"`{column}`" for column in SLIDE_COLUMNS)
    return frappe.db.sql(
        f"SELECT `client_id`, `elements`, {columns} "
        "FROM `tabSlide` WHERE `parent` = %s AND `parenttype` = %s ORDER BY `idx`",
        (docname, DOCTYPE),
        as_dict=True,
    )


def fingerprint_of(row: frappe._dict | None) -> str:
    """Hash the deck's rows and when it last changed, so a changed deck is converted again."""
    if row is None:
        material = [None, None]
    else:
        material = [slide_rows(row.name), str(row.modified)]

    return hashlib.sha256(json.dumps(material, default=str).encode()).hexdigest()


def read_fingerprint(node: str) -> str:
    """Hash `node`'s old deck as `fingerprint_of` does, from the rows alone; a gone row hashes as empty."""
    return fingerprint_of(old_row(node))


def read_old(node: str, *, lock: bool = False) -> OldDeck | None:
    """Read the old deck as the converter's input, or None if it can't convert; with `lock`, lock it first."""
    row = old_row(node, lock=lock)
    # A combined deck has no slides of its own and stays as it is (Q154)
    if row is None or row.is_composite:
        return None

    [[newest]] = frappe.db.sql(f"SELECT MAX(`modified`) FROM `tab{DOCTYPE}` WHERE `node` = %s", node)
    # convert.py reads Writer's `collab` flag off every app's input; a deck has none
    legacy = {**legacy_deck(row.name, slide_rows(row.name)), "collab": 0}
    return OldDeck(row.name, legacy, fingerprint_of(row), newest)


def legacy_deck(docname: str, rows: list[frappe._dict]) -> dict:
    """Parse and repair a deck's rows, or say they don't parse: only the converter refuses."""
    parsed = [parsed_elements(row.elements) for row in rows]
    if any(elements is None for elements in parsed):
        return {"slides": [], "isUnreadable": True}

    try:
        return {"slides": repaired_slides(docname, rows, parsed)}
    except TableKeyLost:
        return {"slides": [], "isTableKeyLost": True}


def parsed_elements(value: str | None) -> list[dict] | None:
    """Read a row's `elements`: an empty row has none, and anything but a list of objects doesn't parse."""
    if not value:
        return []

    try:
        elements = json.loads(value)
    except ValueError:
        return None

    if not isinstance(elements, list) or not all(isinstance(element, dict) for element in elements):
        return None

    return elements


def repaired_slides(docname: str, rows: list[frappe._dict], parsed: list[list[dict]]) -> list[dict]:
    """Give every slide and element an id of its own, first holder keeping it; nothing is dropped."""
    held = {row.client_id for row in rows}
    for elements in parsed:
        held.update(element["id"] for element in elements if isinstance(element.get("id"), str))

    # Stable across reads, since the conversion reads again under the lock and compares
    made = (hashlib.sha256(f"{docname}:{at}".encode()).hexdigest()[:NEW_ID_LENGTH] for at in range(10**6))

    def new_id() -> str:
        fresh = next(candidate for candidate in made if candidate not in held)
        held.add(fresh)
        return fresh

    seen: set[str] = set()
    slides: list[dict] = []
    for row, elements in zip(rows, parsed, strict=True):
        slide_id = row.client_id
        if not slide_id or slide_id in seen:
            slide_id = new_id()

        seen.add(slide_id)
        slides.append(
            {
                "id": slide_id,
                "elements": repaired_elements(elements, seen, new_id),
                **{name: row[column] for column, name in SLIDE_COLUMNS.items() if row[column] is not None},
            }
        )

    return slides


def repaired_elements(elements: list[dict], seen: set[str], new_id: Callable[[], str]) -> list[dict]:
    """Give a slide's elements ids no earlier item holds, keeping what connectors and Magic Move read from the old ones."""
    keys = {element["refId"] for element in elements if isinstance(element.get("refId"), SCALAR_ID)}
    targets: dict = {}
    for element in elements:
        old_id = element.get("id")
        if not isinstance(old_id, str) or not old_id or old_id in seen:
            element["id"] = new_id()
            keep_magic_move_key(element, old_id, keys)
        elif not element.get("refId"):
            keys.add(old_id)

        seen.add(element["id"])
        if isinstance(old_id, SCALAR_ID):
            targets.setdefault(old_id, element["id"])

    for element in elements:
        connector = element.get("connector")
        if isinstance(connector, dict):
            follow_targets(connector, targets)

    return elements


def keep_magic_move_key(element: dict, old_id: object, keys: set) -> None:
    """Give a renamed element its old id as a refId, unless its slide has that key; a renamed table can't keep one."""
    if not old_id or not isinstance(old_id, SCALAR_ID):
        return

    if element.get("type") == "table":
        raise TableKeyLost

    if element.get("refId"):
        return

    key = str(old_id)
    if key not in keys:
        keys.add(key)
        element["refId"] = key


def follow_targets(connector: dict, targets: dict) -> None:
    """Point a connector's ends at the elements their old ids resolved to on this slide."""
    for end in ("start", "end"):
        bound = connector.get(end)
        if not isinstance(bound, dict):
            continue

        element_id = bound.get("elementId")
        if isinstance(element_id, SCALAR_ID) and element_id in targets:
            connector[end] = {**bound, "elementId": targets[element_id]}


def check(node: str, old: OldDeck, converted: convert.Converted) -> CheckedDeck:
    """Refuse a state the layer can't take whole, before anything writes."""
    if len(converted.state) > capacity.STATE_MAX:
        raise ConversionRefused("too_large")

    try:
        if not compaction.compact(converted.state, [], slides_content.PART_MAP).integrated:
            raise ConversionRefused("check", "fallback")
    except compaction.CompactionFailed as failed:
        raise ConversionRefused("check", failed.reason) from None

    schema = slides_content.SCHEMA
    if not schema.allows(updates.parse(converted.state), schema.version):
        raise ConversionRefused("check", "schema")

    return CheckedDeck()


def fix_up(node: str, old: OldDeck, checked: CheckedDeck) -> None:
    """Nothing to move: the Slide rows stay as they were, and Drive already holds the deck's comments."""
