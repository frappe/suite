import { COLORS, TOTAL_COLS } from '../constants.js'
import { cellId } from '../../utils/cells.js'
import { getTextWrap, isWrapText } from '../../utils/text-wrap.js'
import { CHIP, chipFont, chipColor, chipMetrics } from '../chip-geometry.js'
import { checkboxRect, CHECKBOX } from '../checkbox-geometry.js'
import { checkRule } from '../../engine/validation.js'

export function createCellPainter(ctx, { cw, rh, colX, rowY }) {

  // ── Public API ───────────────────────────────────────────────────────────────

  // `getVal(id)` returns a cell's display string. It abstracts over the
  // value source: the legacy eager `data` map (id => data[id]) or the lazy
  // engine-backed lookup. The painter only ever touches cells in the visible
  // region, so the lazy path computes display strings for ~hundreds of cells
  // per frame instead of materialising the whole sheet up front.
  function drawRegionCells(r0, c0, r1, c1, getVal, getFormat, getMergeInfo, isSlave, getComment, getValidation, getCondFormat, getRightInset, getDiffFor) {
    ctx.textBaseline = 'middle'
    // Two-pass paint: every cell's background + decorations first, then
    // every cell's text. Splitting the passes means an upstream cell's
    // overflow text (when that mode lands in a follow-up) won't get
    // overpainted by a downstream cell's background fill in the same
    // loop iteration. The per-cell cost is unchanged — we just iterate
    // twice — and the setup work is shared via _cellGeom.
    for (let r = r0; r <= r1; r++) {
      if (rh(r) === 0) continue
      for (let c = c0; c <= c1; c++)
        _paintBgAt(r, c, getVal, getFormat, getMergeInfo, isSlave, getComment, getValidation, getCondFormat, getDiffFor)
    }
    for (let r = r0; r <= r1; r++) {
      if (rh(r) === 0) continue
      for (let c = c0; c <= c1; c++)
        _paintTextAt(r, c, getVal, getFormat, getMergeInfo, isSlave, getCondFormat, getRightInset, getValidation)
    }
  }

  function drawRegionBorders(r0, c0, r1, c1, getFormat, getMergeInfo, isSlave) {
    if (!getFormat) return
    for (let r = r0; r <= r1; r++) {
      if (rh(r) === 0) continue
      for (let c = c0; c <= c1; c++)
        _drawCellBorders(r, c, getFormat, getMergeInfo, isSlave)
    }
  }

  // ── Cell rendering ───────────────────────────────────────────────────────────

  // Width reserved on the left of a cell when a cond-format icon is present.
  // Mirrors _drawCellIcon's `size + PAD * 2` exactly so the text-pass can
  // compute the same inset without re-drawing the icon.
  const ICON_INSET = 11 + 4 * 2

  // Shared per-cell geometry + format lookup. Both paint phases call this,
  // returns null for slave cells (so the caller knows to skip).
  function _cellGeom(r, c, getVal, getFormat, getMergeInfo, isSlave, getCondFormat) {
    const id = cellId(r, c)
    if (isSlave && isSlave(id)) return null
    const merge = getMergeInfo && getMergeInfo(id)
    const spanC = merge ? merge.colSpan : 1
    const spanR = merge ? merge.rowSpan : 1
    const val   = getVal(id)
    const fmt   = getFormat ? getFormat(id) : {}
    const x = colX(c), y = rowY(r)
    let w = 0, h = 0
    for (let sc = 0; sc < spanC; sc++) w += cw(c + sc)
    for (let sr = 0; sr < spanR; sr++) h += rh(r + sr)
    const condFmt = getCondFormat ? getCondFormat(id, val ?? '') : null
    return { id, val, fmt, condFmt, merge, x, y, w, h }
  }

  function _paintBgAt(r, c, getVal, getFormat, getMergeInfo, isSlave, getComment, getValidation, getCondFormat, getDiffFor) {
    const g = _cellGeom(r, c, getVal, getFormat, getMergeInfo, isSlave, getCondFormat)
    if (!g) return
    const { id, val, fmt, condFmt, merge, x, y, w, h } = g
    _drawCellBackground(x, y, w, h, merge, fmt, condFmt)
    // Data-bar between background and text so values stay readable on top.
    if (condFmt?.dataBar) _drawDataBar(x, y, w, h, condFmt.dataBar)
    if (getDiffFor && getDiffFor(id)) _drawDiffOverlay(x, y, w, h)
    if (getComment?.(id)) _drawCommentTriangle(x, y, w)
    const rule = getValidation?.(id)
    if (rule) {
      const has = val != null && String(val) !== ''
      const invalid = has && !checkRule(rule, val).valid
      if (rule.type === 'list') {
        // List rule → a Sheets-style dropdown affordance. With a value it's a
        // chip (which owns the cell text — the text pass skips it); empty,
        // it's a plain caret so you know it's a dropdown.
        if (has) _drawValidationChip(x, y, w, h, String(val), fmt, !invalid)
        else     _drawDropdownArrow(x, y, w, h)
      } else if (rule.type === 'checkbox') {
        // Checkbox rule → a tickbox that owns the cell (the text pass skips
        // it). Empty reads as unchecked; a value that isn't TRUE/FALSE still
        // gets the invalid marker below.
        _drawCheckbox(x, y, w, h, String(val).toUpperCase() === 'TRUE')
        if (invalid) _drawInvalidTriangle(x, y)
      } else if (invalid) {
        // Number / text-length rules have no dropdown (matching Sheets) — they
        // only surface a marker when the current value breaks the rule.
        _drawInvalidTriangle(x, y)
      }
    }
    // Icon belongs in the bg pass — it's drawn before text and shifts the
    // text rect right. The text pass computes the same inset to position
    // text correctly without re-drawing the icon.
    if (condFmt?.icon) _drawCellIcon(x, y, h, condFmt.icon)
  }

  function _paintTextAt(r, c, getVal, getFormat, getMergeInfo, isSlave, getCondFormat, getRightInset, getValidation) {
    const g = _cellGeom(r, c, getVal, getFormat, getMergeInfo, isSlave, getCondFormat)
    if (!g) return
    const { id, val, fmt, condFmt, x, y, w, h } = g
    if (val == null || val === '') return
    // List / checkbox cells render their value as a chip or tickbox in the bg
    // pass — don't paint the raw text a second time on top.
    const vtype = getValidation?.(id)?.type
    if (vtype === 'list' || vtype === 'checkbox') return
    const s = String(val)
    const baseFmt = condFmt ? { ...fmt, ...condFmt } : fmt
    const efmt = { ...baseFmt, align: baseFmt.align || _autoAlign(s) }
    const rightInset = getRightInset ? (getRightInset(id) || 0) : 0
    const iconInset  = condFmt?.icon ? ICON_INSET : 0
    _setCellFont(efmt)
    const mode = getTextWrap(efmt)
    if (mode === 'wrap') {
      _drawWrappedText(s, x + iconInset, y, w - iconInset, h, efmt, rightInset)
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
        const ext = _overflowExtension(r, c, efmt.align, textW - inside, getVal, getFormat, getMergeInfo, isSlave)
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
  function _overflowExtension(r, c, align, needed, getVal, getFormat, getMergeInfo, isSlave) {
    const out = { left: 0, right: 0 }
    if (align === 'left' || align === 'center') {
      let nc = c + 1, want = align === 'center' ? needed / 2 : needed
      while (out.right < want && nc < TOTAL_COLS) {
        if (_blocksOverflow(r, nc, getVal, getFormat, getMergeInfo, isSlave)) break
        out.right += cw(nc); nc++
      }
    }
    if (align === 'right' || align === 'center') {
      // For centred text whose right extension hit a block early, pull the
      // shortfall back into the left walk so the text stays visible.
      const want = align === 'center' ? (needed - out.right) : needed
      let nc = c - 1
      while (out.left < want && nc >= 0) {
        if (_blocksOverflow(r, nc, getVal, getFormat, getMergeInfo, isSlave)) break
        out.left += cw(nc); nc--
      }
    }
    return out
  }

  function _blocksOverflow(r, c, getVal, getFormat, getMergeInfo, isSlave) {
    if (c < 0 || c >= TOTAL_COLS) return true
    const id = cellId(r, c)
    if (isSlave?.(id)) return true
    if (getMergeInfo?.(id)) return true
    const v = getVal(id)
    if (v != null && v !== '') return true
    const f = getFormat ? getFormat(id) : null
    if (f?.backgroundColor) return true
    return false
  }

  function _drawCellBackground(x, y, w, h, merge, fmt, condFmt) {
    if (merge) {
      ctx.fillStyle = COLORS.white
      ctx.fillRect(x + 1, y + 1, w - 1, h - 1)
    }
    const bg = condFmt?.backgroundColor || fmt.backgroundColor
    if (bg) {
      ctx.fillStyle = bg
      ctx.fillRect(x, y, w, h)
    }
  }

  // Horizontal data bar inside the cell — width is the rule's normalised
  // value (0..1). Stays a couple of px shy of the cell edges so it reads
  // as a separate visual layer from the cell background.
  function _drawDataBar(x, y, w, h, bar) {
    const PAD = 2
    const innerW = Math.max(0, w - PAD * 2)
    const innerH = Math.max(0, h - PAD * 2)
    if (!innerW || !innerH) return
    const t = Math.max(0, Math.min(1, bar.value || 0))
    const fillW = Math.round(innerW * t)
    if (!fillW) return
    ctx.save()
    ctx.fillStyle = bar.negative ? (bar.negativeColor || '#dc2626') : (bar.color || '#0E7490')
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
  function _drawCellIcon(x, y, h, icon) {
    const size  = 11
    const PAD   = 4
    const cx    = x + PAD + size / 2
    const cy    = y + h / 2
    ctx.save()
    ctx.fillStyle = icon.color || '#737373'
    switch (icon.shape) {
      case 'arrow-up':
        ctx.beginPath()
        ctx.moveTo(cx, cy - size / 2)
        ctx.lineTo(cx + size / 2, cy + size / 2)
        ctx.lineTo(cx - size / 2, cy + size / 2)
        ctx.closePath()
        ctx.fill()
        break
      case 'arrow-down':
        ctx.beginPath()
        ctx.moveTo(cx, cy + size / 2)
        ctx.lineTo(cx + size / 2, cy - size / 2)
        ctx.lineTo(cx - size / 2, cy - size / 2)
        ctx.closePath()
        ctx.fill()
        break
      case 'arrow-right':
        ctx.beginPath()
        ctx.moveTo(cx + size / 2, cy)
        ctx.lineTo(cx - size / 2, cy + size / 2)
        ctx.lineTo(cx - size / 2, cy - size / 2)
        ctx.closePath()
        ctx.fill()
        break
      case 'circle':
        ctx.beginPath()
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2)
        ctx.fill()
        break
      case 'circle-empty':
        ctx.beginPath()
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2)
        ctx.lineWidth = 1.5
        ctx.strokeStyle = icon.color || '#737373'
        ctx.stroke()
        break
      case 'circle-half':
        ctx.beginPath()
        ctx.arc(cx, cy, size / 2, Math.PI / 2, -Math.PI / 2)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2)
        ctx.lineWidth = 1.5
        ctx.strokeStyle = icon.color || '#737373'
        ctx.stroke()
        break
      case 'circle-full':
        ctx.beginPath()
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2)
        ctx.fill()
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
  function _drawDiffOverlay(x, y, w, h) {
    ctx.save()
    ctx.fillStyle = 'rgba(14, 116, 144, 0.18)'   // ink-teal-7 at 18 % alpha
    ctx.fillRect(x, y, w, h)
    ctx.restore()
  }

  function _drawCommentTriangle(x, y, w) {
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

  function _drawDropdownArrow(x, y, w, h) {
    const aw = 14, ah = h - 2
    ctx.save()
    ctx.strokeStyle = COLORS.gridLine || '#d0d0d0'
    ctx.lineWidth = 1
    ctx.strokeRect(x + w - aw, y + 1, aw - 1, ah)
    ctx.fillStyle = '#666'
    ctx.beginPath()
    const mx = x + w - aw / 2, my = y + h / 2
    ctx.moveTo(mx - 3, my - 1.5)
    ctx.lineTo(mx + 3, my - 1.5)
    ctx.lineTo(mx, my + 2.5)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  // Sheets-style checkbox: a rounded grey square centred in the cell. Checked
  // is filled with a white tick; unchecked is a hollow outline. Geometry comes
  // from checkbox-geometry so the painted box matches the click zone in
  // canvas/index.js exactly.
  function _drawCheckbox(x, y, w, h, checked) {
    const { x: ox, y: oy, size } = checkboxRect(w, h)
    if (size < CHECKBOX.minSize) return   // row too short for a legible box
    const bx = x + ox, by = y + oy
    const grey = '#6b7280'
    ctx.save()
    _roundRectPath(bx, by, size, size, 3)
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
      ctx.lineTo(bx + size * 0.44, by + size * 0.70)
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
  // caret on its right. Drawn in the bg pass; the matching click zone lives in
  // canvas/index.js (both measure through chip-geometry so they stay aligned).
  function _drawValidationChip(x, y, w, h, text, fmt, valid) {
    const chipH = Math.min(h - 4, CHIP.maxH)
    if (chipH < CHIP.minH) { _drawDropdownArrow(x, y, w, h); return }  // row too short for a pill
    ctx.save()
    _setCellFont(fmt)
    const textColor = fmt.color || COLORS.cellText
    const { offsetX, chipW } = chipMetrics(ctx, text, fmt, w)
    const chipX = x + offsetX
    const chipY = y + (h - chipH) / 2
    // Pill — known options get a stable pastel colour; an out-of-list value
    // stays neutral grey (it isn't one of the choices).
    _roundRectPath(chipX, chipY, chipW, chipH, chipH / 2)
    ctx.fillStyle = valid ? chipColor(text) : COLORS.chipFill
    ctx.fill()
    // Value — ellipsised to the room left of the caret so a long option
    // doesn't get hard-clipped mid-glyph.
    ctx.fillStyle   = textColor
    ctx.textAlign   = 'left'
    ctx.textBaseline = 'middle'
    const textRoom = chipW - CHIP.innerPad - CHIP.caretW
    ctx.fillText(_ellipsize(text, textRoom), chipX + CHIP.innerPad, chipY + chipH / 2)
    // Caret
    const mx = chipX + chipW - CHIP.caretW / 2, my = chipY + chipH / 2
    ctx.fillStyle = COLORS.chipCaret
    ctx.beginPath()
    ctx.moveTo(mx - 3, my - 1.5)
    ctx.lineTo(mx + 3, my - 1.5)
    ctx.lineTo(mx, my + 2.5)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    if (!valid) _drawInvalidTriangle(x, y)
  }

  // Trim `text` to fit `maxW` px (current ctx.font), appending an ellipsis.
  function _ellipsize(text, maxW) {
    if (maxW <= 0) return ''
    if (ctx.measureText(text).width <= maxW) return text
    const ell = '…'
    let lo = 0, hi = text.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (ctx.measureText(text.slice(0, mid) + ell).width <= maxW) lo = mid
      else hi = mid - 1
    }
    return lo > 0 ? text.slice(0, lo) + ell : ell
  }

  // Rounded-rect path with a roundRect fallback for older canvas engines.
  function _roundRectPath(x, y, w, h, r) {
    ctx.beginPath()
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return }
    r = Math.min(r, w / 2, h / 2)
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y,     x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x,     y + h, r)
    ctx.arcTo(x,     y + h, x,     y,     r)
    ctx.arcTo(x,     y,     x + w, y,     r)
    ctx.closePath()
  }

  // Red corner triangle marking a value that fails its validation rule.
  // Anchored top-LEFT to stay clear of the top-right comment triangle, so a
  // cell with both a note and a bad value shows two distinct markers.
  function _drawInvalidTriangle(x, y) {
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

  function _autoAlign(s) {
    return s !== '' && !isNaN(Number(s)) ? 'right' : 'left'
  }

  function _setCellFont(fmt) {
    ctx.font      = chipFont(fmt)
    ctx.fillStyle = fmt.color || (fmt.hyperlink ? '#007BE0' : COLORS.cellText)
    ctx.textAlign = fmt.align || 'left'
  }

  // ── Single-line text ─────────────────────────────────────────────────────────

  function _drawCellText(x, y, w, h, val, fmt, rightInset = 0) {
    ctx.save()
    ctx.beginPath(); ctx.rect(x + 1, y, Math.max(0, w - 2 - rightInset), h); ctx.clip()
    const { textX, textY, baseline } = _computeTextAnchor(x, y, w, h, fmt, rightInset)
    ctx.textBaseline = baseline
    ctx.fillText(val, textX, textY)
    if (fmt.underline || fmt.strikethrough || fmt.hyperlink)
      _drawTextDecorations(fmt, val, textX, _midY(baseline, textY))
    ctx.restore()
  }

  function _computeTextAnchor(x, y, w, h, fmt, rightInset = 0) {
    const innerW = w - rightInset
    const textX = fmt.align === 'center' ? x + innerW / 2
                : fmt.align === 'right'  ? x + innerW - 4
                : x + 4
    const textY = fmt.valign === 'top'    ? y + 4
                : fmt.valign === 'bottom' ? y + h - 4
                :                           y + h / 2
    const baseline = fmt.valign === 'top'    ? 'top'
                   : fmt.valign === 'bottom' ? 'bottom'
                   :                           'middle'
    return { textX, textY, baseline }
  }

  function _midY(baseline, textY) {
    if (baseline === 'top')    return textY + 7
    if (baseline === 'bottom') return textY - 7
    return textY
  }

  function _drawTextDecorations(fmt, val, textX, midY) {
    const tw  = ctx.measureText(val).width
    const lx0 = fmt.align === 'center' ? textX - tw / 2
              : fmt.align === 'right'  ? textX - tw
              : textX
    ctx.strokeStyle = fmt.color || (fmt.hyperlink ? '#007BE0' : COLORS.cellText)
    ctx.lineWidth = 1
    if (fmt.underline || fmt.hyperlink) {
      ctx.beginPath()
      ctx.moveTo(lx0, midY + 8); ctx.lineTo(lx0 + tw, midY + 8)
      ctx.stroke()
    }
    if (fmt.strikethrough) {
      ctx.beginPath()
      ctx.moveTo(lx0, midY + 1); ctx.lineTo(lx0 + tw, midY + 1)
      ctx.stroke()
    }
  }

  // ── Wrapped text ─────────────────────────────────────────────────────────────

  function _drawWrappedText(val, x, y, w, h, fmt, rightInset = 0) {
    const innerW = w - rightInset
    const lines = _wrapLines(val, innerW - 8)
    if (!lines.length) return
    const lineH  = 16
    const totalH = lines.length * lineH
    const startY = fmt.valign === 'top'    ? y + lineH / 2 + 2
                 : fmt.valign === 'bottom' ? y + h - totalH + lineH / 2 - 2
                 :                           y + Math.max(lineH / 2, (h - totalH) / 2 + lineH / 2)
    const textX  = fmt.align === 'center' ? x + innerW / 2
                 : fmt.align === 'right'  ? x + innerW - 4
                 : x + 4
    ctx.save()
    ctx.textBaseline = 'middle'
    ctx.beginPath(); ctx.rect(x + 1, y + 1, Math.max(0, w - 2 - rightInset), h - 2); ctx.clip()
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], textX, startY + i * lineH)
    ctx.restore()
  }

  function _wrapLines(val, maxW) {
    const tokens = val.split(/(\s+)/)
    const lines  = []
    let line = ''
    for (const tok of tokens) {
      if (!tok) continue
      if (ctx.measureText(line + tok).width <= maxW) { line += tok; continue }
      if (/^\s+$/.test(tok)) {
        if (line.trim()) lines.push(line.trimEnd())
        line = ''; continue
      }
      for (const ch of tok) {
        if (line && ctx.measureText(line + ch).width > maxW) {
          lines.push(line.trimEnd()); line = ch
        } else { line += ch }
      }
    }
    if (line.trim()) lines.push(line.trimEnd())
    return lines
  }

  // ── Cell borders ─────────────────────────────────────────────────────────────

  function _drawCellBorders(r, c, getFormat, getMergeInfo, isSlave) {
    const id = cellId(r, c)
    if (isSlave && isSlave(id)) return
    const fmt = getFormat(id)
    if (!fmt) return

    const merge = getMergeInfo ? getMergeInfo(id) : null
    const spanC = merge ? merge.colSpan : 1
    const spanR = merge ? merge.rowSpan : 1
    let w = 0, h = 0
    for (let i = 0; i < spanC; i++) w += cw(c + i)
    for (let i = 0; i < spanR; i++) h += rh(r + i)
    const x = colX(c), y = rowY(r)

    if (fmt.borderTop)    _drawBorderLine(x,     y,     x + w, y,     fmt.borderTop)
    if (fmt.borderBottom) _drawBorderLine(x,     y + h, x + w, y + h, fmt.borderBottom)
    if (fmt.borderLeft)   _drawBorderLine(x,     y,     x,     y + h, fmt.borderLeft)
    if (fmt.borderRight)  _drawBorderLine(x + w, y,     x + w, y + h, fmt.borderRight)
  }

  function _drawBorderLine(x1, y1, x2, y2, border) {
    const { style = 'thin', color = '#000000' } = border
    ctx.strokeStyle = color
    ctx.lineWidth   = style === 'thick' ? 3 : style === 'medium' ? 2 : 1
    ctx.beginPath()
    ctx.moveTo(x1 + 0.5, y1 + 0.5)
    ctx.lineTo(x2 + 0.5, y2 + 0.5)
    ctx.stroke()
  }

  return { drawRegionCells, drawRegionBorders }
}
