"""Assemble a compact, model-friendly view of a worksheet.

The whole workbook blob is far too large (and too private) to hand to the
model. Instead we send only what's needed to write a correct formula against
the user's selection: the header row, an inferred type per column, a bounded
sample of data rows, and the current selection in A1 notation. Everything is
hard-capped (rows, columns, total bytes) so a huge sheet can't blow the
request up — `truncated` tells the model the view is partial.

The cell map handed in is the flat ``{cellId: rawValue}`` form stored under
``decoded["sheet"]["sheets"][sheetName]`` — values are raw primitives, and a
formula is just a string beginning with ``=``.
"""

import re

_CELL_RE = re.compile(r"^([A-Za-z]+)([0-9]+)$")

MAX_SAMPLE_ROWS = 25
MAX_COLS = 40
MAX_CONTEXT_BYTES = 12_000


def col_to_letters(c: int) -> str:
	"""0-indexed column number → spreadsheet letters (0 → 'A', 26 → 'AA')."""
	s = ""
	c += 1
	while c:
		c, rem = divmod(c - 1, 26)
		s = chr(65 + rem) + s
	return s


def parse_cell(cid: str):
	"""'B2' → (row, col) 0-indexed, or None if it isn't a plain cell id."""
	m = _CELL_RE.match(cid or "")
	if not m:
		return None
	letters, digits = m.group(1).upper(), m.group(2)
	col = 0
	for ch in letters:
		col = col * 26 + (ord(ch) - 64)
	return int(digits) - 1, col - 1


def _selection_a1(sel: dict) -> dict:
	"""Render the selection rectangle + active cell in A1 notation."""
	try:
		r0, c0 = int(sel.get("r0", 0)), int(sel.get("c0", 0))
		r1, c1 = int(sel.get("r1", r0)), int(sel.get("c1", c0))
	except (TypeError, ValueError):
		r0 = c0 = r1 = c1 = 0
	lo_r, hi_r = sorted((r0, r1))
	lo_c, hi_c = sorted((c0, c1))
	start = f"{col_to_letters(lo_c)}{lo_r + 1}"
	end = f"{col_to_letters(hi_c)}{hi_r + 1}"
	rng = start if start == end else f"{start}:{end}"
	return {"range": rng, "active": sel.get("active") or start}


def _infer_type(values: list) -> str:
	"""Cheap per-column type from its sampled values."""
	seen = False
	for v in values:
		if v is None or v == "":
			continue
		seen = True
		if isinstance(v, str) and v.startswith("="):
			return "formula"
		if isinstance(v, (int, float)):
			continue
		if isinstance(v, str):
			if re.match(r"^-?\d+(\.\d+)?$", v.strip()):
				continue
			if re.match(r"^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}", v.strip()):
				return "date"
			return "text"
		return "text"
	return "number" if seen else "empty"


def build_context(cell_map: dict, sheet_name: str, sel: dict) -> dict:
	"""Build the compact context dict sent to the model."""
	cells = {}
	max_r = max_c = -1
	for cid, val in (cell_map or {}).items():
		pc = parse_cell(cid)
		if pc is None:
			continue
		r, c = pc
		cells[(r, c)] = val
		if r > max_r:
			max_r = r
		if c > max_c:
			max_c = c

	selection = _selection_a1(sel or {})
	if max_r < 0:
		return {"sheet_name": sheet_name, "empty": True, "selection": selection}

	ncols = min(max_c + 1, MAX_COLS)
	nrows = min(max_r + 1, MAX_SAMPLE_ROWS)

	headers = {}
	for c in range(ncols):
		v = cells.get((0, c))
		if v not in (None, ""):
			headers[col_to_letters(c)] = v

	column_types = {}
	for c in range(ncols):
		col_vals = [cells.get((r, c)) for r in range(1, nrows)]
		column_types[col_to_letters(c)] = _infer_type(col_vals)

	sample_rows = []
	for r in range(nrows):
		row = {"_row": r + 1}
		has = False
		for c in range(ncols):
			v = cells.get((r, c))
			if v not in (None, ""):
				row[col_to_letters(c)] = v
				has = True
		if has:
			sample_rows.append(row)

	ctx = {
		"sheet_name": sheet_name,
		"selection": selection,
		"headers": headers,
		"column_types": column_types,
		"sample_rows": sample_rows,
		"truncated": (max_r + 1 > nrows) or (max_c + 1 > ncols),
	}
	_enforce_byte_cap(ctx)
	return ctx


def _enforce_byte_cap(ctx: dict) -> None:
	"""Drop sample rows from the end until the serialized context fits."""
	import json

	while len(json.dumps(ctx, default=str)) > MAX_CONTEXT_BYTES and ctx["sample_rows"]:
		ctx["sample_rows"].pop()
		ctx["truncated"] = True
