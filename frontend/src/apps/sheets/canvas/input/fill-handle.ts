// The fill handle: the dot on the selection's bottom-right corner.
//
// Dragging it extends the selection, and releasing reports the fill (source
// block → extended block) to the host. Double-clicking it fills down as far
// as the neighbouring column's data goes. The host decides copy vs series;
// Cmd/Ctrl held flips that, as in Google Sheets.

import type { SelRange } from '../selection.js'
import type { CellBlock, GridHost } from '../types.js'

export interface FillHandleOptions {
  range(): SelRange
  extendSel(r: number, c: number): void
  hasValue(r: number, c: number): boolean
  totalRows(): number
  totalCols(): number
  onFill: GridHost['onFill']
}

export interface FillHandle {
  /** A press on the handle at (x, y). */
  start(x: number, y: number): void
  /** True while a fill drag is in progress. */
  active(): boolean
  /** Pointer moved to (x, y) over cell `over`; ignores jitter at the start. */
  move(x: number, y: number, over: { r: number; c: number } | null): void
  /** Released: report the fill if the selection grew. */
  end(withModifier: boolean): void
  /** Double-click on the handle: fill down alongside the neighbour column. */
  fillDown(withModifier: boolean): void
}

/** Pointer travel, in px, before a press on the handle counts as a drag. */
const DRAG_THRESHOLD = 4

/**
 * Google Sheets' double-click rule: follow the neighbouring column's data
 * down (left neighbour first, then right). The last row to fill; `src.r1`
 * when there is nothing to follow.
 */
export function autoFillDownExtent(
  src: CellBlock,
  hasValue: (r: number, c: number) => boolean,
  totalRows: number,
  totalCols: number,
): number {
  const filled = (r: number, c: number): boolean =>
    r >= 0 && r < totalRows && c >= 0 && c < totalCols && hasValue(r, c)
  let guide: number | null = null
  if (filled(src.r1 + 1, src.c0 - 1)) guide = src.c0 - 1
  else if (filled(src.r1 + 1, src.c1 + 1)) guide = src.c1 + 1
  if (guide === null) return src.r1
  let r = src.r1 + 1
  while (r < totalRows && filled(r, guide)) r++
  return r - 1
}

const blockOf = ({ r0, c0, r1, c1 }: CellBlock): CellBlock => ({ r0, c0, r1, c1 })

export function createFillHandle(o: FillHandleOptions): FillHandle {
  let drag: { src: CellBlock; startX: number; startY: number; moved: boolean } | null = null

  return {
    start(x, y) {
      drag = { src: blockOf(o.range()), startX: x, startY: y, moved: false }
    },
    active: () => drag !== null,
    move(x, y, over) {
      if (!drag) return
      if (!drag.moved) {
        // Sub-pixel jitter during a click (or the first half of a
        // double-click) isn't a fill.
        if (Math.hypot(x - drag.startX, y - drag.startY) < DRAG_THRESHOLD) return
        drag.moved = true
      }
      if (over) o.extendSel(over.r, over.c)
    },
    end(withModifier) {
      if (!drag) return
      const { src } = drag
      drag = null
      const total = o.range()
      const grew =
        total.r0 !== src.r0 || total.c0 !== src.c0 || total.r1 !== src.r1 || total.c1 !== src.c1
      if (grew) o.onFill?.(src, total, { withModifier })
    },
    fillDown(withModifier) {
      const src = o.range()
      const end = autoFillDownExtent(src, o.hasValue, o.totalRows(), o.totalCols())
      if (end > src.r1) o.onFill?.(blockOf(src), { ...src, r1: end }, { withModifier })
    },
  }
}
