"""Sheets' one declaration to Drive (§10.7).

Drive owns a sheet's title, place, grants, lifecycle, versions, comments, and
byte charge. Sheets owns the body: the workbook in `sheets_data`, the append-only
`Sheet Op Log`, the allocator in `Sheet Seq`, and the collaborative Y.Doc in
`Sheet Collab State`. Everything Drive needs is the `SPEC` below, registered
through the `drive_content_types` hook.

Every callable here takes and returns names, never documents, and reaches Drive
only through `from suite import drive` (ARCHITECTURE.md, rule 2.2).

## What a sheet costs

The body is free. `Sheet.sheets_data` is a column, not a blob, so a sheet's own
bytes are never admitted against a root (§7.1). A version is not free:
`version_bytes` hands Drive one JSON envelope, Drive stores it with `put_blob`
and admits its size, and `delete_version` releases it again.

## The two satellites

`Sheet Op Log` and `Sheet Collab State` take their rights from the sheet's node:
Read to see, Edit to change. `Sheet Snapshot` is deliberately absent. §10.7 drops
it and §14.6 turns its rows into `Drive Node Version` rows field for field, so it
stays a Build source with its own permission guards until Cleanup removes the
doctype (§14.10). Declaring it here would freeze rows Build still has to read.

## The op log across a Drive lifecycle

Every Drive workflow that changes a body writes one op, so the history panel
tells the whole story rather than skipping the operations Drive performs.
`create_empty` writes `create`, `duplicate` writes `create`, `import_from_file`
writes `import`, and `restore_version` writes `restore`. The seq allocator is
`Sheet Seq`, taken with `SELECT ... FOR UPDATE`, so an op written here is
ordered against a concurrent save exactly like every other op.

None of these calls `versioning.save`: that module gates on
`frappe.has_permission("Sheet", ...)`, and by the time Drive reaches a callback
the point check has already run against `Drive Grant`. Asking a second, weaker
question would be the §1 bypass.

## Media

A sheet body names no media node today: there is no image cell, no chart image,
and no attachment. `used_nodes` still answers, and it answers wide. It walks
every string in the decoded workbook at every depth and reports every whole
token that could be a node id, because §10.6 trashes what the app does not
report. Over-reporting only keeps media alive; under-reporting loses a picture.

`remap_media` is deliberately **not** declared. `nodes._copy_document_media`
copies a document's media only for an app that can rewrite its own references,
and a Sheets body has no reference to rewrite. Declaring a no-op would let a
copy carry media nodes that nothing names, charge the destination root for them,
and have §10.6 trash them seven days later. When Sheets grows an image cell,
that ticket declares `remap_media` and narrows `used_nodes` with it.

## Transactions

Drive runs every callback inside the savepoint of the workflow that calls it, so
any refusal rolls the node, the sheet, its ops, and its seq row back together. A
callback that cannot honour its contract raises rather than half-writing, and
none of them commits. `content.call_app` and `content.call_app_stream` enforce
that last part.
"""

import datetime
import io
import json
import re
import zipfile

import frappe
from frappe import _

from suite import drive
from suite.sheets.doctype.sheet.storage import (
    MAX_SHEETS_DATA_BYTES,
    decode_sheets_data,
    encode_sheets_data,
)
from suite.sheets.versioning import seq as seq_mod

DOCTYPE = "Sheet"
MIME = "frappe/sheet"
NODE_FIELD = "node"

OP_LOG_DOCTYPE = "Sheet Op Log"
COLLAB_STATE_DOCTYPE = "Sheet Collab State"
SNAPSHOT_DOCTYPE = "Sheet Snapshot"
SEQ_DOCTYPE = "Sheet Seq"
CELL_DOCTYPE = "Sheet Cell"

# `Sheet.sheets_data`'s own empty value. The editor's loader falls back to a
# fresh `Sheet1` when the packed payload is absent, so `{}` is a valid workbook.
EMPTY_WORKBOOK = "{}"

VERSION_SCHEMA = "sheet/1"
VERSION_MIME = "application/json"

# The compact row-major wire shape the client reads and writes
# (`frontend/src/apps/sheets/utils/sheet-codec.js`). An importer that wrote any
# other shape would load as an empty workbook.
PACK_VERSION = 2
DEFAULT_SUB_SHEET = "Sheet1"

# A media reference, if a body ever holds one, is a whole node id. The pattern
# matches a token no colour, formula, or URL can be: each of those carries a
# character an id cannot.
MEDIA_ID = re.compile(r"[A-Za-z0-9_-]{1,140}")

# Import bounds. The output is capped by `MAX_SHEETS_DATA_BYTES` anyway, but a
# workbook that would exceed it must be refused before it is materialised, not
# after. `MAX_IMPORT_BYTES` bounds the compressed source, and the cell and sheet
# counts bound the parse itself.
MAX_IMPORT_BYTES = 40 * 1024 * 1024
MAX_IMPORT_CELLS = 2_000_000
MAX_IMPORT_SHEETS = 200

XLSX_MIMES = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel.sheet.macroEnabled.12",
    "application/vnd.ms-excel",
)


class UnreadableWorkbook(frappe.ValidationError):
    """One xlsx openpyxl refused to read."""


# ── The ContentTypeSpec callbacks ────────────────────────────────────────────


def create_empty(node: str) -> str:
    """Insert one empty sheet bound to `node`."""
    return _insert_sheet(node, EMPTY_WORKBOOK, op_type="create", summary="Created")


def duplicate(source_docname: str, node: str) -> str:
    """Copy one workbook under a new node, for copy and new-from-template.

    The body is carried. The op log, the snapshots, the seq allocator, and the
    collaborative Y.Doc are not: §8.9 gives a copy no history, and a copy that
    inherited the source's Y.Doc would rebase every editor of the source onto
    the copy.
    """
    stored = frappe.db.get_value(DOCTYPE, source_docname, "sheets_data")
    if stored is None and not frappe.db.exists(DOCTYPE, source_docname):
        frappe.throw(_("The sheet to copy was not found"), frappe.DoesNotExistError)
    return _insert_sheet(node, decode_sheets_data(stored), op_type="create", summary="Copied")


def import_from_file(file_node: str, node: str) -> str:
    """Turn one xlsx file node into a sheet bound to `node` (§10.1).

    Drive has already checked READ on the file and UPLOAD on the destination.
    The bytes come back through `drive.read_file`, because only Sheets can parse
    a workbook and no app reads a `Drive Node` blob itself.

    The import mirrors the browser importer
    (`frontend/src/apps/sheets/components/SheetEditor/useExportImport.js`): every
    worksheet becomes a sub-sheet, each cell carries its value or formula and its
    number format, and the worksheet's merges come across. What the browser gets
    from SheetJS and this does not is a workbook-level style sheet, so borders,
    fills, and fonts are dropped. Losing decoration is recoverable; losing a
    formula or a merge is not, and neither is dropped here.
    """
    stream, _mime = drive.read_file(file_node)
    try:
        raw = stream.read(MAX_IMPORT_BYTES + 1)
    finally:
        stream.close()
    if len(raw) > MAX_IMPORT_BYTES:
        frappe.throw(
            _("That spreadsheet is larger than {0} MB and cannot be imported").format(
                MAX_IMPORT_BYTES // (1024 * 1024)
            ),
            frappe.ValidationError,
        )
    workbook = _workbook_from_xlsx(raw)
    return _insert_sheet(node, workbook, op_type="import", summary="Imported from a spreadsheet file")


def version_bytes(docname: str) -> tuple[io.BytesIO, str]:
    """Return the bytes Drive stores as one immutable version.

    The envelope carries the head seq beside the workbook so a restore can say
    which point in the op log it is putting back, and so §14.6 can map a
    migrated `Sheet Snapshot` onto the same shape.
    """
    row = frappe.db.get_value(DOCTYPE, docname, ("sheets_data", "head_seq"), as_dict=True)
    if not row:
        frappe.throw(_("That sheet was not found"), frappe.DoesNotExistError)
    payload = {
        "schema": VERSION_SCHEMA,
        "sheets_data": decode_sheets_data(row.sheets_data),
        "head_seq": int(row.head_seq or 0),
    }
    return io.BytesIO(json.dumps(payload).encode("utf-8")), VERSION_MIME


def restore_version(docname: str, stream) -> None:
    """Put one stored version back into the body.

    Drive has already taken a version of the current state, so this is not
    destructive. A payload that is not a `sheet/1` envelope is refused rather
    than half-applied: a truncated workbook would read as an empty one.

    The restore is one op of its own, at a fresh seq, so the timeline records it
    and `head_seq` never regresses.
    """
    payload = _version_payload(stream.read())
    if not frappe.db.exists(DOCTYPE, docname):
        frappe.throw(_("That sheet was not found"), frappe.DoesNotExistError)
    restored_seq = _append_op(docname, "restore", f"Restored from seq {payload['head_seq']}")
    frappe.db.set_value(
        DOCTYPE,
        docname,
        {"sheets_data": encode_sheets_data(payload["sheets_data"]), "head_seq": restored_seq},
    )


def on_purge(docname: str) -> None:
    """Delete the sheet and every app-owned row behind it.

    §8.8 sends a purged node's app data with it, so the cascade covers all five
    side tables, including the two `suite/sheets/trash.py` never reached
    (`Sheet Collab State` and the dead `Sheet Cell`). `head_snapshot` is cleared
    first because the framework's link check refuses a delete while it points at
    a `Sheet Snapshot` row.

    `delete_permanently` is what makes a purge a purge. Without it Frappe keeps
    the whole row as JSON in `Deleted Document`
    (`frappe/model/delete_doc.py:add_to_deleted_document`), so the workbook would
    outlive the §8.8 purge that was meant to remove it.
    """
    if frappe.db.exists(DOCTYPE, docname):
        frappe.db.set_value(DOCTYPE, docname, "head_snapshot", None, update_modified=False)
    frappe.db.delete(SNAPSHOT_DOCTYPE, {"sheet": docname})
    frappe.db.delete(OP_LOG_DOCTYPE, {"sheet": docname})
    frappe.db.delete(SEQ_DOCTYPE, {"sheet": docname})
    frappe.db.delete(COLLAB_STATE_DOCTYPE, {"sheet": docname})
    frappe.db.delete(CELL_DOCTYPE, {"parent_sheet": docname})
    frappe.delete_doc(
        DOCTYPE,
        docname,
        force=1,
        ignore_permissions=True,
        ignore_missing=True,
        delete_permanently=True,
    )


def used_nodes(docname: str) -> set[str]:
    """Answer the media node ids this workbook could still name (§10.6).

    Wide on purpose. Every string in the decoded body is read at every depth and
    every whole id-shaped token is reported, so no body shape Sheets has not
    anticipated can make this answer "names nothing" and let the daily sweep
    trash a live picture. A cell holding the word `total` is reported too, which
    costs the sweep nothing.

    A body that will not decode reports nothing it can read rather than raising:
    the sweep must not stop for one bad row, and `_workbook_strings` already
    falls back to the stored text.
    """
    stored = frappe.db.get_value(DOCTYPE, docname, "sheets_data")
    if stored is None and not frappe.db.exists(DOCTYPE, docname):
        return set()
    found: set[str] = set()
    for text in _workbook_strings(stored):
        if MEDIA_ID.fullmatch(text):
            found.add(text)
    return found


SPEC = drive.ContentTypeSpec(
    doctype=DOCTYPE,
    mime=MIME,
    node_field=NODE_FIELD,
    # §10.7, accepted 2026-09-05: Sheets stays hidden over WebDAV for this
    # release, so there is no default export and no export at all. Enabling one
    # is later work, not a requirement of the rewrite.
    default_export=None,
    export_formats=(),
    create_empty=create_empty,
    duplicate=duplicate,
    import_from_file=import_from_file,
    export=None,
    version_bytes=version_bytes,
    restore_version=restore_version,
    pushes_preview=False,
    on_purge=on_purge,
    satellites=(
        drive.Satellite(doctype=OP_LOG_DOCTYPE, link_field="sheet"),
        drive.Satellite(doctype=COLLAB_STATE_DOCTYPE, link_field="sheet"),
    ),
    used_nodes=used_nodes,
    # §14.6 reads all four columns at Build and §14.10 drops them at Cleanup,
    # one release after activation. Declaring them here is what lets ticket 29
    # activate without dropping a Build source early: they stay, frozen, and
    # `refuse_legacy_field_write` refuses every write to them. `head_snapshot`
    # needs no entry; §10.2 does not forbid it.
    legacy_fields=("title", "trashed", "trashed_on", "trashed_by"),
)


# ── The Drive calls Sheets makes ─────────────────────────────────────────────


def node_of(docname: str) -> str | None:
    """Return the Drive node one sheet carries, or None for a legacy row."""
    return frappe.db.get_value(DOCTYPE, docname, NODE_FIELD) or None


def is_drive_native(docname: str) -> bool:
    """True when Drive owns this sheet, false for a legacy row with no node."""
    return bool(node_of(docname))


def refuse_drive_native(docname: str, instead: str) -> None:
    """Refuse a legacy Sheets path on a sheet Drive already owns.

    The split only ever runs one way. A linked sheet is never answered from a
    `File` or a `DocShare`, because that would be a way around `Drive Grant`
    (§1). The legacy path stays for a row Build has not linked.
    """
    if is_drive_native(docname):
        frappe.throw(
            _("Drive owns this sheet. Use {0} instead.").format(instead),
            frappe.ValidationError,
        )


# ── Sheet rows ───────────────────────────────────────────────────────────────


def _insert_sheet(node: str, plain: str, *, op_type: str, summary: str) -> str:
    """Insert one sheet bound to `node`, with its first op."""
    document = frappe.new_doc(DOCTYPE)
    document.set(NODE_FIELD, node)
    document.sheets_data = encode_sheets_data(plain)
    document.head_seq = 0
    document.insert(ignore_permissions=True)
    head_seq = _append_op(document.name, op_type, summary)
    frappe.db.set_value(DOCTYPE, document.name, "head_seq", head_seq, update_modified=False)
    return document.name


def _append_op(sheet: str, op_type: str, summary: str) -> int:
    """Append one op at a freshly allocated seq and return that seq.

    `versioning.save.append_op` is not used: it gates on
    `frappe.has_permission("Sheet", ...)`, and Drive has already answered the
    access question against `Drive Grant`.
    """
    new_seq = seq_mod.allocate(sheet)
    frappe.get_doc(
        {
            "doctype": OP_LOG_DOCTYPE,
            "sheet": sheet,
            "seq": new_seq,
            "op_type": op_type,
            "summary": summary,
            "actor": frappe.session.user,
        }
    ).insert(ignore_permissions=True)
    return new_seq


def _version_payload(raw: bytes) -> dict:
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        payload = None
    if not isinstance(payload, dict) or payload.get("schema") != VERSION_SCHEMA:
        frappe.throw(
            _("This sheet version predates Drive history and cannot be restored"),
            frappe.ValidationError,
        )
    workbook = payload.get("sheets_data")
    if not isinstance(workbook, str) or not workbook:
        frappe.throw(_("This sheet version cannot be read"), frappe.ValidationError)
    try:
        json.loads(workbook)
    except ValueError:
        frappe.throw(_("This sheet version cannot be read"), frappe.ValidationError)
    head_seq = payload.get("head_seq")
    return {"sheets_data": workbook, "head_seq": int(head_seq) if isinstance(head_seq, int) else 0}


def _workbook_strings(stored: str | None):
    """Yield every string in one stored workbook, at every depth.

    A body that will not decode or will not parse yields the stored text itself,
    so an unreadable row still reports whatever it names rather than reporting
    nothing at all.
    """
    if not stored:
        return
    try:
        plain = decode_sheets_data(stored)
        parsed = json.loads(plain)
    except Exception:
        yield from MEDIA_ID.findall(stored)
        return
    stack = [parsed]
    while stack:
        value = stack.pop()
        if isinstance(value, str):
            yield value
        elif isinstance(value, dict):
            stack.extend(value.keys())
            stack.extend(value.values())
        elif isinstance(value, list | tuple):
            stack.extend(value)


# ── xlsx import ──────────────────────────────────────────────────────────────


def _workbook_from_xlsx(raw: bytes) -> str:
    """Parse one xlsx into the workbook JSON the client reads.

    openpyxl is loaded read-only, so the whole workbook is never materialised in
    memory. Read-only worksheets carry no merge ranges, so those are read from
    the package XML directly — the same place openpyxl reads them from.
    """
    from openpyxl import load_workbook
    from openpyxl.utils.exceptions import InvalidFileException

    source = io.BytesIO(raw)
    try:
        book = load_workbook(source, read_only=True, data_only=False)
    except (InvalidFileException, zipfile.BadZipFile, KeyError, ValueError) as unreadable:
        raise UnreadableWorkbook(_("That file is not a spreadsheet Sheets can read")) from unreadable

    try:
        names = list(book.sheetnames)[:MAX_IMPORT_SHEETS]
        merges = _merge_ranges(raw, names)
        packed: dict[str, dict] = {}
        formats: dict[str, dict] = {}
        merged: dict[str, dict] = {}
        seen = 0
        for name in names:
            rows, cell_formats, seen = _read_worksheet(book[name], seen)
            packed[name] = {"rows": rows}
            if cell_formats:
                formats[name] = {"cells": cell_formats, "cols": {}, "rows": {}}
            slice_ = _merge_slice(merges.get(name) or ())
            if slice_:
                merged[name] = slice_
    finally:
        book.close()

    workbook = {
        "sheet": {
            "v": PACK_VERSION,
            "current": names[0] if names else DEFAULT_SUB_SHEET,
            "sheets": packed,
        },
        "formats": formats,
        "merge": merged or None,
    }
    plain = json.dumps(workbook)
    if len(plain.encode("utf-8")) > MAX_SHEETS_DATA_BYTES:
        frappe.throw(
            _("That spreadsheet is over the {0} MB workbook limit").format(
                MAX_SHEETS_DATA_BYTES // (1024 * 1024)
            ),
            frappe.ValidationError,
        )
    return plain


def _read_worksheet(worksheet, seen: int) -> tuple[dict, dict, int]:
    """Pack one worksheet into row arrays plus its per-cell number formats."""
    rows: dict[str, list] = {}
    formats: dict[str, str] = {}
    for row in worksheet.iter_rows():
        for cell in row:
            if cell.value is None:
                continue
            seen += 1
            if seen > MAX_IMPORT_CELLS:
                frappe.throw(
                    _("That spreadsheet has more than {0} cells and cannot be imported").format(
                        MAX_IMPORT_CELLS
                    ),
                    frappe.ValidationError,
                )
            value = _cell_value(cell.value)
            if value == "":
                continue
            row_index = int(cell.row) - 1
            column_index = int(cell.column) - 1
            slots = rows.setdefault(str(row_index), [])
            while len(slots) <= column_index:
                slots.append(None)
            slots[column_index] = value
            number_format = _number_format(getattr(cell, "number_format", None))
            if number_format:
                formats[f"{_column_label(column_index)}{row_index + 1}"] = {
                    "numberFormat": number_format
                }
    return rows, formats, seen


def _cell_value(value) -> str:
    """Render one openpyxl value the way the engine stores it.

    Mirrors `fromXlsxCell` (`frontend/src/apps/sheets/engine/xlsx-io.js`): a
    formula keeps its leading `=`, a date becomes the ISO text `_toDate` reads
    back, a boolean becomes `TRUE`/`FALSE`, and everything else is text.
    """
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, datetime.datetime):
        if value.hour or value.minute or value.second:
            return value.strftime("%Y-%m-%d %H:%M:%S")
        return value.strftime("%Y-%m-%d")
    if isinstance(value, datetime.date):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, datetime.time):
        return value.strftime("%H:%M:%S")
    if isinstance(value, float):
        # `String(42.0)` is "42" in the browser, so a whole float must not
        # arrive as "42.0" and read as text under a numeric format.
        return str(int(value)) if value.is_integer() else repr(value)
    return str(value)


# `zToNumFmt`'s tables (`frontend/src/apps/sheets/engine/xlsx-io.js`), in the
# direction this module needs. A code that is not here is preserved verbatim as
# `custom:<code>`, which is the client's own escape hatch and round-trips
# through an export untouched.
_DATE_FORMATS = {
    "dd/mm/yyyy": "dmy",
    "mm/dd/yyyy": "mdy",
    "yyyy-mm-dd": "ymd",
    "d mmm yyyy": "long",
    "ddd, d mmm yyyy": "full",
}
_TIME_FORMATS = {
    "hh:mm": "hm",
    "hh:mm:ss": "hms",
    "h:mm AM/PM": "hm12",
    "h:mm:ss AM/PM": "hms12",
}
_PLAIN_NUMBER = re.compile(r"^#,##0(\.0+)?$")
_DECIMALS = re.compile(r"\.(0+)")


def _number_format(code: str | None) -> str:
    """Map one Excel number-format code onto the engine's format string."""
    if not code:
        return ""
    trimmed = code.strip()
    if not trimmed or trimmed == "General":
        return ""
    if trimmed == "@":
        return "text"
    if trimmed in _DATE_FORMATS:
        return f"date:{_DATE_FORMATS[trimmed]}"
    if trimmed in _TIME_FORMATS:
        return f"time:{_TIME_FORMATS[trimmed]}"
    space = trimmed.find(" ")
    if space > 0 and trimmed[:space] in _DATE_FORMATS and trimmed[space + 1 :] in _TIME_FORMATS:
        return f"datetime:{_DATE_FORMATS[trimmed[:space]]}_{_TIME_FORMATS[trimmed[space + 1 :]]}"
    if _has_active_percent(trimmed):
        decimals = _decimal_count(trimmed)
        return "percentage" if decimals == 2 else f"percentage:{decimals}"
    if _PLAIN_NUMBER.fullmatch(trimmed):
        decimals = _decimal_count(trimmed)
        return "number" if decimals == 0 else f"number:{decimals}"
    return f"custom:{code}"


def _has_active_percent(code: str) -> bool:
    """True only for a `%` that scales: not quoted and not backslash-escaped."""
    in_quote = False
    index = 0
    while index < len(code):
        character = code[index]
        if character == "\\":
            index += 2
            continue
        if character == '"':
            in_quote = not in_quote
        elif character == "%" and not in_quote:
            return True
        index += 1
    return False


def _decimal_count(code: str) -> int:
    found = _DECIMALS.search(code)
    return len(found.group(1)) if found else 0


def _merge_slice(ranges) -> dict:
    """Build one sheet's merge slice, the shape the merge engine restores."""
    master_map: dict[str, dict] = {}
    slave_map: dict[str, str] = {}
    for row_start, column_start, row_end, column_end in ranges:
        if row_start == row_end and column_start == column_end:
            continue
        master = f"{_column_label(column_start)}{row_start + 1}"
        master_map[master] = {
            "rowSpan": row_end - row_start + 1,
            "colSpan": column_end - column_start + 1,
            "r": row_start,
            "c": column_start,
        }
        for row in range(row_start, row_end + 1):
            for column in range(column_start, column_end + 1):
                if row == row_start and column == column_start:
                    continue
                slave_map[f"{_column_label(column)}{row + 1}"] = master
    if not master_map:
        return {}
    return {"masterMap": master_map, "slaveMap": slave_map}


_MERGE_REF = re.compile(r"^([A-Z]{1,3})([0-9]{1,7}):([A-Z]{1,3})([0-9]{1,7})$")


def _merge_ranges(raw: bytes, names: list[str]) -> dict[str, tuple]:
    """Read every worksheet's merge ranges out of the xlsx package.

    openpyxl's read-only worksheet carries none, and loading the workbook in
    write mode to get them would materialise the whole thing. The package stores
    them as `<mergeCell ref="A1:B2"/>` inside each worksheet part, so they are
    read from there, in the sheet order the workbook declares.
    """
    from xml.etree import ElementTree

    found: dict[str, tuple] = {}
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as package:
            parts = sorted(
                item
                for item in package.namelist()
                if item.startswith("xl/worksheets/sheet") and item.endswith(".xml")
            )
            parts.sort(key=_worksheet_order)
            for name, part in zip(names, parts, strict=False):
                ranges = []
                with package.open(part) as handle:
                    for _event, element in ElementTree.iterparse(handle, ("end",)):
                        if not element.tag.endswith("}mergeCell") and element.tag != "mergeCell":
                            element.clear()
                            continue
                        parsed = _parse_merge_ref(element.get("ref"))
                        if parsed:
                            ranges.append(parsed)
                        element.clear()
                if ranges:
                    found[name] = tuple(ranges)
    except (zipfile.BadZipFile, KeyError, ElementTree.ParseError):
        # A package this cannot walk still imports; it imports without merges.
        return {}
    return found


def _worksheet_order(part: str) -> tuple:
    digits = "".join(character for character in part if character.isdigit())
    return (int(digits) if digits else 0, part)


def _parse_merge_ref(ref: str | None) -> tuple | None:
    found = _MERGE_REF.fullmatch((ref or "").strip().upper())
    if not found:
        return None
    column_start = _column_index(found.group(1))
    row_start = int(found.group(2)) - 1
    column_end = _column_index(found.group(3))
    row_end = int(found.group(4)) - 1
    if row_start > row_end or column_start > column_end:
        return None
    return (row_start, column_start, row_end, column_end)


def _column_label(index: int) -> str:
    """0 -> A, 25 -> Z, 26 -> AA. Mirrors `colLabel` and `cell_codec._col_label`."""
    label = ""
    index += 1
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        label = chr(65 + remainder) + label
    return label


def _column_index(label: str) -> int:
    index = 0
    for character in label:
        index = index * 26 + (ord(character) - 64)
    return index - 1
