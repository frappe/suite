// Cell format store — bold, italic, underline, color, backgroundColor, align,
// wrapText, numberFormat, fontFamily, fontSize, …
//
// Three layers per sheet so uniform formatting over a whole column/row costs
// ONE entry instead of one-per-cell:
//
//   store[sheet] = { cells: { cellId: fmt }, cols: { colIdx: fmt }, rows: { rowIdx: fmt } }
//
// A cell's effective format is the cascade  col < row < cell  (most specific
// wins). get() returns that merge, so the renderer — which only ever calls
// get(id) — picks up column/row formatting with no changes. Bolding all of
// column F is now `setCol(F, {bold:true})`, not 100k cell writes that bloat the
// saved payload to 100MB+ and freeze the main thread.

import { parseCellId, colLabel } from '../utils/cells.js'
import { deepClone } from '../utils/deep-clone.js'

export function createFormatsEngine() {
	const store = {}

	function ensure(sheet) {
		if (!store[sheet]) store[sheet] = { cells: {}, cols: {}, rows: {} }
		return store[sheet]
	}

	// Raw cell-level format only (no cascade) — the mutation layer reads this so
	// it never denormalises column/row formats down into a cell.
	function _cell(id, sheet) { return store[sheet]?.cells?.[id] || {} }
	function _col(c, sheet)   { return store[sheet]?.cols?.[c]  || {} }
	function _row(r, sheet)   { return store[sheet]?.rows?.[r]  || {} }

	function _empty(o) { for (const _ in o) return false; return true }

	// Resolved (cascaded) format for a cell — col < row < cell. Fast path: when
	// no column/row formats exist (the overwhelmingly common case) skip the
	// cellId parse and hand back the cell entry directly, exactly as the old
	// per-cell store did — keeps get() cheap on the renderer's hot path.
	function get(id, sheet = 'Sheet1') {
		const s = store[sheet]
		if (!s) return {}
		const cell = s.cells[id]
		if (_empty(s.cols) && _empty(s.rows)) return cell || {}
		const p = parseCellId(id)
		const col = p ? s.cols[p.col] : undefined
		const row = p ? s.rows[p.row] : undefined
		if (!col && !row) return cell || {}
		return { ...col, ...row, ...cell }
	}

	// ── Cell-level mutation ───────────────────────────────────────────────────

	// Raw cell-level format (no cascade) — for op capture, so undo restores the
	// cell layer without baking column/row formats into cells.
	function getCellFormat(id, sheet = 'Sheet1') { return _cell(id, sheet) }

	function set(id, format, sheet = 'Sheet1') {
		ensure(sheet).cells[id] = { ..._cell(id, sheet), ...format }
	}

	// Toggle reads the RESOLVED value so a cell in a bold column toggles off by
	// writing an explicit cell-level override.
	function toggle(id, key, sheet = 'Sheet1') {
		set(id, { [key]: !get(id, sheet)[key] }, sheet)
	}

	function clear(id, sheet = 'Sheet1') {
		if (store[sheet]?.cells) delete store[sheet].cells[id]
	}

	function applyToRange(ids, format, sheet = 'Sheet1') {
		for (const id of ids) set(id, format, sheet)
	}

	function toggleRange(ids, key, sheet = 'Sheet1') {
		const allOn = ids.every(id => !!get(id, sheet)[key])
		applyToRange(ids, { [key]: !allOn }, sheet)
	}

	// ── Column / row-level mutation ───────────────────────────────────────────
	//
	// Used when a format covers entire columns/rows (header-click or select-all).
	// One entry covers every cell — present and future — in that column/row.

	function getCol(c, sheet = 'Sheet1') { return _col(c, sheet) }
	function getRow(r, sheet = 'Sheet1') { return _row(r, sheet) }

	function setCol(c, format, sheet = 'Sheet1') {
		ensure(sheet).cols[c] = { ..._col(c, sheet), ...format }
	}
	function setRow(r, format, sheet = 'Sheet1') {
		ensure(sheet).rows[r] = { ..._row(r, sheet), ...format }
	}

	// Exact replacement (not merge) — undo/redo restores a captured layer state.
	// An empty format drops the entry entirely.
	function replaceCol(c, format, sheet = 'Sheet1') {
		const cols = ensure(sheet).cols
		if (format && Object.keys(format).length) cols[c] = { ...format }
		else delete cols[c]
	}
	function replaceRow(r, format, sheet = 'Sheet1') {
		const rows = ensure(sheet).rows
		if (format && Object.keys(format).length) rows[r] = { ...format }
		else delete rows[r]
	}

	function applyToColumns(cols, format, sheet = 'Sheet1') {
		for (const c of cols) setCol(c, format, sheet)
	}
	function applyToRows(rows, format, sheet = 'Sheet1') {
		for (const r of rows) setRow(r, format, sheet)
	}

	function toggleColumns(cols, key, sheet = 'Sheet1') {
		const allOn = cols.every(c => !!_col(c, sheet)[key])
		applyToColumns(cols, { [key]: !allOn }, sheet)
	}
	function toggleRows(rows, key, sheet = 'Sheet1') {
		const allOn = rows.every(r => !!_row(r, sheet)[key])
		applyToRows(rows, { [key]: !allOn }, sheet)
	}

	// Clear a whole column/row: drop its layer entry. Per-cell overrides inside
	// it are left alone (rare, and keeping them undoable without capturing the
	// whole column keeps clear-formatting cheap).
	function clearColumns(cols, sheet = 'Sheet1') {
		const s = store[sheet]
		if (!s) return
		for (const c of cols) delete s.cols[c]
	}
	function clearRows(rows, sheet = 'Sheet1') {
		const s = store[sheet]
		if (!s) return
		for (const r of rows) delete s.rows[r]
	}

	// ── Row / column structural shifts ────────────────────────────────────────

	function _shiftCells(sheet, pred, newIdFn, descending) {
		const cells = ensure(sheet).cells
		const entries = Object.entries(cells)
			.map(([id, fmt]) => ({ id, p: parseCellId(id), fmt }))
			.filter(({ p }) => p && pred(p))
		entries.sort((a, b) => descending ? b.p.row - a.p.row || b.p.col - a.p.col
		                                  : a.p.row - b.p.row || a.p.col - b.p.col)
		for (const { id, p, fmt } of entries) {
			delete cells[id]
			const nid = newIdFn(p)
			if (nid) cells[nid] = fmt
		}
	}

	// Shift the integer keys of a col/row layer (≥ `at` move by `delta`).
	function _shiftAxis(axis, at, delta) {
		const keys = Object.keys(axis).map(Number).filter(k => k >= at)
		keys.sort((a, b) => delta > 0 ? b - a : a - b)
		for (const k of keys) { axis[k + delta] = axis[k]; delete axis[k] }
	}

	function insertRow(atRow, sheet = 'Sheet1') {
		_shiftCells(sheet, p => p.row >= atRow, p => colLabel(p.col) + (p.row + 2), true)
		_shiftAxis(ensure(sheet).rows, atRow, +1)
	}

	function deleteRow(atRow, sheet = 'Sheet1') {
		const s = ensure(sheet)
		for (const id of Object.keys(s.cells)) {
			const p = parseCellId(id)
			if (p && p.row === atRow) delete s.cells[id]
		}
		delete s.rows[atRow]
		_shiftCells(sheet, p => p.row > atRow, p => colLabel(p.col) + p.row, false)
		_shiftAxis(s.rows, atRow + 1, -1)
	}

	function insertCol(atCol, sheet = 'Sheet1') {
		const s = ensure(sheet)
		const entries = Object.entries(s.cells)
			.map(([id, fmt]) => ({ id, p: parseCellId(id), fmt }))
			.filter(({ p }) => p && p.col >= atCol)
		entries.sort((a, b) => b.p.col - a.p.col)
		for (const { id, p, fmt } of entries) {
			delete s.cells[id]
			s.cells[colLabel(p.col + 1) + (p.row + 1)] = fmt
		}
		_shiftAxis(s.cols, atCol, +1)
	}

	function deleteCol(atCol, sheet = 'Sheet1') {
		const s = ensure(sheet)
		for (const id of Object.keys(s.cells)) {
			const p = parseCellId(id)
			if (p && p.col === atCol) delete s.cells[id]
		}
		delete s.cols[atCol]
		const entries = Object.entries(s.cells)
			.map(([id, fmt]) => ({ id, p: parseCellId(id), fmt }))
			.filter(({ p }) => p && p.col > atCol)
		entries.sort((a, b) => a.p.col - b.p.col)
		for (const { id, p, fmt } of entries) {
			delete s.cells[id]
			s.cells[colLabel(p.col - 1) + (p.row + 1)] = fmt
		}
		_shiftAxis(s.cols, atCol + 1, -1)
	}

	// ── Snapshot / restore for history integration ────────────────────────────

	function snapshot() {
		return deepClone(store)
	}

	// Accepts both the layered shape and the legacy flat { sheet: { cellId: fmt } }
	// so documents saved before column/row formats keep loading.
	function restore(snap) {
		for (const k of Object.keys(store)) delete store[k]
		for (const [name, v] of Object.entries(snap || {})) {
			store[name] = _normalizeSheet(v)
		}
	}

	function _normalizeSheet(v) {
		if (v && (v.cells || v.cols || v.rows)) {
			return { cells: v.cells || {}, cols: v.cols || {}, rows: v.rows || {} }
		}
		return { cells: v || {}, cols: {}, rows: {} }   // legacy flat cell map
	}

	// ── Sheet-level operations (rename / duplicate / delete) ──────────────────

	function renameSheet(oldName, newName) {
		if (!store[oldName] || store[newName] || oldName === newName) return
		store[newName] = store[oldName]
		delete store[oldName]
	}

	function duplicateSheet(srcName, newName) {
		if (store[newName]) return
		store[newName] = deepClone(store[srcName] || { cells: {}, cols: {}, rows: {} })
	}

	function deleteSheet(name) {
		delete store[name]
	}

	function reorderSheets(orderedNames) {
		const next = {}
		for (const name of orderedNames) if (store[name]) next[name] = store[name]
		for (const name of Object.keys(store)) if (!next[name]) next[name] = store[name]
		for (const k of Object.keys(store)) delete store[k]
		for (const [k, v] of Object.entries(next)) store[k] = v
	}

	return {
		get, getCellFormat, set, toggle, clear, applyToRange, toggleRange,
		getCol, getRow, setCol, setRow, replaceCol, replaceRow,
		applyToColumns, applyToRows, toggleColumns, toggleRows,
		clearColumns, clearRows,
		insertRow, deleteRow, insertCol, deleteCol,
		renameSheet, duplicateSheet, deleteSheet, reorderSheets,
		snapshot, restore,
	}
}
