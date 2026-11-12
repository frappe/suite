// Default alignment, as in Google Sheets: numbers right, text left. A number
// is known by its cell type, not its shown text, so `1,000`, `$1,000` and
// `50%` line up with plain `1000`.
import { describe, expect, it } from 'vitest'

import { createCellPainter } from './painters/cell-painter.js'
import { createMockCtx, createMockGeo } from './painters/test-utils.js'
import type { CellFormat } from './types.js'

// Paints one cell and reports the text alignment its text was drawn with.
function alignPaintedFor(value: string, isNumber?: boolean, fmt: CellFormat = {}) {
  const ctx = createMockCtx()
  const aligns: string[] = []
  ctx.fillText = () => {
    aligns.push(String(ctx.textAlign))
  }
  const painter = createCellPainter(ctx, createMockGeo())
  painter.drawRegionCells(
    0,
    0,
    0,
    0,
    () => value,
    { getStyle: () => fmt, isNumber: () => isNumber },
    null,
  )
  expect(aligns).toHaveLength(1)
  return aligns[0]
}

describe('default cell alignment', () => {
  it('right-aligns a number whatever its format shows', () => {
    expect(alignPaintedFor('1,000', true)).toBe('right')
    expect(alignPaintedFor('$1,000', true)).toBe('right')
    expect(alignPaintedFor('50%', true)).toBe('right')
  })

  it('left-aligns text, even text that looks like a number', () => {
    expect(alignPaintedFor('1,00', false)).toBe('left')
    expect(alignPaintedFor('12', false)).toBe('left')
  })

  it('guesses from the text when the type is not known yet', () => {
    expect(alignPaintedFor('1000', undefined)).toBe('right')
    expect(alignPaintedFor('abc', undefined)).toBe('left')
  })

  it('keeps an alignment the user chose', () => {
    expect(alignPaintedFor('1,000', true, { align: 'center' })).toBe('center')
    expect(alignPaintedFor('abc', false, { align: 'right' })).toBe('right')
  })
})
