// The grid's selection: which cells are selected, and how it moves.
//
// A selection has an anchor (where it started, the active cell) and a head
// (the opposite corner, which Shift+arrow and drag move). The mode says
// whether whole columns, rows or the sheet are selected; in those modes the
// range spans the full perpendicular axis whatever the corners say.
//
// Rows and columns are 0-based here, like the rest of canvas/.
// Painting, scrolling and notifying the host are the caller's job.

export type SelMode = 'cell' | 'col' | 'row' | 'all'

export interface Cell {
  r: number
  c: number
}

export interface SelRange {
  r0: number
  c0: number
  r1: number
  c1: number
  mode: SelMode
}

export interface SelectionOptions {
  /** Keeps a cell inside the sheet (canvas/geometry.js `clamp`). */
  clamp(r: number, c: number): Cell
  totalRows(): number
  totalCols(): number
}

export interface Selection {
  anchor: Cell
  head: Cell
  mode: SelMode
  /** Normalised range: r0 <= r1, c0 <= c1, widened by the mode. */
  range(): SelRange
  /** Restore a range (e.g. the one a right-click collapsed). */
  set(range: SelRange): void
  /** Collapse to one cell. */
  moveTo(r: number, c: number): void
  /** Move the head, keeping the anchor. */
  extendTo(r: number, c: number): void
}

export function createSelection(o: SelectionOptions): Selection {
  const s: Selection = {
    anchor: { r: 0, c: 0 },
    head: { r: 0, c: 0 },
    mode: 'cell',

    range() {
      let r0 = Math.min(s.anchor.r, s.head.r),
        r1 = Math.max(s.anchor.r, s.head.r)
      let c0 = Math.min(s.anchor.c, s.head.c),
        c1 = Math.max(s.anchor.c, s.head.c)
      // Whole-row / column / sheet selections keep their anchor on the
      // active cell; the mode, not the corners, defines the other axis.
      // So a Shift+Space row still covers every column for copy/delete.
      if (s.mode === 'row' || s.mode === 'all') {
        c0 = 0
        c1 = o.totalCols() - 1
      }
      if (s.mode === 'col' || s.mode === 'all') {
        r0 = 0
        r1 = o.totalRows() - 1
      }
      return { r0, c0, r1, c1, mode: s.mode }
    },

    set({ r0, c0, r1, c1, mode }) {
      s.mode = mode
      s.anchor = o.clamp(r0, c0)
      s.head = o.clamp(r1, c1)
    },

    moveTo(r, c) {
      s.mode = 'cell'
      s.anchor = s.head = o.clamp(r, c)
    },

    extendTo(r, c) {
      s.head = o.clamp(r, c)
    },
  }
  return s
}

/**
 * Where Ctrl/Cmd+Arrow lands, as in Google Sheets: from a filled cell with a
 * filled neighbour, the end of that block; otherwise the next filled cell in
 * that direction; with none, the sheet edge.
 */
export function jumpEdge(
  start: Cell,
  dr: number,
  dc: number,
  hasValue: (r: number, c: number) => boolean,
  maxR: number,
  maxC: number,
): Cell {
  const inside = (r: number, c: number) => r >= 0 && r <= maxR && c >= 0 && c <= maxC
  const nr = Math.max(0, Math.min(maxR, start.r + dr))
  const nc = Math.max(0, Math.min(maxC, start.c + dc))
  if (hasValue(start.r, start.c) && hasValue(nr, nc)) {
    let r = start.r,
      c = start.c
    while (inside(r + dr, c + dc) && hasValue(r + dr, c + dc)) {
      r += dr
      c += dc
    }
    return { r, c }
  }
  let r = start.r + dr,
    c = start.c + dc
  while (inside(r, c)) {
    if (hasValue(r, c)) return { r, c }
    r += dr
    c += dc
  }
  return {
    r: dr > 0 ? maxR : dr < 0 ? 0 : start.r,
    c: dc > 0 ? maxC : dc < 0 ? 0 : start.c,
  }
}
