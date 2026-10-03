import { colLabel } from '../../utils/cells.js'
import { COL_HEADER_H, COLORS, ROW_HEADER_W } from '../constants.js'

export function createHeaderPainter(ctx, { cw, rh, colX, rowY }) {
  // ── Column headers ───────────────────────────────────────────────────────────

  function drawColHeaders(c0Scroll, c1Scroll, fc, mainX, cssW, sel, range, selMode) {
    ctx.fillStyle = COLORS.headerBg
    ctx.fillRect(ROW_HEADER_W, 0, cssW, COL_HEADER_H)
    ctx.font = '12px InterVar, Inter, ui-sans-serif, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'

    ctx.save()
    ctx.beginPath()
    ctx.rect(mainX, 0, Math.max(0, cssW - mainX), COL_HEADER_H)
    ctx.clip()
    for (let c = Math.max(c0Scroll, fc); c <= c1Scroll; c++)
      _drawOneColHeader(c, sel, range, selMode)
    ctx.restore()

    for (let c = 0; c < fc; c++) _drawOneColHeader(c, sel, range, selMode)

    ctx.strokeStyle = COLORS.gridLine
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(ROW_HEADER_W, COL_HEADER_H + 0.5)
    ctx.lineTo(cssW, COL_HEADER_H + 0.5)
    ctx.stroke()
  }

  function _drawOneColHeader(c, sel, range, selMode) {
    const x = colX(c),
      w = cw(c)
    const inRange = c >= range.c0 && c <= range.c1
    const isSelected = (selMode === 'col' || selMode === 'all') && inRange
    const isAnchor = c === sel.c
    _drawColHeaderBackground(x, w, isSelected, isAnchor, inRange)
    ctx.fillStyle = isSelected || isAnchor ? COLORS.cellText : COLORS.headerText
    if (w > 0) ctx.fillText(colLabel(c), x + w / 2, COL_HEADER_H / 2)
    _drawColHeaderSeparator(x, w, c)
  }

  function _drawColHeaderBackground(x, w, isSelected, isAnchor, inRange) {
    if (isSelected || isAnchor) {
      ctx.fillStyle = COLORS.activeHeader
      ctx.fillRect(x, 0, w, COL_HEADER_H)
    } else if (inRange) {
      ctx.fillStyle = COLORS.rangeHeader
      ctx.fillRect(x, 0, w, COL_HEADER_H)
    }
  }

  function _drawColHeaderSeparator(x, w, c) {
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

  // ── Row headers ──────────────────────────────────────────────────────────────

  function drawRowHeaders(r0Scroll, r1Scroll, fr, mainY, cssH, sel, range, selMode) {
    ctx.fillStyle = COLORS.headerBg
    ctx.fillRect(0, COL_HEADER_H, ROW_HEADER_W, cssH)
    ctx.font = '12px InterVar, Inter, ui-sans-serif, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'

    ctx.save()
    ctx.beginPath()
    ctx.rect(0, mainY, ROW_HEADER_W, Math.max(0, cssH - mainY))
    ctx.clip()
    for (let r = Math.max(r0Scroll, fr); r <= r1Scroll; r++)
      _drawOneRowHeader(r, sel, range, selMode)
    ctx.restore()

    for (let r = 0; r < fr; r++) _drawOneRowHeader(r, sel, range, selMode)

    ctx.strokeStyle = COLORS.gridLine
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(ROW_HEADER_W + 0.5, COL_HEADER_H)
    ctx.lineTo(ROW_HEADER_W + 0.5, cssH)
    ctx.stroke()
  }

  function _drawOneRowHeader(r, sel, range, selMode) {
    const y = rowY(r),
      h = rh(r)
    if (h === 0) return
    const inRange = r >= range.r0 && r <= range.r1
    const isSelected = (selMode === 'row' || selMode === 'all') && inRange
    const isAnchor = r === sel.r
    _drawRowHeaderBackground(y, h, isSelected, isAnchor, inRange)
    ctx.fillStyle = isSelected || isAnchor ? COLORS.cellText : COLORS.headerText
    ctx.fillText(String(r + 1), ROW_HEADER_W / 2, y + h / 2)
    _drawRowHeaderSeparator(y, h, r)
  }

  function _drawRowHeaderBackground(y, h, isSelected, isAnchor, inRange) {
    if (isSelected || isAnchor) {
      ctx.fillStyle = COLORS.activeHeader
      ctx.fillRect(0, y, ROW_HEADER_W, h)
    } else if (inRange) {
      ctx.fillStyle = COLORS.rangeHeader
      ctx.fillRect(0, y, ROW_HEADER_W, h)
    }
  }

  function _drawRowHeaderSeparator(y, h, r) {
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

  function drawCorner() {
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

  function _drawHiddenChevronsV(bx, by) {
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

  function _drawHiddenChevronsH(bx, by) {
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
