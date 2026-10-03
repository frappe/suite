import { colLabel, parseCellId } from '../utils/cells.js'
import { deepClone } from '../utils/deep-clone.js'
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
export function createSortFilter(sheet) {
  const _byShet = {} // { [sheetName]: { range, byCol } }

  function _entry(sn) {
    if (!_byShet[sn]) _byShet[sn] = { range: null, byCol: {} }
    return _byShet[sn]
  }

  function _inCols(colIdx, range) {
    return colIdx >= range.c0 && colIdx <= range.c1
  }

  function _getRows() {
    return _buildRows((id) => sheet.getCell(id))
  }

  // Same shape as _getRows but each cell is the *displayed* (formula-evaluated)
  // value rather than the raw stored cell. Used by the filter so a row whose
  // visible value is "306" (from `=A1*B1`) matches a "contains 0" predicate
  // — matching against the raw `=A1*B1` would not.
  function _getDisplayRows() {
    const get = sheet.getDisplayValue
      ? (id) => sheet.getDisplayValue(id)
      : (id) => sheet.getCell(id)
    return _buildRows(get)
  }

  function _buildRows(get) {
    const data = sheet.getRawData()
    let maxR = 0,
      maxC = 0
    for (const id of Object.keys(data)) {
      const p = parseCellId(id)
      if (p) {
        if (p.row > maxR) maxR = p.row
        if (p.col > maxC) maxC = p.col
      }
    }
    const rows = []
    for (let r = 0; r <= maxR; r++) {
      const row = []
      for (let c = 0; c <= maxC; c++) row.push(get(colLabel(c) + (r + 1)))
      rows.push(row)
    }
    return rows
  }

  // Sort data rows of the active filter range (range.r0 stays as the header).
  function sort(colIndex, dir = 'asc', sheetName) {
    const range = getRange(sheetName)
    if (!range || !_inCols(colIndex, range)) return
    const rows = _getRows()
    const headerR = range.r0
    if (range.r1 <= headerR) return
    const block = []
    for (let r = headerR + 1; r <= range.r1; r++) block.push(rows[r] || [])
    block.sort((a, b) => _cmp(a[colIndex] ?? '', b[colIndex] ?? '', dir))
    for (let i = 0; i < block.length; i++) {
      for (let c = range.c0; c <= range.c1; c++) {
        sheet.setCell(colLabel(c) + (headerR + 2 + i), block[i][c] ?? '')
      }
    }
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

  function _rowFails(row, entries) {
    for (const [colId, spec] of entries) {
      const cellVal = String(row?.[parseInt(colId)] ?? '')
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

  // Distinct displayed values within the column's data range (header row is
  // excluded). Drives the "Filter by values" checklist in the UI.
  function getColumnValues(colIdx, sheetName) {
    const range = getRange(sheetName)
    if (!range || !_inCols(colIdx, range)) return []
    const rows = _getDisplayRows()
    const seen = new Set()
    const start = range.r0 + 1,
      end = Math.min(range.r1, rows.length - 1)
    for (let r = start; r <= end; r++) {
      seen.add(String(rows[r]?.[colIdx] ?? ''))
    }
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
    const rows = _getDisplayRows()
    const start = e.range.r0 + 1,
      end = Math.min(e.range.r1, rows.length - 1)
    for (let ri = start; ri <= end; ri++) {
      if (_rowFails(rows[ri], entries)) hidden.add(ri)
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
    sort,
    setFilter,
    clearFilter,
    clearAll,
    getFilterConfig,
    computeHiddenRows,
    getColumnValues,
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
