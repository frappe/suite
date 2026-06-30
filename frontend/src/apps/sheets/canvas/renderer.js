import { COLORS, COL_HEADER_H, ROW_HEADER_W } from './constants.js'
import { createGridPainter }      from './painters/grid-painter.js'
import { createSelectionPainter } from './painters/selection-painter.js'
import { createCellPainter }      from './painters/cell-painter.js'
import { createHeaderPainter }    from './painters/header-painter.js'

export function createRenderer(ctx, geometry) {
  const { firstVisCol, firstVisRow, lastVisCol, lastVisRow } = geometry
  const frozenW = geometry.frozenW || (() => 0)
  const frozenH = geometry.frozenH || (() => 0)

  const gridPainter   = createGridPainter(ctx, geometry)
  const selPainter    = createSelectionPainter(ctx, geometry)
  const cellPainter   = createCellPainter(ctx, geometry)
  const headerPainter = createHeaderPainter(ctx, geometry)

  function render({ cssW, cssH, getValue, sel, selEnd, selMode = 'cell', editing, getFormat,
                    freeze: frz = { rows: 0, cols: 0 }, getMergeInfo, isSlave,
                    getComment = null, getValidation = null, getCondFormat = null,
                    getRightInset = null, getDiffFor = null,
                    marchAnts = null, marchPhase = 0, pickerRect = null, zoom = 1 }) {
    if (!cssW || !cssH) return
    ctx.save()
    const k = (window.devicePixelRatio || 1) * zoom
    ctx.scale(k, k)
    ctx.fillStyle = COLORS.white
    ctx.fillRect(0, 0, cssW, cssH)

    const fc = frz.cols || 0, fr = frz.rows || 0
    const frozW_ = frozenW(), frozH_ = frozenH()
    const mainX  = ROW_HEADER_W + frozW_, mainY = COL_HEADER_H + frozH_
    const c0s    = firstVisCol(), r0s = firstVisRow()
    const c1s    = lastVisCol(c0s, cssW), r1s = lastVisRow(r0s, cssH)
    const range  = _selRange(sel, selEnd)

    const state = { cssW, cssH, getValue, getFormat, getMergeInfo, isSlave,
                    getComment, getValidation, getCondFormat, getRightInset,
                    getDiffFor,
                    editing, range, marchAnts, marchPhase, pickerRect }

    _renderRegion(r0s, c0s, r1s, c1s, mainX, mainY, cssW - mainX, cssH - mainY, state)
    if (fr > 0) _renderRegion(0, c0s, fr - 1, c1s, mainX, COL_HEADER_H, cssW - mainX, frozH_, state)
    if (fc > 0) _renderRegion(r0s, 0, r1s, fc - 1, ROW_HEADER_W, mainY, frozW_, cssH - mainY, state)
    if (fr > 0 && fc > 0) _renderRegion(0, 0, fr - 1, fc - 1, ROW_HEADER_W, COL_HEADER_H, frozW_, frozH_, state)

    headerPainter.drawColHeaders(c0s, c1s, fc, mainX, cssW, sel, range, selMode)
    headerPainter.drawRowHeaders(r0s, r1s, fr, mainY, cssH, sel, range, selMode)
    headerPainter.drawCorner()

    if (!editing && selMode === 'cell')
      selPainter.drawSelectionBorder(sel, range, fc, fr, mainX, mainY, cssW, cssH, getMergeInfo)

    if (frozW_ > 0 || frozH_ > 0) gridPainter.drawFreezeSeparators(frozW_, frozH_, cssW, cssH)

    ctx.restore()
  }

  function _renderRegion(r0, c0, r1, c1, clipX, clipY, clipW, clipH, state) {
    if (clipW <= 0 || clipH <= 0 || r1 < r0 || c1 < c0) return
    const { cssW, cssH, getValue, getFormat, getMergeInfo, isSlave,
            getComment, getValidation, getCondFormat, getRightInset,
            getDiffFor,
            editing, range, marchAnts, marchPhase, pickerRect } = state
    ctx.save()
    ctx.beginPath(); ctx.rect(clipX, clipY, clipW, clipH); ctx.clip()
    if (!editing) selPainter.drawSelFill(range)
    gridPainter.drawGridLines(r0, c0, r1, c1, cssW, cssH)
    cellPainter.drawRegionCells(r0, c0, r1, c1, getValue, getFormat, getMergeInfo, isSlave, getComment, getValidation, getCondFormat, getRightInset, getDiffFor)
    cellPainter.drawRegionBorders(r0, c0, r1, c1, getFormat, getMergeInfo, isSlave)
    if (marchAnts)  selPainter.drawMarchingAnts(marchAnts, marchPhase)
    if (pickerRect) selPainter.drawPickerRect(pickerRect)
    ctx.restore()
  }

  function _selRange(sel, selEnd) {
    return {
      r0: Math.min(sel.r, selEnd.r), c0: Math.min(sel.c, selEnd.c),
      r1: Math.max(sel.r, selEnd.r), c1: Math.max(sel.c, selEnd.c),
    }
  }

  return { render }
}
