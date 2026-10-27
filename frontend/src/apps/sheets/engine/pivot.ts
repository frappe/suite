import { cellId, parseCellId } from '../utils/cells.js'
import { deepClone } from '../utils/deep-clone.js'
import { displayNumber } from '../utils/format-number.js'
import { newItemId } from './item-id.js'
import { remapRangeString } from './ref-remap.js'
import type { IndexMap, Rect } from './types.js'

export const AGG_OPTIONS = [
  { value: 'sum', label: 'SUM' },
  { value: 'count', label: 'COUNT' },
  { value: 'avg', label: 'AVERAGE' },
  { value: 'min', label: 'MIN' },
  { value: 'max', label: 'MAX' },
  { value: 'counta', label: 'COUNTA' },
]

/** A value field: the source column (by header name) and how to aggregate it. */
export interface PivotValue {
  field: string
  /** An AGG_OPTIONS value; absent or unknown sums. */
  agg?: string
}

/**
 * What a pivot is built from and where it is written. Fields are named by
 * header text, so they survive a column reorder. Everything is optional:
 * the computations bail out (null) when a part is missing.
 */
export interface PivotSpec {
  sourceSheet?: string
  sourceRange?: string
  rows?: string[]
  cols?: string[]
  values?: PivotValue[]
  outputSheet?: string
  /** Output origin, 0-based. */
  anchorRow?: number
  anchorCol?: number
}

export interface PivotConfig extends PivotSpec {
  id: string
  anchorRow: number
  anchorCol: number
  /** Last written output rectangle. Render state only, never persisted. */
  _extent?: Rect | null
}

export interface PivotSnapshot {
  pivots: Record<string, Omit<PivotConfig, '_extent'>>
  /** From when ids were counted; ignored. */
  nextId?: number
}

/** A pivot output cell: a label or an aggregate ('' when there is nothing to aggregate). */
export type PivotCell = string | number

/** Reads a range by its corner cell ids, row by row (cells as values). */
export type RangeGetter = (
  startId: string,
  endId: string,
  sheet?: string,
) => unknown[][] | null | undefined

interface ValCol {
  idx: number
  agg: string
  field: string
}

interface PivotPlan {
  headers: string[]
  rows: string[]
  rowIdxs: number[]
  colIdxs: number[]
  valCols: ValCol[]
  hasColFields: boolean
}

interface Accumulator {
  buckets: Map<string, unknown[]>
  rowKeyList: string[]
  colKeyList: string[]
  rowKeySet: Set<string>
  colKeySet: Set<string>
}

export interface PivotModel extends Omit<PivotPlan, 'rows'> {
  table: PivotCell[][]
  dataRows: unknown[][]
  rowKeyList: string[]
  colKeyList: string[]
}

export type PivotEngine = ReturnType<typeof createPivotEngine>

// ── Pure helpers ────────────────────────────────────────────────────────────

function _agg(vals: unknown[], fn: string): number | '' {
  if (!vals.length) return ''
  const nums = vals.filter((v): v is number => typeof v === 'number' && !isNaN(v))
  switch (fn) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0)
    case 'count':
      return vals.length // count all non-empty values (text + numbers)
    case 'counta':
      return vals.length
    case 'avg':
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : ''
    case 'min':
      return nums.length ? Math.min(...nums) : ''
    case 'max':
      return nums.length ? Math.max(...nums) : ''
    default:
      return nums.reduce((a, b) => a + b, 0)
  }
}

// Build a Map key string from row values at given column indices.
function _makeKey(row: unknown[], idxs: number[]) {
  return idxs.map((i) => String(row[i] ?? '')).join('\x00')
}

// Split a composite key back into its parts.
function _keyParts(key: string) {
  return key.split('\x00')
}

// ── Source reading ───────────────────────────────────────────────────────────

// "A1:C10" (or one cell) → 0-based { r0, c0, r1, c1 }, or null.
export function parseRangeRect(range: unknown): Rect | null {
  const text = String(range || '')
  // split(':') on a string containing ':' always yields at least two parts.
  const [start = '', end = ''] = text.includes(':') ? text.split(':') : [text, text]
  const s = parseCellId(start.trim()),
    e = parseCellId(end.trim())
  if (!s || !e) return null
  return {
    r0: Math.min(s.row, e.row),
    c0: Math.min(s.col, e.col),
    r1: Math.max(s.row, e.row),
    c1: Math.max(s.col, e.col),
  }
}

// A getRangeValues over values already read from the workbook: `data` holds
// `rect`'s rows; cells outside it read as ''. Lets the pure pivot code stay
// synchronous while the read itself is async.
export function rangeReader(rect: Rect, data: unknown[][]) {
  return (startId: string, endId: string) => {
    const s = parseCellId(startId),
      e = parseCellId(endId)
    if (!s || !e) return []
    const rows: unknown[][] = []
    for (let r = Math.min(s.row, e.row); r <= Math.max(s.row, e.row); r++) {
      const row: unknown[] = []
      for (let c = Math.min(s.col, e.col); c <= Math.max(s.col, e.col); c++)
        row.push(data[r - rect.r0]?.[c - rect.c0] ?? '')
      rows.push(row)
    }
    return rows
  }
}

// ── Pivot computation (pure) ─────────────────────────────────────────────────

export function computePivot(config: PivotSpec, getRangeValues: RangeGetter) {
  return computePivotModel(config, getRangeValues)?.table ?? []
}

// Like computePivot but returns the full intermediate model alongside the
// rendered table: { table, headers, dataRows, rowIdxs, colIdxs, valCols,
// rowKeyList, colKeyList, hasColFields }. Drill-down needs the keys + source
// rows to map an output cell back to the rows that fed it. Returns null when
// there's nothing to pivot. computePivot() is a thin wrapper over this.
export function computePivotModel(
  config: PivotSpec,
  getRangeValues: RangeGetter,
): PivotModel | null {
  const { sourceSheet, sourceRange } = config
  if (!sourceRange) return null
  const [start = '', end = ''] = sourceRange.includes(':')
    ? sourceRange.split(':')
    : [sourceRange, sourceRange]
  const data = getRangeValues(start, end, sourceSheet)
  if (!data || data.length < 2) return null

  const plan = _planPivot(config, data[0])
  if (!plan) return null
  const dataRows = data
    .slice(1)
    .filter((r) => r.some((v) => v !== null && v !== undefined && v !== ''))
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
export async function computePivotModelAsync(
  config: PivotSpec,
  getRangeValues: RangeGetter,
  { blockRows = 5000, onYield }: { blockRows?: number; onYield?: () => unknown } = {},
): Promise<PivotModel | null> {
  const { sourceSheet, sourceRange } = config
  if (!sourceRange) return null
  const [start = '', end = ''] = sourceRange.includes(':')
    ? sourceRange.split(':')
    : [sourceRange, sourceRange]
  const s = parseCellId(start),
    e = parseCellId(end)
  if (!s || !e) return null
  const r0 = Math.min(s.row, e.row),
    rEnd = Math.max(s.row, e.row)
  const c0 = Math.min(s.col, e.col),
    c1 = Math.max(s.col, e.col)

  const headerRow = (getRangeValues(cellId(r0, c0), cellId(r0, c1), sourceSheet) || [])[0]
  const plan = _planPivot(config, headerRow)
  if (!plan || rEnd <= r0) return null

  const acc = _newAccumulator()
  const dataRows: unknown[][] = []
  for (let br = r0 + 1; br <= rEnd; br += blockRows) {
    const be = Math.min(br + blockRows - 1, rEnd)
    const block = getRangeValues(cellId(br, c0), cellId(be, c1), sourceSheet) || []
    for (const row of block) {
      if (!row.some((v) => v !== null && v !== undefined && v !== '')) continue
      _accumulate(acc, row, plan)
      dataRows.push(row)
    }
    if (onYield) {
      const ok = await onYield()
      if (ok === false) return null
    }
  }
  if (!dataRows.length) return null
  return _finishModel(acc, dataRows, plan)
}

// Resolve field names → column indices from the header row, validating that
// there's something to pivot. Returns null when the config can't produce a table.
function _planPivot(config: PivotSpec, headerRowRaw: unknown[] | undefined): PivotPlan | null {
  const { rows, cols, values } = config
  if (!rows?.length || !values?.length || !headerRowRaw) return null
  const headers = headerRowRaw.map((h) => String(h ?? ''))
  const rowIdxs = rows.map((f) => headers.indexOf(f)).filter((i) => i >= 0)
  const colIdxs = (cols || []).map((f) => headers.indexOf(f)).filter((i) => i >= 0)
  const valCols = values
    .map((v) => ({ idx: headers.indexOf(v.field), agg: v.agg || 'sum', field: v.field }))
    .filter((v) => v.idx >= 0)
  if (!valCols.length || !rowIdxs.length) return null
  return { headers, rows, rowIdxs, colIdxs, valCols, hasColFields: colIdxs.length > 0 }
}

function _newAccumulator(): Accumulator {
  return {
    buckets: new Map(), // rk\x01ck\x01vi → [values]
    rowKeyList: [],
    colKeyList: [],
    rowKeySet: new Set(),
    colKeySet: new Set(),
  }
}

function _accumulate(acc: Accumulator, row: unknown[], plan: PivotPlan) {
  const { rowIdxs, colIdxs, valCols, hasColFields } = plan
  const rk = _makeKey(row, rowIdxs)
  const ck = hasColFields ? _makeKey(row, colIdxs) : ''
  if (!acc.rowKeySet.has(rk)) {
    acc.rowKeySet.add(rk)
    acc.rowKeyList.push(rk)
  }
  if (hasColFields && !acc.colKeySet.has(ck)) {
    acc.colKeySet.add(ck)
    acc.colKeyList.push(ck)
  }
  for (let vi = 0; vi < valCols.length; vi++) {
    const key = `${rk}\x01${ck}\x01${vi}`
    let arr = acc.buckets.get(key)
    if (!arr) {
      arr = []
      acc.buckets.set(key, arr)
    }
    const raw = row[(valCols[vi] as ValCol).idx]
    if (raw !== null && raw !== undefined && raw !== '') {
      const n = displayNumber(raw)
      arr.push(isNaN(n) ? raw : n)
    }
  }
}

function _finishModel(acc: Accumulator, dataRows: unknown[][], plan: PivotPlan): PivotModel {
  const { headers, rows, rowIdxs, colIdxs, valCols, hasColFields } = plan
  const { buckets, rowKeyList, colKeyList } = acc
  // vi always indexes valCols.
  const aggOf = (vi: number) => (valCols[vi] as ValCol).agg

  const _sortKeys = (list: string[]) =>
    list.sort((a, b) => {
      const an = Number(a),
        bn = Number(b)
      if (!isNaN(an) && !isNaN(bn)) return an - bn
      return a.localeCompare(b)
    })
  _sortKeys(rowKeyList)
  if (hasColFields) _sortKeys(colKeyList)

  const get = (rk: string, ck: string, vi: number) => buckets.get(`${rk}\x01${ck}\x01${vi}`) || []
  const table: PivotCell[][] = []

  // ── Header row ────────────────────────────────────────────────────────────
  const hdr: PivotCell[] = [...rows.slice(0, rowIdxs.length)]
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
    const row: PivotCell[] = _keyParts(rk).map((p) => p || '(blank)')
    if (hasColFields) {
      for (const ck of colKeyList) {
        for (let vi = 0; vi < valCols.length; vi++) row.push(_agg(get(rk, ck, vi), aggOf(vi)))
      }
      for (let vi = 0; vi < valCols.length; vi++) {
        const rowVals = colKeyList.flatMap((ck) => get(rk, ck, vi))
        row.push(_agg(rowVals, aggOf(vi)))
      }
    } else {
      for (let vi = 0; vi < valCols.length; vi++) row.push(_agg(get(rk, '', vi), aggOf(vi)))
      if (valCols.length > 1) {
        const allVals = valCols.flatMap((_, vi) => get(rk, '', vi))
        row.push(_agg(allVals, aggOf(0)))
      }
    }
    table.push(row)
  }

  // ── Grand total row ────────────────────────────────────────────────────────
  const totalRow: PivotCell[] = rows
    .slice(0, rowIdxs.length)
    .map((_, i) => (i === 0 ? 'Grand Total' : ''))
  if (hasColFields) {
    for (const ck of colKeyList) {
      for (let vi = 0; vi < valCols.length; vi++) {
        const colVals = rowKeyList.flatMap((rk) => get(rk, ck, vi))
        totalRow.push(_agg(colVals, aggOf(vi)))
      }
    }
    for (let vi = 0; vi < valCols.length; vi++) {
      const all = rowKeyList.flatMap((rk) => colKeyList.flatMap((ck) => get(rk, ck, vi)))
      totalRow.push(_agg(all, aggOf(vi)))
    }
  } else {
    for (let vi = 0; vi < valCols.length; vi++) {
      const all = rowKeyList.flatMap((rk) => get(rk, '', vi))
      totalRow.push(_agg(all, aggOf(vi)))
    }
    if (valCols.length > 1) totalRow.push('')
  }
  table.push(totalRow)

  return {
    table,
    headers,
    dataRows,
    rowIdxs,
    colIdxs,
    valCols,
    rowKeyList,
    colKeyList,
    hasColFields,
  }
}

// Map a clicked pivot output cell (r, c) back to the source rows that feed it.
// Returns { headers, rows } (rows = matching source data rows) or null if the
// cell isn't a drillable value/total/row-label cell. Which rows belong to a
// group depends only on the row-key ∩ col-key — not on which value field is
// aggregated — so we match on those two and ignore the value index.
export function pivotDrillDown(model: PivotModel | null | undefined, r: number, c: number) {
  if (!model) return null
  const { headers, dataRows, rowIdxs, colIdxs, valCols, rowKeyList, colKeyList, hasColFields } =
    model
  const nRowFields = rowIdxs.length
  const nData = rowKeyList.length

  // Row 0 is the header; rows 1..nData are groups; the last row is the grand
  // total (rk = null → every row group).
  if (r < 1 || r > nData + 1) return null
  const rk = r === nData + 1 ? null : rowKeyList[r - 1]

  let ck: string | null | undefined = null // null → every column group
  let drillable = false
  if (c < nRowFields) {
    drillable = true // row-label cell → whole row group
  } else if (hasColFields) {
    const cp = c - nRowFields
    const groupCount = colKeyList.length * valCols.length
    if (cp < groupCount) {
      ck = colKeyList[Math.floor(cp / valCols.length)]
      drillable = true
    } else if (cp < groupCount + valCols.length) drillable = true // totals block → all columns
  } else {
    const cp = c - nRowFields
    const width = valCols.length + (valCols.length > 1 ? 1 : 0) // +1 for the multi-value grand total
    if (cp >= 0 && cp < width) drillable = true
  }
  if (!drillable) return null

  const rows = dataRows.filter(
    (row) =>
      (rk === null || _makeKey(row, rowIdxs) === rk) &&
      (ck === null || _makeKey(row, colIdxs) === ck),
  )
  return { headers, rows }
}

// ── Write pivot output to sheet ──────────────────────────────────────────────

// Write a computed pivot table into the sheet, offset by `anchor` (so several
// pivots can coexist on one sheet at different origins). `clearRect` wipes only
// the pivot's *previous* output rectangle (`prevExtent`, or nothing on the
// first render) instead of the whole sheet, so a rebuild never erases a
// neighbouring pivot or user data.
export function writePivotToSheet(
  table: unknown[][],
  outputSheet: string,
  setCell: (id: string, value: number | string, sheet: string) => void,
  clearRect: (sheet: string, extent: Rect | null) => void,
  anchor = { row: 0, col: 0 },
  prevExtent: Rect | null = null,
) {
  clearRect(outputSheet, prevExtent)
  for (let r = 0; r < table.length; r++) {
    const row = table[r] as unknown[]
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (v === null || v === undefined || v === '') continue
      // Preserve numeric type so values sort/formula-reference correctly.
      setCell(
        cellId(anchor.row + r, anchor.col + c),
        typeof v === 'number' ? v : String(v),
        outputSheet,
      )
    }
  }
}

// ── Engine (stateful) ─────────────────────────────────────────────────────────

export function createPivotEngine() {
  let _pivots: Record<string, PivotConfig> = {} // id → PivotConfig
  let _onChange: (() => void) | null = null

  // Random, so two tabs adding a pivot at once never share an id (item-id.ts).
  function _newId() {
    return `pivot_${newItemId()}`
  }
  function _notify() {
    _onChange?.()
  }

  // Register a callback fired after every mutation (add/update/remove/restore).
  // Consumers wire this to a Vue ref so list-driven computeds re-evaluate —
  // crucial for `restore`, which used to silently rehydrate state without
  // triggering reactivity, hiding the pivot edit FAB on page reload.
  function setOnChange(cb: (() => void) | null) {
    _onChange = cb
  }

  function add(config: PivotSpec & { id?: string }) {
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
  function setExtent(id: string, extent: Rect | null) {
    const p = _pivots[id]
    if (p) p._extent = extent
  }

  function update(id: string, config: Partial<PivotConfig>) {
    const p = _pivots[id]
    if (p) {
      _pivots[id] = { ...p, ...config, id }
      _notify()
    }
  }

  function remove(id: string) {
    if (id in _pivots) {
      delete _pivots[id]
      _notify()
    }
  }

  function list() {
    return Object.values(_pivots)
  }

  function get(id: string) {
    return _pivots[id]
  }

  // Structural permutation. Remap the source range (when the op is on the source
  // sheet) and the output anchor column (when the op is on the output sheet).
  // Field references are by header name, so they survive a column reorder.
  function _remap(sheet: string, mapCol: IndexMap | null, mapRow: IndexMap | null) {
    const lc = String(sheet || '').toLowerCase()
    let changed = false
    for (const p of Object.values(_pivots)) {
      if (String(p.sourceSheet || '').toLowerCase() === lc && p.sourceRange) {
        p.sourceRange = remapRangeString(p.sourceRange, { opSheet: p.sourceSheet, mapCol, mapRow })
        changed = true
      }
      if (mapCol && String(p.outputSheet || '').toLowerCase() === lc && p.anchorCol != null) {
        const nc = mapCol(p.anchorCol)
        if (nc != null && nc >= 0) {
          p.anchorCol = nc
          changed = true
        }
      }
    }
    if (changed) _notify()
  }
  function remapCols(mapCol: IndexMap, sheet: string) {
    _remap(sheet, mapCol, null)
  }
  function remapRows(mapRow: IndexMap, sheet: string) {
    _remap(sheet, null, mapRow)
  }

  // Sheet operations, run alongside the other stores' (useSheetTabs extras).
  // A pivot names the sheet it reads (sourceSheet) and the sheet it writes
  // its table to (outputSheet).
  function renameSheet(oldName: string, newName: string) {
    let changed = false
    for (const p of Object.values(_pivots)) {
      if (p.sourceSheet === oldName) {
        p.sourceSheet = newName
        changed = true
      }
      if (p.outputSheet === oldName) {
        p.outputSheet = newName
        changed = true
      }
    }
    if (changed) _notify()
  }

  // A pivot whose output sheet is deleted goes with it.
  function deleteSheet(name: string) {
    const gone = Object.values(_pivots).filter((p) => p.outputSheet === name)
    for (const p of gone) delete _pivots[p.id]
    if (gone.length) _notify()
  }

  // Returns true if the given sheet+cellId falls within any pivot's source range.
  function affectsPivot(sheetName: string) {
    return Object.values(_pivots).some((p) => p.sourceSheet === sheetName)
  }

  // Strip the transient `_extent` render cache from each config so it's never
  // persisted — a stale rectangle surviving reload/undo would mis-clear cells.
  function snapshot(): PivotSnapshot {
    const pivots: PivotSnapshot['pivots'] = {}
    for (const [id, p] of Object.entries(_pivots)) {
      const { _extent, ...rest } = p
      pivots[id] = deepClone(rest)
    }
    return { pivots }
  }

  function restore(data: PivotSnapshot | null | undefined) {
    if (!data) return
    _pivots = deepClone(data.pivots || {})
    // Configs saved before anchors existed lack anchorRow/anchorCol; default
    // them to A1. restore() bypasses add(), so it must default them itself.
    // Use == null so a legitimately-stored 0 isn't re-defaulted.
    for (const p of Object.values(_pivots)) {
      if (p.anchorRow == null) p.anchorRow = 0
      if (p.anchorCol == null) p.anchorCol = 0
    }
    _notify()
  }

  return {
    add,
    update,
    remove,
    list,
    get,
    affectsPivot,
    remapCols,
    remapRows,
    renameSheet,
    deleteSheet,
    snapshot,
    restore,
    setOnChange,
    setExtent,
  }
}
