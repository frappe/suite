import { describe, expect, it } from 'vitest'

import { buildOption } from './chart-data.js'

const cfg = (over = {}) => ({
  chartType: 'bar',
  title: '',
  hasHeader: true,
  encoding: { x: 0, y: [1] },
  options: {},
  ...over,
})

describe('buildOption — aggregation', () => {
  // Repeated X values so grouping is observable: Apple 10+20, Banana 5+15.
  const REPEATED = [
    ['Fruit', 'Qty'],
    ['Apple', 10],
    ['Apple', 20],
    ['Banana', 5],
    ['Banana', 15],
  ]
  const agg = (over) =>
    buildOption(cfg({ chartType: 'bar', encoding: { x: 0, y: [1] }, ...over }), REPEATED)

  it('leaves rows untouched when aggregate is absent (default)', () => {
    const opt = agg({})
    expect(opt.xAxis.data).toEqual(['Apple', 'Apple', 'Banana', 'Banana'])
    expect(opt.series[0].data).toEqual([10, 20, 5, 15])
  })

  it('leaves rows untouched when aggregate is "none"', () => {
    const opt = agg({ options: { aggregate: 'none' } })
    expect(opt.series[0].data).toEqual([10, 20, 5, 15])
  })

  it('collapses repeated X values with sum, preserving first-appearance order', () => {
    const opt = agg({ options: { aggregate: 'sum' } })
    expect(opt.xAxis.data).toEqual(['Apple', 'Banana'])
    expect(opt.series[0].data).toEqual([30, 20])
  })

  it('supports avg / min / max / count', () => {
    expect(agg({ options: { aggregate: 'avg' } }).series[0].data).toEqual([15, 10])
    expect(agg({ options: { aggregate: 'min' } }).series[0].data).toEqual([10, 5])
    expect(agg({ options: { aggregate: 'max' } }).series[0].data).toEqual([20, 15])
    expect(agg({ options: { aggregate: 'count' } }).series[0].data).toEqual([2, 2])
  })
})
