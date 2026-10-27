import { describe, expect, it, vi } from 'vitest'

import { newItemId, newItemNumber } from './item-id.js'

// Two tabs share one document: an item one tab adds must never take the id of
// an item another tab adds at the same moment. Each tab is its own page, so a
// module-level counter starts at the same number in both.
async function twoTabs<T>(path: string): Promise<[T, T]> {
  vi.resetModules()
  const a = (await import(path)) as T
  vi.resetModules()
  const b = (await import(path)) as T
  return [a, b]
}

const range = { r0: 0, c0: 0, r1: 4, c1: 0 }

describe('item ids', () => {
  it('newItemId and newItemNumber are random', () => {
    const ids = new Set(Array.from({ length: 1000 }, newItemId))
    const nums = new Set(Array.from({ length: 1000 }, newItemNumber))
    expect(ids.size).toBe(1000)
    expect(nums.size).toBe(1000)
    for (const n of nums) expect(Number.isSafeInteger(n) && n > 0).toBe(true)
  })

  it('two tabs adding a chart pick different ids', async () => {
    const [a, b] = await twoTabs<typeof import('./charts.js')>('./charts.js')
    const spec = { sourceSheet: 'Sheet1', sourceRange: 'A1:B5' }
    expect(a.createChartEngine().add(spec)).not.toBe(b.createChartEngine().add(spec))
  })

  it('two tabs adding a pivot pick different ids', async () => {
    const [a, b] = await twoTabs<typeof import('./pivot.js')>('./pivot.js')
    const spec = { sourceSheet: 'Sheet1', sourceRange: 'A1:B5', outputSheet: 'Sheet2' }
    expect(a.createPivotEngine().add(spec)).not.toBe(b.createPivotEngine().add(spec))
  })

  it('two tabs adding a conditional format rule pick different ids', async () => {
    const [a, b] = await twoTabs<typeof import('./cond-format.js')>('./cond-format.js')
    const rule = { range, condition: { type: 'gt', value: '1' }, format: { bold: true } }
    expect(a.createCondFormatEngine().addRule(rule)).not.toBe(
      b.createCondFormatEngine().addRule(rule),
    )
  })

  it('two tabs adding a slicer pick different ids', async () => {
    const [a, b] = await twoTabs<typeof import('./slicers.js')>('./slicers.js')
    expect(a.createSlicerEngine().add(1)).not.toBe(b.createSlicerEngine().add(1))
  })
})
