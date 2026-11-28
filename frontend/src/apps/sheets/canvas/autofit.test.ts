import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'

import { createAutofit, type MeasureContext } from './autofit.js'
import { createGrid } from './index.js'
import { createMockCtx } from './painters/test-utils.js'
import type { CellFormat, CellValue, SelRange, ViewSnapshot } from './types.js'

// Every character is 10px wide (bold 12px), so widths are easy to predict.
function measureCtx(): MeasureContext {
  return {
    font: '',
    save() {},
    restore() {},
    measureText(text: string) {
      return fromPartial<TextMetrics>({
        width: text.length * (this.font.includes('bold') ? 12 : 10),
      })
    },
  }
}

function setup(
  cells: { [id: string]: CellValue },
  formats: { [id: string]: CellFormat } = {},
  colWidth = 100,
) {
  return createAutofit(
    {
      ctx: measureCtx(),
      colWidth: () => colWidth,
      cellIds: () => Object.keys(cells),
      valueAt: (id) => cells[id],
      formatAt: (id) => formats[id] ?? {},
    },
    24,
  )
}

describe('fitColWidth', () => {
  it('fits the longest value plus padding', () => {
    const fit = setup({ A1: 'abc', A2: 'abcdefghij', B1: 'a much longer value in another column' })
    expect(fit.fitColWidth(0)).toBe(10 * 10 + 12)
  })

  it('never goes below the minimum or above the maximum', () => {
    expect(setup({}).fitColWidth(0)).toBe(40)
    expect(setup({ A1: 'x'.repeat(200) }).fitColWidth(0)).toBe(600)
  })

  it('ignores wrapped cells, which grow their row instead', () => {
    const fit = setup({ A1: 'x'.repeat(30) }, { A1: { textWrap: 'wrap' } })
    expect(fit.fitColWidth(0)).toBe(40)
  })
})

// Row 1's fitted height, as a fit of that row measures it
const firstRow = (fit: ReturnType<typeof setup>) => fit.measureRows((r) => r === 0).get(0)?.height

describe('fitting a row', () => {
  it('fits the cell with the most lines', () => {
    const fit = setup({ A1: 'one', B1: 'one\ntwo\nthree' })
    // 3 lines × 16px (13px font × 1.25) + 6px padding
    expect(firstRow(fit)).toBe(3 * 16 + 6)
  })

  it('counts soft-wrapped lines in wrap mode', () => {
    // 50px column − 8px inset = 42px per line; "aaaa bbbb cccc" wraps to 3.
    const fit = setup({ A1: 'aaaa bbbb cccc' }, { A1: { textWrap: 'wrap' } }, 50)
    expect(firstRow(fit)).toBe(3 * 16 + 6)
  })

  it('grows for a word moved whole to the next line', () => {
    // 42px holds 4 chars: "ab" / "cd" / "ef", not "ab c" / "d ef".
    const fit = setup({ A1: 'ab cd ef' }, { A1: { textWrap: 'wrap' } }, 50)
    expect(firstRow(fit)).toBe(3 * 16 + 6)
  })

  it('keeps at least the default height', () => {
    expect(firstRow(setup({ A1: 'one' }))).toBe(24)
  })
})

describe('measuring rows with pending writes', () => {
  const rowsOf = (fit: ReturnType<typeof setup>, edits: { [id: string]: CellValue }) =>
    Object.fromEntries(fit.measureRows(() => true, edits))

  it('measures the written value in place of what the cell shows', () => {
    const fit = setup({ A1: 'one' })
    expect(rowsOf(fit, { A1: 'a\nb\nc' })[0]).toEqual({ height: 3 * 16 + 6, tall: true })
    // A value written into an empty cell, or an empty row, counts too
    expect(rowsOf(fit, { B1: 'a\nb' })[0]).toEqual({ height: 2 * 16 + 6, tall: true })
    expect(rowsOf(fit, { A3: 'x\ny' })[2]).toEqual({ height: 2 * 16 + 6, tall: true })
  })

  it('measures every row a batch writes, as a paste or fill does', () => {
    const fit = setup({ A1: 'a\nb', A2: 'x' })
    expect(rowsOf(fit, { A1: 'short', A2: '1\n2\n3', B4: '' })).toEqual({
      0: { height: 24, tall: false },
      1: { height: 3 * 16 + 6, tall: true },
    })
  })

  it('drops a cleared cell, so its row shrinks back', () => {
    const fit = setup({ A1: 'a\nb\nc', B1: 'one' })
    expect(rowsOf(fit, { A1: '' })[0]).toEqual({ height: 24, tall: false })
    // A row with nothing left is not measured; the grid treats it as empty
    expect(rowsOf(setup({ A1: 'a\nb' }), { A1: '' })).toEqual({})
  })

  it('keeps the shown value for a formula, whose result is not known yet', () => {
    const fit = setup({ A1: 'x\ny' })
    expect(rowsOf(fit, { A1: '="a"&CHAR(10)&"b"&CHAR(10)&"c"' })[0].height).toBe(2 * 16 + 6)
  })

  it('counts a wrapped cell as tall even when its text fits one line', () => {
    const fit = setup({}, { A1: { textWrap: 'wrap' } })
    expect(rowsOf(fit, { A1: 'short' })[0]).toEqual({ height: 24, tall: true })
  })
})

describe('measureRows', () => {
  it('fits every matching row in one pass and skips empty rows', () => {
    const fit = setup(
      { A1: 'aaaa bbbb cccc', A2: 'plain', B3: 'x\ny', A5: 'other' },
      { A1: { textWrap: 'wrap' } },
      50,
    )
    const rows = fit.measureRows((r) => r <= 3)
    expect(Object.fromEntries(rows)).toEqual({
      0: { height: 3 * 16 + 6, tall: true },
      1: { height: 24, tall: false },
      2: { height: 2 * 16 + 6, tall: true },
    })
  })
})

describe('wrappedRows', () => {
  it('lists the rows with a wrapped cell in the given columns', () => {
    const fit = setup(
      { A1: 'long text', B2: 'long text', A3: 'not wrapped', A4: 'long' },
      { A1: { textWrap: 'wrap' }, B2: { textWrap: 'wrap' }, A4: { textWrap: 'wrap' } },
    )
    expect(fit.wrappedRows(new Set([0])).sort()).toEqual([0, 3])
    expect(fit.wrappedRows(new Set())).toEqual([])
  })
})

describe('fitting rows from a tab', () => {
  // At the 13px text a line is 16px and a row 6px more, never under 28
  const TWO_LINES = 38
  const THREE_LINES = 54
  const ONE_LINE = 28

  // Rows 2 to 4 and 6 hold text; rows 2, 4, 6 and the empty 7 are sized by hand
  function grid(sel: Partial<SelRange>) {
    const parent = document.createElement('div')
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getContext').mockReturnValue(createMockCtx())
    parent.appendChild(canvas)
    document.body.appendChild(parent)
    const g = createGrid(canvas, { cells: { getStyle: () => ({}) }, host: { canEdit: () => true } })
    g.resize(800, 600)
    g.batchSetCells({ A2: 'a\nb', B3: 'a\nb\nc', A4: 'a', A6: 'a\nb' })
    const view: Partial<ViewSnapshot> = {
      rowH: { 1: 100, 3: 70, 5: 90, 6: 80 },
      manualRows: [1, 3, 5, 6],
    }
    g.viewRestore(view)
    g.setSelection(sel)
    return g
  }
  const heights = (g: ReturnType<typeof grid>, rows: number[]) => rows.map((r) => g.getRowHeight(r))

  it('fits each selected row to its own text, none of them sized by hand after', () => {
    const g = grid({ r0: 1, c0: 0, r1: 3, c1: 0, mode: 'row' })
    g.autoFitRow(2)
    expect(heights(g, [1, 2, 3, 5])).toEqual([TWO_LINES, THREE_LINES, ONE_LINE, 90])
    expect(g.viewSnapshot().manualRows).toEqual([5, 6])
  })

  it('fits only the row asked for when it is outside the selected rows', () => {
    const g = grid({ r0: 1, c0: 0, r1: 3, c1: 0, mode: 'row' })
    g.autoFitRow(5)
    expect(heights(g, [1, 2, 3, 5])).toEqual([100, 28, 70, TWO_LINES])
    expect(g.viewSnapshot().manualRows).toEqual([1, 3, 6])
  })

  it('fits only the row asked for when cells, not whole rows, are selected', () => {
    const g = grid({ r0: 1, c0: 0, r1: 3, c1: 1, mode: 'cell' })
    g.autoFitRow(2)
    expect(heights(g, [1, 2, 3])).toEqual([100, THREE_LINES, 70])
  })

  it('fits every row when the whole sheet is selected, an empty one to the default', () => {
    const g = grid({ r0: 0, c0: 0, r1: 0, c1: 0, mode: 'all' })
    g.autoFitRow(0)
    expect(heights(g, [0, 1, 2, 3, 4, 5, 6])).toEqual([
      28,
      TWO_LINES,
      THREE_LINES,
      ONE_LINE,
      28,
      TWO_LINES,
      28,
    ])
    expect(g.viewSnapshot().manualRows).toEqual([])
  })
})
