import { describe, expect, it } from 'vitest'

import { placeBeside, type PlaceOptions } from './place-floating'

// 100 px columns and 24 px rows behind a 50 px row header and a 24 px column
// header, no scroll: what getCellRect reports.
const cellRect = (r: number, c: number) => ({
  x: 50 + 100 * c,
  y: 24 + 24 * r,
  width: 100,
  height: 24,
})

function place(values: string[], over: Partial<PlaceOptions> = {}) {
  const has = new Set(values)
  return placeBeside({
    source: { r0: 0, c0: 0, r1: 4, c1: 1 }, // A1:B5
    size: { width: 220, height: 300 },
    cellRect,
    hasValue: (r, c) => has.has(`${r},${c}`),
    view: { w: 1200, h: 700 },
    min: { x: 50, y: 24 },
    ...over,
  })
}

describe('placeBeside', () => {
  it('goes right of the source, level with its first row', () => {
    expect(place([])).toEqual({ x: 266, y: 24 })
  })

  it('moves right past every value it would cover', () => {
    // C1 and, further down the rows it covers, E9.
    expect(place(['0,2', '8,4'])).toEqual({ x: 50 + 500 + 16, y: 24 })
  })

  it('goes below, past values, when the right side does not fit', () => {
    // The view ends at x 400; A7 has a value under the first spot below.
    expect(place(['6,0'], { view: { w: 400, h: 2000 } })).toEqual({ x: 50, y: 24 + 24 * 7 + 16 })
  })

  it('stays inside the view when neither side fits', () => {
    expect(place([], { view: { w: 400, h: 300 } })).toEqual({ x: 180, y: 24 })
  })
})
