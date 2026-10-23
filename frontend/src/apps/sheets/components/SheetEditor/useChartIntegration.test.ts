import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { createChartEngine } from '../../engine/charts.js'
import { useChartIntegration } from './useChartIntegration.js'

// A grid of 100 px columns and 24 px rows below a 24 px header, behind a
// 50 px row header: what getCellRect reports with no scroll or zoom.
function setup({ viewportW = 1400 } = {}) {
  const chart = createChartEngine()
  const grid = {
    getSelection: () => null,
    getCellRect: (r: number, c: number) => ({
      x: 50 + 100 * c,
      y: 24 + 24 * r,
      width: 100,
      height: 24,
    }),
    getViewportSize: () => ({ w: viewportW, h: 800 }),
  }
  const ui = useChartIntegration({
    chart,
    readRange: vi.fn(async () => []),
    currentSheet: ref('Sheet1'),
    contextMenu: { open: false },
    history: { push: vi.fn() },
    isDirty: ref(false),
    getGrid: () => grid,
  })
  const insert = (sourceRange: string) => {
    ui.onChartConfirm({ type: 'bar', sourceSheet: 'Sheet1', sourceRange })
    return chart.list().at(-1)?.position
  }
  return { insert }
}

// ISSUES #65: a new chart covered A1:D12 and the column headers, so the
// data it charts was hidden until the chart was dragged off.
describe('a new chart', () => {
  it('goes beside its data, level with the first row', () => {
    const { insert } = setup()
    expect(insert('A1:B6')).toMatchObject({ x: 50 + 200 + 16, y: 24 })
  })

  it('goes below its data when there is no room to the right', () => {
    const { insert } = setup({ viewportW: 700 })
    expect(insert('C2:F6')).toMatchObject({ x: 50 + 200, y: 24 + 24 * 6 + 16 })
  })

  it('a second chart on the same data is offset, not stacked', () => {
    const { insert } = setup()
    const a = insert('A1:B6')
    const b = insert('A1:B6')
    expect(b?.x).toBeGreaterThan(a?.x ?? 0)
    expect(b?.y).toBeGreaterThan(a?.y ?? 0)
  })
})
