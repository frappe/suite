// A number that does not fit its cell is rounded to fit, or shown as ###.
// It never spills into a neighbour, where its leading digits were cut off.
import { describe, expect, it } from 'vitest'

import { createCellPainter } from './painters/cell-painter.js'
import { createMockCtx, createMockGeo } from './painters/test-utils.js'

const CHAR_WIDTH = 7

// Paints A1 holding `value` in a 100px column, B1 empty; returns what was drawn.
function paint(value: string, isNumber: boolean) {
  const ctx = createMockCtx()
  ctx.measureText = (text: string) => ({ width: text.length * CHAR_WIDTH })
  const drawn: string[] = []
  ctx.fillText = (text: string) => drawn.push(text)
  const painter = createCellPainter(ctx, createMockGeo())
  painter.drawRegionCells(
    0,
    0,
    0,
    1,
    (id: string) => (id === 'A1' ? value : ''),
    {
      getStyle: () => ({}),
      isNumber: (id: string) => id === 'A1' && isNumber,
    },
    null,
  )
  return drawn
}

describe('a number wider than its cell', () => {
  it('keeps a number that fits as it is', () => {
    expect(paint('3135334.34', true)).toEqual(['3135334.34'])
  })

  it('rounds a long decimal to the places that fit', () => {
    // 92px of room fits 13 characters.
    expect(paint('3135334.340000009', true)).toEqual(['3135334.34'])
    expect(paint('1070260.689999999', true)).toEqual(['1070260.69'])
  })

  it('shows # when even the whole number does not fit', () => {
    const [shown] = paint('31353343400000000', true)
    expect(shown).toMatch(/^#+$/)
  })

  it('shows # for a formatted number that does not fit', () => {
    const [shown] = paint('$3,135,334,340,000.00', true)
    expect(shown).toMatch(/^#+$/)
  })

  it('still lets long text spill into an empty neighbour', () => {
    expect(paint('Quarterly budget summary', false)).toEqual(['Quarterly budget summary'])
  })
})
