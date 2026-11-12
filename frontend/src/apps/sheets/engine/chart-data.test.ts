import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import { init, use } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { describe, expect, it, vi } from 'vitest'

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

// Charts read the cells' display strings. IronCalc shows a typed $1.50 or
// 1,000 formatted, and Number() made those NaN, so the bars vanished.
describe('buildOption — formatted numbers', () => {
  it('plots and sums numbers shown as $1.50, 1,000 or 50%', () => {
    const rows = [
      ['Fruit', 'Price'],
      ['Apple', '$1.50'],
      ['Apple', '1,000'],
      ['Banana', '50%'],
    ]
    const opt = buildOption(cfg({ options: { aggregate: 'sum' } }), rows)
    expect(opt.series[0].data).toEqual([1001.5, 0.5])
    expect(buildOption(cfg(), rows).series[0].data).toEqual([1.5, 1000, 0.5])
  })
})

// A scatter point sits at (x, y) from one row. With Y alone on a value X axis,
// ECharts had no X to read and drew Y against Y (ISSUES #76).
describe('buildOption — scatter', () => {
  const scatter = (rows, over = {}) => buildOption(cfg({ chartType: 'scatter', ...over }), rows)

  it('plots each row at (x, y)', () => {
    const rows = [
      ['Price', 'Units'],
      [10, 5],
      [20, 3],
      ['$30.00', '1,000'],
    ]
    expect(scatter(rows).series[0].data).toEqual([
      [10, 5],
      [20, 3],
      [30, 1000],
    ])
  })

  it('plots every Y series against the same X column', () => {
    const rows = [
      ['Units', 'Price', 'Cost'],
      [5, 10, 7],
      [3, 20, 9],
    ]
    const opt = scatter(rows, { encoding: { x: 1, y: [0, 2] } })
    expect(opt.series.map((s) => s.data)).toEqual([
      [
        [10, 5],
        [20, 3],
      ],
      [
        [10, 7],
        [20, 9],
      ],
    ])
  })

  it('skips rows whose X or Y is empty or not a number', () => {
    const rows = [
      ['Price', 'Units'],
      [10, 5],
      ['', 4],
      [12, ''],
      ['n/a', 6],
      [14, 'none'],
      [null, 2],
      [16, 8],
    ]
    expect(scatter(rows).series[0].data).toEqual([
      [10, 5],
      [16, 8],
    ])
  })

  // A date shows as `12/9/2025`; its number format turns it back into the
  // day serial, so dates plot in date order and the axis reads as dates.
  it('plots dates in the X column by their day serial', () => {
    const rows = [
      ['Day', 'Units'],
      ['12/11/2025', 3],
      ['12/9/2025', 5],
      ['1/2/2026', 4],
    ]
    const fmts = [['general', 'general'], ...rows.slice(1).map(() => ['m/d/yyyy', 'general'])]
    const opt = buildOption(cfg({ chartType: 'scatter' }), rows, false, fmts)
    expect(opt.series[0].data).toEqual([
      [46002, 3],
      [46000, 5],
      [46024, 4],
    ])
    expect(opt.xAxis.scale).toBe(true)
    expect(opt.xAxis.axisLabel.formatter(46000)).toBe('12/9/2025')
    expect(opt.xAxis.axisLabel.formatter(46024)).toBe('1/2/2026')
  })

  it('reads each date in its own day order', () => {
    const rows = [
      ['Day', 'Units'],
      ['09/12/2025', 5],
    ]
    const fmts = [
      ['general', 'general'],
      ['dd/mm/yyyy', 'general'],
    ]
    const opt = buildOption(cfg({ chartType: 'scatter' }), rows, false, fmts)
    expect(opt.series[0].data).toEqual([[46000, 5]])
    expect(opt.xAxis.axisLabel.formatter(46000)).toBe('09/12/2025')
  })

  it('skips rows whose X is blank or text and plots the dated rest', () => {
    const rows = [
      ['Day', 'Units'],
      ['12/9/2025', 5],
      ['', 4],
      ['soon', 6],
      ['12/10/2025', 7],
    ]
    const fmts = [
      ['general', 'general'],
      ['m/d/yyyy', 'general'],
      ['general', 'general'],
      ['general', 'general'],
      ['m/d/yyyy', 'general'],
    ]
    const opt = buildOption(cfg({ chartType: 'scatter' }), rows, false, fmts)
    expect(opt.series[0].data).toEqual([
      [46000, 5],
      [46001, 7],
    ])
  })

  it('says No data when no row can plot', () => {
    const rows = [
      ['Name', 'Units'],
      ['Ann', 5],
      ['Bob', 3],
    ]
    const opt = scatter(rows)
    expect(opt.title.text).toBe('No data')
    expect(opt.series).toBeUndefined()
  })

  it('keeps a number X axis as before', () => {
    const opt = scatter([
      ['Price', 'Units'],
      [10, 5],
    ])
    expect(opt.xAxis.scale).toBeUndefined()
    expect(opt.xAxis.axisLabel.formatter).toBeUndefined()
  })

  it('leaves bar, line and area series as plain Y values', () => {
    const rows = [
      ['Month', 'Sales'],
      ['Jan', 10],
      ['Feb', ''],
    ]
    for (const chartType of ['bar', 'line', 'area']) {
      expect(buildOption(cfg({ chartType }), rows).series[0].data).toEqual([10, 0])
    }
  })
})

describe('buildOption — rendering', () => {
  // ECharts is imported at the top of the file, while the file loads: a cold
  // import inside the test counted against its 5 s timeout and could run past
  // it under a full run's load (ISSUES #82).
  it('renders every chart kind without an ECharts console notice', () => {
    use([BarChart, LineChart, PieChart, ScatterChart, GridComponent, LegendComponent])
    use([TitleComponent, TooltipComponent, SVGRenderer])

    const rows = [
      ['Month', 'Sales'],
      ['Jan', 10],
      ['Feb', 20],
    ]
    const notices = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const chartType of ['bar', 'line', 'area', 'scatter', 'pie']) {
      const chart = init(null, null, { renderer: 'svg', ssr: true, width: 480, height: 320 })
      chart.setOption(buildOption(cfg({ chartType }), rows))
      chart.dispose()
    }
    expect(notices.mock.calls).toEqual([])
    expect(warnings.mock.calls).toEqual([])
    notices.mockRestore()
    warnings.mockRestore()
  })
})
