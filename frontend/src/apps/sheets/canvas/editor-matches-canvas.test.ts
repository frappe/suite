// Starting or ending an edit must not move a cell's text: the in-cell editor
// lays its text out exactly where the cell painter draws it. Each case paints
// a cell with the real painter on a recording context, opens the overlay on
// the same cell, and compares font, text edge, baseline and line pitch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EditorFormat } from './input/editor.js'
import { createOverlay } from './overlay.js'
import { createCellPainter } from './painters/cell-painter.js'
import { autoAlign } from './painters/cell-text-style.js'
import { createMockCtx, createMockGeo } from './painters/test-utils.js'
import type { CellFormat, MergeInfo } from './types.js'

// Font metrics both canvases report, as shares of the font size: the font
// box (CSS line layout), cap height, and the em box ('top' / 'bottom').
const ASC = 0.97
const DESC = 0.24
const CAP = 0.73
const EM_ASC = 0.8
const EM_DESC = 0.2
// Glyph advance, as a share of the font size.
const ADVANCE = 0.55

const px = (v: string) => parseFloat(v)
const sizeOf = (font: string) => parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)![1])

function measureFor(ctx: { font: string; textBaseline: string }) {
  return (t: string) => {
    const size = sizeOf(ctx.font)
    const shift =
      ctx.textBaseline === 'top'
        ? -EM_ASC * size
        : ctx.textBaseline === 'bottom'
          ? EM_DESC * size
          : 0
    return {
      width: t.length * ADVANCE * size,
      fontBoundingBoxAscent: size * ASC,
      fontBoundingBoxDescent: size * DESC,
      actualBoundingBoxAscent: size * CAP + shift,
      // How far the alphabetic baseline sits above the current baseline.
      alphabeticBaseline: shift,
    }
  }
}

beforeEach(() => {
  // The overlay measures on an OffscreenCanvas (jsdom has none).
  class FakeOffscreenCanvas {
    getContext() {
      const ctx = {
        font: '13px Inter',
        textBaseline: 'alphabetic',
        measureText: (_t: string) => ({}),
      }
      ctx.measureText = measureFor(ctx)
      return ctx
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

interface Draw {
  text: string
  x: number
  baseline: number // alphabetic, in logical px
  align: string
  font: string
}

interface Case {
  value: string
  fmt?: CellFormat
  h?: number
  w?: number
  zoom?: number
  merge?: MergeInfo
  rightInset?: number
}

// The painter's text draws for A1 (logical x 50, y 24).
function paint({ value, fmt = {}, h = 24, w = 100, merge, rightInset = 0 }: Case): Draw[] {
  const ctx = createMockCtx()
  ctx.measureText = measureFor(ctx) as never
  const draws: Draw[] = []
  ctx.fillText = (text: string, x: number, y: number) => {
    const size = sizeOf(ctx.font)
    const shift =
      ctx.textBaseline === 'top'
        ? EM_ASC * size
        : ctx.textBaseline === 'bottom'
          ? -EM_DESC * size
          : 0
    draws.push({ text, x, baseline: y + shift, align: ctx.textAlign, font: ctx.font })
  }
  const geo = createMockGeo({ colWidths: { 0: w }, rowHeights: { 0: h } })
  const painter = createCellPainter(ctx as never, geo as never)
  painter.drawRegionCells(
    0,
    0,
    0,
    0,
    () => value,
    {
      getStyle: () => fmt,
      getMergeInfo: () => merge ?? null,
      getRightInset: () => rightInset,
    },
    null,
  )
  return draws
}

// Opens the overlay on A1 the way the editor does, editing the cell's own
// value; returns where its text sits, in logical px.
function edit({ value, fmt = {}, h = 24, w = 100, zoom = 1, merge, rightInset = 0 }: Case) {
  const W = merge ? merge.colSpan * w : w
  const H = merge ? merge.rowSpan * h : h
  const editorFmt: EditorFormat = {
    ...fmt,
    align: fmt.align || autoAlign(value, undefined),
    insetRight: rightInset,
  }
  const overlay = createOverlay(document.body)
  overlay.position(50 * zoom, 24 * zoom, W * zoom, H * zoom, editorFmt, zoom)
  overlay.show(value)
  const s = overlay.el.style
  const size = px(s.fontSize)
  const lineH = px(s.lineHeight)
  const left = px(s.left) + px(s.borderLeftWidth) + px(s.paddingLeft)
  const right = px(s.left) + px(s.width) - px(s.borderRightWidth) - px(s.paddingRight)
  const align = s.textAlign
  const x = align === 'right' ? right : align === 'center' ? (left + right) / 2 : left
  const top = px(s.top) + px(s.borderTopWidth) + px(s.paddingTop)
  const baseline = top + (lineH - size * (ASC + DESC)) / 2 + size * ASC
  return {
    s,
    x: x / zoom,
    baseline: baseline / zoom,
    lineH: lineH / zoom,
    align,
    font: `${s.fontStyle} ${s.fontWeight} ${size / zoom}px ${s.fontFamily}`,
  }
}

const CASES: { [name: string]: Case } = {
  'plain text': { value: 'Hello' },
  'a tall row': { value: 'Hello', h: 40 },
  'its own font size': { value: 'Big', fmt: { fontSize: 20 }, h: 32 },
  'bold italic': { value: 'Bold', fmt: { bold: true, italic: true } },
  'a font family': { value: 'Serif', fmt: { fontFamily: 'Georgia, serif' } },
  'centre alignment': { value: 'Mid', fmt: { align: 'center' } },
  'right alignment': { value: 'End', fmt: { align: 'right' } },
  'a number (right by default)': { value: '1234' },
  'top alignment': { value: 'Top', fmt: { valign: 'top' }, h: 40 },
  'bottom alignment': { value: 'Bottom', fmt: { valign: 'bottom' }, h: 40 },
  'wrapped text': { value: 'Wrap me', fmt: { textWrap: 'wrap' }, h: 40 },
  'wrapped text, top': { value: 'Wrap me', fmt: { textWrap: 'wrap', valign: 'top' }, h: 40 },
  'wrapped text, bottom': { value: 'Wrap me', fmt: { textWrap: 'wrap', valign: 'bottom' }, h: 40 },
  'two lines': { value: 'one\ntwo', h: 40 },
  'two lines, centred, 18px': { value: 'one\ntwo', fmt: { align: 'center', fontSize: 18 }, h: 50 },
  'zoom 0.8': { value: 'Small', zoom: 0.8 },
  'zoom 1.5, 18px, right': { value: 'Zoomed', fmt: { fontSize: 18, align: 'right' }, zoom: 1.5 },
  'zoom 2, 60px': { value: 'Huge', fmt: { fontSize: 60 }, h: 80, zoom: 2 },
  'a merged cell, centred': {
    value: 'Title',
    fmt: { align: 'center' },
    merge: { colSpan: 2, rowSpan: 2 } as MergeInfo,
  },
  'a filter header, right': { value: 'Col', fmt: { align: 'right' }, rightInset: 19 },
}

describe('the in-cell editor draws text where the grid does', () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(name, () => {
      const draws = paint(c)
      const ed = edit(c)
      expect(draws.length).toBeGreaterThan(0)
      // Same font, size, weight and style.
      expect(ed.font.replace(/\s+/g, ' ')).toBe(draws[0].font.replace(/\s+/g, ' '))
      // Same horizontal anchor and alignment.
      expect(ed.align).toBe(draws[0].align)
      expect(ed.x).toBeCloseTo(draws[0].x, 5)
      // First line on the same baseline; later lines at the same pitch.
      expect(ed.baseline).toBeCloseTo(draws[0].baseline, 5)
      draws.slice(1).forEach((d, i) => {
        expect(ed.baseline + (i + 1) * ed.lineH).toBeCloseTo(d.baseline, 5)
      })
    })
  }

  it('draws with the optical size the canvas uses', () => {
    // A `font` shorthand on the textarea would reset font-variation-settings.
    expect(edit({ value: 'x' }).s.cssText).not.toMatch(/(^|;)\s*font:/)
    // The canvas draws the unzoomed size and scales it, so a variable font
    // picks the unzoomed size's design; the editor pins the same one.
    const { s } = edit({ value: 'x', fmt: { fontSize: 20 }, zoom: 1.25 })
    expect(s.getPropertyValue('font-variation-settings')).toBe('"opsz" 20')
  })

  it('takes the grid’s own optical size when it sets one', () => {
    document.body.style.setProperty('font-variation-settings', '"opsz" 24')
    const { s } = edit({ value: 'x' })
    expect(s.getPropertyValue('font-variation-settings')).toBe('inherit')
    document.body.style.removeProperty('font-variation-settings')
  })

  it('keeps the first line put while typing more lines', () => {
    const overlay = createOverlay(document.body)
    overlay.position(50, 24, 100, 40, {}, 1)
    overlay.show('one')
    const before = overlay.el.style.paddingTop
    overlay.el.value = 'one\ntwo'
    overlay.el.dispatchEvent(new Event('input'))
    expect(overlay.el.style.paddingTop).toBe(before)
  })
})
