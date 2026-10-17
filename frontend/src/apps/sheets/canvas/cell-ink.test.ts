// Regression harness for "conditional formatting in dark mode".
//
// A colour-scale rule interpolates literal hex stops, so its fills stay pale
// whichever theme is on. The cell ink resolves `--ink-gray-9`, which dark mode
// turns near-white. The two together painted white numbers on a white cell.
//
// Dark mode here is the real thing: the tokens the canvas reads are set on
// <html> to their dark-theme values, exactly as frappe-ui does at runtime.
import { beforeEach, describe, expect, it } from 'vitest'

import { createCellPainter } from './painters/cell-painter.js'
import { createMockCtx, createMockGeo } from './painters/test-utils.js'
import type { CellFormat, CondFormat } from './types.js'

const DARK_TOKENS = {
  '--ink-gray-9': '#f5f5f5', // near-white: dark mode's default cell ink
  '--surface-base': '#1f1f1f',
}
const LIGHT_TOKENS = {
  '--ink-gray-9': '#171717',
  '--surface-base': '#ffffff',
}
// Theme-independent inks the painter picks from when a cell carries a fill.
const INK_ON_LIGHT = '#101010'
const INK_ON_DARK = '#fafafa'

function setTheme(tokens: Record<string, string>) {
  const root = document.documentElement
  root.removeAttribute('style')
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v)
  root.style.setProperty('--gray-950', INK_ON_LIGHT)
  root.style.setProperty('--gray-50', INK_ON_DARK)
}

// Paints one cell and reports the fill style in force when its text was drawn.
function inkPaintedFor({
  value = '42',
  fmt = {} as CellFormat,
  condFmt = null as null | CondFormat,
}) {
  const ctx = createMockCtx()
  const painted: string[] = []
  ctx.fillText = (text: string) => {
    painted.push(String(ctx.fillStyle))
  }
  const painter = createCellPainter(ctx, createMockGeo())
  painter.drawRegionCells(
    0,
    0,
    0,
    0,
    () => value,
    {
      getStyle: () => fmt,
      getCondFormat: () => condFmt,
    },
    null,
  )
  expect(painted).toHaveLength(1)
  return painted[0]
}

describe('cell text stays readable on a fill', () => {
  beforeEach(() => document.documentElement.removeAttribute('style'))

  it('darkens the ink over a pale colour-scale fill in dark mode', () => {
    setTheme(DARK_TOKENS)
    expect(inkPaintedFor({ condFmt: { backgroundColor: '#e8f1f5' } })).toBe(INK_ON_LIGHT)
    expect(inkPaintedFor({ condFmt: { backgroundColor: '#ffffff' } })).toBe(INK_ON_LIGHT)
  })

  it('lightens the ink over a deep colour-scale fill in light mode', () => {
    setTheme(LIGHT_TOKENS)
    expect(inkPaintedFor({ condFmt: { backgroundColor: '#0e7490' } })).toBe(INK_ON_DARK)
  })

  it('picks the same ink for the same fill in either theme', () => {
    setTheme(LIGHT_TOKENS)
    const light = inkPaintedFor({ condFmt: { backgroundColor: '#b8d8e2' } })
    setTheme(DARK_TOKENS)
    expect(inkPaintedFor({ condFmt: { backgroundColor: '#b8d8e2' } })).toBe(light)
  })

  it('treats a fill from the fill picker the same as one from a rule', () => {
    setTheme(DARK_TOKENS)
    expect(inkPaintedFor({ fmt: { backgroundColor: '#fff3b0' } })).toBe(INK_ON_LIGHT)
  })

  it('lets a conditional fill override the cell own fill, as the paint does', () => {
    setTheme(LIGHT_TOKENS)
    const fmt = { backgroundColor: '#ffffff' }
    expect(inkPaintedFor({ fmt, condFmt: { backgroundColor: '#0e7490' } })).toBe(INK_ON_DARK)
  })

  it('keeps the themed ink on an unfilled cell', () => {
    setTheme(DARK_TOKENS)
    expect(inkPaintedFor({})).toBe(DARK_TOKENS['--ink-gray-9'])
    setTheme(LIGHT_TOKENS)
    expect(inkPaintedFor({})).toBe(LIGHT_TOKENS['--ink-gray-9'])
  })

  it('keeps the themed ink when a rule sets no fill at all', () => {
    setTheme(DARK_TOKENS)
    const condFmt = { icon: { shape: 'arrow-up', color: '#16a34a' } }
    expect(inkPaintedFor({ condFmt })).toBe(DARK_TOKENS['--ink-gray-9'])
  })

  it('never overrides a text colour the user chose', () => {
    setTheme(DARK_TOKENS)
    const fmt = { color: '#d946ef' }
    expect(inkPaintedFor({ fmt, condFmt: { backgroundColor: '#ffffff' } })).toBe('#d946ef')
  })
})

// Paints row 0 with `fmt` on column `col` (A = 0) and every other cell empty
// and unfilled, text 400px wide (columns are 100px, column c starts at
// 50 + 100c). Reports each text draw's ink and the x-range it was clipped to.
function overflowDraws(fmt: CellFormat, col = 0) {
  const ctx = createMockCtx()
  ctx.measureText = () => ({ width: 400 })
  let clipX: [number, number] = [-Infinity, Infinity]
  const saved: [number, number][] = []
  ctx.save = () => saved.push(clipX)
  ctx.restore = () => (clipX = saved.pop() ?? [-Infinity, Infinity])
  let pending: [number, number] | null = null
  ctx.rect = (x: number, _y: number, w: number) => (pending = [x, x + w])
  ctx.clip = () => {
    if (pending) clipX = [Math.max(clipX[0], pending[0]), Math.min(clipX[1], pending[1])]
  }
  const draws: { ink: string; x0: number; x1: number }[] = []
  ctx.fillText = () => draws.push({ ink: String(ctx.fillStyle), x0: clipX[0], x1: clipX[1] })
  const painter = createCellPainter(ctx, createMockGeo())
  painter.drawRegionCells(
    0,
    0,
    0,
    5,
    (id) => (id === `${String.fromCharCode(65 + col)}1` ? 'a long line of text' : ''),
    { getStyle: (id) => (id === `${String.fromCharCode(65 + col)}1` ? fmt : {}) },
    null,
  )
  return draws
}

describe('overflow text from a filled cell', () => {
  beforeEach(() => setTheme(LIGHT_TOKENS))

  it('keeps the fill ink inside the cell and the normal ink over empty neighbours', () => {
    const draws = overflowDraws({ backgroundColor: '#262626' })
    expect(draws).toHaveLength(2)
    const inside = draws.find((d) => d.ink === INK_ON_DARK)
    const spill = draws.find((d) => d.ink === LIGHT_TOKENS['--ink-gray-9'])
    // A1 spans x 50..150; the spill starts at B1's left edge.
    expect(inside?.x1).toBeLessThanOrEqual(150)
    expect(spill?.x0).toBeGreaterThanOrEqual(150)
  })

  it('splits leftwards too for right-aligned text', () => {
    const draws = overflowDraws({ backgroundColor: '#262626', align: 'right' }, 4)
    // E1 spans x 450..550; its text spills left over D1, C1, B1.
    const inside = draws.find((d) => d.ink === INK_ON_DARK)
    const spill = draws.find((d) => d.ink === LIGHT_TOKENS['--ink-gray-9'])
    expect(inside?.x0).toBeGreaterThanOrEqual(450)
    expect(spill?.x1).toBeLessThanOrEqual(450)
  })

  it('draws once for an unfilled cell', () => {
    expect(overflowDraws({ bold: true })).toHaveLength(1)
  })

  it('draws once in a text colour the user chose', () => {
    const draws = overflowDraws({ backgroundColor: '#262626', color: '#d946ef' })
    expect(draws).toEqual([expect.objectContaining({ ink: '#d946ef' })])
  })
})
