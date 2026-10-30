import { colLabel } from '../../utils/cells.js'
import { COL_HEADER_H, COLORS, ROW_HEADER_W } from '../constants.js'
import type { Geometry } from '../geometry.js'
import type { CellBlock } from '../types.js'
import { cellMidY, centredBaseline, createCapHeight } from './text-anchor.js'

const HEADER_FONT = '12px InterVar, Inter, ui-sans-serif, system-ui, sans-serif'
// Labels of the headers a selection covers: semibold, on the activeHeader tint.
const MARKED_FONT = '600 ' + HEADER_FONT

export interface HeaderPainter {
  drawColHeaders(
    c0Scroll: number,
    c1Scroll: number,
    fc: number,
    mainX: number,
    cssW: number,
    range: CellBlock,
  ): void
  drawRowHeaders(
    r0Scroll: number,
    r1Scroll: number,
    fr: number,
    mainY: number,
    cssH: number,
    range: CellBlock,
  ): void
  drawCorner(): void
}

export function createHeaderPainter(
  ctx: CanvasRenderingContext2D,
  { cw, rh, colX, rowY }: Pick<Geometry, 'cw' | 'rh' | 'colX' | 'rowY'>,
): HeaderPainter {
  const capHeight = createCapHeight(ctx)

  // ── Column headers ───────────────────────────────────────────────────────────

  function drawColHeaders(
    c0Scroll: number,
    c1Scroll: number,
    fc: number,
    mainX: number,
    cssW: number,
    range: CellBlock,
  ): void {
    ctx.fillStyle = COLORS.headerBg
    ctx.fillRect(ROW_HEADER_W, 0, cssW, COL_HEADER_H)
    ctx.font = HEADER_FONT
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'center'

    ctx.save()
    ctx.beginPath()
    ctx.rect(mainX, 0, Math.max(0, cssW - mainX), COL_HEADER_H)
    ctx.clip()
    for (let c = Math.max(c0Scroll, fc); c <= c1Scroll; c++) _drawOneColHeader(c, range)
    ctx.restore()

    for (let c = 0; c < fc; c++) _drawOneColHeader(c, range)

    ctx.strokeStyle = COLORS.gridLine
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(ROW_HEADER_W, COL_HEADER_H + 0.5)
    ctx.lineTo(cssW, COL_HEADER_H + 0.5)
    ctx.stroke()
  }

  function _drawOneColHeader(c: number, range: CellBlock): void {
    const x = colX(c),
      w = cw(c)
    const marked = c >= range.c0 && c <= range.c1
    if (marked) _markHeader(x, 0, w, COL_HEADER_H)
    else _plainLabel()
    // No gridline above the column headers: the white area is the full height.
    if (w > 0) ctx.fillText(colLabel(c), x + w / 2, centredBaseline(COL_HEADER_H / 2, capHeight()))
    _drawColHeaderSeparator(x, w, c)
  }

  function _drawColHeaderSeparator(x: number, w: number, c: number): void {
    const nextHidden = cw(c + 1) === 0 && c + 1 < 9999
    if (w > 0 && nextHidden) {
      ctx.strokeStyle = COLORS.freezeLine
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x + w + 0.5, 0)
      ctx.lineTo(x + w + 0.5, COL_HEADER_H)
      ctx.stroke()
      _drawHiddenChevronsV(x + w, COL_HEADER_H / 2)
    } else {
      ctx.strokeStyle = COLORS.gridLine
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x + w + 0.5, 0)
      ctx.lineTo(x + w + 0.5, COL_HEADER_H)
      ctx.stroke()
    }
  }

  // A header the selection covers: tinted, with a dark semibold label.
  function _markHeader(x: number, y: number, w: number, h: number): void {
    ctx.fillStyle = COLORS.activeHeader
    ctx.fillRect(x, y, w, h)
    ctx.font = MARKED_FONT
    ctx.fillStyle = COLORS.cellText
  }

  function _plainLabel(): void {
    ctx.font = HEADER_FONT
    ctx.fillStyle = COLORS.headerText
  }

  // ── Row headers ──────────────────────────────────────────────────────────────

  function drawRowHeaders(
    r0Scroll: number,
    r1Scroll: number,
    fr: number,
    mainY: number,
    cssH: number,
    range: CellBlock,
  ): void {
    ctx.fillStyle = COLORS.headerBg
    ctx.fillRect(0, COL_HEADER_H, ROW_HEADER_W, cssH)
    ctx.font = HEADER_FONT
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'center'

    ctx.save()
    ctx.beginPath()
    ctx.rect(0, mainY, ROW_HEADER_W, Math.max(0, cssH - mainY))
    ctx.clip()
    for (let r = Math.max(r0Scroll, fr); r <= r1Scroll; r++) _drawOneRowHeader(r, range)
    ctx.restore()

    for (let r = 0; r < fr; r++) _drawOneRowHeader(r, range)

    ctx.strokeStyle = COLORS.gridLine
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(ROW_HEADER_W + 0.5, COL_HEADER_H)
    ctx.lineTo(ROW_HEADER_W + 0.5, cssH)
    ctx.stroke()
  }

  function _drawOneRowHeader(r: number, range: CellBlock): void {
    const y = rowY(r),
      h = rh(r)
    if (h === 0) return
    const marked = r >= range.r0 && r <= range.r1
    if (marked) _markHeader(0, y, ROW_HEADER_W, h)
    else _plainLabel()
    ctx.fillText(String(r + 1), ROW_HEADER_W / 2, centredBaseline(cellMidY(y, h), capHeight()))
    _drawRowHeaderSeparator(y, h, r)
  }

  function _drawRowHeaderSeparator(y: number, h: number, r: number): void {
    const nextHidden = rh(r + 1) === 0 && r + 1 < 9999
    if (nextHidden) {
      ctx.strokeStyle = COLORS.freezeLine
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, y + h + 0.5)
      ctx.lineTo(ROW_HEADER_W, y + h + 0.5)
      ctx.stroke()
      _drawHiddenChevronsH(ROW_HEADER_W / 2, y + h)
    } else {
      ctx.strokeStyle = COLORS.gridLine
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, y + h + 0.5)
      ctx.lineTo(ROW_HEADER_W, y + h + 0.5)
      ctx.stroke()
    }
  }

  // ── Corner & chevrons ────────────────────────────────────────────────────────

  function drawCorner(): void {
    ctx.fillStyle = COLORS.headerBg
    ctx.fillRect(0, 0, ROW_HEADER_W, COL_HEADER_H)
    ctx.strokeStyle = COLORS.gridLine
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(ROW_HEADER_W + 0.5, 0)
    ctx.lineTo(ROW_HEADER_W + 0.5, COL_HEADER_H)
    ctx.moveTo(0, COL_HEADER_H + 0.5)
    ctx.lineTo(ROW_HEADER_W, COL_HEADER_H + 0.5)
    ctx.stroke()
  }

  function _drawHiddenChevronsV(bx: number, by: number): void {
    const sz = 3
    ctx.fillStyle = COLORS.headerText
    ctx.beginPath()
    ctx.moveTo(bx - 2, by - sz)
    ctx.lineTo(bx - 2 - sz, by)
    ctx.lineTo(bx - 2, by + sz)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(bx + 2, by - sz)
    ctx.lineTo(bx + 2 + sz, by)
    ctx.lineTo(bx + 2, by + sz)
    ctx.closePath()
    ctx.fill()
  }

  function _drawHiddenChevronsH(bx: number, by: number): void {
    const sz = 3
    ctx.fillStyle = COLORS.headerText
    ctx.beginPath()
    ctx.moveTo(bx - sz, by - 2)
    ctx.lineTo(bx, by - 2 - sz)
    ctx.lineTo(bx + sz, by - 2)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(bx - sz, by + 2)
    ctx.lineTo(bx, by + 2 + sz)
    ctx.lineTo(bx + sz, by + 2)
    ctx.closePath()
    ctx.fill()
  }

  return { drawColHeaders, drawRowHeaders, drawCorner }
}
