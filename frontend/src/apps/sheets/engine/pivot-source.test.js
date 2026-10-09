import { describe, expect, it } from 'vitest'

import { computePivot, parseRangeRect, rangeReader } from './pivot.js'

describe('parseRangeRect', () => {
  it('reads a range in either corner order, and a single cell', () => {
    expect(parseRangeRect('A1:C10')).toEqual({ r0: 0, c0: 0, r1: 9, c1: 2 })
    expect(parseRangeRect('C10:A1')).toEqual({ r0: 0, c0: 0, r1: 9, c1: 2 })
    expect(parseRangeRect(' B2 ')).toEqual({ r0: 1, c0: 1, r1: 1, c1: 1 })
  })

  it('returns null for what is not a range', () => {
    expect(parseRangeRect('')).toBeNull()
    expect(parseRangeRect('A:C')).toBeNull()
  })
})

describe('rangeReader', () => {
  const rect = { r0: 1, c0: 1, r1: 2, c1: 2 } // B2:C3
  const read = rangeReader(rect, [
    ['a', 'b'],
    ['c', 'd'],
  ])

  it('serves cells of the rect it was read from', () => {
    expect(read('B2', 'C3')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(read('C3', 'C3')).toEqual([['d']])
  })

  it('reads cells outside the rect as empty', () => {
    expect(read('A1', 'B2')).toEqual([
      ['', ''],
      ['', 'a'],
    ])
  })

  it('feeds computePivot like a live sheet', () => {
    const data = [
      ['Region', 'Sales'],
      ['North', '10'],
      ['South', '5'],
      ['North', '7'],
    ]
    const source = rangeReader({ r0: 0, c0: 0, r1: 3, c1: 1 }, data)
    const table = computePivot(
      {
        sourceSheet: 'S',
        sourceRange: 'A1:B4',
        rows: ['Region'],
        values: [{ field: 'Sales', agg: 'sum' }],
      },
      source,
    )
    expect(table.slice(1).map((r) => r.slice(0, 2))).toEqual([
      ['North', 17],
      ['South', 5],
      ['Grand Total', 22],
    ])
  })
})
