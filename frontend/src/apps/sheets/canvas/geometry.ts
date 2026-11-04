import type { Cell, ViewModel } from '../core/view-model.js'
import { COL_HEADER_H, ROW_HEADER_W } from './constants.js'
import type { CanvasRect } from './input/hit-test.js'

export interface Geometry {
  /** Column width; 0 when hidden. */
  cw(c: number): number
  /** Row height; 0 when hidden. */
  rh(r: number): number
  colX(c: number): number
  rowY(r: number): number
  frozenW(): number
  frozenH(): number
  isFilterHidden(r: number): boolean
  firstVisCol(): number
  firstVisRow(): number
  lastVisCol(c0: number, cssW: number): number
  lastVisRow(r0: number, cssH: number): number
  totalRows(): number
  totalCols(): number
  hitTest(ex: number, ey: number, rect: CanvasRect): Cell | null
  clamp(r: number, c: number): Cell
  hitTestCorner(ex: number, ey: number, rect: CanvasRect): boolean
  hitTestColResize(ex: number, ey: number, rect: CanvasRect): number | null
  hitTestColHeader(ex: number, ey: number, rect: CanvasRect): number | null
  hitTestRowHeader(ex: number, ey: number, rect: CanvasRect): number | null
  hitTestRowResize(ex: number, ey: number, rect: CanvasRect): number | null
  colInsertIndex(ex: number, rect: CanvasRect): number
}

export function createGeometry(vm: ViewModel): Geometry {
  const { scroll, freeze } = vm
  const cw = (c: number): number => (vm.hiddenCols.has(c) ? 0 : vm.colWidth(c))
  const rh = (r: number): number => (vm.hiddenRows.has(r) ? 0 : vm.rowHeight(r))
  // Distinguishes filter-hidden rows (transient, many small gaps) from
  // manually-hidden rows so the grid painter can draw the bold "there's
  // something hidden here" boundary only for the manual variety.
  const isFilterHidden = (r: number): boolean => vm.filterHiddenRows.has(r)
  // Convert page coordinates into the renderer's *logical* coordinate system.
  // Renderer scales ctx by zoom; mouse coords come in physical CSS pixels.
  const _logical = (ex: number, ey: number, canvasRect: CanvasRect): { x: number; y: number } => {
    const z = vm.zoom || 1
    return { x: (ex - canvasRect.left) / z, y: (ey - canvasRect.top) / z }
  }
  const totalRows = (): number => vm.totalRows
  const totalCols = (): number => vm.totalCols

  function frozenW(): number {
    let w = 0
    for (let i = 0; i < (freeze.cols || 0); i++) w += cw(i)
    return w
  }

  function frozenH(): number {
    let h = 0
    for (let i = 0; i < (freeze.rows || 0); i++) h += rh(i)
    return h
  }

  function colX(c: number): number {
    const fc = freeze.cols || 0
    if (c < fc) {
      let x = ROW_HEADER_W
      for (let i = 0; i < c; i++) x += cw(i)
      return x
    }
    let x = ROW_HEADER_W + frozenW()
    for (let i = fc; i < c; i++) x += cw(i)
    return x - scroll.x
  }

  function rowY(r: number): number {
    const fr = freeze.rows || 0
    if (r < fr) {
      let y = COL_HEADER_H
      for (let i = 0; i < r; i++) y += rh(i)
      return y
    }
    let y = COL_HEADER_H + frozenH()
    for (let i = fr; i < r; i++) y += rh(i)
    return y - scroll.y
  }

  function firstVisCol(): number {
    const fc = freeze.cols || 0
    let c = fc,
      x = 0
    while (c < totalCols() - 1 && x + cw(c) <= scroll.x) {
      x += cw(c)
      c++
    }
    return c
  }

  function firstVisRow(): number {
    const fr = freeze.rows || 0
    let r = fr,
      y = 0
    while (r < totalRows() - 1 && y + rh(r) <= scroll.y) {
      y += rh(r)
      r++
    }
    return r
  }

  function lastVisCol(c0: number, cssW: number): number {
    let c = c0
    while (c < totalCols() - 1 && colX(c) < cssW) c++
    return c
  }

  function lastVisRow(r0: number, cssH: number): number {
    let r = r0
    while (r < totalRows() - 1 && rowY(r) < cssH) r++
    return r
  }

  function hitTest(ex: number, ey: number, canvasRect: CanvasRect): Cell | null {
    const { x, y } = _logical(ex, ey, canvasRect)
    if (x < ROW_HEADER_W || y < COL_HEADER_H) return null

    const fc = freeze.cols || 0
    const fr = freeze.rows || 0

    // Determine column (check frozen cols first)
    let c = 0,
      found = false
    let cx = ROW_HEADER_W
    for (let i = 0; i < fc; i++) {
      if (x < cx + cw(i)) {
        c = i
        found = true
        break
      }
      cx += cw(i)
    }
    if (!found) {
      cx = ROW_HEADER_W + frozenW() - scroll.x
      c = fc
      while (c < totalCols() - 1 && cx + cw(c) <= x) {
        cx += cw(c)
        c++
      }
    }

    // Determine row (check frozen rows first)
    let r = 0
    found = false
    let ry = COL_HEADER_H
    for (let i = 0; i < fr; i++) {
      if (y < ry + rh(i)) {
        r = i
        found = true
        break
      }
      ry += rh(i)
    }
    if (!found) {
      ry = COL_HEADER_H + frozenH() - scroll.y
      r = fr
      while (r < totalRows() - 1 && ry + rh(r) <= y) {
        ry += rh(r)
        r++
      }
    }

    return { r, c }
  }

  function clamp(r: number, c: number): Cell {
    return {
      r: Math.max(0, Math.min(r, totalRows() - 1)),
      c: Math.max(0, Math.min(c, totalCols() - 1)),
    }
  }

  function hitTestCorner(ex: number, ey: number, canvasRect: CanvasRect): boolean {
    const { x, y } = _logical(ex, ey, canvasRect)
    return x < ROW_HEADER_W && y < COL_HEADER_H
  }

  // mainX/Y: left/top edge of the scrollable region (= ROW_HEADER_W+frozenW,
  // COL_HEADER_H+frozenH). Scrollable cells whose visible position is left/
  // above these are occluded by the frozen pane and must not be hittable.
  function _mainX(): number {
    return ROW_HEADER_W + frozenW()
  }
  function _mainY(): number {
    return COL_HEADER_H + frozenH()
  }

  function hitTestColResize(ex: number, ey: number, canvasRect: CanvasRect): number | null {
    const { x, y } = _logical(ex, ey, canvasRect)
    if (y >= COL_HEADER_H) return null
    const fc = freeze.cols || 0
    const mainX = _mainX()
    for (let c = 0; c < totalCols(); c++) {
      const right = colX(c) + cw(c)
      // Frozen cols only matter inside [ROW_HEADER_W, mainX]; scrollable cols
      // only matter when their right edge is visible past mainX. Otherwise
      // they're either off-canvas or hidden under the frozen pane.
      if (c < fc) {
        if (right > mainX) continue
      } else {
        if (right <= mainX) continue
      }
      if (Math.abs(x - right) <= 4) return c
    }
    return null
  }

  function hitTestColHeader(ex: number, ey: number, canvasRect: CanvasRect): number | null {
    const { x, y } = _logical(ex, ey, canvasRect)
    if (y >= COL_HEADER_H || x < ROW_HEADER_W) return null
    const fc = freeze.cols || 0
    const mainX = _mainX()
    // Inside the frozen strip: walk frozen cols only.
    if (x < mainX) {
      let cx = ROW_HEADER_W
      for (let i = 0; i < fc; i++) {
        if (x < cx + cw(i)) return i
        cx += cw(i)
      }
      return null
    }
    // Outside the frozen strip: walk scrollable cols starting at mainX.
    let cx = mainX - scroll.x
    let c = fc
    while (c < totalCols() - 1 && cx + cw(c) <= x) {
      cx += cw(c)
      c++
    }
    return c
  }

  // Insertion boundary for a column drag: the index a dropped column would sit
  // *before* (0..totalCols), decided by which side of the hovered column's
  // midpoint the cursor sits on. Ignores the y coordinate so it tracks anywhere.
  function colInsertIndex(ex: number, canvasRect: CanvasRect): number {
    const { x } = _logical(ex, 0, canvasRect)
    const fc = freeze.cols || 0
    const mainX = _mainX()
    let c: number, cx: number
    if (x < mainX) {
      cx = ROW_HEADER_W
      c = 0
      while (c < fc && x >= cx + cw(c)) {
        cx += cw(c)
        c++
      }
      if (c >= fc) {
        c = fc
        cx = mainX - scroll.x
      }
    } else {
      cx = mainX - scroll.x
      c = fc
      while (c < totalCols() - 1 && cx + cw(c) <= x) {
        cx += cw(c)
        c++
      }
    }
    return x < cx + cw(c) / 2 ? c : c + 1
  }

  function hitTestRowHeader(ex: number, ey: number, canvasRect: CanvasRect): number | null {
    const { x, y } = _logical(ex, ey, canvasRect)
    if (x >= ROW_HEADER_W || y < COL_HEADER_H) return null
    const fr = freeze.rows || 0
    const mainY = _mainY()
    if (y < mainY) {
      let ry = COL_HEADER_H
      for (let i = 0; i < fr; i++) {
        if (y < ry + rh(i)) return i
        ry += rh(i)
      }
      return null
    }
    let ry = mainY - scroll.y
    let r = fr
    while (r < totalRows() - 1 && ry + rh(r) <= y) {
      ry += rh(r)
      r++
    }
    return r
  }

  function hitTestRowResize(ex: number, ey: number, canvasRect: CanvasRect): number | null {
    const { x, y } = _logical(ex, ey, canvasRect)
    if (x >= ROW_HEADER_W) return null
    const fr = freeze.rows || 0
    const mainY = _mainY()
    for (let r = 0; r < totalRows(); r++) {
      const yTop = rowY(r)
      if (yTop > y + 10) break
      const bottom = yTop + rh(r)
      if (r < fr) {
        if (bottom > mainY) continue
      } else {
        if (bottom <= mainY) continue
      }
      if (Math.abs(y - bottom) <= 4) return r
    }
    return null
  }

  return {
    cw,
    rh,
    colX,
    rowY,
    frozenW,
    frozenH,
    isFilterHidden,
    firstVisCol,
    firstVisRow,
    lastVisCol,
    lastVisRow,
    totalRows,
    totalCols,
    hitTest,
    clamp,
    hitTestColResize,
    hitTestColHeader,
    hitTestRowHeader,
    hitTestCorner,
    colInsertIndex,
    hitTestRowResize,
  }
}
