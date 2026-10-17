import { describe, expect, it } from 'vitest'

import { isSparkSpec, parseSparkline, sparkGeometry, sparkSpec, sparkType } from './sparkline.js'

describe('sparkType', () => {
  it('accepts known types, defaults to line', () => {
    expect(sparkType('column')).toBe('column')
    expect(sparkType('COLUMN')).toBe('column')
    expect(sparkType('bar')).toBe('line') // unimplemented → falls back to line
    expect(sparkType('pie')).toBe('line')
    expect(sparkType(undefined)).toBe('line')
  })
})

describe('sparkSpec', () => {
  it('keeps numeric data, drops non-numeric', () => {
    const s = sparkSpec([1, '2', 'x', '', 4], 'line')
    expect(s.data).toEqual([1, 2, 4])
    expect(s.__spark).toBe(true)
    expect(s.type).toBe('line')
    expect(s.color).toBe(null)
  })
  it('keeps a valid color (hex or keyword), rejects garbage', () => {
    expect(sparkSpec([1], 'line', '  #f00 ').color).toBe('#f00')
    expect(sparkSpec([1], 'line', 'red').color).toBe('red')
    expect(sparkSpec([1], 'line', 'steelblue').color).toBe('steelblue')
    expect(sparkSpec([1], 'line', 'bluee').color).toBe(null) // typo → default, not a leftover colour
    expect(sparkSpec([1], 'line', '#REF!').color).toBe(null) // stray error text, not a colour
    expect(sparkSpec([1], 'line', '').color).toBe(null)
    expect(sparkSpec([1], 'line', 5).color).toBe(null)
  })
  it('isSparkSpec recognises a spec', () => {
    expect(isSparkSpec(sparkSpec([1]))).toBe(true)
    expect(isSparkSpec({})).toBe(false)
    expect(isSparkSpec('#spark')).toBe(false)
    expect(isSparkSpec(null)).toBe(false)
  })
})

describe('sparkGeometry — line', () => {
  it('spreads points across the padded width, inverts y', () => {
    const g = sparkGeometry(sparkSpec([0, 10], 'line'), 26, 20, 3)
    expect(g.kind).toBe('line')
    expect(g.points).toHaveLength(2)
    expect(g.points[0].x).toBe(3) // left inset
    expect(g.points[1].x).toBe(23) // right inset (26 - 3)
    expect(g.points[0].y).toBeGreaterThan(g.points[1].y) // 0 is lower (bigger y) than 10
  })
  it('a single point sits at the left', () => {
    const g = sparkGeometry(sparkSpec([5], 'line'), 26, 20)
    expect(g.points).toHaveLength(1)
    expect(g.points[0].x).toBe(3)
  })
})

describe('sparkGeometry — bars', () => {
  it('lays one bar per value within the box', () => {
    const g = sparkGeometry(sparkSpec([1, 2, 3], 'column'), 30, 20, 3)
    expect(g.kind).toBe('bars')
    expect(g.bars).toHaveLength(3)
    for (const b of g.bars) {
      expect(b.x).toBeGreaterThanOrEqual(3)
      expect(b.h).toBeGreaterThanOrEqual(1)
    }
  })
  it('negatives grow the other side of the zero baseline', () => {
    const g = sparkGeometry(sparkSpec([-2, 3], 'column'), 30, 20, 3)
    expect(g.bars[0].neg).toBe(true)
    expect(g.bars[1].neg).toBe(false)
    // the negative bar's top is below the positive bar's top
    expect(g.bars[0].y).toBeGreaterThan(g.bars[1].y)
  })
})

describe('sparkGeometry — nothing to draw', () => {
  it('returns null with no data', () => {
    expect(sparkGeometry(sparkSpec([]), 26, 20)).toBe(null)
    expect(sparkGeometry(sparkSpec(['a', 'b']), 26, 20)).toBe(null)
  })
  it('returns null when the box is too small', () => {
    expect(sparkGeometry(sparkSpec([1, 2]), 4, 4)).toBe(null)
  })
})

describe('parseSparkline', () => {
  it('reads the range and options', () => {
    expect(parseSparkline('=SPARKLINE(A1:A10)')).toEqual({
      sheet: null,
      r0: 0,
      c0: 0,
      r1: 9,
      c1: 0,
      type: null,
      color: null,
    })
    expect(parseSparkline('=sparkline(Data!$B$2:B9, "column", "#e11d48")')).toMatchObject({
      sheet: 'Data',
      r0: 1,
      c0: 1,
      r1: 8,
      c1: 1,
      type: 'column',
      color: '#e11d48',
    })
  })

  it('handles a quoted sheet name and a single cell', () => {
    expect(parseSparkline("=SPARKLINE('My data'!C3)")).toMatchObject({
      sheet: 'My data',
      r0: 2,
      c0: 2,
      r1: 2,
      c1: 2,
    })
  })

  it('is null for anything else', () => {
    expect(parseSparkline('=SUM(A1:A3)')).toBeNull()
    expect(parseSparkline('SPARKLINE(A1:A3)')).toBeNull()
    expect(parseSparkline('=SPARKLINE(A1:A3, B1)')).toBeNull() // options must be literals
    expect(parseSparkline(null)).toBeNull()
  })
})
