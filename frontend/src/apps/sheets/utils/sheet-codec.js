// Compact row-major codec for the `sheet` slice of a saved payload.
//
// In memory the engine keys every cell by its id ({ "A1": "v", "B1": "w" }).
// As JSON that map inflates ~2.5x: each value drags its cell-id key along, and
// the keys are unique so gzip can't crush them. Packing each sheet into per-row
// value arrays drops the keys entirely. On a 2M-cell import the `sheet` slice
// goes 36MB -> 20MB uncompressed and 6.4MB -> 1.5MB gzipped, and stringify
// drops from ~1s to ~0.15s. The smaller uncompressed size is also what the
// server's size gate measures, so real sheets stop tripping the limit.
//
// Wire shape (version 2):
//   { v: 2, current: "Sheet1",
//     sheets: { Sheet1: { rows: { "0": ["a","b"], "4": [null,"x"] } } } }
// Row keys are 0-based row indices; array slots are 0-based columns. Empty
// slots / holes are dropped on unpack. Legacy payloads (no `v`) are the old
// { sheets: { name: { cellId: val } }, current } shape and pass through
// untouched in both directions, so old documents keep loading and migrate
// lazily on their next save.

import { colLabel } from './cells.js'

const PACK_VERSION = 2

// Pack a `{ sheets, current }` snapshot into the compact wire shape. Reads the
// input without mutating it, so callers can hand it the engine's live data.
// Synchronous: use for the keepalive/unmount save, where the page may die
// before an async pass could finish. Interactive autosave should prefer
// packSheetChunked so it doesn't freeze the main thread.
export function packSheet(snap) {
  const sheets = (snap && snap.sheets) || {}
  const out = {}
  for (const name of Object.keys(sheets)) {
    const cells = sheets[name]
    const rows = {}
    for (const id in cells) _packCellInto(rows, id, cells[id])
    out[name] = { rows }
  }
  return { v: PACK_VERSION, current: (snap && snap.current) || 'Sheet1', sheets: out }
}

// Async, chunked variant of packSheet. Yields to the event loop every
// `yieldEvery` cells so a multi-million-cell pack doesn't monopolise the main
// thread — that monopoly was the ~6s "input delay" before the browser could
// even handle a keystroke during autosave. Consistency: each sheet's cell ids
// are snapshotted up front and each value read is atomic, so a concurrent edit
// at worst lands in the NEXT autosave rather than tearing this payload (still
// valid JSON either way; isDirty stays set so the follow-up save catches it).
export async function packSheetChunked(snap, { yieldEvery = 50000 } = {}) {
  const sheets = (snap && snap.sheets) || {}
  const out = {}
  let since = 0
  for (const name of Object.keys(sheets)) {
    const cells = sheets[name]
    const rows = {}
    const ids = Object.keys(cells)
    for (let k = 0; k < ids.length; k++) {
      _packCellInto(rows, ids[k], cells[ids[k]])
      if (++since >= yieldEvery) { since = 0; await _tick() }
    }
    out[name] = { rows }
  }
  return { v: PACK_VERSION, current: (snap && snap.current) || 'Sheet1', sheets: out }
}

function _tick() { return new Promise(r => setTimeout(r, 0)) }

// Unpack the compact wire shape back to `{ sheets, current }`. Anything that
// isn't a version-2 envelope (legacy snapshots, the empty-default fallback) is
// returned unchanged.
export function unpackSheet(data) {
  if (!data || typeof data !== 'object' || data.v !== PACK_VERSION) return data
  const sheets = {}
  const packed = data.sheets || {}
  for (const name of Object.keys(packed)) sheets[name] = _unpackRows(packed[name] && packed[name].rows)
  return { sheets, current: data.current || 'Sheet1' }
}

// Cheaply derive each sheet's { maxRow, maxCol } extent straight from the
// packed structure — row keys and array lengths give it without parsing a
// single cell id. The load path hands this to the engine so the grid can size
// itself without _repopulateGrid re-parsing every cell id for bounds (~0.5s on
// a 2M-cell sheet). Returns null for legacy/non-packed input.
export function boundsOf(data) {
  if (!data || typeof data !== 'object' || data.v !== PACK_VERSION) return null
  const out = {}
  const packed = data.sheets || {}
  for (const name of Object.keys(packed)) {
    const rows = packed[name] && packed[name].rows
    let maxRow = 0, maxCol = 0
    for (const r in (rows || {})) {
      const arr = rows[r]
      if (!arr) continue
      const row = +r
      if (row > maxRow) maxRow = row
      if (arr.length - 1 > maxCol) maxCol = arr.length - 1
    }
    out[name] = { maxRow, maxCol }
  }
  return out
}

// Column labels are stable, so cache them module-wide and grow on demand —
// unpacking 2M cells otherwise re-walks colLabel's character loop per cell.
const _labelCache = []
function _label(c) {
  for (let i = _labelCache.length; i <= c; i++) _labelCache[i] = colLabel(i)
  return _labelCache[c]
}

// Place one cell into the row-major `rows` accumulator. Shared by the sync and
// chunked packers so they can't drift. Skips empties and malformed ids.
function _packCellInto(rows, id, v) {
  if (v === '' || v == null) return
  const { row, col } = _parseId(id)
  if (!(row >= 0) || !(col >= 0)) return
  let arr = rows[row]
  if (!arr) arr = rows[row] = []
  arr[col] = v
}

function _unpackRows(rows) {
  const cells = {}
  if (!rows) return cells
  for (const r in rows) {
    const arr = rows[r]
    if (!arr) continue
    // Build the row suffix once and reuse cached column labels, instead of
    // recomputing colLabel + string concat for every one of the row's cells.
    const suffix = String(+r + 1)
    for (let c = 0; c < arr.length; c++) {
      const v = arr[c]
      if (v === '' || v == null) continue
      cells[_label(c) + suffix] = v
    }
  }
  return cells
}

// Regex-free cell-id parse — the hot path runs once per cell on multi-million
// cell sheets, where `parseCellId`'s regex + split is ~3x slower. Returns
// 0-based { row, col }; row/col are NaN for malformed ids and skipped above.
function _parseId(id) {
  let i = 0, col = 0
  for (; i < id.length; i++) {
    const cc = id.charCodeAt(i)
    if (cc < 65 || cc > 90) break // first non-A-Z char starts the row digits
    col = col * 26 + (cc - 64)
  }
  return { row: +id.slice(i) - 1, col: col - 1 }
}
