// What is under the mouse: one answer, in one fixed priority order.
//
// A point can match more than one target (the right edge of a column header
// is both the header and its resize edge), so the order decides:
//   column resize edge > row resize edge > fill handle > corner >
//   column header > row header > cell.
// The pixel maths lives in canvas/geometry.js; this module only orders it.
//
// Rows and columns are 0-based. Coordinates are mouse clientX/clientY plus
// the canvas's bounding rect, as the event handlers have them.

import type { Cell } from '../selection.js'

export interface CanvasRect {
  left: number
  top: number
}

/** The parts of canvas/geometry.js hit testing needs. */
export interface HitGeometry {
  hitTest(ex: number, ey: number, rect: CanvasRect): Cell | null
  hitTestCorner(ex: number, ey: number, rect: CanvasRect): boolean
  hitTestColResize(ex: number, ey: number, rect: CanvasRect): number | null
  hitTestRowResize(ex: number, ey: number, rect: CanvasRect): number | null
  hitTestColHeader(ex: number, ey: number, rect: CanvasRect): number | null
  hitTestRowHeader(ex: number, ey: number, rect: CanvasRect): number | null
  colX(c: number): number
  rowY(r: number): number
  cw(c: number): number
  rh(r: number): number
}

export type Hit =
  | { kind: 'colResize'; col: number }
  | { kind: 'rowResize'; row: number }
  | { kind: 'fillHandle' }
  | { kind: 'corner' }
  | { kind: 'colHeader'; col: number }
  | { kind: 'rowHeader'; row: number }
  | { kind: 'cell'; r: number; c: number }
  | { kind: 'none' }

export interface HitOptions {
  /** Resize edges are only targets for users who can edit. Default true. */
  resize?: boolean
  /** Same for the fill handle. Default true. */
  fill?: boolean
}

export interface HitTesterOptions {
  geo: HitGeometry
  getZoom(): number
  /**
   * The cell whose bottom-right corner carries the fill handle (the
   * selection's far corner, widened to a merge), or null when there is no
   * handle, e.g. while the editor is open.
   */
  fillCorner(): Cell | null
}

export interface HitTester {
  at(ex: number, ey: number, rect: CanvasRect, opts?: HitOptions): Hit
  onFillHandle(ex: number, ey: number, rect: CanvasRect): boolean
}

/** How close to the handle's centre a press still grabs it, in logical px. */
export const FILL_HANDLE_RADIUS = 6

export function createHitTester({ geo, getZoom, fillCorner }: HitTesterOptions): HitTester {
  function onFillHandle(ex: number, ey: number, rect: CanvasRect): boolean {
    const corner = fillCorner()
    if (!corner) return false
    // Mouse coordinates are physical CSS px; geometry is logical. Undo zoom.
    const zoom = getZoom()
    const x = (ex - rect.left) / zoom
    const y = (ey - rect.top) / zoom
    const fx = geo.colX(corner.c) + geo.cw(corner.c)
    const fy = geo.rowY(corner.r) + geo.rh(corner.r)
    return Math.hypot(x - fx, y - fy) <= FILL_HANDLE_RADIUS
  }

  function at(
    ex: number,
    ey: number,
    rect: CanvasRect,
    { resize = true, fill = true }: HitOptions = {},
  ): Hit {
    if (resize) {
      const col = geo.hitTestColResize(ex, ey, rect)
      if (col !== null) return { kind: 'colResize', col }
      const row = geo.hitTestRowResize(ex, ey, rect)
      if (row !== null) return { kind: 'rowResize', row }
    }
    if (fill && onFillHandle(ex, ey, rect)) return { kind: 'fillHandle' }
    if (geo.hitTestCorner(ex, ey, rect)) return { kind: 'corner' }
    const col = geo.hitTestColHeader(ex, ey, rect)
    if (col !== null) return { kind: 'colHeader', col }
    const row = geo.hitTestRowHeader(ex, ey, rect)
    if (row !== null) return { kind: 'rowHeader', row }
    const cell = geo.hitTest(ex, ey, rect)
    return cell ? { kind: 'cell', r: cell.r, c: cell.c } : { kind: 'none' }
  }

  return { at, onFillHandle }
}
