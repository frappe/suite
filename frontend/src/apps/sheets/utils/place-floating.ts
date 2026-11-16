// Where a new floating object (a chart, a slicer) goes: beside the cells it
// reads, on cells with no values, inside the visible grid. Positions are
// canvas-local CSS px, the space getCellRect reports in. Pure.

import type { CellBlock } from '../canvas/types'

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** A canvas-local top-left corner. */
export interface Spot {
  x: number
  y: number
}

export interface PlaceOptions {
  /** The cells the object reads. */
  source: CellBlock
  size: { width: number; height: number }
  /** A cell's rect on screen now (widths, heights, scroll, zoom). */
  cellRect: (r: number, c: number) => Box
  /** Whether a cell has a value. */
  hasValue: (r: number, c: number) => boolean
  /** The visible grid's size. */
  view: { w: number; h: number }
  /** Top-left of the cell area, below and right of the headers. */
  min: { x: number; y: number }
  /** Space between the source and the object. */
  gap?: number
  /** Added to both coordinates, so objects placed on the same source don't stack. */
  offset?: number
}

// How far past the source the search for empty cells goes, so a sheet full
// of values can't loop forever.
const MAX_STEPS = 200

/**
 * Right of the source, level with its first row, moved further right past any
 * cell with a value under it. When that doesn't fit in the view, below the
 * source, moved down past values. When neither fits, the right-hand spot
 * pulled back inside the view, where it may cover values.
 */
export function placeBeside(o: PlaceOptions): Spot {
  const right = _placeRight(o)
  if (right.x + o.size.width <= o.view.w) return right
  const below = _placeBelow(o)
  if (below.y + o.size.height <= o.view.h) return below
  return { x: Math.max(o.min.x, o.view.w - o.size.width), y: right.y }
}

function _placeRight(o: PlaceOptions) {
  const { source, cellRect, gap = 16, offset = 0 } = o
  const y = Math.max(o.min.y, cellRect(source.r0, source.c0).y) + offset
  let col = source.c1 + 1
  for (let step = 0; step < MAX_STEPS; step++) {
    const x = Math.max(o.min.x, cellRect(source.r0, col).x + gap) + offset
    const hit = _lastValueUnder(o, x, y, source.r0, col)
    if (!hit) return { x, y }
    col = hit.c + 1
  }
  return { x: Math.max(o.min.x, cellRect(source.r0, col).x + gap) + offset, y }
}

function _placeBelow(o: PlaceOptions) {
  const { source, cellRect, gap = 16, offset = 0 } = o
  const x = Math.max(o.min.x, cellRect(source.r0, source.c0).x) + offset
  let row = source.r1 + 1
  for (let step = 0; step < MAX_STEPS; step++) {
    const y = Math.max(o.min.y, cellRect(row, source.c0).y + gap) + offset
    const hit = _lastValueUnder(o, x, y, row, source.c0)
    if (!hit) return { x, y }
    row = hit.r + 1
  }
  return { x, y: Math.max(o.min.y, cellRect(row, source.c0).y + gap) + offset }
}

// The last row and the last column with a value under the box at (x, y), or
// null when its cells are empty. The search starts at (r, c), a cell at or
// before the box's top-left.
function _lastValueUnder(o: PlaceOptions, x: number, y: number, r: number, c: number) {
  const { cellRect, hasValue, size } = o
  const end = { x: x + size.width, y: y + size.height }
  // Step to the first row and column the box overlaps.
  let r0 = r,
    c0 = c
  for (let i = 0; i < MAX_STEPS * 10; i++) {
    const rect = cellRect(r0, c)
    if (rect.y + rect.height > y) break
    r0++
  }
  for (let i = 0; i < MAX_STEPS * 10; i++) {
    const rect = cellRect(r, c0)
    if (rect.x + rect.width > x) break
    c0++
  }
  let lastRow = -1,
    lastCol = -1
  for (let rr = r0; cellRect(rr, c0).y < end.y && rr < r0 + MAX_STEPS * 10; rr++)
    for (let cc = c0; cellRect(rr, cc).x < end.x && cc < c0 + MAX_STEPS * 10; cc++)
      if (hasValue(rr, cc)) {
        lastRow = Math.max(lastRow, rr)
        lastCol = Math.max(lastCol, cc)
      }
  return lastRow < 0 ? null : { r: lastRow, c: lastCol }
}
