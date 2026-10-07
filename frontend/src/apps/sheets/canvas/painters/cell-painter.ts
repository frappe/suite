import { checkRule } from '../../engine/validation.js'
import { cellId } from '../../utils/cells.js'
import { getTextWrap, lineHeightFor, wrapLines } from '../../utils/text-wrap.js'
import { COLORS } from '../constants.js'
import type { Geometry } from '../geometry.js'
import type {
  BorderSpec,
  CellFormat,
  CellProvider,
  CellValue,
  CondFormat,
  MergeInfo,
} from '../types.js'
import { createCellDecorations, ICON_INSET } from './cell-decorations.js'
import { inkFor, setCellFont } from './cell-text-style.js'

export interface CellPainter {
  drawRegionCells(
    r0: number,
    c0: number,
    r1: number,
    c1: number,
    getVal: (id: string) => CellValue,
    cells: CellProvider,
    getDiffFor: ((id: string) => boolean) | null,
  ): void
  drawRegionBorders(r0: number, c0: number, r1: number, c1: number, cells: CellProvider): void
}

interface CellGeom {
  id: string
  val: CellValue
  fmt: CellFormat
  condFmt: CondFormat | null | undefined
  merge: MergeInfo | null | undefined
  x: number
  y: number
  w: number
  h: number
}

type PaintGeometry = Pick<Geometry, 'cw' | 'rh' | 'colX' | 'rowY' | 'totalCols'>

export function createCellPainter(
  ctx: CanvasRenderingContext2D,
  { cw, rh, colX, rowY, totalCols }: PaintGeometry,
): CellPainter {
  const deco = createCellDecorations(ctx)

  // ── Public API ───────────────────────────────────────────────────────────────

  // `getVal(id)` returns a cell's display string. It abstracts over the
  // value source: the legacy eager `data` map (id => data[id]) or the lazy
  // engine-backed lookup. The painter only ever touches cells in the visible
  // region, so the lazy path computes display strings for ~hundreds of cells
  // per frame instead of materialising the whole sheet up front.
  function drawRegionCells(
    r0: number,
    c0: number,
    r1: number,
    c1: number,
    getVal: (id: string) => CellValue,
    cells: CellProvider,
    getDiffFor: ((id: string) => boolean) | null,
  ): void {
    ctx.textBaseline = 'middle'
    // Two-pass paint: every cell's background + decorations first, then
    // every cell's text. Splitting the passes means an upstream cell's
    // overflow text won't get overpainted by a downstream cell's background
    // fill in the same loop iteration. The per-cell cost is unchanged — we
    // just iterate twice — and the setup work is shared via _cellGeom.
    for (let r = r0; r <= r1; r++) {
      if (rh(r) === 0) continue
      for (let c = c0; c <= c1; c++) _paintBgAt(r, c, getVal, cells, getDiffFor)
    }
    for (let r = r0; r <= r1; r++) {
      if (rh(r) === 0) continue
      for (let c = c0; c <= c1; c++) _paintTextAt(r, c, getVal, cells)
    }
  }

  function drawRegionBorders(
    r0: number,
    c0: number,
    r1: number,
    c1: number,
    cells: CellProvider,
  ): void {
    if (!cells.getStyle) return
    for (let r = r0; r <= r1; r++) {
      if (rh(r) === 0) continue
      for (let c = c0; c <= c1; c++) _drawCellBorders(r, c, cells)
    }
  }

  // ── Cell rendering ───────────────────────────────────────────────────────────

  // Shared per-cell geometry + format lookup. Both paint phases call this,
  // returns null for slave cells (so the caller knows to skip).
  function _cellGeom(
    r: number,
    c: number,
    getVal: (id: string) => CellValue,
    cells: CellProvider,
  ): CellGeom | null {
    const id = cellId(r, c)
    if (cells.isSlave?.(id)) return null
    const merge = cells.getMergeInfo?.(id)
    const spanC = merge ? merge.colSpan : 1
    const spanR = merge ? merge.rowSpan : 1
    const val = getVal(id)
    const fmt = cells.getStyle?.(id) || {}
    const x = colX(c),
      y = rowY(r)
    let w = 0,
      h = 0
    for (let sc = 0; sc < spanC; sc++) w += cw(c + sc)
    for (let sr = 0; sr < spanR; sr++) h += rh(r + sr)
    const condFmt = cells.getCondFormat?.(id, val ?? '')
    return { id, val, fmt, condFmt, merge, x, y, w, h }
  }

  function _paintBgAt(
    r: number,
    c: number,
    getVal: (id: string) => CellValue,
    cells: CellProvider,
    getDiffFor: ((id: string) => boolean) | null,
  ): void {
    const g = _cellGeom(r, c, getVal, cells)
    if (!g) return
    const { id, val, fmt, condFmt, merge, x, y, w, h } = g
    _drawCellBackground(x, y, w, h, merge, fmt, condFmt)
    // Data-bar between background and text so values stay readable on top.
    if (condFmt?.dataBar) deco.drawDataBar(x, y, w, h, condFmt.dataBar)
    if (getDiffFor?.(id)) deco.drawDiffOverlay(x, y, w, h)
    if (cells.getComment?.(id)) deco.drawCommentTriangle(x, y, w)
    const rule = cells.getValidation?.(id)
    if (rule) {
      const has = val != null && String(val) !== ''
      const invalid = has && !checkRule(rule, val).valid
      if (rule.type === 'list') {
        // List rule → a Sheets-style dropdown affordance. With a value it's a
        // chip (which owns the cell text — the text pass skips it); empty,
        // it's a plain caret so you know it's a dropdown.
        if (has) deco.drawValidationChip(x, y, w, h, String(val), fmt, !invalid, rule)
        else deco.drawDropdownArrow(x, y, w, h)
      } else if (rule.type === 'checkbox') {
        // Checkbox rule → a tickbox that owns the cell (the text pass skips
        // it). Empty reads as unchecked; a value that isn't TRUE/FALSE still
        // gets the invalid marker below.
        deco.drawCheckbox(x, y, w, h, String(val).toUpperCase() === 'TRUE')
        if (invalid) deco.drawInvalidTriangle(x, y)
      } else if (invalid) {
        // Number / text-length rules have no dropdown (matching Sheets) — they
        // only surface a marker when the current value breaks the rule.
        deco.drawInvalidTriangle(x, y)
      }
    }
    // Icon belongs in the bg pass — it's drawn before text and shifts the
    // text rect right. The text pass computes the same inset to position
    // text correctly without re-drawing the icon.
    if (condFmt?.icon) deco.drawCellIcon(x, y, h, condFmt.icon)
  }

  function _paintTextAt(
    r: number,
    c: number,
    getVal: (id: string) => CellValue,
    cells: CellProvider,
  ): void {
    const g = _cellGeom(r, c, getVal, cells)
    if (!g) return
    const { id, val, fmt, condFmt, x, y, w, h } = g
    // A sparkline cell renders a mini chart in place of text.
    const spark = cells.getSparkline?.(id)
    if (spark) {
      deco.drawSparkline(x, y, w, h, spark)
      return
    }
    if (val == null || val === '') return
    // List / checkbox cells render their value as a chip or tickbox in the bg
    // pass — don't paint the raw text a second time on top.
    const vtype = cells.getValidation?.(id)?.type
    if (vtype === 'list' || vtype === 'checkbox') return
    const s = String(val)
    const baseFmt: CellFormat = condFmt ? { ...fmt, ...condFmt } : fmt
    const efmt: CellFormat = { ...baseFmt, align: baseFmt.align || _autoAlign(s) }
    const rightInset = cells.getRightInset?.(id) || 0
    const iconInset = condFmt?.icon ? ICON_INSET : 0
    setCellFont(ctx, efmt)
    const mode = getTextWrap(efmt)
    // A value with hard newlines (Cmd+Enter) always renders multi-line, even
    // in clip/overflow mode — matching Sheets, where only wrap mode also
    // soft-wraps long lines.
    if (mode === 'wrap' || s.includes('\n')) {
      _drawWrappedText(s, x + iconInset, y, w - iconInset, h, efmt, rightInset, mode === 'wrap')
      return
    }
    let drawX = x + iconInset
    let drawW = w - iconInset
    // Overflow mode: when the text doesn't fit in the cell, extend the
    // clip rect into adjacent empty / no-background cells per the cell's
    // alignment direction (or both ways for centred text). Clip mode
    // skips this and falls through to the cell's own bounds.
    if (mode === 'overflow') {
      const textW = ctx.measureText(s).width + 8
      const inside = drawW - rightInset
      if (textW > inside) {
        const ext = _overflowExtension(r, c, efmt.align, textW - inside, getVal, cells)
        drawX -= ext.left
        drawW += ext.left + ext.right
      }
    }
    _drawCellText(drawX, y, drawW, h, s, efmt, rightInset)
  }

  // Walk adjacent cells in the alignment direction and return how many CSS
  // pixels of extra room we can use. Stops at the first cell with a value,
  // an explicit background fill, or the grid edge — mirroring Sheets' rule
  // that bg-styled cells block overflow even when otherwise empty.
  function _overflowExtension(
    r: number,
    c: number,
    align: string | undefined,
    needed: number,
    getVal: (id: string) => CellValue,
    cells: CellProvider,
  ): { left: number; right: number } {
    const out = { left: 0, right: 0 }
    if (align === 'left' || align === 'center') {
      let nc = c + 1
      const want = align === 'center' ? needed / 2 : needed
      while (out.right < want && nc < totalCols()) {
        if (_blocksOverflow(r, nc, getVal, cells)) break
        out.right += cw(nc)
        nc++
      }
    }
    if (align === 'right' || align === 'center') {
      // For centred text whose right extension hit a block early, pull the
      // shortfall back into the left walk so the text stays visible.
      const want = align === 'center' ? needed - out.right : needed
      let nc = c - 1
      while (out.left < want && nc >= 0) {
        if (_blocksOverflow(r, nc, getVal, cells)) break
        out.left += cw(nc)
        nc--
      }
    }
    return out
  }

  function _blocksOverflow(
    r: number,
    c: number,
    getVal: (id: string) => CellValue,
    cells: CellProvider,
  ): boolean {
    if (c < 0 || c >= totalCols()) return true
    const id = cellId(r, c)
    if (cells.isSlave?.(id)) return true
    if (cells.getMergeInfo?.(id)) return true
    const v = getVal(id)
    if (v != null && v !== '') return true
    return !!cells.getStyle?.(id)?.backgroundColor
  }

  // Grid lines are already on the canvas when a cell paints, so a fill that
  // covered the cell's own top/left edge would rub them out — and only those
  // two, since the bottom/right lines belong to the neighbours. Both fills
  // start 1px in, which lands the fill flush against the lines on every side.
  function _drawCellBackground(
    x: number,
    y: number,
    w: number,
    h: number,
    merge: MergeInfo | null | undefined,
    fmt: CellFormat,
    condFmt: CondFormat | null | undefined,
  ): void {
    if (merge) {
      ctx.fillStyle = COLORS.white
      ctx.fillRect(x + 1, y + 1, w - 1, h - 1)
    }
    const bg = condFmt?.backgroundColor || fmt.backgroundColor
    if (bg) {
      ctx.fillStyle = bg
      ctx.fillRect(x + 1, y + 1, w - 1, h - 1)
    }
  }

  function _autoAlign(s: string): string {
    return s !== '' && !isNaN(Number(s)) ? 'right' : 'left'
  }

  // ── Single-line text ─────────────────────────────────────────────────────────

  function _drawCellText(
    x: number,
    y: number,
    w: number,
    h: number,
    val: string,
    fmt: CellFormat,
    rightInset = 0,
  ): void {
    ctx.save()
    ctx.beginPath()
    ctx.rect(x + 1, y, Math.max(0, w - 2 - rightInset), h)
    ctx.clip()
    const { textX, textY, baseline } = _computeTextAnchor(x, y, w, h, fmt, rightInset)
    ctx.textBaseline = baseline
    ctx.fillText(val, textX, textY)
    if (fmt.underline || fmt.strikethrough || fmt.hyperlink)
      _drawTextDecorations(fmt, val, textX, _midY(baseline, textY))
    ctx.restore()
  }

  function _computeTextAnchor(
    x: number,
    y: number,
    w: number,
    h: number,
    fmt: CellFormat,
    rightInset = 0,
  ): { textX: number; textY: number; baseline: CanvasTextBaseline } {
    const innerW = w - rightInset
    const textX =
      fmt.align === 'center' ? x + innerW / 2 : fmt.align === 'right' ? x + innerW - 4 : x + 4
    const textY = fmt.valign === 'top' ? y + 4 : fmt.valign === 'bottom' ? y + h - 4 : y + h / 2
    const baseline = fmt.valign === 'top' ? 'top' : fmt.valign === 'bottom' ? 'bottom' : 'middle'
    return { textX, textY, baseline }
  }

  function _midY(baseline: CanvasTextBaseline, textY: number): number {
    if (baseline === 'top') return textY + 7
    if (baseline === 'bottom') return textY - 7
    return textY
  }

  function _drawTextDecorations(fmt: CellFormat, val: string, textX: number, midY: number): void {
    const tw = ctx.measureText(val).width
    const lx0 = fmt.align === 'center' ? textX - tw / 2 : fmt.align === 'right' ? textX - tw : textX
    ctx.strokeStyle = inkFor(fmt)
    ctx.lineWidth = 1
    if (fmt.underline || fmt.hyperlink) {
      ctx.beginPath()
      ctx.moveTo(lx0, midY + 8)
      ctx.lineTo(lx0 + tw, midY + 8)
      ctx.stroke()
    }
    if (fmt.strikethrough) {
      ctx.beginPath()
      ctx.moveTo(lx0, midY + 1)
      ctx.lineTo(lx0 + tw, midY + 1)
      ctx.stroke()
    }
  }

  // ── Wrapped text ─────────────────────────────────────────────────────────────

  function _drawWrappedText(
    val: string,
    x: number,
    y: number,
    w: number,
    h: number,
    fmt: CellFormat,
    rightInset = 0,
    softWrap = true,
  ): void {
    const innerW = w - rightInset
    const lines = softWrap
      ? wrapLines(val, innerW - 8, (t) => ctx.measureText(t).width)
      : String(val).split('\n')
    if (!lines.length) return
    const lineH = lineHeightFor(fmt)
    const totalH = lines.length * lineH
    const startY =
      fmt.valign === 'top'
        ? y + lineH / 2 + 2
        : fmt.valign === 'bottom'
          ? y + h - totalH + lineH / 2 - 2
          : y + Math.max(lineH / 2, (h - totalH) / 2 + lineH / 2)
    const textX =
      fmt.align === 'center' ? x + innerW / 2 : fmt.align === 'right' ? x + innerW - 4 : x + 4
    ctx.save()
    ctx.textBaseline = 'middle'
    ctx.beginPath()
    ctx.rect(x + 1, y + 1, Math.max(0, w - 2 - rightInset), h - 2)
    ctx.clip()
    lines.forEach((line, i) => ctx.fillText(line, textX, startY + i * lineH))
    ctx.restore()
  }

  // ── Cell borders ─────────────────────────────────────────────────────────────

  function _drawCellBorders(r: number, c: number, cells: CellProvider): void {
    const id = cellId(r, c)
    if (cells.isSlave?.(id)) return
    const fmt = cells.getStyle?.(id)
    if (!fmt) return

    const merge = cells.getMergeInfo?.(id)
    const spanC = merge ? merge.colSpan : 1
    const spanR = merge ? merge.rowSpan : 1
    let w = 0,
      h = 0
    for (let i = 0; i < spanC; i++) w += cw(c + i)
    for (let i = 0; i < spanR; i++) h += rh(r + i)
    const x = colX(c),
      y = rowY(r)

    if (fmt.borderTop) _drawBorderLine(x, y, x + w, y, fmt.borderTop)
    if (fmt.borderBottom) _drawBorderLine(x, y + h, x + w, y + h, fmt.borderBottom)
    if (fmt.borderLeft) _drawBorderLine(x, y, x, y + h, fmt.borderLeft)
    if (fmt.borderRight) _drawBorderLine(x + w, y, x + w, y + h, fmt.borderRight)
  }

  function _drawBorderLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    border: BorderSpec,
  ): void {
    const { style = 'thin', color = '#000000' } = border
    ctx.strokeStyle = color
    ctx.lineWidth = style === 'thick' ? 3 : style === 'medium' ? 2 : 1
    ctx.beginPath()
    ctx.moveTo(x1 + 0.5, y1 + 0.5)
    ctx.lineTo(x2 + 0.5, y2 + 0.5)
    ctx.stroke()
  }

  return { drawRegionCells, drawRegionBorders }
}
