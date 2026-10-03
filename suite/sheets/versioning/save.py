"""Save flow — the single chokepoint for advancing the head.

The save model (no data loss):

  1. Validate the incoming sheets_data (size + JSON).
  2. Append any client-batched ops to `Sheet Op Log`, allocating
     consecutive monotonic seqs.
  3. Write the implicit `save` op as the final entry of the batch.
  4. Update the live `Sheet` row: sheets_data, head_seq.
  5. Take a `Drive Node Version` INLINE when the newest one is older than
     `AUTO_VERSION_SECS`, so version history works with no background worker
     and rapid saves cluster into one version. A failure there never fails
     the save: the ops are already persisted.

A sheet is created through Drive (`drive.create_document`, behind
`suite.sheets.api.create_sheet`), never here, and Drive owns its title.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import get_datetime, now_datetime

from suite import drive
from suite.sheets.doctype.sheet.storage import (
    MAX_SHEETS_DATA_BYTES,
    decode_sheets_data,
    encode_sheets_data,
)
from suite.sheets.drive import node_of, require_sheet

from . import seq as seq_mod

MAX_OPS_PER_SAVE = 500
AUTO_VERSION_SECS = 30


def save_sheet(
    name: str,
    sheets_data: str,
    ops: list | str | None = None,
    request_id: str | None = None,
) -> dict:
    """Write one sheet's body and return ``{"name", "head_seq"}``.

    ``head_seq`` tells the client where its ops landed in the canonical order.
    A ``request_id`` the log already carries answers the seq it landed at
    without writing anything again.
    """
    if not name:
        frappe.throw(_("A sheet is created through Drive"), frappe.ValidationError)
    require_sheet(name, write=True)
    if request_id:
        completed_seq = frappe.db.get_value("Sheet Op Log", {"sheet": name, "request_id": request_id}, "seq")
        if completed_seq is not None:
            return {"name": name, "head_seq": int(completed_seq)}

    plain = _validate_payload(sheets_data)
    encoded = encode_sheets_data(plain)
    byte_size = len(plain.encode("utf-8"))
    ops_list = _coerce_ops(ops)

    head_seq = _append_ops_and_save(name, ops_list, byte_size, save_op_type="save", request_id=request_id)
    # The op log is the single chokepoint for advancing the head, so the row is
    # written directly rather than through the document lifecycle.
    frappe.db.set_value(
        "Sheet",
        name,
        {"sheets_data": encoded, "head_seq": head_seq},
        update_modified=True,
    )

    try:
        _maybe_take_version(name)
    except Exception:
        frappe.log_error(title="sheets: inline version failed", message=frappe.get_traceback())
    return {"name": name, "head_seq": head_seq}


def _maybe_take_version(name: str) -> None:
    """Take an automatic version unless one was taken in the last `AUTO_VERSION_SECS`."""
    node = node_of(name)
    newest = drive.list_versions(node, limit=1)["rows"]
    if newest:
        age = (now_datetime() - get_datetime(newest[0]["creation"])).total_seconds()
        if age < _conf_int("versioning_auto_snapshot_secs", AUTO_VERSION_SECS):
            return
    drive.take_version(node, kind="auto")


def _conf_int(key: str, default: int) -> int:
    try:
        return int(frappe.conf.get(key) or default)
    except (TypeError, ValueError):
        return default


def _append_ops_and_save(
    sheet: str,
    ops_list: list[dict],
    byte_size: int,
    save_op_type: str,
    request_id: str | None = None,
) -> int:
    """Append the user ops + the implicit save op as one contiguous range.

    Returns the final seq (the save op's seq).
    """
    total = len(ops_list) + 1
    first_seq = seq_mod.allocate(sheet, count=total)
    actor = frappe.session.user
    rows: list[dict] = []
    for i, op in enumerate(ops_list):
        rows.append(_op_doc(sheet, first_seq + i, op, actor))
    save_seq = first_seq + total - 1
    rows.append(
        {
            "doctype": "Sheet Op Log",
            "sheet": sheet,
            "seq": save_seq,
            "op_type": save_op_type,
            "summary": f"Saved ({_format_bytes(byte_size)})",
            "actor": actor,
            "request_id": request_id,
        }
    )
    for row in rows:
        frappe.get_doc(row).insert(ignore_permissions=True)
    return save_seq


def append_op(sheet: str, op: dict) -> int:
    """Append a single ad-hoc op. Used outside the save path (e.g. realtime)."""
    require_sheet(sheet, write=True)
    new_seq = seq_mod.allocate(sheet)
    frappe.get_doc(_op_doc(sheet, new_seq, op, frappe.session.user)).insert(ignore_permissions=True)
    # Advance head_seq only forward — never regress.
    frappe.db.sql(
        "UPDATE `tabSheet` SET head_seq = GREATEST(IFNULL(head_seq, 0), %s) WHERE name = %s",
        (new_seq, sheet),
    )
    return new_seq


def _op_doc(sheet: str, seq: int, op: dict, actor: str) -> dict:
    # Accept both snake_case and camelCase keys so the client can pass either.
    op_type = op.get("op_type") or op.get("opType")
    if not op_type:
        frappe.throw("op_type is required")
    return {
        "doctype": "Sheet Op Log",
        "sheet": sheet,
        "seq": seq,
        "op_type": op_type,
        "sub_sheet": op.get("sub_sheet") or op.get("subSheet"),
        "cell_refs": op.get("cell_refs") or op.get("cellRefs"),
        "before_json": op.get("before") or op.get("before_json"),
        "after_json": op.get("after") or op.get("after_json"),
        "summary": op.get("summary") or "",
        "actor": actor,
    }


def _coerce_ops(ops) -> list[dict]:
    if ops is None or ops == "":
        return []
    if isinstance(ops, str):
        try:
            ops = json.loads(ops)
        except (TypeError, ValueError):
            frappe.throw("ops must be a JSON array")
    if not isinstance(ops, list):
        frappe.throw("ops must be a JSON array")
    if len(ops) > MAX_OPS_PER_SAVE:
        frappe.throw(f"Too many ops in one save (max {MAX_OPS_PER_SAVE})")
    return ops


def _validate_payload(sheets_data: str) -> str:
    if not isinstance(sheets_data, str):
        frappe.throw("sheets_data must be a JSON string")
    plain = decode_sheets_data(sheets_data)
    size = len(plain.encode("utf-8"))
    if size > MAX_SHEETS_DATA_BYTES:
        limit_mb = MAX_SHEETS_DATA_BYTES // (1024 * 1024)
        frappe.throw(
            f"This spreadsheet is {_format_bytes(size)}, over the {limit_mb} MB limit. "
            f"Formatting applied across a very large range is the usual cause — clear "
            f"formatting you don't need, or split the data across sheets."
        )
    try:
        json.loads(plain)
    except (ValueError, TypeError):
        frappe.throw("sheets_data is not valid JSON")
    return plain


def _format_bytes(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n / (1024 * 1024):.1f} MB"
