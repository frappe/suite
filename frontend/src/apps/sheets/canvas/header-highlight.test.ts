// Every row and column header a selection covers is marked the same way, so
// the selection reads in the headers even after a drag: a grey tint and a
// dark semibold label. Headers outside the selection stay plain.
import { describe, expect, it } from 'vitest'

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
