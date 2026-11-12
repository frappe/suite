// Every row and column header a selection covers is marked the same way, so
// the selection reads in the headers even after a drag: a grey tint and a
// dark semibold label. Headers outside the selection stay plain.
import { cssVariables } from 'frappe-ui/tailwind/tokens'
import { afterEach, describe, expect, it } from 'vitest'

import { COL_HEADER_H, COLORS } from './constants.js'
import { createHeaderPainter } from './painters/header-painter.js'
import { createMockCtx, createMockGeo } from './painters/test-utils.js'

// Paints rows 1–4 with B2:B3 selected; returns each row label's
// tint, ink and font.
function rowHeaders() {
  const ctx = createMockCtx()
  const tint: Record<string, string> = {}
  const ink: Record<string, string> = {}
  const font: Record<string, string> = {}
  ctx.fillRect = (_x: number, y: number) => {
    tint[Math.round((y - COL_HEADER_H) / 24) + 1] = String(ctx.fillStyle)
  }
  ctx.fillText = (text: string) => {
    ink[text] = String(ctx.fillStyle)
    font[text] = ctx.font
  }
  const hp = createHeaderPainter(ctx, createMockGeo())
  const range = { r0: 1, c0: 1, r1: 2, c1: 1 }
  hp.drawRowHeaders(0, 3, 0, COL_HEADER_H, 600, range)
  return { tint, ink, font }
}

describe('selection headers', () => {
  it('marks every header the range covers the same way', () => {
    const { tint, ink, font } = rowHeaders()
    for (const row of ['2', '3']) {
      expect(tint[row], `row ${row}`).toBe(COLORS.activeHeader)
      expect(ink[row], `row ${row}`).toBe(COLORS.cellText)
      expect(font[row], `row ${row}`).toMatch(/^600 /)
    }
  })

  it('leaves rows outside the selection plain', () => {
    const { ink, font } = rowHeaders()
    for (const row of ['1', '4']) {
      expect(ink[row], `row ${row}`).toBe(COLORS.headerText)
      expect(font[row], `row ${row}`).not.toMatch(/^600 /)
    }
  })
})

// Paints rows 1–4 and columns A–D with B2:C3 selected; returns the colour of
// the separator after each header (the stroke that follows its label).
function separators() {
  const ctx = createMockCtx()
  const rows: Record<string, string> = {}
  const cols: Record<string, string> = {}
  let last = ''
  ctx.fillText = (text: string) => void (last = text)
  ctx.stroke = () => {
    if (!last) return
    if (/^\d+$/.test(last)) rows[last] = String(ctx.strokeStyle)
    else cols[last] = String(ctx.strokeStyle)
    last = ''
  }
  const hp = createHeaderPainter(ctx, createMockGeo())
  const range = { r0: 1, c0: 1, r1: 2, c1: 2 }
  hp.drawRowHeaders(0, 3, 0, COL_HEADER_H, 600, range)
  hp.drawColHeaders(0, 3, 0, 50, 600, range)
  return { rows, cols }
}

// Puts frappe-ui's token values for a theme on <html>, the way its stylesheet
// does: light on :root, dark over it. Without them every colour reads its hex
// fallback, and the tint and separator fallbacks always differ, so the check
// would pass without testing anything.
const style = document.documentElement.style
function applyTheme(theme: 'light' | 'dark'): void {
  const vars =
    theme === 'light' ? cssVariables.light : { ...cssVariables.light, ...cssVariables.dark }
  for (const [name, value] of Object.entries(vars)) style.setProperty(name, String(value))
}

describe('the grid\u2019s quiet colours', () => {
  afterEach(() => {
    style.cssText = ''
  })

  it.each(['light', 'dark'] as const)('read the design tokens in %s mode', (theme) => {
    applyTheme(theme)
    const token = (name: string) => style.getPropertyValue(name).trim()
    expect(COLORS.headerBg).toBe(token('--surface-base'))
    expect(COLORS.gridLine).toBe(token('--outline-gray-1'))
    expect(COLORS.activeHeader).toBe(token('--surface-gray-2'))
  })

  it.each(['light', 'dark'] as const)('keep gridlines off the background in %s mode', (theme) => {
    applyTheme(theme)
    expect(COLORS.gridLine).not.toBe(COLORS.white)
  })
})

describe('separators between selected headers', () => {
  afterEach(() => {
    style.cssText = ''
  })

  it.each(['light', 'dark'] as const)('stay visible on the tint in %s mode', (theme) => {
    applyTheme(theme)
    const { rows, cols } = separators()
    for (const line of [rows['2'], rows['3'], cols['B'], cols['C']]) {
      expect(line).toBe(COLORS.activeHeaderLine)
      expect(line).not.toBe(COLORS.activeHeader)
    }
  })

  it('match the plain gridline in light mode', () => {
    applyTheme('light')
    expect(separators().rows['2']).toBe(cssVariables.light['--outline-gray-1'])
  })

  it('stay the plain gridline colour outside the selection', () => {
    const { rows, cols } = separators()
    for (const row of ['1', '4']) expect(rows[row], `row ${row}`).toBe(COLORS.gridLine)
    for (const col of ['A', 'D']) expect(cols[col], `col ${col}`).toBe(COLORS.gridLine)
  })
})

// A header's separator is drawn on the first pixel of the next header, so a
// selected header's tint must start after it or it paints over the line.
describe('selected header tint', () => {
  function tints() {
    const ctx = createMockCtx()
    const rects: [number, number, number, number][] = []
    ctx.fillRect = (...r: [number, number, number, number]) => {
      if (ctx.fillStyle === COLORS.activeHeader) rects.push(r)
    }
    const hp = createHeaderPainter(ctx, createMockGeo())
    const range = { r0: 1, c0: 1, r1: 2, c1: 2 }
    hp.drawColHeaders(0, 3, 0, 50, 600, range)
    hp.drawRowHeaders(0, 3, 0, COL_HEADER_H, 600, range)
    return rects
  }

  it('leaves the separator on its left edge uncovered', () => {
    // Columns B and C start at x 150 and 250 (their left separators' pixels);
    // rows 2 and 3 start at y 48 and 72.
    const [b, c, row2, row3] = tints()
    expect([b[0], b[2]]).toEqual([151, 99])
    expect([c[0], c[2]]).toEqual([251, 99])
    expect([row2[1], row2[3]]).toEqual([49, 23])
    expect([row3[1], row3[3]]).toEqual([73, 23])
  })
})
