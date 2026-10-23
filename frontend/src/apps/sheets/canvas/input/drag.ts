// Drags that start on a header and follow the pointer anywhere on the page:
// resizing columns or rows, and moving columns. They listen on the document,
// so they keep tracking when the pointer leaves the canvas.
//
// A press (mouse.ts) starts one; this module applies each move and finishes
// it on release. Pixel deltas are divided by zoom, since widths and heights
// are stored in logical px.

import type { CanvasRect } from './hit-test.js'

/** A column header press that may become a drag to move columns. */
export interface ColDrag {
  fromCol: number
  count: number
  startX: number
  startY: number
  /** Past the threshold: a real drag, not a click. */
  moved: boolean
  /** The column the block would be dropped before. */
  insertCol: number | null
}

export interface DragOptions {
  canvasRect(): CanvasRect
  colInsertIndex(ex: number, rect: CanvasRect): number
  getZoom(): number
  setColWidths(cols: readonly number[], w: number): void
  setRowHeights(rows: readonly number[], h: number): void
  onColMove?(fromCol: number, toCol: number, count: number): void
  onResizeEnd?(): void
  render(): void
}

export interface Drags {
  /** Every listed column follows the dragged edge (Sheets / Excel). */
  startColResize(cols: number[], startX: number, startW: number): void
  startRowResize(rows: number[], startY: number, startH: number): void
  /** Arm a column move; it starts once the pointer passes the threshold. */
  armColMove(fromCol: number, count: number, startX: number, startY: number): void
  /** Which resize is in progress, if any. */
  resizing(): 'col' | 'row' | null
  /** The column drag, armed or moving; null when none. */
  colDrag(): ColDrag | null
  destroy(): void
}

/**
 * Every column (or row) a resize applies to: the whole sheet, the selected
 * block when the dragged edge is inside it, or just the one.
 */
export function resizeTargets(
  i: number,
  inBlock: boolean,
  all: boolean,
  lo: number,
  hi: number,
  total: number,
): number[] {
  if (all) return Array.from({ length: total }, (_, k) => k)
  if (inBlock) return Array.from({ length: hi - lo + 1 }, (_, k) => lo + k)
  return [i]
}

const COL_MOVE_THRESHOLD = 5
const MIN_COL_W = 30
const MIN_ROW_H = 16

export function createDrags(o: DragOptions): Drags {
  let colResize: { cols: number[]; startX: number; startW: number } | null = null
  let rowResize: { rows: number[]; startY: number; startH: number } | null = null
  let colMove: ColDrag | null = null

  function onMove(e: MouseEvent): void {
    const z = o.getZoom()
    if (colMove) {
      if (
        colMove.moved ||
        Math.hypot(e.clientX - colMove.startX, e.clientY - colMove.startY) >= COL_MOVE_THRESHOLD
      ) {
        colMove.moved = true
        colMove.insertCol = o.colInsertIndex(e.clientX, o.canvasRect())
        document.body.style.cursor = 'grabbing'
        o.render()
      }
    }
    if (colResize) {
      o.setColWidths(
        colResize.cols,
        Math.max(MIN_COL_W, colResize.startW + (e.clientX - colResize.startX) / z),
      )
      o.render()
    }
    if (rowResize) {
      o.setRowHeights(
        rowResize.rows,
        Math.max(MIN_ROW_H, rowResize.startH + (e.clientY - rowResize.startY) / z),
      )
      o.render()
    }
  }

  function onUp(): void {
    if (colMove) {
      const cd = colMove
      colMove = null
      document.body.style.cursor = ''
      if (cd.moved && cd.insertCol !== null) o.onColMove?.(cd.fromCol, cd.insertCol, cd.count)
      o.render()
    }
    const didResize = !!colResize || !!rowResize
    colResize = null
    rowResize = null
    if (didResize) o.onResizeEnd?.()
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)

  return {
    startColResize(cols, startX, startW) {
      colResize = { cols, startX, startW }
    },
    startRowResize(rows, startY, startH) {
      rowResize = { rows, startY, startH }
    },
    armColMove(fromCol, count, startX, startY) {
      colMove = { fromCol, count, startX, startY, moved: false, insertCol: null }
    },
    resizing: () => (colResize ? 'col' : rowResize ? 'row' : null),
    colDrag: () => colMove,
    destroy() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    },
  }
}
