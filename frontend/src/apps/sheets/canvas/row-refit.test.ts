import { describe, expect, it } from 'vitest'

import { planRowRefit } from './row-refit.js'

const DEFAULT = 24
const tall = (height: number) => ({ height, tall: true })

function view(rowH: Record<number, number> = {}, manual: number[] = []) {
  return {
    rowH,
    manualRows: new Set(manual),
    rowHeight: (r: number) => rowH[r] ?? DEFAULT,
  }
}

describe('planRowRefit', () => {
  it('grows a row to its wrapped text', () => {
    const plan = planRowRefit([0], new Map([[0, tall(54)]]), view(), DEFAULT)
    expect(plan).toEqual({ before: { 0: 24 }, after: { 0: 54 } })
  })

  it('leaves a row sized by hand alone', () => {
    const plan = planRowRefit([0], new Map([[0, tall(54)]]), view({ 0: 80 }, [0]), DEFAULT)
    expect(plan).toBeNull()
  })

  it('shrinks a fitted row back when its tall text is gone', () => {
    const shorter = new Map([[0, { height: 24, tall: false }]])
    expect(planRowRefit([0], shorter, view({ 0: 54 }), DEFAULT)).toEqual({
      before: { 0: 54 },
      after: { 0: 24 },
    })
    // Nothing left in the row at all: back to the default height
    expect(planRowRefit([0], new Map(), view({ 0: 54 }), DEFAULT)).toEqual({
      before: { 0: 54 },
      after: { 0: 24 },
    })
  })

  it("doesn't store a height for a plain row that never had one", () => {
    const plain = new Map([[0, { height: 24, tall: false }]])
    expect(planRowRefit([0, 1], plain, view(), DEFAULT)).toBeNull()
  })

  it('reports only the rows that change', () => {
    const measured = new Map([
      [0, tall(54)],
      [1, tall(38)],
      [2, tall(70)],
    ])
    const plan = planRowRefit([0, 1, 2], measured, view({ 1: 38, 2: 90 }, [2]), DEFAULT)
    expect(plan).toEqual({ before: { 0: 24 }, after: { 0: 54 } })
  })
})
