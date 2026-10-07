import { describe, expect, it } from 'vitest'

import { createSelection, jumpEdge } from './selection.js'

// A 10 × 5 sheet (rows 0–9, cols 0–4).
const setup = () =>
  createSelection({
    clamp: (r, c) => ({ r: Math.max(0, Math.min(9, r)), c: Math.max(0, Math.min(4, c)) }),
    totalRows: () => 10,
    totalCols: () => 5,
  })

describe('selection', () => {
  it('starts on A1', () => {
    expect(setup().range()).toEqual({ r0: 0, c0: 0, r1: 0, c1: 0, mode: 'cell' })
  })

  it('normalises the range whichever way it was dragged', () => {
    const s = setup()
    s.moveTo(5, 3)
    s.extendTo(2, 1)
    expect(s.range()).toEqual({ r0: 2, c0: 1, r1: 5, c1: 3, mode: 'cell' })
    expect(s.anchor).toEqual({ r: 5, c: 3 }) // the active cell stays put
  })

  it('moveTo collapses to one cell and resets the mode', () => {
    const s = setup()
    s.mode = 'col'
    s.extendTo(4, 4)
    s.moveTo(3, 2)
    expect(s.range()).toEqual({ r0: 3, c0: 2, r1: 3, c1: 2, mode: 'cell' })
  })

  it('clamps to the sheet', () => {
    const s = setup()
    s.moveTo(-3, 99)
    expect(s.anchor).toEqual({ r: 0, c: 4 })
  })

  it('widens column, row and whole-sheet modes across the other axis', () => {
    const s = setup()
    s.moveTo(3, 2)
    s.mode = 'col'
    expect(s.range()).toEqual({ r0: 0, c0: 2, r1: 9, c1: 2, mode: 'col' })
    s.mode = 'row'
    expect(s.range()).toEqual({ r0: 3, c0: 0, r1: 3, c1: 4, mode: 'row' })
    s.mode = 'all'
    expect(s.range()).toEqual({ r0: 0, c0: 0, r1: 9, c1: 4, mode: 'all' })
  })

  it('set restores a range', () => {
    const s = setup()
    s.set({ r0: 1, c0: 1, r1: 4, c1: 3, mode: 'cell' })
    expect(s.range()).toEqual({ r0: 1, c0: 1, r1: 4, c1: 3, mode: 'cell' })
  })
})

describe('jumpEdge (Ctrl/Cmd+Arrow)', () => {
  // Column 0 has values in rows 2–5 and 8.
  const filled = new Set([2, 3, 4, 5, 8])
  const has = (r: number, c: number) => c === 0 && filled.has(r)
  const jump = (r: number, dr: number) => jumpEdge({ r, c: 0 }, dr, 0, has, 9, 4)

  it('runs to the end of a filled block', () => {
    expect(jump(2, 1)).toEqual({ r: 5, c: 0 })
  })

  it('from the end of a block, jumps to the next filled cell', () => {
    expect(jump(5, 1)).toEqual({ r: 8, c: 0 })
  })

  it('from an empty cell, jumps to the next filled cell', () => {
    expect(jump(0, 1)).toEqual({ r: 2, c: 0 })
  })

  it('with nothing further, goes to the sheet edge', () => {
    expect(jump(8, 1)).toEqual({ r: 9, c: 0 })
    expect(jump(1, -1)).toEqual({ r: 0, c: 0 })
  })
})
