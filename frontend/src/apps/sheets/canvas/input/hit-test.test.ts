import { describe, expect, it } from 'vitest'

import { createHitTester, type HitGeometry } from './hit-test.js'

// A geometry stub where every target is "hit" or not by flag, so each test
// can stack targets on one point and check which one wins.
function setup(
  targets: {
    colResize?: number
    rowResize?: number
    corner?: boolean
    colHeader?: number
    rowHeader?: number
    cell?: { r: number; c: number }
  } = {},
  fillCorner: { r: number; c: number } | null = null,
  zoom = 1,
) {
  const geo: HitGeometry = {
    hitTestColResize: () => targets.colResize ?? null,
    hitTestRowResize: () => targets.rowResize ?? null,
    hitTestCorner: () => targets.corner ?? false,
    hitTestColHeader: () => targets.colHeader ?? null,
    hitTestRowHeader: () => targets.rowHeader ?? null,
    hitTest: () => targets.cell ?? null,
    // 100 × 20 cells starting at (50, 24): cell (r, c) ends at
    // x = 150 + 100c, y = 44 + 20r.
    colX: (c) => 50 + c * 100,
    rowY: (r) => 24 + r * 20,
    cw: () => 100,
    rh: () => 20,
  }
  return createHitTester({ geo, getZoom: () => zoom, fillCorner: () => fillCorner })
}

const rect = { left: 0, top: 0 }

describe('hit tester — priority', () => {
  it('prefers a resize edge over the header it sits on', () => {
    expect(setup({ colResize: 2, colHeader: 2 }).at(0, 0, rect)).toEqual({
      kind: 'colResize',
      col: 2,
    })
    expect(setup({ rowResize: 4, rowHeader: 4 }).at(0, 0, rect)).toEqual({
      kind: 'rowResize',
      row: 4,
    })
  })

  it('skips resize edges for viewers, falling through to the header', () => {
    expect(setup({ colResize: 2, colHeader: 2 }).at(0, 0, rect, { resize: false })).toEqual({
      kind: 'colHeader',
      col: 2,
    })
  })

  it('prefers the fill handle over the cell under it', () => {
    // Selection ends at A1, whose bottom-right corner is (150, 44).
    const hits = setup({ cell: { r: 0, c: 0 } }, { r: 0, c: 0 })
    expect(hits.at(149, 43, rect)).toEqual({ kind: 'fillHandle' })
    expect(hits.at(149, 43, rect, { fill: false })).toEqual({ kind: 'cell', r: 0, c: 0 })
  })

  it('reports headers, the corner, a cell, or nothing', () => {
    expect(setup({ corner: true }).at(0, 0, rect)).toEqual({ kind: 'corner' })
    expect(setup({ rowHeader: 7 }).at(0, 0, rect)).toEqual({ kind: 'rowHeader', row: 7 })
    expect(setup({ cell: { r: 3, c: 1 } }).at(0, 0, rect)).toEqual({ kind: 'cell', r: 3, c: 1 })
    expect(setup().at(0, 0, rect)).toEqual({ kind: 'none' })
  })
})

describe('hit tester — fill handle', () => {
  it('grabs within 6 px of the corner, not beyond', () => {
    const hits = setup({}, { r: 0, c: 0 })
    expect(hits.onFillHandle(150 + 6, 44, rect)).toBe(true)
    expect(hits.onFillHandle(150 + 7, 44, rect)).toBe(false)
  })

  it('has no handle when there is no fill corner (editor open)', () => {
    expect(setup({}, null).onFillHandle(150, 44, rect)).toBe(false)
  })

  it('accounts for zoom and the canvas offset', () => {
    // At zoom 2 the corner (150, 44) appears at screen (300, 88), plus
    // the canvas sitting at (10, 20) on the page.
    const hits = setup({}, { r: 0, c: 0 }, 2)
    expect(hits.onFillHandle(310, 108, { left: 10, top: 20 })).toBe(true)
  })
})
