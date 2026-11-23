import { fromPartial } from '@total-typescript/shoehorn'
// Starting or ending an edit must not move a cell's text: the in-cell editor
// lays its text out exactly where the cell painter draws it. Each case paints
// a cell with the real painter on a recording context, opens the overlay on
// the same cell, and compares font, text edge, baseline and line pitch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { COLORS } from './constants.js'
import type { EditorFormat } from './input/editor.js'
import { createOverlay } from './overlay.js'
import { createCellPainter } from './painters/cell-painter.js'
import { cellBox, cellText } from './painters/cell-text-box.js'
import { createMockCtx, createMockGeo } from './painters/test-utils.js'
import type { CellFormat, CondFormat, MergeInfo } from './types.js'

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
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

interface Draw {
  text: string
  x: number
  baseline: number // alphabetic, in logical px
  align: string
  font: string
  ink: string
}

interface Case {
  value: string
  fmt?: CellFormat
  /** What a conditional-formatting rule gives the cell. */
  cond?: CondFormat
  h?: number
  w?: number
  zoom?: number
  merge?: MergeInfo
  rightInset?: number
}

// A1 (logical x 50, y 24) and the provider the painter and the editor both
// read it through.
function sheet({ fmt = {}, cond, h = 24, w = 100, merge, rightInset = 0 }: Case) {
  const geo = createMockGeo({ colWidths: { 0: w }, rowHeights: { 0: h } })
  const cells = {
    getStyle: () => fmt,
    getMergeInfo: () => merge ?? null,
    getCondFormat: () => cond ?? null,
    getRightInset: () => rightInset,
  }
  return { geo, cells }
}

// The painter's text draws for A1.
function paint(c: Case): Draw[] {
  const { geo, cells } = sheet(c)
  const ctx = createMockCtx()
  ctx.measureText = fromPartial(measureFor(ctx))
  const draws: Draw[] = []
  ctx.fillText = (text: string, x: number, y: number) => {
    const size = sizeOf(ctx.font)
    const shift =
      ctx.textBaseline === 'top'
        ? EM_ASC * size
        : ctx.textBaseline === 'bottom'
          ? -EM_DESC * size
          : 0
    draws.push({
      text,
      x,
      baseline: y + shift,
      align: ctx.textAlign,
      font: ctx.font,
      ink: ctx.fillStyle,
    })
  }
  const painter = createCellPainter(fromPartial(ctx), fromPartial(geo))
  painter.drawRegionCells(0, 0, 0, 0, () => c.value, cells, null)
  return draws
}

// Opens the overlay on A1 the way the editor does, editing the cell's own
// value: on the box the painter draws the cell in, with the format and
// alignment it draws the text with. Returns where its text sits, in
// logical px.
function edit(c: Case) {
  const { value, zoom = 1 } = c
  const { geo, cells } = sheet(c)
  const box = cellBox(0, 0, cells.getMergeInfo(), geo)
  const text = cellText('A1', value, cells.getStyle(), cells.getCondFormat(), cells)
  const editorFmt: EditorFormat = {
    ...text.fmt,
    align: text.align,
    insetLeft: text.iconInset,
    insetRight: text.rightInset,
  }
  const overlay = createOverlay(document.body)
  overlay.position(box.x, box.y, box.w, box.h, editorFmt, zoom)
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

const CASES = {
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
  'text wrapped onto two lines': {
    value: 'Wrap me please now',
    fmt: { textWrap: 'wrap' },
    w: 80,
    h: 54,
  },
  'two lines': { value: 'one\ntwo', h: 40 },
  'two lines, centred, 18px': { value: 'one\ntwo', fmt: { align: 'center', fontSize: 18 }, h: 50 },
  'zoom 0.8': { value: 'Small', zoom: 0.8 },
  'zoom 1.5, 18px, right': { value: 'Zoomed', fmt: { fontSize: 18, align: 'right' }, zoom: 1.5 },
  'zoom 2, 60px': { value: 'Huge', fmt: { fontSize: 60 }, h: 80, zoom: 2 },
  // 20 letters 7.7px wide fill the 154px between the text edges exactly, so
  // the painter draws one line. At zoom 0.8, (162 × 0.8) / 0.8 is
  // 161.99999999999997: a width zoomed and divided back is too narrow.
  'wrapped text that fills the cell, zoom 0.8': {
    value: 'x'.repeat(20),
    fmt: { textWrap: 'wrap', fontSize: 14 },
    w: 162,
    h: 40,
    zoom: 0.8,
  },
  'a merged cell, centred': {
    value: 'Title',
    fmt: { align: 'center' },
    merge: fromPartial<MergeInfo>({ colSpan: 2, rowSpan: 2 }),
  },
  'a filter header, right': { value: 'Col', fmt: { align: 'right' }, rightInset: 19 },
  'a conditional format, bold': { value: 'Flag', cond: { bold: true } },
  'a conditional-format icon': { value: 'Up', cond: { icon: { shape: 'arrow-up' } } },
  'an icon and a filter button, centred': {
    value: 'Mid',
    fmt: { align: 'center' },
    cond: { icon: { shape: 'arrow-up' } },
    rightInset: 19,
  },
} satisfies { [name: string]: Case }

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
    // A `font` shorthand on the textarea would reset the font settings that
    // it, like the canvas, inherits from the grid.
    expect(edit({ value: 'x' }).s.cssText).not.toMatch(/(^|;)\s*font:/)
    // The canvas draws the unzoomed size and scales it, so a variable font
    // picks the unzoomed size's design; the editor pins the same one.
    const { s } = edit({ value: 'x', fmt: { fontSize: 20 }, zoom: 1.25 })
    expect(s.getPropertyValue('font-variation-settings')).toBe('"opsz" 20')
  })

  it('writes in the ink and on the fill the grid draws', () => {
    // A dark fill (from the fill picker or a colour scale) gets light ink,
    // and a link is blue. The grid doesn't paint the legacy `bg`, so the
    // editor neither fills with it nor reads its ink off it.
    const colour = (c: string) => {
      const probe = document.createElement('i')
      probe.style.color = c
      return probe.style.color
    }
    const cases: [CellFormat, string][] = [
      [{ backgroundColor: '#1e3a8a' }, '#1e3a8a'],
      [{ hyperlink: 'https://frappe.io' }, COLORS.white],
      [{ bg: '#1e3a8a' }, COLORS.white],
    ]
    for (const [fmt, fill] of cases) {
      const draw = paint({ value: 'x', fmt })[0]
      const { s } = edit({ value: 'x', fmt })
      expect(s.color).toBe(colour(draw.ink))
      expect(s.backgroundColor).toBe(colour(fill))
    }
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

// On a real page the browser snaps the editor's 1.5px border to whole device
// pixels, places a line's baseline with its own rounding, and the grid can
// sit between device pixels. Fake that layout and check the text still lands
// where the canvas puts it: same text edge, and the first baseline on the
// device pixel the canvas rounds its baseline to.
describe('on a laid-out page', () => {
  const PAGE_TOP = 73 // grid's top in the page, CSS px

  // The browser's baseline in a line box, as Chrome lays a line out: it
  // rounds the font's ascent and descent to whole device pixels and puts
  // half the leading above the ascent, rounded down to a whole device pixel
  // (13px text in a 16px line has it 13 device px down at 1x, 16 at 1.25x,
  // 19 at 1.5x, 25 at 2x). So the baseline moves in whole device pixels, and
  // a line box shrunk by less than two device pixels can keep it in place.
  const browserBaseline = (lineH: number, size: number, dpr: number) => {
    const ascent = Math.round(size * ASC * dpr)
    const descent = Math.round(size * DESC * dpr)
    return (Math.floor((lineH * dpr - ascent - descent) / 2) + ascent) / dpr
  }

  // The device row the canvas draws a baseline on: Chrome keeps the canvas's
  // scale (dpr × zoom) and maps the baseline through it in single precision,
  // then rounds to the nearest row.
  const canvasRow = (baseline: number, k: number) =>
    Math.floor(Math.fround(Math.fround(k) * Math.fround(baseline)) + 0.5)

  function layOut(dpr: number) {
    vi.stubGlobal('devicePixelRatio', dpr)
    const realStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((elt, pseudo) => {
      const cs = realStyle(elt, pseudo)
      if (!(elt instanceof HTMLTextAreaElement)) return cs
      // Chrome draws a border at least 1 device px, rounded down.
      const set = parseFloat(elt.style.borderWidth)
      const used = Math.max(1, Math.floor(set * dpr)) / dpr
      return fromPartial<CSSStyleDeclaration>({ borderTopWidth: used + 'px' })
    })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(16)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      let top = 0
      if (this === document.body) top = PAGE_TOP
      const probe: HTMLElement | null = this.parentElement
      if (this.tagName === 'SPAN' && probe?.getAttribute('aria-hidden') === 'true')
        top = browserBaseline(
          parseFloat(probe.style.lineHeight),
          parseFloat(probe.style.fontSize),
          dpr,
        )
      return fromPartial<DOMRect>({
        top,
        left: 0,
        right: 0,
        bottom: top,
        width: 0,
        height: 0,
        x: 0,
        y: top,
      })
    })
    return (set: number) => Math.max(1, Math.floor(set * dpr)) / dpr
  }

  const LAID_OUT = {
    'plain text': { value: 'Hello' },
    'right alignment': { value: 'End', fmt: { align: 'right' } },
    'top alignment': { value: 'Top', fmt: { valign: 'top' }, h: 40 },
    '18px, centred': { value: 'Mid', fmt: { fontSize: 18, align: 'center' }, h: 32 },
    'two lines': { value: 'one\ntwo', h: 40 },
    // Text that draws its baseline higher than a full line box allows: the
    // editor shrinks its line box to lift the baseline.
    '24px in a 28px row': { value: 'Big', fmt: { fontSize: 24 }, h: 28 },
    'top alignment, 24px': { value: 'Top', fmt: { valign: 'top', fontSize: 24 }, h: 40 },
    'top alignment, 36px': { value: 'Top', fmt: { valign: 'top', fontSize: 36 }, h: 56 },
  } satisfies { [name: string]: Case }

  function expectOnCanvasPixels(c: Case, dpr: number, zoom: number) {
    const usedBorder = layOut(dpr)
    const draw = paint(c)[0]
    const { s } = edit({ ...c, zoom })
    const used = usedBorder(px(s.borderTopWidth))
    // Text edge: where the textarea's content box starts or ends.
    const left = px(s.left) + used + px(s.paddingLeft)
    const right = px(s.left) + px(s.width) - used - px(s.paddingRight)
    const edge =
      s.textAlign === 'right' ? right : s.textAlign === 'center' ? (left + right) / 2 : left
    expect(edge).toBeCloseTo(draw.x * zoom, 5)
    // Baseline: the browser draws the editor's on the device pixel it falls
    // in; the canvas rounds its own to the nearest one.
    const lineH = px(s.lineHeight)
    const editorBase =
      (PAGE_TOP +
        px(s.top) +
        used +
        px(s.paddingTop) +
        browserBaseline(lineH, px(s.fontSize), dpr)) *
      dpr
    const canvasBase = Math.round(PAGE_TOP * dpr) + canvasRow(draw.baseline, dpr * zoom)
    expect(editorBase - canvasBase).toBeGreaterThanOrEqual(0)
    expect(editorBase - canvasBase).toBeLessThan(0.5)
  }

  for (const dpr of [1, 1.25, 1.5, 2]) {
    for (const zoom of [1, 1.25]) {
      for (const [name, c] of Object.entries(LAID_OUT)) {
        it(`${name} at ${dpr}x, zoom ${zoom}`, () => expectOnCanvasPixels(c, dpr, zoom))
      }
    }
  }

  it('a baseline on an exact half device pixel at 1x, zoom 0.7', () => {
    // 10px text at the bottom of a 27px row has its baseline at logical 45.
    // The canvas maps that to 0.7 × 45 = 31.5 and rounds up; the same sum
    // from the zoomed numbers in double precision is 31.4999…
    const c: Case = { value: 'Low', fmt: { valign: 'bottom', fontSize: 10 }, h: 27 }
    expectOnCanvasPixels(c, 1, 0.7)
  })
})
