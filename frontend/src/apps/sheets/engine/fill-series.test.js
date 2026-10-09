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
