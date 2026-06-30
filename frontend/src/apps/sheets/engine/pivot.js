import { parseCellId, colLabel, cellId } from '../utils/cells.js'
import { deepClone } from '../utils/deep-clone.js'

export const AGG_OPTIONS = [
  { value: 'sum',    label: 'SUM'     },
  { value: 'count',  label: 'COUNT'   },
  { value: 'avg',    label: 'AVERAGE' },
  { value: 'min',    label: 'MIN'     },
  { value: 'max',    label: 'MAX'     },
  { value: 'counta', label: 'COUNTA'  },
]

// ── Pure helpers ────────────────────────────────────────────────────────────

function _agg(vals, fn) {
  if (!vals.length) return ''
  const nums = vals.filter(v => typeof v === 'number' && !isNaN(v))
  switch (fn) {
    case 'sum':    return nums.reduce((a, b) => a + b, 0)
    case 'count':  return vals.length   // count all non-empty values (text + numbers)
    case 'counta': return vals.length
    case 'avg':    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : ''
    case 'min':    return nums.length ? Math.min(...nums) : ''
    case 'max':    return nums.length ? Math.max(...nums) : ''
    default:       return nums.reduce((a, b) => a + b, 0)
  }
}

// Build a Map key string from row values at given column indices.
function _makeKey(row, idxs) {
  return idxs.map(i => String(row[i] ?? '')).join('\x00')
}

// Split a composite key back into its parts.
function _keyParts(key) { return key.split('\x00') }

// ── Pivot computation (pure) ─────────────────────────────────────────────────

export function computePivot(config, getRangeValues) {
  return computePivotModel(config, getRangeValues)?.table ?? []
}

// Like computePivot but returns the full intermediate model alongside the
// rendered table: { table, headers, dataRows, rowIdxs, colIdxs, valCols,
// rowKeyList, colKeyList, hasColFields }. Drill-down needs the keys + source
// rows to map an output cell back to the rows that fed it. Returns null when
// there's nothing to pivot. computePivot() is a thin wrapper over this.
export function computePivotModel(config, getRangeValues) {
  const { sourceSheet, sourceRange } = config
  if (!sourceRange) return null
  const [start, end] = sourceRange.includes(':') ? sourceRange.split(':') : [sourceRange, sourceRange]
  const data = getRangeValues(start, end, sourceSheet)
  if (!data || data.length < 2) return null

  const plan = _planPivot(config, data[0])
  if (!plan) return null
  const dataRows = data.slice(1).filter(r => r.some(v => v !== null && v !== undefined && v !== ''))
  if (!dataRows.length) return null

  // Single pass: collect ordered keys AND fill aggregation buckets together,
  // computing each row's keys once instead of once per loop (this was two full
  // walks of every source row — doubled the work on a 100k-row sheet).
  const acc = _newAccumulator()
  for (const row of dataRows) _accumulate(acc, row, plan)
  return _finishModel(acc, dataRows, plan)
}

// Async variant: reads the source range in row blocks and aggregates each
// block single-pass, yielding to the event loop between blocks so building a
// pivot over a 100k-row sheet doesn't freeze the UI. Same getRangeValues
// contract as the sync version. `onYield` is awaited between blocks and may
// return false to cancel (e.g. a newer recompute superseded this one).
export async function computePivotModelAsync(config, getRangeValues, { blockRows = 5000, onYield } = {}) {
  const { sourceSheet, sourceRange } = config
  if (!sourceRange) return null
  const [start, end] = sourceRange.includes(':') ? sourceRange.split(':') : [sourceRange, sourceRange]
  const s = parseCellId(start), e = parseCellId(end)
  if (!s || !e) return null
  const r0 = Math.min(s.row, e.row), rEnd = Math.max(s.row, e.row)
  const c0 = Math.min(s.col, e.col), c1 = Math.max(s.col, e.col)

  const headerRow = (getRangeValues(cellId(r0, c0), cellId(r0, c1), sourceSheet) || [])[0]
  const plan = _planPivot(config, headerRow)
  if (!plan || rEnd <= r0) return null

  const acc = _newAccumulator()
  const dataRows = []
  for (let br = r0 + 1; br <= rEnd; br += blockRows) {
    const be = Math.min(br + blockRows - 1, rEnd)
    const block = getRangeValues(cellId(br, c0), cellId(be, c1), sourceSheet) || []
    for (const row of block) {
      if (!row.some(v => v !== null && v !== undefined && v !== '')) continue
      _accumulate(acc, row, plan)
      dataRows.push(row)
    }
    if (onYield) { const ok = await onYield(); if (ok === false) return null }
  }
  if (!dataRows.length) return null
  return _finishModel(acc, dataRows, plan)
}

// Resolve field names → column indices from the header row, validating that
// there's something to pivot. Returns null when the config can't produce a table.
function _planPivot(config, headerRowRaw) {
  const { rows, cols, values } = config
  if (!rows?.length || !values?.length || !headerRowRaw) return null
  const headers = headerRowRaw.map(h => String(h ?? ''))
  const rowIdxs = rows.map(f => headers.indexOf(f)).filter(i => i >= 0)
  const colIdxs = (cols || []).map(f => headers.indexOf(f)).filter(i => i >= 0)
  const valCols = values
    .map(v => ({ idx: headers.indexOf(v.field), agg: v.agg || 'sum', field: v.field }))
    .filter(v => v.idx >= 0)
  if (!valCols.length || !rowIdxs.length) return null
  return { headers, rows, rowIdxs, colIdxs, valCols, hasColFields: colIdxs.length > 0 }
}

function _newAccumulator() {
  return {
    buckets: new Map(),                                   // rk\x01ck\x01vi → [values]
    rowKeyList: [], colKeyList: [],
    rowKeySet: new Set(), colKeySet: new Set(),
  }
}

function _accumulate(acc, row, plan) {
  const { rowIdxs, colIdxs, valCols, hasColFields } = plan
  const rk = _makeKey(row, rowIdxs)
  const ck = hasColFields ? _makeKey(row, colIdxs) : ''
  if (!acc.rowKeySet.has(rk)) { acc.rowKeySet.add(rk); acc.rowKeyList.push(rk) }
  if (hasColFields && !acc.colKeySet.has(ck)) { acc.colKeySet.add(ck); acc.colKeyList.push(ck) }
  for (let vi = 0; vi < valCols.length; vi++) {
    const key = `${rk}\x01${ck}\x01${vi}`
    let arr = acc.buckets.get(key)
    if (!arr) { arr = []; acc.buckets.set(key, arr) }
    const raw = row[valCols[vi].idx]
    if (raw !== null && raw !== undefined && raw !== '') {
      const n = Number(raw)
      arr.push(isNaN(n) ? raw : n)
    }
  }
}

function _finishModel(acc, dataRows, plan) {
  const { headers, rows, rowIdxs, colIdxs, valCols, hasColFields } = plan
  const { buckets, rowKeyList, colKeyList } = acc

  const _sortKeys = list => list.sort((a, b) => {
    const an = Number(a), bn = Number(b)
    if (!isNaN(an) && !isNaN(bn)) return an - bn
    return a.localeCompare(b)
  })
  _sortKeys(rowKeyList)
  if (hasColFields) _sortKeys(colKeyList)

  const get = (rk, ck, vi) => buckets.get(`${rk}\x01${ck}\x01${vi}`) || []
  const table = []

  // ── Header row ────────────────────────────────────────────────────────────
  const hdr = [...rows.slice(0, rowIdxs.length)]
  if (hasColFields) {
    for (const ck of colKeyList) {
      const label = _keyParts(ck).join(' / ') || '(blank)'
      for (const vc of valCols) {
        hdr.push(valCols.length > 1 ? `${label} – ${vc.agg.toUpperCase()}(${vc.field})` : label)
      }
    }
    for (const vc of valCols) {
      hdr.push(valCols.length > 1 ? `Total – ${vc.agg.toUpperCase()}(${vc.field})` : 'Grand Total')
    }
  } else {
    for (const vc of valCols) {
      hdr.push(`${vc.agg.toUpperCase()}(${vc.field})`)
    }
    if (valCols.length > 1) hdr.push('Grand Total')
  }
  table.push(hdr)

  // ── Data rows ─────────────────────────────────────────────────────────────
  for (const rk of rowKeyList) {
    const row = _keyParts(rk).map(p => p || '(blank)')
    if (hasColFields) {
      for (const ck of colKeyList) {
        for (let vi = 0; vi < valCols.length; vi++) row.push(_agg(get(rk, ck, vi), valCols[vi].agg))
      }
      for (let vi = 0; vi < valCols.length; vi++) {
        const rowVals = colKeyList.flatMap(ck => get(rk, ck, vi))
        row.push(_agg(rowVals, valCols[vi].agg))
      }
    } else {
      for (let vi = 0; vi < valCols.length; vi++) row.push(_agg(get(rk, '', vi), valCols[vi].agg))
      if (valCols.length > 1) {
        const allVals = valCols.flatMap((_, vi) => get(rk, '', vi))
        row.push(_agg(allVals, valCols[0].agg))
      }
    }
    table.push(row)
  }

  // ── Grand total row ────────────────────────────────────────────────────────
  const totalRow = rows.slice(0, rowIdxs.length).map((_, i) => i === 0 ? 'Grand Total' : '')
  if (hasColFields) {
    for (const ck of colKeyList) {
      for (let vi = 0; vi < valCols.length; vi++) {
        const colVals = rowKeyList.flatMap(rk => get(rk, ck, vi))
        totalRow.push(_agg(colVals, valCols[vi].agg))
      }
    }
    for (let vi = 0; vi < valCols.length; vi++) {
      const all = rowKeyList.flatMap(rk => colKeyList.flatMap(ck => get(rk, ck, vi)))
      totalRow.push(_agg(all, valCols[vi].agg))
    }
  } else {
    for (let vi = 0; vi < valCols.length; vi++) {
      const all = rowKeyList.flatMap(rk => get(rk, '', vi))
      totalRow.push(_agg(all, valCols[vi].agg))
    }
    if (valCols.length > 1) totalRow.push('')
  }
  table.push(totalRow)

  return { table, headers, dataRows, rowIdxs, colIdxs, valCols, rowKeyList, colKeyList, hasColFields }
}

// Map a clicked pivot output cell (r, c) back to the source rows that feed it.
// Returns { headers, rows } (rows = matching source data rows) or null if the
// cell isn't a drillable value/total/row-label cell. Which rows belong to a
// group depends only on the row-key ∩ col-key — not on which value field is
// aggregated — so we match on those two and ignore the value index.
export function pivotDrillDown(model, r, c) {
  if (!model) return null
  const { headers, dataRows, rowIdxs, colIdxs, valCols, rowKeyList, colKeyList, hasColFields } = model
  const nRowFields = rowIdxs.length
  const nData = rowKeyList.length

  // Row 0 is the header; rows 1..nData are groups; the last row is the grand
  // total (rk = null → every row group).
  if (r < 1 || r > nData + 1) return null
  const rk = r === nData + 1 ? null : rowKeyList[r - 1]

  let ck = null            // null → every column group
  let drillable = false
  if (c < nRowFields) {
    drillable = true                                 // row-label cell → whole row group
  } else if (hasColFields) {
    const cp = c - nRowFields
    const groupCount = colKeyList.length * valCols.length
    if (cp < groupCount) { ck = colKeyList[Math.floor(cp / valCols.length)]; drillable = true }
    else if (cp < groupCount + valCols.length) drillable = true   // totals block → all columns
  } else {
    const cp = c - nRowFields
    const width = valCols.length + (valCols.length > 1 ? 1 : 0)   // +1 for the multi-value grand total
    if (cp >= 0 && cp < width) drillable = true
  }
  if (!drillable) return null

  const rows = dataRows.filter(row =>
    (rk === null || _makeKey(row, rowIdxs) === rk) &&
    (ck === null || _makeKey(row, colIdxs) === ck))
  return { headers, rows }
}

// ── Write pivot output to sheet ──────────────────────────────────────────────

// Write a computed pivot table into the sheet, offset by `anchor` (so several
// pivots can coexist on one sheet at different origins). `clearRect` wipes only
// the pivot's *previous* output rectangle (`prevExtent`, or nothing on the
// first render) instead of the whole sheet, so a rebuild never erases a
// neighbouring pivot or user data.
export function writePivotToSheet(table, outputSheet, setCell, clearRect, anchor = { row: 0, col: 0 }, prevExtent = null) {
  clearRect(outputSheet, prevExtent)
  for (let r = 0; r < table.length; r++) {
    for (let c = 0; c < table[r].length; c++) {
      const v = table[r][c]
      if (v === null || v === undefined || v === '') continue
      // Preserve numeric type so values sort/formula-reference correctly.
      setCell(cellId(anchor.row + r, anchor.col + c), typeof v === 'number' ? v : String(v), outputSheet)
    }
  }
}

// ── Engine (stateful) ─────────────────────────────────────────────────────────

export function createPivotEngine() {
  let _pivots = {}   // id → PivotConfig
  let _nextId  = 1
  let _onChange = null

  function _newId() { return `pivot_${_nextId++}` }
  function _notify() { _onChange?.() }

  // Register a callback fired after every mutation (add/update/remove/restore).
  // Consumers wire this to a Vue ref so list-driven computeds re-evaluate —
  // crucial for `restore`, which used to silently rehydrate state without
  // triggering reactivity, hiding the pivot edit FAB on page reload.
  function setOnChange(cb) { _onChange = cb }

  function add(config) {
    const id = config.id || _newId()
    // anchor defaults go before the spread so an explicit anchor in `config`
    // wins, while callers that pass none (and old configs) default to A1.
    _pivots[id] = { anchorRow: 0, anchorCol: 0, ...config, id }
    _notify()
    return id
  }

  // Record the last-written output rectangle for a pivot. This is transient
  // render state (recomputed on every render) — it is NOT persisted by
  // snapshot(), so it never goes stale across reload/undo. Mutates without
  // notifying since overlays read it via renderVersion, not pivotVersion.
  function setExtent(id, extent) {
    if (_pivots[id]) _pivots[id]._extent = extent
  }

  function update(id, config) {
    if (_pivots[id]) {
      _pivots[id] = { ..._pivots[id], ...config, id }
      _notify()
    }
  }

  function remove(id) {
    if (id in _pivots) { delete _pivots[id]; _notify() }
  }

  function list() { return Object.values(_pivots) }

  function get(id) { return _pivots[id] }

  // Returns true if the given sheet+cellId falls within any pivot's source range.
  function affectsPivot(sheetName) {
    return Object.values(_pivots).some(p => p.sourceSheet === sheetName)
  }

  // Strip the transient `_extent` render cache from each config so it's never
  // persisted — a stale rectangle surviving reload/undo would mis-clear cells.
  function snapshot() {
    const pivots = {}
    for (const [id, p] of Object.entries(_pivots)) {
      const { _extent, ...rest } = p
      pivots[id] = deepClone(rest)
    }
    return { pivots, nextId: _nextId }
  }

  function restore(data) {
    if (!data) return
    _pivots = deepClone(data.pivots || {})
    // Configs saved before anchors existed lack anchorRow/anchorCol; default
    // them to A1. restore() bypasses add(), so it must default them itself.
    // Use == null so a legitimately-stored 0 isn't re-defaulted.
    for (const p of Object.values(_pivots)) {
      if (p.anchorRow == null) p.anchorRow = 0
      if (p.anchorCol == null) p.anchorCol = 0
    }
    _nextId  = data.nextId  || 1
    _notify()
  }

  return { add, update, remove, list, get, affectsPivot, snapshot, restore, setOnChange, setExtent }
}
