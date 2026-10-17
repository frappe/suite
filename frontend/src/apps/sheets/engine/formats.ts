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

import { colLabel, parseCellId } from '../utils/cells.js'
import { deepClone } from '../utils/deep-clone.js'
import { remapCellKeys, remapIndexKeys } from './ref-remap.js'
import type { CellPos, IndexMap } from './types.js'

/** One layer's format: any of the keys above, set by whichever feature owns it. */
export type Format = Record<string, unknown>

/** One sheet's three layers. Column/row layers are keyed by 0-based index. */
export interface FormatSheet {
  cells: Record<string, Format>
  cols: Record<number, Format>
  rows: Record<number, Format>
}

export type FormatsSnapshot = Record<string, FormatSheet>

export type FormatsEngine = ReturnType<typeof createFormatsEngine>

interface FormatEntry {
  id: string
  p: CellPos
  fmt: Format
}

// Each cell format with its parsed position; ids that don't parse are skipped.
function _entries(cells: Record<string, Format>, pred: (p: CellPos) => boolean): FormatEntry[] {
  return Object.entries(cells)
    .map(([id, fmt]) => ({ id, p: parseCellId(id), fmt }))
    .filter((e): e is FormatEntry => !!e.p && pred(e.p))
}

export function createFormatsEngine() {
  const store: FormatsSnapshot = {}

  function ensure(sheet: string): FormatSheet {
    if (!store[sheet]) store[sheet] = { cells: {}, cols: {}, rows: {} }
    return store[sheet]
  }

  // Raw cell-level format only (no cascade) — the mutation layer reads this so
  // it never denormalises column/row formats down into a cell.
  function _cell(id: string, sheet: string): Format {
    return store[sheet]?.cells?.[id] || {}
  }
  function _col(c: number, sheet: string): Format {
    return store[sheet]?.cols?.[c] || {}
  }
  function _row(r: number, sheet: string): Format {
    return store[sheet]?.rows?.[r] || {}
  }

  function _empty(o: object) {
    for (const _ in o) return false
    return true
  }

  // Resolved (cascaded) format for a cell — col < row < cell. Fast path: when
  // no column/row formats exist (the overwhelmingly common case) skip the
  // cellId parse and hand back the cell entry directly, exactly as the old
  // per-cell store did — keeps get() cheap on the renderer's hot path.
  function get(id: string, sheet = 'Sheet1'): Format {
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
  function getCellFormat(id: string, sheet = 'Sheet1') {
    return _cell(id, sheet)
  }

  function set(id: string, format: Format, sheet = 'Sheet1') {
    ensure(sheet).cells[id] = { ..._cell(id, sheet), ...format }
  }

  // Toggle reads the RESOLVED value so a cell in a bold column toggles off by
  // writing an explicit cell-level override.
  function toggle(id: string, key: string, sheet = 'Sheet1') {
    set(id, { [key]: !get(id, sheet)[key] }, sheet)
  }

  function clear(id: string, sheet = 'Sheet1') {
    if (store[sheet]?.cells) delete store[sheet].cells[id]
  }

  function applyToRange(ids: readonly string[], format: Format, sheet = 'Sheet1') {
    for (const id of ids) set(id, format, sheet)
  }

  function toggleRange(ids: readonly string[], key: string, sheet = 'Sheet1') {
    const allOn = ids.every((id) => !!get(id, sheet)[key])
    applyToRange(ids, { [key]: !allOn }, sheet)
  }

  // ── Column / row-level mutation ───────────────────────────────────────────
  //
  // Used when a format covers entire columns/rows (header-click or select-all).
  // One entry covers every cell — present and future — in that column/row.

  function getCol(c: number, sheet = 'Sheet1') {
    return _col(c, sheet)
  }
  function getRow(r: number, sheet = 'Sheet1') {
    return _row(r, sheet)
  }

  function setCol(c: number, format: Format, sheet = 'Sheet1') {
    ensure(sheet).cols[c] = { ..._col(c, sheet), ...format }
  }
  function setRow(r: number, format: Format, sheet = 'Sheet1') {
    ensure(sheet).rows[r] = { ..._row(r, sheet), ...format }
  }

  // Exact replacement (not merge) — undo/redo restores a captured layer state.
  // An empty format drops the entry entirely.
  function replaceCol(c: number, format: Format | null | undefined, sheet = 'Sheet1') {
    const cols = ensure(sheet).cols
    if (format && Object.keys(format).length) cols[c] = { ...format }
    else delete cols[c]
  }
  function replaceRow(r: number, format: Format | null | undefined, sheet = 'Sheet1') {
    const rows = ensure(sheet).rows
    if (format && Object.keys(format).length) rows[r] = { ...format }
    else delete rows[r]
  }

  function applyToColumns(cols: readonly number[], format: Format, sheet = 'Sheet1') {
    for (const c of cols) setCol(c, format, sheet)
  }
  function applyToRows(rows: readonly number[], format: Format, sheet = 'Sheet1') {
    for (const r of rows) setRow(r, format, sheet)
  }

  function toggleColumns(cols: readonly number[], key: string, sheet = 'Sheet1') {
    const allOn = cols.every((c) => !!_col(c, sheet)[key])
    applyToColumns(cols, { [key]: !allOn }, sheet)
  }
  function toggleRows(rows: readonly number[], key: string, sheet = 'Sheet1') {
    const allOn = rows.every((r) => !!_row(r, sheet)[key])
    applyToRows(rows, { [key]: !allOn }, sheet)
  }

  // Clear a whole column/row: drop its layer entry. Per-cell overrides inside
  // it are left alone (rare, and keeping them undoable without capturing the
  // whole column keeps clear-formatting cheap).
  function clearColumns(cols: readonly number[], sheet = 'Sheet1') {
    const s = store[sheet]
    if (!s) return
    for (const c of cols) delete s.cols[c]
  }
  function clearRows(rows: readonly number[], sheet = 'Sheet1') {
    const s = store[sheet]
    if (!s) return
    for (const r of rows) delete s.rows[r]
  }

  // ── Row / column structural shifts ────────────────────────────────────────

  function _shiftCells(
    sheet: string,
    pred: (p: CellPos) => boolean,
    newIdFn: (p: CellPos) => string,
    descending: boolean,
  ) {
    const cells = ensure(sheet).cells
    const entries = _entries(cells, pred)
    entries.sort((a, b) =>
      descending ? b.p.row - a.p.row || b.p.col - a.p.col : a.p.row - b.p.row || a.p.col - b.p.col,
    )
    for (const { id, p, fmt } of entries) {
      delete cells[id]
      const nid = newIdFn(p)
      if (nid) cells[nid] = fmt
    }
  }

  // Shift the integer keys of a col/row layer (≥ `at` move by `delta`).
  function _shiftAxis(axis: Record<number, Format>, at: number, delta: number) {
    const keys = Object.keys(axis)
      .map(Number)
      .filter((k) => k >= at)
    keys.sort((a, b) => (delta > 0 ? b - a : a - b))
    for (const k of keys) {
      axis[k + delta] = axis[k] as Format
      delete axis[k]
    }
  }

  function insertRow(atRow: number, sheet = 'Sheet1') {
    _shiftCells(
      sheet,
      (p) => p.row >= atRow,
      (p) => colLabel(p.col) + (p.row + 2),
      true,
    )
    _shiftAxis(ensure(sheet).rows, atRow, +1)
  }

  function deleteRow(atRow: number, sheet = 'Sheet1') {
    const s = ensure(sheet)
    for (const id of Object.keys(s.cells)) {
      const p = parseCellId(id)
      if (p && p.row === atRow) delete s.cells[id]
    }
    delete s.rows[atRow]
    _shiftCells(
      sheet,
      (p) => p.row > atRow,
      (p) => colLabel(p.col) + p.row,
      false,
    )
    _shiftAxis(s.rows, atRow + 1, -1)
  }

  function insertCol(atCol: number, sheet = 'Sheet1') {
    const s = ensure(sheet)
    const entries = _entries(s.cells, (p) => p.col >= atCol)
    entries.sort((a, b) => b.p.col - a.p.col)
    for (const { id, p, fmt } of entries) {
      delete s.cells[id]
      s.cells[colLabel(p.col + 1) + (p.row + 1)] = fmt
    }
    _shiftAxis(s.cols, atCol, +1)
  }

  function deleteCol(atCol: number, sheet = 'Sheet1') {
    const s = ensure(sheet)
    for (const id of Object.keys(s.cells)) {
      const p = parseCellId(id)
      if (p && p.col === atCol) delete s.cells[id]
    }
    delete s.cols[atCol]
    const entries = _entries(s.cells, (p) => p.col > atCol)
    entries.sort((a, b) => a.p.col - b.p.col)
    for (const { id, p, fmt } of entries) {
      delete s.cells[id]
      s.cells[colLabel(p.col - 1) + (p.row + 1)] = fmt
    }
    _shiftAxis(s.cols, atCol + 1, -1)
  }

  // Structural permutation — remap the per-cell layer and the integer-keyed
  // column layer through the same index map used everywhere else.
  function remapCols(mapCol: IndexMap, sheet = 'Sheet1') {
    const s = ensure(sheet)
    s.cells = remapCellKeys(s.cells, mapCol, null)
    s.cols = remapIndexKeys(s.cols, mapCol)
  }

  function remapRows(mapRow: IndexMap, sheet = 'Sheet1') {
    const s = ensure(sheet)
    s.cells = remapCellKeys(s.cells, null, mapRow)
    s.rows = remapIndexKeys(s.rows, mapRow)
  }

  // ── Snapshot / restore for history integration ────────────────────────────

  function snapshot() {
    return deepClone(store)
  }

  // Accepts both the layered shape and the legacy flat { sheet: { cellId: fmt } }
  // so documents saved before column/row formats keep loading.
  function restore(snap: Record<string, unknown> | null | undefined) {
    for (const k of Object.keys(store)) delete store[k]
    for (const [name, v] of Object.entries(snap || {})) {
      store[name] = _normalizeSheet(v)
    }
  }

  function _normalizeSheet(v: unknown): FormatSheet {
    const layered = v as Partial<FormatSheet> | null | undefined
    if (layered && (layered.cells || layered.cols || layered.rows)) {
      return { cells: layered.cells || {}, cols: layered.cols || {}, rows: layered.rows || {} }
    }
    return { cells: (v as Record<string, Format>) || {}, cols: {}, rows: {} } // legacy flat cell map
  }

  // ── Sheet-level operations (rename / duplicate / delete) ──────────────────

  function renameSheet(oldName: string, newName: string) {
    if (!store[oldName] || store[newName] || oldName === newName) return
    store[newName] = store[oldName]
    delete store[oldName]
  }

  function duplicateSheet(srcName: string, newName: string) {
    if (store[newName]) return
    store[newName] = deepClone(store[srcName] || { cells: {}, cols: {}, rows: {} })
  }

  function deleteSheet(name: string) {
    delete store[name]
  }

  function reorderSheets(orderedNames: readonly string[]) {
    const next: FormatsSnapshot = {}
    for (const name of orderedNames) if (store[name]) next[name] = store[name]
    for (const name of Object.keys(store)) if (!next[name]) next[name] = store[name] as FormatSheet
    for (const k of Object.keys(store)) delete store[k]
    for (const [k, v] of Object.entries(next)) store[k] = v
  }

  return {
    get,
    getCellFormat,
    set,
    toggle,
    clear,
    applyToRange,
    toggleRange,
    getCol,
    getRow,
    setCol,
    setRow,
    replaceCol,
    replaceRow,
    applyToColumns,
    applyToRows,
    toggleColumns,
    toggleRows,
    clearColumns,
    clearRows,
    insertRow,
    deleteRow,
    insertCol,
    deleteCol,
    remapCols,
    remapRows,
    renameSheet,
    duplicateSheet,
    deleteSheet,
    reorderSheets,
    snapshot,
    restore,
  }
}
