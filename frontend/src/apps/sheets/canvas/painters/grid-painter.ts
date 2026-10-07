import { COL_HEADER_H, COLORS, ROW_HEADER_W } from '../constants.js'
import type { Geometry } from '../geometry.js'

export interface GridPainter {
  drawGridLines(r0: number, c0: number, r1: number, c1: number, cssW: number, cssH: number): void
  drawFreezeSeparators(frozW: number, frozH: number, cssW: number, cssH: number): void
}

export function createGridPainter(
  ctx: CanvasRenderingContext2D,
  {
    cw,
    rh,
    colX,
    rowY,
    isFilterHidden,
  }: Pick<Geometry, 'cw' | 'rh' | 'colX' | 'rowY'> & Partial<Pick<Geometry, 'isFilterHidden'>>,
): GridPainter {
  const _isFilterHidden = isFilterHidden || ((): boolean => false)

  function drawGridLines(
    r0: number,
    c0: number,
    r1: number,
    c1: number,
    cssW: number,
    cssH: number,
  ): void {
    _drawMainGridLines(r0, c0, r1, c1, cssW, cssH)
    _drawHiddenBoundaryLines(r0, c0, r1, c1, cssW, cssH)
  }

  function _drawMainGridLines(
    r0: number,
    c0: number,
    r1: number,
    c1: number,
    cssW: number,
    cssH: number,
  ): void {
    ctx.strokeStyle = COLORS.gridLine
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let r = r0; r <= r1 + 1; r++) {
      const y = rowY(r) + 0.5
      ctx.moveTo(ROW_HEADER_W, y)
      ctx.lineTo(cssW, y)
    }
    for (let c = c0; c <= c1 + 1; c++) {
      const x = colX(c) + 0.5
      ctx.moveTo(x, COL_HEADER_H)
      ctx.lineTo(x, cssH)
    }
    ctx.stroke()
  }

  function _drawHiddenBoundaryLines(
    r0: number,
    c0: number,
    r1: number,
    c1: number,
    cssW: number,
    cssH: number,
  ): void {
    ctx.strokeStyle = COLORS.freezeLine
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let c = c0; c <= c1; c++) {
      if (cw(c) > 0 && cw(c + 1) === 0) {
        const x = colX(c) + cw(c) + 0.5
        ctx.moveTo(x, COL_HEADER_H)
        ctx.lineTo(x, cssH)
      }
    }
    for (let r = r0; r <= r1; r++) {
      // Only draw the bold "rows hidden here" marker for manually-hidden
      // rows. Filter hides produce many small gaps in normal use; a bold
      // line at each transition reads as chart-junk. The regular gridline
      // at this y is still drawn by _drawMainGridLines.
      if (rh(r) > 0 && rh(r + 1) === 0 && !_isFilterHidden(r + 1)) {
        const y = rowY(r) + rh(r) + 0.5
        ctx.moveTo(ROW_HEADER_W, y)
        ctx.lineTo(cssW, y)
      }
    }
    ctx.stroke()
  }

  function drawFreezeSeparators(frozW: number, frozH: number, cssW: number, cssH: number): void {
    ctx.strokeStyle = COLORS.freezeLine
    ctx.lineWidth = 2
    ctx.beginPath()
    if (frozW > 0) {
      const x = ROW_HEADER_W + frozW + 0.5
      ctx.moveTo(x, COL_HEADER_H)
      ctx.lineTo(x, cssH)
    }
    if (frozH > 0) {
      const y = COL_HEADER_H + frozH + 0.5
      ctx.moveTo(ROW_HEADER_W, y)
      ctx.lineTo(cssW, y)
    }
    ctx.stroke()
  }

  return { drawGridLines, drawFreezeSeparators }
}
