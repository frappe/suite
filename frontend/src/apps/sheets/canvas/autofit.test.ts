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

describe('grownRowHeight', () => {
  it('grows for a multi-line value', () => {
    expect(setup({}).grownRowHeight(0, 0, 'a\nb\nc', 24)).toBe(3 * 16 + 8)
  })

  it('never shrinks, and ignores single lines and formulas', () => {
    const fit = setup({})
    expect(fit.grownRowHeight(0, 0, 'a\nb', 100)).toBeNull()
    expect(fit.grownRowHeight(0, 0, 'one line', 24)).toBeNull()
    expect(fit.grownRowHeight(0, 0, '="a"&CHAR(10)&"b"\n', 24)).toBeNull()
  })
})
