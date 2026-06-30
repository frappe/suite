"""Save flow — the single chokepoint for advancing the head.

The save model (Google Sheets-equivalent, no data loss):

  1. Validate the incoming sheets_data (size + JSON).
  2. Append any client-batched ops to `Sheet Op Log`, allocating
     consecutive monotonic seqs.
  3. Write the implicit `save` op as the final entry of the batch.
  4. Update the live `Sheet` row: sheets_data, head_seq.
  5. Run `snapshots.maybe_snapshot` INLINE — version history must work
     even when no background worker is running (common in dev / small
     deployments). The policy (`_should_snapshot`) clusters rapid saves
     into one snapshot so the cost stays bounded, and the snapshot
     itself is one row insert (~tens of ms for typical sheet sizes).

Why inline beats enqueue:
  * No silent failure modes from a stuck/missing worker.
  * Users see their version appear immediately after Save.
  * Pruning (`tasks.rollup_snapshots`) still runs nightly to cap storage.

Compared with Frappe's default `track_changes`-driven `tabVersion`
inserts, this trades a single fixed cost (~one row insert per op) for
a flat snapshot cap regardless of edit volume.
"""

from __future__ import annotations

import json

import frappe

from suite.sheets.doctype.sheet.storage import (
	MAX_SHEETS_DATA_BYTES,
	decode_sheets_data,
	encode_sheets_data,
)

from . import seq as seq_mod
from . import snapshots as snapshots_mod


MAX_TITLE_LEN = 280
MAX_OPS_PER_SAVE = 500


def save_sheet(
	title: str,
	sheets_data: str,
	name: str | None = None,
	ops: list | str | None = None,
) -> dict:
	"""Create or update a sheet.

	Returns ``{"name": <sheet_id>, "head_seq": <int>}`` so the client
	knows where its ops landed in the canonical order.
	"""
	plain = _validate_payload(sheets_data)
	clean_title = _clean_title(title)
	encoded = encode_sheets_data(plain)
	byte_size = len(plain.encode("utf-8"))
	ops_list = _coerce_ops(ops)

	if name:
		sheet_id, head_seq = _update_existing(name, clean_title, encoded, byte_size, ops_list)
	else:
		sheet_id, head_seq = _insert_new(clean_title, encoded, byte_size, ops_list)

	# Snapshot inline — no worker dependency. A failure here must NOT fail
	# the save; the ops are already persisted (no data loss) and the next
	# save will get a chance to snapshot. We log the error for ops triage.
	try:
		snapshots_mod.maybe_snapshot(sheet_id, expected_head_seq=head_seq)
	except Exception:
		frappe.log_error(
			title="sheets: inline maybe_snapshot failed",
			message=frappe.get_traceback(),
		)
	return {"name": sheet_id, "head_seq": head_seq}


def _insert_new(
	title: str, encoded: str, byte_size: int, ops_list: list[dict]
) -> tuple[str, int]:
	doc = frappe.new_doc("Sheet")
	doc.title = title
	doc.sheets_data = encoded
	doc.head_seq = 0
	doc.insert()
	head_seq = _append_ops_and_save(doc.name, ops_list, byte_size, save_op_type="create")
	frappe.db.set_value("Sheet", doc.name, "head_seq", head_seq, update_modified=False)
	return doc.name, head_seq


def _update_existing(
	name: str, title: str, encoded: str, byte_size: int, ops_list: list[dict]
) -> tuple[str, int]:
	frappe.has_permission("Sheet", doc=name, ptype="write", throw=True)
	head_seq = _append_ops_and_save(name, ops_list, byte_size, save_op_type="save")
	frappe.db.set_value(
		"Sheet",
		name,
		{"title": title, "sheets_data": encoded, "head_seq": head_seq},
		update_modified=True,
	)
	return name, head_seq


def _append_ops_and_save(
	sheet: str, ops_list: list[dict], byte_size: int, save_op_type: str
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
		}
	)
	for row in rows:
		frappe.get_doc(row).insert(ignore_permissions=True)
	return save_seq


def append_op(sheet: str, op: dict) -> int:
	"""Append a single ad-hoc op. Used outside the save path (e.g. realtime)."""
	frappe.has_permission("Sheet", doc=sheet, ptype="write", throw=True)
	new_seq = seq_mod.allocate(sheet)
	frappe.get_doc(_op_doc(sheet, new_seq, op, frappe.session.user)).insert(
		ignore_permissions=True
	)
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


def _clean_title(title: str) -> str:
	t = (title or "").strip() or "Untitled Spreadsheet"
	return t[:MAX_TITLE_LEN]


def _format_bytes(n: int) -> str:
	if n < 1024:
		return f"{n} B"
	if n < 1024 * 1024:
		return f"{n / 1024:.1f} KB"
	return f"{n / (1024 * 1024):.1f} MB"
