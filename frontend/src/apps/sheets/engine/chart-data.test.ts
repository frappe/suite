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

describe('buildOption — rendering', () => {
  it('renders every chart kind without an ECharts console notice', async () => {
    const { BarChart, LineChart, PieChart, ScatterChart } = await import('echarts/charts')
    const { GridComponent, LegendComponent, TitleComponent, TooltipComponent } =
      await import('echarts/components')
    const { init, use } = await import('echarts/core')
    const { SVGRenderer } = await import('echarts/renderers')
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
