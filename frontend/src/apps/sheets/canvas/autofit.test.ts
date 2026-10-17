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

describe('fitting a row with a pending edit', () => {
  it('measures the edited value in place of what the cell shows', () => {
    const fit = setup({ A1: 'one' })
    expect(fit.fitRowHeight(0, { c: 0, value: 'a\nb\nc' })).toBe(3 * 16 + 6)
    // A value typed into an empty cell counts too
    expect(fit.fitRowHeight(0, { c: 1, value: 'a\nb' })).toBe(2 * 16 + 6)
  })

  it('shrinks back when the edit removes the tall text', () => {
    const fit = setup({ A1: 'a\nb\nc' })
    expect(fit.fitRowHeight(0, { c: 0, value: 'short' })).toBe(24)
    expect(fit.fitRowHeight(0, { c: 0, value: '' })).toBe(24)
  })

  it('keeps the shown value for a formula, whose result is not known yet', () => {
    const fit = setup({ A1: 'x\ny' })
    expect(fit.fitRowHeight(0, { c: 0, value: '="a"&CHAR(10)&"b"&CHAR(10)&"c"' })).toBe(2 * 16 + 6)
  })
})

describe('hasTallText', () => {
  it('is true for a wrapped cell or a multi-line value only', () => {
    expect(setup({ A1: 'one line' }).hasTallText(0)).toBe(false)
    expect(setup({ A1: 'a\nb' }).hasTallText(0)).toBe(true)
    expect(setup({ A1: 'short' }, { A1: { textWrap: 'wrap' } }).hasTallText(0)).toBe(true)
    expect(setup({}).hasTallText(0, { c: 0, value: 'a\nb' })).toBe(true)
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
