// Underline and strikethrough on wrapped text, as in Google Sheets: every
// wrapped line gets its own line, as wide as that line's text.
import { describe, expect, it } from 'vitest'

import { createCellPainter } from './painters/cell-painter.js'
import { createMockCtx, createMockGeo } from './painters/test-utils.js'
import type { CellFormat, MergeInfo } from './types.js'

// 7px per character, so a 100px column (92px usable) wraps
// "strikethrough lines" into "strikethrough" (91px) and "lines" (35px).
const VALUE = 'strikethrough lines'

interface Segment {
  x0: number
  x1: number
  y: number
}

// Paints A1 in a 60px-tall row and returns the horizontal lines stroked.
function linesPaintedFor(fmt: CellFormat, value = VALUE, merge: MergeInfo | null = null) {
  const ctx = createMockCtx()
  ctx.measureText = (t: string) => ({ width: t.length * 7 })
  const segments: Segment[] = []
  let start: [number, number] | null = null
  ctx.moveTo = (x: number, y: number) => {
    start = [x, y]
  }
  ctx.lineTo = (x: number, y: number) => {
    if (start && start[1] === y) segments.push({ x0: start[0], x1: x, y })
    start = null
  }
  const painter = createCellPainter(ctx, createMockGeo({ rowHeights: { 0: 60 } }))
  painter.drawRegionCells(
    0,
    0,
    0,
    0,
    () => value,
    { getStyle: () => fmt, getMergeInfo: () => merge },
    null,
  )
  return segments
}

// Row 0 starts at y=24, is 60px tall; two 16px lines centre at y=46 and y=62.
// Strike sits 1px below a line's middle, underline 8px below.
const STRIKE_Y = [47, 63]
const UNDER_Y = [54, 70]

describe('decorations on wrapped text', () => {
  it('strikes through every wrapped line, at that line’s width', () => {
    expect(linesPaintedFor({ textWrap: 'wrap', strikethrough: true })).toEqual([
      { x0: 54, x1: 145, y: STRIKE_Y[0] },
      { x0: 54, x1: 89, y: STRIKE_Y[1] },
    ])
  })

  it('underlines every wrapped line', () => {
    expect(linesPaintedFor({ textWrap: 'wrap', underline: true })).toEqual([
      { x0: 54, x1: 145, y: UNDER_Y[0] },
      { x0: 54, x1: 89, y: UNDER_Y[1] },
    ])
  })

  it('draws both lines under each other when both are on', () => {
    const segs = linesPaintedFor({ textWrap: 'wrap', underline: true, strikethrough: true })
    expect(segs.map((s) => s.y).sort()).toEqual([...STRIKE_Y, ...UNDER_Y].sort())
  })

  it('follows centre alignment', () => {
    // Cell centre x=100: 91px line spans 54.5..145.5, 35px line 82.5..117.5.
    expect(linesPaintedFor({ textWrap: 'wrap', strikethrough: true, align: 'center' })).toEqual([
      { x0: 54.5, x1: 145.5, y: STRIKE_Y[0] },
      { x0: 82.5, x1: 117.5, y: STRIKE_Y[1] },
    ])
  })

  it('follows right alignment', () => {
    // Text ends 4px inside the cell's right edge (x=150).
    expect(linesPaintedFor({ textWrap: 'wrap', strikethrough: true, align: 'right' })).toEqual([
      { x0: 55, x1: 146, y: STRIKE_Y[0] },
      { x0: 111, x1: 146, y: STRIKE_Y[1] },
    ])
  })

  it('strikes each line of hard-newline text outside wrap mode', () => {
    expect(linesPaintedFor({ strikethrough: true }, 'alpha\nbeta')).toEqual([
      { x0: 54, x1: 89, y: STRIKE_Y[0] },
      { x0: 54, x1: 82, y: STRIKE_Y[1] },
    ])
  })

  it('wraps to the merged width in a merged cell', () => {
    // Two columns (192px usable) fit the whole value on one line.
    const merge: MergeInfo = { colSpan: 2, rowSpan: 1 }
    expect(linesPaintedFor({ textWrap: 'wrap', strikethrough: true }, VALUE, merge)).toEqual([
      { x0: 54, x1: 187, y: 55 },
    ])
  })
})
