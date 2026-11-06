// Gridlines in a frozen pane stay put while the sheet scrolls under it. The
// frozen pane's closing line sits on the last frozen row's bottom (or the last
// frozen column's right) edge, never at the first scrolled row or column's
// moved position, which would land inside the frozen pane.
import { describe, expect, it } from 'vitest'

import { COL_HEADER_H, ROW_HEADER_W } from './constants.js'
import { createGeometry } from './geometry.js'
import { createGridPainter } from './painters/grid-painter.js'
import { createMockCtx } from './painters/test-utils.js'

const COL_W = 100
const ROW_H = 24
const CSS_W = 600
const CSS_H = 400

function geometryWith(freeze: { rows: number; cols: number }, scroll: { x: number; y: number }) {
  const vm = {
    scroll,
    freeze,
    zoom: 1,
    totalRows: 1000,
    totalCols: 26,
    hiddenRows: new Set<number>(),
    hiddenCols: new Set<number>(),
    filterHiddenRows: new Set<number>(),
    rowHeight: () => ROW_H,
    colWidth: () => COL_W,
  }
  return createGeometry(vm as never)
}

// Draws the grid lines for one region and returns the y of every horizontal
// line and the x of every vertical line, in drawing order.
function gridLines(
  freeze: { rows: number; cols: number },
  scroll: { x: number; y: number },
  region: [number, number, number, number],
) {
  const ctx = createMockCtx()
  const ys: number[] = []
  const xs: number[] = []
  ctx.moveTo.mockImplementation((x: number, y: number) => {
    if (x === ROW_HEADER_W) ys.push(y)
    else if (y === COL_HEADER_H) xs.push(x)
  })
  const geo = geometryWith(freeze, scroll)
  const gp = createGridPainter(ctx as never, geo)
  gp.drawGridLines(...region, CSS_W, CSS_H)
  return { ys, xs, geo }
}

describe('frozen pane gridlines', () => {
  // 2 frozen rows; scrolls of 1, 2 and 3 rows, and partial rows in between.
  for (const scrollY of [5, ROW_H, ROW_H + 10, 2 * ROW_H, 3 * ROW_H - 7]) {
    it(`frozen rows keep their own lines at scroll.y = ${scrollY}`, () => {
      const { ys } = gridLines({ rows: 2, cols: 0 }, { x: 0, y: scrollY }, [0, 0, 1, 3])
      const frozenBottom = COL_HEADER_H + 2 * ROW_H
      expect(ys).toEqual([COL_HEADER_H + 0.5, COL_HEADER_H + ROW_H + 0.5, frozenBottom + 0.5])
    })
  }

  for (const scrollX of [5, COL_W, COL_W + 30, 3 * COL_W - 1]) {
    it(`frozen columns keep their own lines at scroll.x = ${scrollX}`, () => {
      const { xs } = gridLines({ rows: 0, cols: 2 }, { x: scrollX, y: 0 }, [0, 0, 3, 1])
      const frozenRight = ROW_HEADER_W + 2 * COL_W
      expect(xs).toEqual([ROW_HEADER_W + 0.5, ROW_HEADER_W + COL_W + 0.5, frozenRight + 0.5])
    })
  }

  it('the frozen corner keeps its lines when both directions scroll', () => {
    const { ys, xs } = gridLines({ rows: 2, cols: 2 }, { x: 30, y: 10 }, [0, 0, 1, 1])
    expect(ys).toEqual([28.5, 52.5, 76.5])
    expect(xs).toEqual([50.5, 150.5, 250.5])
  })

  it('the scrolled area still draws a line at every row and column edge', () => {
    const scroll = { x: 30, y: 10 }
    const { ys, xs, geo } = gridLines({ rows: 2, cols: 2 }, scroll, [2, 2, 12, 6])
    const wantYs = Array.from({ length: 12 }, (_, i) => geo.rowY(2 + i) + 0.5)
    const wantXs = Array.from({ length: 6 }, (_, i) => geo.colX(2 + i) + 0.5)
    expect(ys).toEqual(wantYs)
    expect(xs).toEqual(wantXs)
  })
})
