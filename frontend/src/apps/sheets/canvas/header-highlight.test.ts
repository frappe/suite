// Headers of a selection step up with it: the active row / column gets the
// strongest tint and full ink, the rest of the range a lighter tint and
// mid ink, and headers outside the selection stay plain.
import { describe, expect, it } from 'vitest'

import { COL_HEADER_H, COLORS } from './constants.js'
import { createHeaderPainter } from './painters/header-painter.js'
import { createMockCtx, createMockGeo } from './painters/test-utils.js'

// Paints rows 1–4 with B2:B3 selected (anchor B2); returns each row label's
// tint and ink.
function rowHeaders() {
  const ctx = createMockCtx()
  const tint: Record<string, string> = {}
  const ink: Record<string, string> = {}
  ctx.fillRect = (_x: number, y: number) => {
    tint[Math.round((y - COL_HEADER_H) / 24) + 1] = String(ctx.fillStyle)
  }
  ctx.fillText = (text: string) => {
    ink[text] = String(ctx.fillStyle)
  }
  const hp = createHeaderPainter(ctx, createMockGeo())
  hp.drawRowHeaders(
    0,
    3,
    0,
    COL_HEADER_H,
    600,
    { r: 1, c: 1 },
    { r0: 1, c0: 1, r1: 2, c1: 1 },
    'cell',
  )
  return { tint, ink }
}

describe('selection headers', () => {
  it('tints the active row header strongest, with full ink', () => {
    const { tint, ink } = rowHeaders()
    expect(tint['2']).toBe(COLORS.activeHeader)
    expect(ink['2']).toBe(COLORS.cellText)
  })

  it('gives the rest of the range a lighter tint and mid ink', () => {
    const { tint, ink } = rowHeaders()
    expect(tint['3']).toBe(COLORS.rangeHeader)
    expect(ink['3']).toBe(COLORS.rangeHeaderText)
  })

  it('leaves rows outside the selection plain', () => {
    const { ink } = rowHeaders()
    expect(ink['1']).toBe(COLORS.headerText)
    expect(ink['4']).toBe(COLORS.headerText)
  })
})
