// Regression harness for "conditional formatting in dark mode".
//
// A colour-scale rule interpolates literal hex stops, so its fills stay pale
// whichever theme is on. The cell ink resolves `--ink-gray-9`, which dark mode
// turns near-white. The two together painted white numbers on a white cell.
//
// Dark mode here is the real thing: the tokens the canvas reads are set on
// <html> to their dark-theme values, exactly as frappe-ui does at runtime.
import { describe, it, expect, beforeEach } from 'vitest'
import { createMockCtx, createMockGeo } from './painters/test-utils.js'
import { createCellPainter } from './painters/cell-painter.js'

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
function inkPaintedFor({ value = '42', fmt = {}, condFmt = null as null | object }) {
  const ctx = createMockCtx()
  const painted: string[] = []
  ctx.fillText = (text: string) => { painted.push(String(ctx.fillStyle)) }
  const painter = createCellPainter(ctx, createMockGeo())
  painter.drawRegionCells(
    0, 0, 0, 0,
    () => value,               // getVal
    () => fmt,                 // getFormat
    null, null, null, null,    // merge, slave, comment, validation
    () => condFmt,             // getCondFormat
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
