// Text is centred on what the eye sees: the cell's white area below its
// gridline (y+1 … y+h), with the capitals' middle on that centre. The
// painters draw on the alphabetic baseline at centre + capHeight / 2.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { COL_HEADER_H, ROW_HEADER_W } from './constants.js'
import { createCellPainter } from './painters/cell-painter.js'
import { createHeaderPainter } from './painters/header-painter.js'
import { createMockCtx, createMockGeo } from './painters/test-utils.js'
import { createCapHeight } from './painters/text-anchor.js'
import type { CellFormat } from './types.js'

// Cap height the mock context reports for every font.
const CAP = 9

interface Draw {
  text: string
  y: number
  baseline: string
}

function recordingCtx() {
  const ctx = createMockCtx()
  const draws: Draw[] = []
  ctx.measureText = (t: string) => ({ width: t.length * 7, actualBoundingBoxAscent: CAP })
  ctx.fillText = (text: string, _x: number, y: number) => {
    draws.push({ text, y, baseline: String(ctx.textBaseline) })
  }
  return { ctx, draws }
}

// Where the middle of the capitals lands, from a recorded draw.
function capCentre(d: Draw): number {
  expect(d.baseline).toBe('alphabetic')
  return d.y - CAP / 2
}

// Paints A1 (top y = 24) at row height h; returns its text draws.
function paintA1(h: number, value: string, fmt: CellFormat = {}) {
  const { ctx, draws } = recordingCtx()
  const painter = createCellPainter(ctx, createMockGeo({ rowHeights: { 0: h } }))
  painter.drawRegionCells(0, 0, 0, 0, () => value, { getStyle: () => fmt }, null)
  return draws
}

describe('cell text centring', () => {
  for (const h of [21, 24, 25, 28]) {
    it(`centres digits on the white area of a ${h}px row`, () => {
      const [d] = paintA1(h, '123')
      // Gridline on y=24; white rows 25 … 24+h-1, centre 24 + (h+1)/2.
      expect(capCentre(d)).toBe(24 + (h + 1) / 2)
    })
  }

  it('centres a 24px row on y + 12.5, half a pixel below the old y + 12', () => {
    expect(capCentre(paintA1(24, 'abc')[0])).toBe(36.5)
  })

  it('keeps top and bottom alignment 4px from the cell edge', () => {
    const [top] = paintA1(40, 'x', { valign: 'top' })
    expect(top).toMatchObject({ y: 28, baseline: 'top' })
    const [bottom] = paintA1(40, 'x', { valign: 'bottom' })
    expect(bottom).toMatchObject({ y: 60, baseline: 'bottom' })
  })

  it('measures the cap height from the alphabetic baseline', () => {
    // Like a real canvas: glyph bounds are relative to the current baseline,
    // and the cell pass starts with 'middle'.
    const { ctx, draws } = recordingCtx()
    ctx.measureText = (t: string) => ({
      width: t.length * 7,
      actualBoundingBoxAscent: ctx.textBaseline === 'alphabetic' ? CAP : CAP / 2,
    })
    const painter = createCellPainter(ctx, createMockGeo())
    painter.drawRegionCells(0, 0, 0, 0, () => '42', { getStyle: () => ({}) }, null)
    expect(capCentre(draws[0])).toBe(36.5)
  })

  it('centres a dropdown chip’s label like plain text', () => {
    const { ctx, draws } = recordingCtx()
    Object.assign(ctx, { arcTo: () => {}, quadraticCurveTo: () => {}, roundRect: () => {} })
    const painter = createCellPainter(ctx, createMockGeo())
    const rule = { type: 'list', options: ['Yes', 'No'] }
    painter.drawRegionCells(
      0,
      0,
      0,
      0,
      () => 'Yes',
      { getStyle: () => ({}), getValidation: () => rule as never },
      null,
    )
    const label = draws.find((d) => d.text === 'Yes')!
    expect(capCentre(label)).toBe(36.5)
  })

  it('keeps underline and strike on pixel rows at any height', () => {
    for (const h of [21, 24, 25, 28]) {
      const { ctx } = recordingCtx()
      const ys: number[] = []
      ctx.moveTo = (_x: number, y: number) => void ys.push(y)
      const painter = createCellPainter(ctx, createMockGeo({ rowHeights: { 0: h } }))
      const fmt = { underline: true, strikethrough: true }
      painter.drawRegionCells(0, 0, 0, 0, () => 'abc', { getStyle: () => fmt }, null)
      expect(ys).toHaveLength(2)
      for (const y of ys) expect(y % 1, `h=${h} y=${y}`).toBe(0.5)
    }
  })

  it('centres a wrapped block on the white area', () => {
    // Two 16px lines in a 60px row: white area 25 … 84 (59px), block 32px,
    // so the lines' middles are at 25 + 13.5 + 8 = 46.5 and 62.5.
    const draws = paintA1(60, 'alpha\nbeta')
    expect(draws.map(capCentre)).toEqual([46.5, 62.5])
  })
})

describe('header label centring', () => {
  it('centres row numbers on the row’s white area', () => {
    for (const h of [21, 24, 28]) {
      const { ctx, draws } = recordingCtx()
      const hp = createHeaderPainter(ctx, createMockGeo({ rowHeights: { 0: h } }))
      const far = { r: 50, c: 50 }
      hp.drawRowHeaders(0, 0, 0, COL_HEADER_H, 600, far, { r0: 50, c0: 50, r1: 50, c1: 50 }, 'cell')
      const one = draws.find((d) => d.text === '1')!
      expect(capCentre(one)).toBe(COL_HEADER_H + (h + 1) / 2)
    }
  })

  it('centres column letters on the full header height', () => {
    const { ctx, draws } = recordingCtx()
    const hp = createHeaderPainter(ctx, createMockGeo())
    const far = { r: 50, c: 50 }
    hp.drawColHeaders(0, 0, 0, ROW_HEADER_W, 600, far, { r0: 50, c0: 50, r1: 50, c1: 50 }, 'cell')
    const a = draws.find((d) => d.text === 'A')!
    expect(capCentre(a)).toBe(COL_HEADER_H / 2)
  })
})

describe('cap height cache', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('re-measures until the web fonts have loaded, then keeps the value', () => {
    const fonts = { status: 'loading' }
    vi.stubGlobal('document', { ...document, fonts })
    const { ctx } = recordingCtx()
    let calls = 0
    ctx.measureText = () => ({ width: 0, actualBoundingBoxAscent: ++calls })
    const capHeight = createCapHeight(ctx as never)
    expect([capHeight(), capHeight()]).toEqual([1, 2])
    fonts.status = 'loaded'
    expect([capHeight(), capHeight()]).toEqual([3, 3])
  })
})
