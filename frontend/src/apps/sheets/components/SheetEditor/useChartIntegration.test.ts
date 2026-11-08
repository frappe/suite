import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { COL_HEADER_H } from '../../canvas/constants.js'
import { createChartEngine } from '../../engine/charts.js'
import type { Rect } from '../../engine/types'
import { useChartIntegration } from './useChartIntegration.js'

// A grid of 100 px columns and 24 px rows below a 24 px header, behind a
// 50 px row header: what getCellRect reports with no scroll or zoom.
function setup({ viewportW = 1400, readRange = vi.fn(async () => ({ displays: [] })) } = {}) {
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
    readRange,
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
  return { insert, ui }
}

// ISSUES #65: a new chart covered A1:D12 and the column headers, so the
// data it charts was hidden until the chart was dragged off.
describe('a new chart', () => {
  it('goes beside its data, level with the first row', () => {
    const { insert } = setup()
    expect(insert('A1:B6')).toMatchObject({ x: 50 + 200 + 16, y: COL_HEADER_H })
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

// ISSUES #110: a scatter chart reads dates in its X column by their number
// format, so the overlay asks for formats; other charts skip that read.
describe('a chart source', () => {
  it('reads the number formats only when asked', async () => {
    const readRange = vi.fn(async (_sn: string, _rect: Rect, opts: { numFmts: boolean }) => ({
      displays: [['Day'], ['12/9/2025']],
      ...(opts.numFmts && { numFmts: [['general'], ['m/d/yyyy']] }),
    }))
    const { ui } = setup({ readRange })
    expect(ui.getSource('Sheet1', 'A1:A2', { numFmts: true })).toEqual({
      matrix: [],
      numFmts: null,
    })
    await vi.waitFor(() =>
      expect(ui.getSource('Sheet1', 'A1:A2', { numFmts: true })).toEqual({
        matrix: [['Day'], ['12/9/2025']],
        numFmts: [['general'], ['m/d/yyyy']],
      }),
    )
    expect(readRange).toHaveBeenLastCalledWith(
      'Sheet1',
      { r0: 0, c0: 0, r1: 1, c1: 0 },
      { numFmts: true },
    )
    ui.getSource('Sheet1', 'A1:A2')
    expect(readRange).toHaveBeenLastCalledWith(
      'Sheet1',
      { r0: 0, c0: 0, r1: 1, c1: 0 },
      { numFmts: false },
    )
  })
})
