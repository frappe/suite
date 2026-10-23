import { describe, expect, it } from 'vitest'

import { createAutofit, type MeasureContext } from './autofit.js'
import type { CellFormat, CellValue } from './types.js'

// Every character is 10px wide (bold 12px), so widths are easy to predict.
function measureCtx(): MeasureContext {
  return {
    font: '',
    save() {},
    restore() {},
    measureText(text: string) {
      return { width: text.length * (this.font.includes('bold') ? 12 : 10) } as TextMetrics
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

describe('fitRowHeight', () => {
  it('fits the cell with the most lines', () => {
    const fit = setup({ A1: 'one', B1: 'one\ntwo\nthree' })
    // 3 lines × 16px (13px font × 1.25) + 6px padding
    expect(fit.fitRowHeight(0)).toBe(3 * 16 + 6)
  })

  it('counts soft-wrapped lines in wrap mode', () => {
    // 50px column − 8px inset = 42px per line; "aaaa bbbb cccc" wraps to 3.
    const fit = setup({ A1: 'aaaa bbbb cccc' }, { A1: { textWrap: 'wrap' } }, 50)
    expect(fit.fitRowHeight(0)).toBe(3 * 16 + 6)
  })

  it('keeps at least the default height', () => {
    expect(setup({}).fitRowHeight(0)).toBe(24)
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
