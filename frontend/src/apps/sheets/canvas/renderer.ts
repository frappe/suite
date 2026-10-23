import { COL_HEADER_H, COLORS, ROW_HEADER_W } from './constants.js'
import type { Geometry } from './geometry.js'
import type { ColDrag } from './input/drag.js'
import { createCellPainter } from './painters/cell-painter.js'
import { createGridPainter } from './painters/grid-painter.js'
import { createHeaderPainter } from './painters/header-painter.js'
import { createSelectionPainter } from './painters/selection-painter.js'
import type { Cell, SelMode } from './selection.js'
import type { CellBlock, CellProvider, CellValue } from './types.js'

/** Everything one paint needs; the painters read the provider per cell. */
export interface RenderOptions {
  cssW: number
  cssH: number
  getValue(id: string): CellValue
  cells: CellProvider
  sel: Cell
  selEnd: Cell
  selMode: SelMode
  editing: boolean
  freeze: { readonly rows: number; readonly cols: number }
  getDiffFor: ((id: string) => boolean) | null
  marchAnts: CellBlock | null
  marchPhase: number
  pickerRect: CellBlock | null
  colDrag: ColDrag | null
  zoom: number
}

export interface Renderer {
  render(opts: RenderOptions): void
}

interface RegionState {
  cssW: number
  cssH: number
  getValue(id: string): CellValue
  cells: CellProvider
  getDiffFor: ((id: string) => boolean) | null
  editing: boolean
  range: CellBlock
  fillRange: CellBlock
  marchAnts: CellBlock | null
  marchPhase: number
  pickerRect: CellBlock | null
}

export function createRenderer(ctx: CanvasRenderingContext2D, geometry: Geometry): Renderer {
  const { firstVisCol, firstVisRow, lastVisCol, lastVisRow, frozenW, frozenH } = geometry

  const gridPainter = createGridPainter(ctx, geometry)
  const selPainter = createSelectionPainter(ctx, geometry)
  const cellPainter = createCellPainter(ctx, geometry)
  const headerPainter = createHeaderPainter(ctx, geometry)

  function render({
    cssW,
    cssH,
    getValue,
    cells,
    sel,
    selEnd,
    selMode,
    editing,
    freeze: frz,
    getDiffFor,
    marchAnts,
    marchPhase,
    pickerRect,
    colDrag,
    zoom,
  }: RenderOptions): void {
    if (!cssW || !cssH) return
    ctx.save()
    const k = (window.devicePixelRatio || 1) * zoom
    ctx.scale(k, k)
    ctx.fillStyle = COLORS.white
    ctx.fillRect(0, 0, cssW, cssH)

    const fc = frz.cols || 0,
      fr = frz.rows || 0
    const frozW_ = frozenW(),
      frozH_ = frozenH()
    const mainX = ROW_HEADER_W + frozW_,
      mainY = COL_HEADER_H + frozH_
    const c0s = firstVisCol(),
      r0s = firstVisRow()
    const c1s = lastVisCol(c0s, cssW),
      r1s = lastVisRow(r0s, cssH)
    const range = _selRange(sel, selEnd)
    // The fill spans the full width (row mode) / height (col mode) / both (all)
    // while headers + anchor keep the literal `range`, so the active cell stays
    // in the user's column even though the whole row/column is shaded.
    const fillRange = _fillRange(range, selMode)

    const state: RegionState = {
      cssW,
      cssH,
      getValue,
      cells,
      getDiffFor,
      editing,
      range,
      fillRange,
      marchAnts,
      marchPhase,
      pickerRect,
    }

    _renderRegion(r0s, c0s, r1s, c1s, mainX, mainY, cssW - mainX, cssH - mainY, state)
    if (fr > 0) _renderRegion(0, c0s, fr - 1, c1s, mainX, COL_HEADER_H, cssW - mainX, frozH_, state)
    if (fc > 0) _renderRegion(r0s, 0, r1s, fc - 1, ROW_HEADER_W, mainY, frozW_, cssH - mainY, state)
    if (fr > 0 && fc > 0)
      _renderRegion(0, 0, fr - 1, fc - 1, ROW_HEADER_W, COL_HEADER_H, frozW_, frozH_, state)

    headerPainter.drawColHeaders(c0s, c1s, fc, mainX, cssW, sel, range, selMode)
    headerPainter.drawRowHeaders(r0s, r1s, fr, mainY, cssH, sel, range, selMode)
    headerPainter.drawCorner()

    if (!editing && selMode === 'cell')
      selPainter.drawSelectionBorder(sel, range, fc, fr, mainX, mainY, cssW, cssH, (id) =>
        cells.getMergeInfo?.(id),
      )

    if (frozW_ > 0 || frozH_ > 0) gridPainter.drawFreezeSeparators(frozW_, frozH_, cssW, cssH)

    if (colDrag && colDrag.insertCol !== null)
      _drawColDrag(colDrag.fromCol, colDrag.count, colDrag.insertCol, cssH)

    ctx.restore()
  }

  // Column drag affordance: shade the column(s) being moved and draw a thick
  // insertion line at the drop boundary. Drawn last so it sits above everything.
  function _drawColDrag(fromCol: number, count: number, insertCol: number, cssH: number): void {
    const { colX, cw } = geometry
    ctx.save()
    ctx.fillStyle = 'rgba(37, 99, 235, 0.14)'
    for (let i = 0; i < count; i++) {
      const c = fromCol + i
      ctx.fillRect(colX(c), 0, cw(c), cssH)
    }
    const ix = colX(insertCol)
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(ix, 0)
    ctx.lineTo(ix, cssH)
    ctx.stroke()
    ctx.restore()
  }

  function _renderRegion(
    r0: number,
    c0: number,
    r1: number,
    c1: number,
    clipX: number,
    clipY: number,
    clipW: number,
    clipH: number,
    state: RegionState,
  ): void {
    if (clipW <= 0 || clipH <= 0 || r1 < r0 || c1 < c0) return
    const {
      cssW,
      cssH,
      getValue,
      cells,
      getDiffFor,
      editing,
      range,
      fillRange,
      marchAnts,
      marchPhase,
      pickerRect,
    } = state
    ctx.save()
    ctx.beginPath()
    ctx.rect(clipX, clipY, clipW, clipH)
    ctx.clip()
    if (!editing) selPainter.drawSelFill(fillRange || range)
    gridPainter.drawGridLines(r0, c0, r1, c1, cssW, cssH)
    cellPainter.drawRegionCells(r0, c0, r1, c1, getValue, cells, getDiffFor)
    cellPainter.drawRegionBorders(r0, c0, r1, c1, cells)
    if (marchAnts) selPainter.drawMarchingAnts(marchAnts, marchPhase)
    if (pickerRect) selPainter.drawPickerRect(pickerRect)
    ctx.restore()
  }

  function _selRange(sel: Cell, selEnd: Cell): CellBlock {
    return {
      r0: Math.min(sel.r, selEnd.r),
      c0: Math.min(sel.c, selEnd.c),
      r1: Math.max(sel.r, selEnd.r),
      c1: Math.max(sel.c, selEnd.c),
    }
  }

  // Whole-line selections shade the full width/height regardless of where the
  // anchor sits. Mirrors getSelRange()'s expansion in the grid module.
  function _fillRange(range: CellBlock, selMode: SelMode): CellBlock {
    if (!selMode || selMode === 'cell') return range
    const r = { ...range }
    if (selMode === 'row' || selMode === 'all') {
      r.c0 = 0
      r.c1 = geometry.totalCols() - 1
    }
    if (selMode === 'col' || selMode === 'all') {
      r.r0 = 0
      r.r1 = geometry.totalRows() - 1
    }
    return r
  }

  return { render }
}
