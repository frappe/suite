"""Read cell values out of the compact `sheet` slice of a saved payload.

The frontend stores each sheet's cells per-row to keep the JSON small (see
``frontend/src/utils/sheet-codec.js``): the inflated ``{cellId: value}`` map
becomes ``{rows: {"0": [v, v, ...]}}``. Server code that needs the actual cell
values back — currently only AI Assist context-building — goes through here so
it transparently understands both the compact (v2) and legacy shapes.
"""

PACK_VERSION = 2


def cell_map(sheet_slice: dict | None, sheet_name: str) -> dict:
	"""Return ``{cellId: value}`` for one sheet from a saved ``sheet`` slice.

	Accepts both the compact v2 envelope and the legacy
	``{sheets: {name: {cellId: val}}}`` shape; unknown input yields ``{}``.
	"""
	if not isinstance(sheet_slice, dict):
		return {}
	sheet = (sheet_slice.get("sheets") or {}).get(sheet_name)
	if not isinstance(sheet, dict):
		return {}
	if sheet_slice.get("v") != PACK_VERSION:
		return sheet  # legacy: already a {cellId: value} map
	return _unpack_rows(sheet.get("rows") or {})


def _unpack_rows(rows: dict) -> dict:
	out = {}
	for r, arr in rows.items():
		if not arr:
			continue
		try:
			row = int(r)
		except (TypeError, ValueError):
			continue
		if not isinstance(arr, list):
			continue
		for col, value in enumerate(arr):
			if value is None or value == "":
				continue
			out[f"{_col_label(col)}{row + 1}"] = value
	return out


def _col_label(idx: int) -> str:
	s = ""
	idx += 1
	while idx > 0:
		idx, rem = divmod(idx - 1, 26)
		s = chr(65 + rem) + s
	return s
