// Reads the compact row-major `sheet` slice of a payload saved by the old
// engine. Nothing writes this shape any more; old sheets' bodies, their
// conversion to the live room and recovery copies still hold it.
//
// In memory the engine keyed every cell by its id ({ "A1": "v", "B1": "w" }).
// As JSON that map inflates ~2.5x, so each sheet was packed into per-row value
// arrays without the keys.
//
// Wire shape (version 2):
//   { v: 2, current: "Sheet1",
//     sheets: { Sheet1: { rows: { "0": ["a","b"], "4": [null,"x"] } } } }
// Row keys are 0-based row indices; array slots are 0-based columns. Empty
// slots / holes are dropped on unpack. Legacy payloads (no `v`) are the old
// { sheets: { name: { cellId: val } }, current } shape and pass through
// untouched.

import { colLabel } from './cells.js'

const PACK_VERSION = 2

type Cells = Record<string, unknown>

/** In-memory shape: each sheet's cells keyed by A1 id. */
interface SheetSnapshot {
  sheets: Record<string, Cells>
  current: string
}

/** Row key → that row's values by 0-based column. */
type PackedRows = Record<string, unknown[]>

interface PackedSheets {
  v: typeof PACK_VERSION
  current: string
  sheets: Record<string, { rows: PackedRows }>
}

// Unpack the compact wire shape back to `{ sheets, current }`. Anything that
// isn't a version-2 envelope (legacy snapshots, the empty-default fallback) is
// returned unchanged, which is why the result is `unknown`.
export function unpackSheet(data: unknown): unknown {
  if (!_isPacked(data)) return data
  const sheets: Record<string, Cells> = {}
  const packed = data.sheets || {}
  for (const name of Object.keys(packed)) sheets[name] = _unpackRows(packed[name]?.rows)
  return { sheets, current: data.current || 'Sheet1' } satisfies SheetSnapshot
}

// A version-2 envelope; its fields are still checked where they're read.
function _isPacked(data: unknown): data is Partial<PackedSheets> {
  return !!data && typeof data === 'object' && (data as { v?: unknown }).v === PACK_VERSION
}

// Column labels are stable, so cache them module-wide and grow on demand —
// unpacking 2M cells otherwise re-walks colLabel's character loop per cell.
const _labelCache: string[] = []
function _label(c: number): string {
  for (let i = _labelCache.length; i <= c; i++) _labelCache[i] = colLabel(i)
  return _labelCache[c] ?? ''
}

function _unpackRows(rows: PackedRows | undefined): Cells {
  const cells: Cells = {}
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
