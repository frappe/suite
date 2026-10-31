import { describe, expect, it } from 'vitest'

import { cellId } from '../utils/cells.js'
import { planFill } from './fill-series.js'

// Inputs keyed by cell id (A1 style), read 0-based like the editor does.
const from = (cells) => (r, c) => cells[cellId(r, c)] ?? ''

describe('planFill', () => {
  it('continues a numeric series downward', () => {
    const writes = planFill(
      { r0: 0, c0: 0, r1: 1, c1: 0 },
      { r0: 0, c0: 0, r1: 3, c1: 0 },
      from({ A1: '1', A2: '2' }),
    )
    expect(writes).toEqual({ A3: '3', A4: '4' })
  })

  it('copies instead in copy mode', () => {
    const writes = planFill(
      { r0: 0, c0: 0, r1: 1, c1: 0 },
      { r0: 0, c0: 0, r1: 3, c1: 0 },
      from({ A1: '1', A2: '2' }),
      'copy',
    )
    expect(writes).toEqual({ A3: '1', A4: '2' })
  })

  it('shifts formula references by how far they moved', () => {
    const writes = planFill(
      { r0: 0, c0: 1, r1: 0, c1: 1 },
      { r0: 0, c0: 1, r1: 2, c1: 1 },
      from({ B1: '=A1*2' }),
    )
    expect(writes).toEqual({ B2: '=A2*2', B3: '=A3*2' })
  })

  it('fills upward', () => {
    const writes = planFill(
      { r0: 2, c0: 0, r1: 2, c1: 0 },
      { r0: 0, c0: 0, r1: 2, c1: 0 },
      from({ A3: 'x' }),
    )
    expect(writes).toEqual({ A1: 'x', A2: 'x' })
  })

  // ISSUES #22: the value nearest the source goes next to it, as in Excel.
  it('continues a numeric series upward, nearest value next to the source', () => {
    const writes = planFill(
      { r0: 2, c0: 0, r1: 3, c1: 0 },
      { r0: 0, c0: 0, r1: 3, c1: 0 },
      from({ A3: '1', A4: '2' }),
    )
    expect(writes).toEqual({ A2: '0', A1: '-1' })
  })

  it('keeps the cycle order when copying a two-row source upward', () => {
    const writes = planFill(
      { r0: 2, c0: 0, r1: 3, c1: 0 },
      { r0: 0, c0: 0, r1: 3, c1: 0 },
      from({ A3: 'a', A4: 'b' }),
      'copy',
    )
    expect(writes).toEqual({ A1: 'a', A2: 'b' })
  })

  it('shifts each formula from its own source row when filling upward', () => {
    const writes = planFill(
      { r0: 2, c0: 0, r1: 3, c1: 0 },
      { r0: 0, c0: 0, r1: 3, c1: 0 },
      from({ A3: '=B3', A4: '=C4' }),
    )
    expect(writes).toEqual({ A1: '=B1', A2: '=C2' })
  })

  it('continues a numeric series leftward, nearest value next to the source', () => {
    const writes = planFill(
      { r0: 0, c0: 2, r1: 0, c1: 3 },
      { r0: 0, c0: 0, r1: 0, c1: 3 },
      from({ C1: '1', D1: '2' }),
    )
    expect(writes).toEqual({ B1: '0', A1: '-1' })
  })

  it('keeps the cycle order when copying a two-column source leftward', () => {
    const writes = planFill(
      { r0: 0, c0: 2, r1: 0, c1: 3 },
      { r0: 0, c0: 0, r1: 0, c1: 3 },
      from({ C1: 'a', D1: 'b' }),
      'copy',
    )
    expect(writes).toEqual({ A1: 'a', B1: 'b' })
  })

  // ISSUES #23: Ctrl-drag (mode 'series') on one number counts by 1.
  it('copies a single number on a plain drag', () => {
    const writes = planFill(
      { r0: 0, c0: 0, r1: 0, c1: 0 },
      { r0: 0, c0: 0, r1: 2, c1: 0 },
      from({ A1: '7' }),
    )
    expect(writes).toEqual({ A2: '7', A3: '7' })
  })

  it('counts a single number up by 1 when the series is forced', () => {
    const writes = planFill(
      { r0: 0, c0: 0, r1: 0, c1: 0 },
      { r0: 0, c0: 0, r1: 2, c1: 0 },
      from({ A1: '7' }),
      'series',
    )
    expect(writes).toEqual({ A2: '8', A3: '9' })
  })

  it('counts down going up, and across going right, when forced', () => {
    const up = planFill(
      { r0: 2, c0: 0, r1: 2, c1: 0 },
      { r0: 0, c0: 0, r1: 2, c1: 0 },
      from({ A3: '7' }),
      'series',
    )
    expect(up).toEqual({ A2: '6', A1: '5' })
    const right = planFill(
      { r0: 0, c0: 0, r1: 0, c1: 0 },
      { r0: 0, c0: 0, r1: 0, c1: 2 },
      from({ A1: '7' }),
      'series',
    )
    expect(right).toEqual({ B1: '8', C1: '9' })
  })

  it('still copies forced text with no pattern', () => {
    const writes = planFill(
      { r0: 0, c0: 0, r1: 0, c1: 0 },
      { r0: 0, c0: 0, r1: 1, c1: 0 },
      from({ A1: 'hello' }),
      'series',
    )
    expect(writes).toEqual({ A2: 'hello' })
  })

  it('fills the whole block on a diagonal drag', () => {
    const writes = planFill(
      { r0: 0, c0: 0, r1: 0, c1: 0 },
      { r0: 0, c0: 0, r1: 1, c1: 1 },
      from({ A1: 'x' }),
    )
    expect(writes).toEqual({ A2: 'x', B1: 'x', B2: 'x' })
  })

  it('writes strings, and empty for blank source cells', () => {
    const writes = planFill(
      { r0: 0, c0: 0, r1: 0, c1: 1 },
      { r0: 0, c0: 0, r1: 1, c1: 1 },
      from({ A1: 'a' }),
    )
    expect(writes).toEqual({ A2: 'a', B2: '' })
  })
})
