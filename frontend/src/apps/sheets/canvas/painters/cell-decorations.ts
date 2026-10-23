// Everything drawn inside a cell other than its plain text: data bars and
// icons from conditional formatting, the version-diff wash, comment and
// invalid-value markers, list dropdown chips and arrows, checkboxes, and
// sparklines. Each draw takes the cell's box in logical px.

import { sparkGeometry } from '../../engine/sparkline.js'
import { CHECKBOX, checkboxRect } from '../checkbox-geometry.js'
import { CHIP, chipColor, chipMetrics } from '../chip-geometry.js'
import { COLORS } from '../constants.js'
import type { CellFormat, CondIcon, DataBar, SparkSpec, ValidationRule } from '../types.js'
import { setCellFont } from './cell-text-style.js'

export interface CellDecorations {
  drawDataBar(x: number, y: number, w: number, h: number, bar: DataBar): void
  /** Returns the width it reserves, so text can shift right. */
  drawCellIcon(x: number, y: number, h: number, icon: CondIcon): number
  drawDiffOverlay(x: number, y: number, w: number, h: number): void
  drawCommentTriangle(x: number, y: number, w: number): void
  drawInvalidTriangle(x: number, y: number): void
  drawDropdownArrow(x: number, y: number, w: number, h: number): void
  drawCheckbox(x: number, y: number, w: number, h: number, checked: boolean): void
  drawValidationChip(
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    fmt: CellFormat,
    valid: boolean,
    rule: ValidationRule,
  ): void
  drawSparkline(x: number, y: number, w: number, h: number, spec: SparkSpec): void
}

/** Width a cond-format icon takes on the cell's left: size + padding on both sides. */
export const ICON_INSET = 11 + 4 * 2

export function createCellDecorations(ctx: CanvasRenderingContext2D): CellDecorations {
  // Horizontal data bar inside the cell — width is the rule's normalised
  // value (0..1). Stays a couple of px shy of the cell edges so it reads
  // as a separate visual layer from the cell background.
  function drawDataBar(x: number, y: number, w: number, h: number, bar: DataBar): void {
    const PAD = 2
    const innerW = Math.max(0, w - PAD * 2)
    const innerH = Math.max(0, h - PAD * 2)
    if (!innerW || !innerH) return
    const t = Math.max(0, Math.min(1, bar.value || 0))
    const fillW = Math.round(innerW * t)
    if (!fillW) return
    ctx.save()
    ctx.fillStyle = bar.negative ? bar.negativeColor || '#dc2626' : bar.color || '#0E7490'
    // Faint background channel so partial bars don't look like fixed-width
    // shapes drifting in space.
    ctx.globalAlpha = 0.18
    ctx.fillRect(x + PAD, y + PAD, innerW, innerH)
    ctx.globalAlpha = 0.55
    ctx.fillRect(x + PAD, y + PAD, fillW, innerH)
    ctx.restore()
  }

  // Render the icon at the left edge of the cell. Returns the reserved
  // horizontal space so the text painter can shift right.
  function drawCellIcon(x: number, y: number, h: number, icon: CondIcon): number {
    const size = 11
    const PAD = 4
    const cx = x + PAD + size / 2
    const cy = y + h / 2
    const half = size / 2
    const triangle = (
      ax: number,
      ay: number,
      bx: number,
      by: number,
      qx: number,
      qy: number,
    ): void => {
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.lineTo(qx, qy)
      ctx.closePath()
      ctx.fill()
    }
    const ring = (): void => {
      ctx.beginPath()
      ctx.arc(cx, cy, half, 0, Math.PI * 2)
      ctx.lineWidth = 1.5
      ctx.strokeStyle = icon.color || '#737373'
      ctx.stroke()
    }
    ctx.save()
    ctx.fillStyle = icon.color || '#737373'
    switch (icon.shape) {
      case 'arrow-up':
        triangle(cx, cy - half, cx + half, cy + half, cx - half, cy + half)
        break
      case 'arrow-down':
        triangle(cx, cy + half, cx + half, cy - half, cx - half, cy - half)
        break
      case 'arrow-right':
        triangle(cx + half, cy, cx - half, cy + half, cx - half, cy - half)
        break
      case 'circle':
      case 'circle-full':
        ctx.beginPath()
        ctx.arc(cx, cy, half, 0, Math.PI * 2)
        ctx.fill()
        break
      case 'circle-empty':
        ring()
        break
      case 'circle-half':
        ctx.beginPath()
        ctx.arc(cx, cy, half, Math.PI / 2, -Math.PI / 2)
        ctx.fill()
        ring()
        break
      default:
        // Unknown shape — fail quiet rather than crash a render.
        break
    }
    ctx.restore()
    return size + PAD * 2
  }

  // Diff overlay: translucent teal wash painted on top of the cell background
  // in version-preview mode.  Espresso-aligned colour, not the Google teal —
  // keeps the editor in-theme while still signalling "this cell changed".
  function drawDiffOverlay(x: number, y: number, w: number, h: number): void {
    ctx.save()
    ctx.fillStyle = 'rgba(14, 116, 144, 0.18)' // ink-teal-7 at 18 % alpha
    ctx.fillRect(x, y, w, h)
    ctx.restore()
  }

  function drawCommentTriangle(x: number, y: number, w: number): void {
    const sz = 6
    ctx.save()
    ctx.fillStyle = '#E8523A'
    ctx.beginPath()
    ctx.moveTo(x + w - sz, y)
    ctx.lineTo(x + w, y)
    ctx.lineTo(x + w, y + sz)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  // Red corner triangle marking a value that fails its validation rule.
  // Anchored top-LEFT to stay clear of the top-right comment triangle, so a
  // cell with both a note and a bad value shows two distinct markers.
  function drawInvalidTriangle(x: number, y: number): void {
    const sz = 7
    ctx.save()
    ctx.fillStyle = COLORS.invalidMark
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + sz, y)
    ctx.lineTo(x, y + sz)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  // A soft, borderless chevron button on the cell's right edge — reads as a
  // frappe-ui control rather than the old hard-bordered <select> box. Empty
  // list cells get this; a cell with a value gets the same chevron inside its
  // chip (see drawChevron below).
  function drawDropdownArrow(x: number, y: number, w: number, h: number): void {
    const btn = 18
    const bh = Math.min(h - 4, CHIP.maxH)
    if (bh < CHIP.minH) return // row too short for a legible affordance
    const bx = x + w - btn - 3
    const by = y + (h - bh) / 2
    ctx.save()
    roundRectPath(bx, by, btn, bh, 4)
    ctx.fillStyle = COLORS.chipFill
    ctx.fill()
    drawChevron(bx + btn / 2, y + h / 2)
    ctx.restore()
  }

  // A small rounded chevron (⌄) centred on (cx, cy). Stroked, not a filled
  // triangle, so it matches frappe-ui's FeatherIcon "chevron-down".
  function drawChevron(cx: number, cy: number): void {
    ctx.strokeStyle = COLORS.chipCaret
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(cx - 3.5, cy - 1.5)
    ctx.lineTo(cx, cy + 2)
    ctx.lineTo(cx + 3.5, cy - 1.5)
    ctx.stroke()
  }

  // Sheets-style checkbox: a rounded grey square centred in the cell. Checked
  // is filled with a white tick; unchecked is a hollow outline. Geometry comes
  // from checkbox-geometry so the painted box matches the click zone in
  // canvas/input/mouse.ts exactly.
  function drawCheckbox(x: number, y: number, w: number, h: number, checked: boolean): void {
    const { x: ox, y: oy, size } = checkboxRect(w, h)
    if (size < CHECKBOX.minSize) return // row too short for a legible box
    const bx = x + ox,
      by = y + oy
    const grey = '#6b7280'
    ctx.save()
    roundRectPath(bx, by, size, size, 3)
    if (checked) {
      ctx.fillStyle = grey
      ctx.fill()
      // Tick — three-point polyline scaled to the box.
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = Math.max(1.5, size / 8)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(bx + size * 0.26, by + size * 0.52)
      ctx.lineTo(bx + size * 0.44, by + size * 0.7)
      ctx.lineTo(bx + size * 0.74, by + size * 0.32)
      ctx.stroke()
    } else {
      ctx.strokeStyle = grey
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
    ctx.restore()
  }

  // Sheets-style dropdown chip: a rounded pill holding the cell value with a
  // caret on its right. Drawn in the bg pass; a single click anywhere in the
  // cell opens the dropdown (canvas/input/mouse.ts).
  function drawValidationChip(
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    fmt: CellFormat,
    valid: boolean,
    rule: ValidationRule,
  ): void {
    const chipH = Math.min(h - 4, CHIP.maxH)
    if (chipH < CHIP.minH) {
      drawDropdownArrow(x, y, w, h)
      return
    } // row too short for a pill
    ctx.save()
    setCellFont(ctx, fmt)
    const textColor = fmt.color || COLORS.cellText
    const { offsetX, chipW } = chipMetrics(ctx, text, fmt, w)
    const chipX = x + offsetX
    const chipY = y + (h - chipH) / 2
    // Pill — a known option gets its custom colour (or the auto palette slot);
    // an out-of-list value stays neutral grey (it isn't one of the choices).
    roundRectPath(chipX, chipY, chipW, chipH, chipH / 2)
    ctx.fillStyle = valid ? chipColor(text, rule) : COLORS.chipFill
    ctx.fill()
    // Value — ellipsised to the room left of the caret so a long option
    // doesn't get hard-clipped mid-glyph.
    ctx.fillStyle = textColor
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const textRoom = chipW - CHIP.innerPad - CHIP.caretW
    ctx.fillText(ellipsize(text, textRoom), chipX + CHIP.innerPad, chipY + chipH / 2)
    // Caret — same chevron as the empty-cell affordance, for consistency.
    drawChevron(chipX + chipW - CHIP.caretW / 2, chipY + chipH / 2)
    ctx.restore()
    if (!valid) drawInvalidTriangle(x, y)
  }

  // Paint a sparkline spec into the cell box. Geometry (points / bars) comes
  // from the pure sparkline module; here we just stroke/fill it.
  function drawSparkline(x: number, y: number, w: number, h: number, spec: SparkSpec): void {
    const geo = sparkGeometry(spec, w, h)
    if (!geo) return
    const color = spec.color || COLORS.sparkline
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip() // dense charts can't spill into neighbours
    if (geo.kind === 'bars') {
      ctx.fillStyle = color
      for (const b of geo.bars) ctx.fillRect(x + b.x, y + b.y, b.w, b.h)
    } else if (geo.points.length === 1 && geo.points[0]) {
      const p = geo.points[0] // a lone point renders as a dot, not an empty stroke
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x + p.x, y + p.y, 1.5, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.lineJoin = 'round'
      ctx.beginPath()
      geo.points.forEach((p, i) =>
        i ? ctx.lineTo(x + p.x, y + p.y) : ctx.moveTo(x + p.x, y + p.y),
      )
      ctx.stroke()
    }
    ctx.restore()
  }

  // Trim `text` to fit `maxW` px (current ctx.font), appending an ellipsis.
  function ellipsize(text: string, maxW: number): string {
    if (maxW <= 0) return ''
    if (ctx.measureText(text).width <= maxW) return text
    const ell = '…'
    let lo = 0,
      hi = text.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (ctx.measureText(text.slice(0, mid) + ell).width <= maxW) lo = mid
      else hi = mid - 1
    }
    return lo > 0 ? text.slice(0, lo) + ell : ell
  }

  // Rounded-rect path with a roundRect fallback for older canvas engines.
  function roundRectPath(x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath()
    if ('roundRect' in ctx && typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r)
      return
    }
    r = Math.min(r, w / 2, h / 2)
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  return {
    drawDataBar,
    drawCellIcon,
    drawDiffOverlay,
    drawCommentTriangle,
    drawInvalidTriangle,
    drawDropdownArrow,
    drawCheckbox,
    drawValidationChip,
    drawSparkline,
  }
}
