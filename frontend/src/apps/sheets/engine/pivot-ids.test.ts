import { describe, expect, it } from 'vitest'

import { createPivotEngine } from './pivot.js'

const spec = { sourceSheet: 'Sheet1', sourceRange: 'A1:D9', outputSheet: 'Pivot' }

describe('PivotEngine ids', () => {
  it('a pivot added after restoring a snapshot without nextId keeps the old one', () => {
    const src = createPivotEngine()
    const savedId = src.add(spec)
    // Saved before nextId was stored: restore must not start counting at 1
    const { pivots } = src.snapshot()
    const fresh = createPivotEngine()
    fresh.restore({ pivots, nextId: 0 })
    const newId = fresh.add(spec)
    expect(newId).not.toBe(savedId)
    expect(fresh.list()).toHaveLength(2)
  })
})
