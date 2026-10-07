// The view state of one open sheet: everything about how it looks that isn't
// a cell's content. Column widths, row heights, scroll, freeze, hidden rows and
// columns, sheet size, zoom, and the selection.
//
// Canvas modules read it live (geometry walks `colW` on every paint) and change
// it only through the setters here. `serialize()` is the `view` slice of the
// save payload; the selection is per-user and is never part of it.
//
// Rows and columns are 0-based.

export interface Cell {
  r: number
  c: number
}

export type SelMode = 'cell' | 'col' | 'row' | 'all'

/** Anchor = the active cell; head = the opposite corner; mode widens the range. */
export interface SelectionState {
  anchor: Cell
  head: Cell
  mode: SelMode
}

/** What a sheet saves about its view. */
export interface ViewSnapshot {
  colW: { [col: number]: number }
  rowH: { [row: number]: number }
  freezeRows: number
  freezeCols: number
  hiddenRows: number[]
  hiddenCols: number[]
  totalRows: number
  totalCols: number
  zoom: number
}

/** Maps an old row/column index to its new one; null or negative drops it. */
export type IndexMap = (i: number) => number | null | undefined

export const DEFAULT_COL_W = 100
export const DEFAULT_ROW_H = 24
export const DEFAULT_TOTAL_ROWS = 1000
export const DEFAULT_TOTAL_COLS = 26
export const MIN_COL_W = 30
export const MIN_ROW_H = 16
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 2.5

export interface ViewModel {
  // Live state. Read freely; change only through the setters below.
  readonly colW: { readonly [col: number]: number }
  readonly rowH: { readonly [row: number]: number }
  /** Scroll offset in logical px; the viewport writes it as it clamps. */
  readonly scroll: { x: number; y: number }
  readonly freeze: { readonly rows: number; readonly cols: number }
  readonly hiddenRows: ReadonlySet<number>
  readonly hiddenCols: ReadonlySet<number>
  /** The hidden rows that come from a filter rather than a manual hide. */
  readonly filterHiddenRows: ReadonlySet<number>
  readonly sel: SelectionState
  readonly totalRows: number
  readonly totalCols: number
  readonly zoom: number

  /** Stored width, ignoring hides. */
  colWidth(c: number): number
  rowHeight(r: number): number
  setColWidth(c: number, w: number): void
  setRowHeight(r: number, h: number): void
  /** Insert/delete: move every size at or after `at` by `delta`. */
  shiftCols(at: number, delta: number): void
  shiftRows(at: number, delta: number): void
  /** Move/sort: send sizes and hides through the engine's index map. */
  remapCols(map: IndexMap): void
  remapRows(map: IndexMap): void
  /** Also resets scroll, so the first unfrozen row/column sits at the edge. */
  setFreeze(rows: number, cols: number): void
  setHiddenRows(rows: Iterable<number>): void
  setHiddenCols(cols: Iterable<number>): void
  /** Tag which hidden rows are filter hides; set the union with setHiddenRows first. */
  setFilterHiddenRows(rows: Iterable<number>): void
  setTotalRows(n: number): void
  setTotalCols(n: number): void
  setZoom(z: number): void

  serialize(): ViewSnapshot
  /** Load a saved view; missing parts fall back to the defaults. */
  restore(snap: Partial<ViewSnapshot> | null | undefined): void
}

type Sizes = { [i: number]: number }

function replace(set: Set<number>, items: Iterable<number>): void {
  set.clear()
  for (const i of items) set.add(i)
}

function clearSizes(sizes: Sizes): void {
  for (const k of Object.keys(sizes)) delete sizes[Number(k)]
}

function entries(sizes: Sizes): [number, number][] {
  return Object.entries(sizes).map(([k, v]): [number, number] => [Number(k), v])
}

// Walk away from the gap so no entry overwrites one not yet moved.
function shiftSizes(sizes: Sizes, at: number, delta: number): void {
  const moving = entries(sizes)
    .filter(([i]) => i >= at)
    .sort((a, b) => (delta > 0 ? b[0] - a[0] : a[0] - b[0]))
  for (const [i, v] of moving) {
    delete sizes[i]
    if (i + delta >= 0) sizes[i + delta] = v
  }
}

function remap(sizes: Sizes, hidden: Set<number>, map: IndexMap): void {
  const old = entries(sizes)
  clearSizes(sizes)
  for (const [i, v] of old) {
    const n = map(i)
    if (n != null && n >= 0) sizes[n] = v
  }
  const oldHidden = [...hidden]
  hidden.clear()
  for (const i of oldHidden) {
    const n = map(i)
    if (n != null && n >= 0) hidden.add(n)
  }
}

const clampZoom = (z: number): number => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
const clampTotal = (n: number): number => Math.max(1, Math.floor(n))

export function createViewModel(): ViewModel {
  const colW: Sizes = {}
  const rowH: Sizes = {}
  const scroll = { x: 0, y: 0 }
  const freeze = { rows: 0, cols: 0 }
  const hiddenRows = new Set<number>()
  const hiddenCols = new Set<number>()
  const filterHiddenRows = new Set<number>()
  const sel: SelectionState = { anchor: { r: 0, c: 0 }, head: { r: 0, c: 0 }, mode: 'cell' }
  let totalRows = DEFAULT_TOTAL_ROWS
  let totalCols = DEFAULT_TOTAL_COLS
  let zoom = 1

  return {
    colW,
    rowH,
    scroll,
    freeze,
    hiddenRows,
    hiddenCols,
    filterHiddenRows,
    sel,
    get totalRows() {
      return totalRows
    },
    get totalCols() {
      return totalCols
    },
    get zoom() {
      return zoom
    },

    colWidth: (c) => colW[c] ?? DEFAULT_COL_W,
    rowHeight: (r) => rowH[r] ?? DEFAULT_ROW_H,
    setColWidth(c, w) {
      colW[c] = Math.max(MIN_COL_W, w)
    },
    setRowHeight(r, h) {
      rowH[r] = Math.max(MIN_ROW_H, h)
    },
    shiftCols: (at, delta) => shiftSizes(colW, at, delta),
    shiftRows: (at, delta) => shiftSizes(rowH, at, delta),
    remapCols: (map) => remap(colW, hiddenCols, map),
    remapRows: (map) => remap(rowH, hiddenRows, map),

    setFreeze(rows, cols) {
      freeze.rows = rows || 0
      freeze.cols = cols || 0
      scroll.x = 0
      scroll.y = 0
    },
    setHiddenRows: (rows) => replace(hiddenRows, rows),
    setHiddenCols: (cols) => replace(hiddenCols, cols),
    setFilterHiddenRows: (rows) => replace(filterHiddenRows, rows),
    setTotalRows(n) {
      totalRows = clampTotal(n)
    },
    setTotalCols(n) {
      totalCols = clampTotal(n)
    },
    setZoom(z) {
      zoom = clampZoom(z)
    },

    serialize() {
      return {
        colW: { ...colW },
        rowH: { ...rowH },
        freezeRows: freeze.rows,
        freezeCols: freeze.cols,
        // Manual hides only: filter hides are re-derived per sheet, and
        // saving them leaked one sheet's filter onto the others.
        hiddenRows: [...hiddenRows].filter((r) => !filterHiddenRows.has(r)),
        hiddenCols: [...hiddenCols],
        totalRows,
        totalCols,
        zoom,
      }
    },

    restore(snap) {
      if (!snap) return
      clearSizes(colW)
      clearSizes(rowH)
      Object.assign(colW, snap.colW || {})
      Object.assign(rowH, snap.rowH || {})
      freeze.rows = snap.freezeRows || 0
      freeze.cols = snap.freezeCols || 0
      replace(hiddenRows, snap.hiddenRows || [])
      // A previous sheet's filter tags must not carry over.
      filterHiddenRows.clear()
      replace(hiddenCols, snap.hiddenCols || [])
      // No saved size (new, pivot, drill-down sheets): back to the default,
      // not whatever a big sheet grew it to. The host grows it to fit data.
      totalRows = clampTotal(
        typeof snap.totalRows === 'number' ? snap.totalRows : DEFAULT_TOTAL_ROWS,
      )
      totalCols = clampTotal(
        typeof snap.totalCols === 'number' ? snap.totalCols : DEFAULT_TOTAL_COLS,
      )
      if (typeof snap.zoom === 'number') zoom = clampZoom(snap.zoom)
    },
  }
}
