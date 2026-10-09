import { cellId } from '../utils/cells.js'
import { deepClone } from '../utils/deep-clone.js'
import { adjustFormula } from './formula-adjust.js'
import { remapIndexKeys, remapRect } from './ref-remap.js'

// Ranged, per-sheet sort & filter — Google-Sheets-style "basic filter":
//   At most one filter per sheet, scoped to a rectangular range. The range's
//   first row is treated as the header row; subsequent rows are the data the
//   filter hides/shows. Columns outside the range never get a chevron and
//   never participate in hiding. Inserts/deletes inside the range shift it.
//
//   Persisted shape:
//     { [sheetName]: { range: { r0, c0, r1, c1 }, byCol: { [colIdx]: spec } } }
//
//   - range.r0 is the header row (chevrons go on these cells)
//   - byCol keys are GLOBAL column indices; specs only apply to columns in
//     [range.c0 .. range.c1]
//
// Cells are read and written through `cells` (the same port as the clipboard):
//   read(sheetName, rect)  → Promise<{ inputs: string[][], displays: string[][] }>
//   write(sheetName, map)  → writes a {cellId: input} map as one edit
// Filtering matches displayed values, which refresh(sheetName) reads into a
// cache; computeHiddenRows, getColumnValues and getHeader read that cache, so
// the UI can call them synchronously.
export function createSortFilter(cells) {
  const _byShet = {} // { [sheetName]: { range, byCol } }
  const _shown = {} // { [sheetName]: { rect, rows: string[][] } } display values

  function _entry(sn) {
    if (!_byShet[sn]) _byShet[sn] = { range: null, byCol: {} }
    return _byShet[sn]
  }

  function _inCols(colIdx, range) {
    return colIdx >= range.c0 && colIdx <= range.c1
  }

  // Reads the filter range's displayed values (formula results, so a row
  // showing "306" from `=A1*B1` matches "contains 0"). No-op without a range.
  async function refresh(sheetName) {
    const range = getRange(sheetName)
    if (!range) {
      delete _shown[sheetName]
      return
    }
    const rect = { ...range }
    const { displays } = await cells.read(sheetName, rect)
    // A newer range replaced this one while reading: its own refresh wins.
    const now = getRange(sheetName)
    if (
      !now ||
      now.r0 !== rect.r0 ||
      now.r1 !== rect.r1 ||
      now.c0 !== rect.c0 ||
      now.c1 !== rect.c1
    )
      return
    _shown[sheetName] = { rect, rows: displays }
  }

  // Displayed value at (r, c) from the last refresh, '' when unknown.
  function _shownAt(sheetName, r, c) {
    const s = _shown[sheetName]
    if (!s) return ''
    return String(s.rows[r - s.rect.r0]?.[c - s.rect.c0] ?? '')
  }

  // Sort data rows of the active filter range (range.r0 stays as the header)
  // by their displayed values. Formulas move with their row and shift their
  // references by the distance moved. Returns the {cellId: input} maps of
  // the rows before and after, for undo; null when nothing to sort.
  async function sort(colIndex, dir = 'asc', sheetName) {
    const range = getRange(sheetName)
    if (!range || !_inCols(colIndex, range) || range.r1 <= range.r0) return null
    const rect = { r0: range.r0 + 1, c0: range.c0, r1: range.r1, c1: range.c1 }
    const { inputs, displays } = await cells.read(sheetName, rect)
    const key = colIndex - rect.c0
    const order = inputs.map((_, i) => i)
    order.sort((a, b) => _cmp(displays[a]?.[key] ?? '', displays[b]?.[key] ?? '', dir))
    const before = {}
    const after = {}
    order.forEach((from, to) => {
      for (let c = rect.c0; c <= rect.c1; c++) {
        before[cellId(rect.r0 + to, c)] = inputs[to]?.[c - rect.c0] ?? ''
        const v = inputs[from]?.[c - rect.c0] ?? ''
        after[cellId(rect.r0 + to, c)] = v.startsWith('=') ? adjustFormula(v, to - from, 0) : v
      }
    })
    cells.write(sheetName, after)
    return { before, after }
  }

  function _cmp(av, bv, dir) {
    if (av === '' && bv === '') return 0
    if (av === '') return 1
    if (bv === '') return -1
    const an = parseFloat(av),
      bn = parseFloat(bv)
    const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : String(av).localeCompare(String(bv))
    return dir === 'asc' ? cmp : -cmp
  }

  // ── Range management ──────────────────────────────────────────────────────
  function setRange(range, sheetName) {
    const e = _entry(sheetName)
    e.range = range ? { ...range } : null
    if (!range) {
      e.byCol = {}
      return
    }
    // Drop column specs that fall outside the new range bounds.
    for (const k of Object.keys(e.byCol)) {
      if (!_inCols(parseInt(k, 10), e.range)) delete e.byCol[k]
    }
  }

  function getRange(sheetName) {
    return _byShet[sheetName]?.range || null
  }

  function clearRange(sheetName) {
    if (_byShet[sheetName]) _byShet[sheetName] = { range: null, byCol: {} }
  }

  function hasFilter(sheetName) {
    return !!getRange(sheetName)
  }

  // ── Per-column specs (within the range) ───────────────────────────────────
  function setFilter(colId, spec, sheetName) {
    const e = _entry(sheetName)
    if (!e.range || !_inCols(colId, e.range)) return
    e.byCol[colId] = spec
  }

  function clearFilter(colId, sheetName) {
    if (_byShet[sheetName]) delete _byShet[sheetName].byCol[colId]
  }

  function clearAll(sheetName) {
    if (_byShet[sheetName]) _byShet[sheetName].byCol = {}
  }

  function getFilterConfig(sheetName) {
    return _byShet[sheetName]?.byCol || {}
  }

  function _rowFails(sheetName, r, entries) {
    for (const [colId, spec] of entries) {
      const cellVal = _shownAt(sheetName, r, parseInt(colId))
      const specVal = String(spec.value ?? '')
      const op = spec.operator
      if (op === 'contains' && !cellVal.toLowerCase().includes(specVal.toLowerCase())) return true
      else if (op === 'equals' && cellVal !== specVal) return true
      else if (op === 'gt' && !(parseFloat(cellVal) > parseFloat(specVal))) return true
      else if (op === 'lt' && !(parseFloat(cellVal) < parseFloat(specVal))) return true
      else if (op === 'empty' && cellVal !== '') return true
      else if (op === 'notempty' && cellVal === '') return true
      // Google-Sheets-style "Filter by values": spec.values is an array of the
      // values the user CHECKED to keep visible. Anything not in the set is
      // hidden. Empty cells are represented by the empty string in the array.
      else if (op === 'inSet' && !(spec.values || []).includes(cellVal)) return true
    }
    return false
  }

  // The header cell's displayed value for a column of the range.
  function getHeader(colIdx, sheetName) {
    const range = getRange(sheetName)
    return range ? _shownAt(sheetName, range.r0, colIdx) : ''
  }

  // Distinct displayed values within the column's data range (header row is
  // excluded). Drives the "Filter by values" checklist in the UI.
  function getColumnValues(colIdx, sheetName) {
    const range = getRange(sheetName)
    if (!range || !_inCols(colIdx, range)) return []
    const seen = new Set()
    for (let r = range.r0 + 1; r <= range.r1; r++) seen.add(_shownAt(sheetName, r, colIdx))
    // Sort so the list is stable across opens; empty string first so
    // "(Blanks)" sits at the top like Google Sheets.
    return [...seen].sort((a, b) => {
      if (a === '' && b !== '') return -1
      if (b === '' && a !== '') return 1
      const an = parseFloat(a),
        bn = parseFloat(b)
      if (!isNaN(an) && !isNaN(bn)) return an - bn
      return a.localeCompare(b)
    })
  }

  // Returns a Set of row indices that should be hidden in the given sheet.
  // Only rows inside [range.r0+1, range.r1] are ever hidden — rows outside the
  // filter range stay visible regardless of specs.
  function computeHiddenRows(sheetName) {
    const hidden = new Set()
    const e = _byShet[sheetName]
    if (!e?.range) return hidden
    const entries = Object.entries(e.byCol)
    if (!entries.length) return hidden
    for (let ri = e.range.r0 + 1; ri <= e.range.r1; ri++) {
      if (_rowFails(sheetName, ri, entries)) hidden.add(ri)
    }
    return hidden
  }

  // ── Row / column structural shifts (called from SheetEditor handlers) ────
  function insertRow(atRow, sheetName) {
    const e = _byShet[sheetName]
    if (!e?.range) return
    if (atRow <= e.range.r0) e.range.r0++
    if (atRow <= e.range.r1) e.range.r1++
  }

  function deleteRow(atRow, sheetName) {
    const e = _byShet[sheetName]
    if (!e?.range) return
    if (atRow < e.range.r0) e.range.r0--
    if (atRow <= e.range.r1) e.range.r1--
    if (e.range.r1 < e.range.r0) clearRange(sheetName)
  }

  function insertCol(atCol, sheetName) {
    const e = _byShet[sheetName]
    if (!e?.range) return
    if (atCol <= e.range.c0) e.range.c0++
    if (atCol <= e.range.c1) e.range.c1++
    e.byCol = _shiftByColKeys(e.byCol, atCol, +1)
  }

  function deleteCol(atCol, sheetName) {
    const e = _byShet[sheetName]
    if (!e?.range) return
    if (atCol < e.range.c0) e.range.c0--
    if (atCol <= e.range.c1) e.range.c1--
    if (e.range.c1 < e.range.c0) {
      clearRange(sheetName)
      return
    }
    delete e.byCol[atCol]
    e.byCol = _shiftByColKeys(e.byCol, atCol, -1)
  }

  function remapCols(mapCol, sheetName) {
    const e = _byShet[sheetName]
    if (!e?.range) return
    const rect = remapRect(e.range, mapCol, null)
    if (!rect) {
      clearRange(sheetName)
      return
    }
    e.range = rect
    e.byCol = remapIndexKeys(e.byCol, mapCol)
    // Drop specs for columns no longer inside the (grown/shrunk) range.
    for (const k of Object.keys(e.byCol)) if (!_inCols(parseInt(k, 10), e.range)) delete e.byCol[k]
  }

  function remapRows(mapRow, sheetName) {
    const e = _byShet[sheetName]
    if (!e?.range) return
    const rect = remapRect(e.range, null, mapRow)
    if (!rect) {
      clearRange(sheetName)
      return
    }
    e.range = rect
  }

  function _shiftByColKeys(byCol, atCol, delta) {
    const next = {}
    for (const [k, v] of Object.entries(byCol)) {
      const ci = parseInt(k, 10)
      if (delta > 0 && ci >= atCol) next[ci + 1] = v
      else if (delta < 0 && ci > atCol) next[ci - 1] = v
      else next[ci] = v
    }
    return next
  }

  // ── Sheet-level operations ────────────────────────────────────────────────
  function renameSheet(oldName, newName) {
    if (!_byShet[oldName] || _byShet[newName] || oldName === newName) return
    _byShet[newName] = _byShet[oldName]
    delete _byShet[oldName]
  }

  function deleteSheet(name) {
    delete _byShet[name]
  }

  function duplicateSheet(srcName, newName) {
    if (_byShet[newName]) return
    _byShet[newName] = deepClone(_byShet[srcName] || { range: null, byCol: {} })
  }

  function snapshot() {
    return deepClone(_byShet)
  }

  function restore(snap) {
    for (const k of Object.keys(_byShet)) delete _byShet[k]
    if (snap) for (const [k, v] of Object.entries(snap)) _byShet[k] = v
  }

  return {
    refresh,
    sort,
    setFilter,
    clearFilter,
    clearAll,
    getFilterConfig,
    computeHiddenRows,
    getColumnValues,
    getHeader,
    setRange,
    getRange,
    clearRange,
    hasFilter,
    insertRow,
    deleteRow,
    insertCol,
    deleteCol,
    remapCols,
    remapRows,
    renameSheet,
    deleteSheet,
    duplicateSheet,
    snapshot,
    restore,
  }
}
