import { describe, expect, it } from 'vitest'

import { sizeCheck } from './limits'

const MiB = 2 ** 20
const limits = {
  fragment: 256 * 1024,
  edit_max: 4 * MiB,
  state_max: 4 * MiB,
  state_bytes: MiB,
  tail_bound: MiB,
}

describe('size check', () => {
  it('a change up to the most one save may hold fits an empty enough document', () => {
    expect(sizeCheck({ ...limits, state_bytes: 0, tail_bound: 0 }, 4 * MiB)).toBe('fits')
  })

  it('a change one byte over the most one save may hold is too large', () => {
    expect(sizeCheck({ ...limits, state_bytes: 0, tail_bound: 0 }, 4 * MiB + 1)).toBe('too_large')
  })

  it('a change that would take the document past its cap with what is not yet compacted warns', () => {
    expect([sizeCheck(limits, 2 * MiB), sizeCheck(limits, 2 * MiB + 1)]).toEqual([
      'fits',
      'near_full',
    ])
  })

  it('without published sizes nothing is refused', () => {
    expect(sizeCheck(null, 100 * MiB)).toBe('fits')
  })
})
