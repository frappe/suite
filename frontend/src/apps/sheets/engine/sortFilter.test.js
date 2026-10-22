import { describe, expect, it } from 'vitest'

import { cellId } from '../utils/cells.js'
import { createSortFilter, formatsAfterSort } from './sortFilter.js'

// The `cells` port over {cellId: input} plus {cellId: display} stores. A
// cell without a display entry displays its input.
function makeCells(inputs, displays = {}) {
  const writes = []
  const grid = (rect, pick) => {
    const rows = []
    for (let r = rect.r0; r <= rect.r1; r++) {
      const row = []
      for (let c = rect.c0; c <= rect.c1; c++) row.push(pick(cellId(r, c)))
      rows.push(row)
    }
    return rows
  }
  return {
    writes,
    read: async (_sn, rect) => ({
      inputs: grid(rect, (id) => inputs[id] ?? ''),
      displays: grid(rect, (id) => displays[id] ?? inputs[id] ?? ''),
    }),
    write: (sn, map) => writes.push([sn, map]),
  }
}

// A1:B4 — header row, then three data rows.
const RANGE = { r0: 0, c0: 0, r1: 3, c1: 1 }

describe('sort', () => {
  it('sorts the data rows by displayed value and keeps the header', async () => {
    const cells = makeCells(
      { A1: 'Name', B1: 'Score', A2: 'b', B2: '=1+1', A3: 'c', B3: '10', A4: 'a', B4: '3' },
      { B2: '2' },
    )
    const sf = createSortFilter(cells)
    sf.setRange(RANGE, 'Sheet1')
    const res = await sf.sort(1, 'asc', 'Sheet1')
    // 2 (formula), 3, 10 — numeric order, not '10' < '2'.
    expect(cells.writes).toEqual([
      ['Sheet1', { A2: 'b', B2: '=1+1', A3: 'a', B3: '3', A4: 'c', B4: '10' }],
    ])
    expect(res.before).toEqual({ A2: 'b', B2: '=1+1', A3: 'c', B3: '10', A4: 'a', B4: '3' })
  })

  it('shifts a formula by the rows it moved', async () => {
    const cells = makeCells({ A1: 'h', A2: '2', B2: '=A2*2', A3: '1', B3: '=A3*2' })
    const sf = createSortFilter(cells)
    sf.setRange({ r0: 0, c0: 0, r1: 2, c1: 1 }, 'Sheet1')
    await sf.sort(0, 'asc', 'Sheet1')
    expect(cells.writes[0][1]).toEqual({ A2: '1', B2: '=A2*2', A3: '2', B3: '=A3*2' })
  })

  it('puts blanks last in both directions', async () => {
    const cells = makeCells({ A1: 'h', A2: '', A3: '1', A4: '2' })
    const sf = createSortFilter(cells)
    sf.setRange({ r0: 0, c0: 0, r1: 3, c1: 0 }, 'Sheet1')
    await sf.sort(0, 'desc', 'Sheet1')
    expect(cells.writes[0][1]).toEqual({ A2: '2', A3: '1', A4: '' })
  })

  it('does nothing without a range or outside it', async () => {
    const cells = makeCells({})
    const sf = createSortFilter(cells)
    expect(await sf.sort(0, 'asc', 'Sheet1')).toBeNull()
    sf.setRange(RANGE, 'Sheet1')
    expect(await sf.sort(5, 'asc', 'Sheet1')).toBeNull()
    expect(cells.writes).toEqual([])
  })
})

describe('filtering from refreshed values', () => {
  const inputs = { A1: 'Name', B1: 'Total', A2: 'x', B2: '=5*2', A3: 'y', B3: '3', A4: 'z' }
  const displays = { B2: '10' }

  it('knows nothing until refreshed', () => {
    const sf = createSortFilter(makeCells(inputs, displays))
    sf.setRange(RANGE, 'Sheet1')
    expect(sf.getHeader(1, 'Sheet1')).toBe('')
  })

  it('hides rows whose displayed value fails the spec', async () => {
    const sf = createSortFilter(makeCells(inputs, displays))
    sf.setRange(RANGE, 'Sheet1')
    sf.setFilter(1, { operator: 'gt', value: '5' }, 'Sheet1')
    await sf.refresh('Sheet1')
    // Row 2 shows 10 (a formula), row 3 shows 3, row 4 is blank.
    expect([...sf.computeHiddenRows('Sheet1')]).toEqual([2, 3])
  })

  it('lists distinct displayed values, blanks first, and the header', async () => {
    const sf = createSortFilter(makeCells(inputs, displays))
    sf.setRange(RANGE, 'Sheet1')
    await sf.refresh('Sheet1')
    expect(sf.getColumnValues(1, 'Sheet1')).toEqual(['', '3', '10'])
    expect(sf.getHeader(1, 'Sheet1')).toBe('Total')
  })

  it('drops a read for a range that changed while reading', async () => {
    const sf = createSortFilter(makeCells(inputs, displays))
    sf.setRange(RANGE, 'Sheet1')
    const stale = sf.refresh('Sheet1')
    sf.setRange({ ...RANGE, c1: 0 }, 'Sheet1')
    await stale
    expect(sf.getHeader(0, 'Sheet1')).toBe('')
  })
})

// Values are compared as the numbers they show. IronCalc shows a typed
// 1,000 as `1,000` and 50% as `50%`; parseFloat read those as 1 and 50, so
// a descending sort put 12 and 3 above 1,000.
describe('numbers IronCalc formatted', () => {
  const inputs = {
    A1: 'h',
    A2: '12',
    A3: '1000',
    A4: '3',
    B1: 'p',
    B2: '0.6',
    B3: '0.5',
    B4: '0.05',
  }
  const displays = { A3: '1,000', B2: '0.6', B3: '50%', B4: '$0.05' }

  it('sorts 1,000 as a thousand', async () => {
    const cells = makeCells(inputs, displays)
    const sf = createSortFilter(cells)
    sf.setRange({ r0: 0, c0: 0, r1: 3, c1: 0 }, 'Sheet1')
    await sf.sort(0, 'desc', 'Sheet1')
    expect(cells.writes[0][1]).toEqual({ A2: '1000', A3: '12', A4: '3' })
  })

  it('sorts 50% as a half', async () => {
    const cells = makeCells(inputs, displays)
    const sf = createSortFilter(cells)
    sf.setRange({ r0: 0, c0: 1, r1: 3, c1: 1 }, 'Sheet1')
    await sf.sort(1, 'asc', 'Sheet1')
    expect(cells.writes[0][1]).toEqual({ B2: '0.05', B3: '0.5', B4: '0.6' })
  })

  it('filters and lists by the number shown', async () => {
    const sf = createSortFilter(makeCells(inputs, displays))
    sf.setRange({ r0: 0, c0: 0, r1: 3, c1: 1 }, 'Sheet1')
    sf.setFilter(0, { operator: 'gt', value: '100' }, 'Sheet1')
    await sf.refresh('Sheet1')
    expect([...sf.computeHiddenRows('Sheet1')]).toEqual([1, 3])
    expect(sf.getColumnValues(0, 'Sheet1')).toEqual(['3', '12', '1,000'])
  })
})

// Dates show as text (`12/10/2025`); compared as strings, 12/10 sorted
// before 12/9 and 1/5/2026 before both. Sort reads IronCalc's date format
// with the cells and compares the dates.
describe('dates', () => {
  function datesCells(shown, code) {
    const inputs = { A1: 'When' }
    shown.forEach((s, i) => (inputs[`A${i + 2}`] = s))
    const base = makeCells(inputs)
    return {
      ...base,
      read: async (sn, rect, opts) => {
        const res = await base.read(sn, rect, opts)
        return opts?.numFmts ? { ...res, numFmts: res.displays.map((r) => r.map(() => code)) } : res
      },
    }
  }

  it('sorts m/d/yyyy dates by date', async () => {
    const cells = datesCells(['12/10/2025', '1/5/2026', '12/9/2025'], 'm/d/yyyy')
    const sf = createSortFilter(cells)
    sf.setRange({ r0: 0, c0: 0, r1: 3, c1: 0 }, 'Sheet1')
    await sf.sort(0, 'asc', 'Sheet1')
    expect(cells.writes[0][1]).toEqual({ A2: '12/9/2025', A3: '12/10/2025', A4: '1/5/2026' })
  })

  it('sorts dd/mm/yyyy and yyyy-mm-dd dates by date', async () => {
    let cells = datesCells(['10/12/2025', '05/01/2026', '09/12/2025'], 'dd/mm/yyyy')
    let sf = createSortFilter(cells)
    sf.setRange({ r0: 0, c0: 0, r1: 3, c1: 0 }, 'Sheet1')
    await sf.sort(0, 'desc', 'Sheet1')
    expect(cells.writes[0][1]).toEqual({ A2: '05/01/2026', A3: '10/12/2025', A4: '09/12/2025' })
    cells = datesCells(['2025-12-10', '2026-01-05', '2025-12-09'], 'yyyy-mm-dd')
    sf = createSortFilter(cells)
    sf.setRange({ r0: 0, c0: 0, r1: 3, c1: 0 }, 'Sheet1')
    await sf.sort(0, 'asc', 'Sheet1')
    expect(cells.writes[0][1]).toEqual({ A2: '2025-12-09', A3: '2025-12-10', A4: '2026-01-05' })
  })
})

// Formats travel with their rows (ISSUES #48): sort reports the order it
// used, and formatsAfterSort maps each target cell to its source's format.
describe('formats move with their rows', () => {
  it('returns the order and the rect it sorted', async () => {
    const cells = makeCells({ A1: 'h', A2: '3', A3: '1', A4: '2' })
    const sf = createSortFilter(cells)
    sf.setRange({ r0: 0, c0: 0, r1: 3, c1: 0 }, 'Sheet1')
    const res = await sf.sort(0, 'asc', 'Sheet1')
    expect(res.order).toEqual([1, 2, 0])
    expect(res.rect).toEqual({ r0: 1, c0: 0, r1: 3, c1: 0 })
  })

  it('maps each cell to the format of the cell its value came from', () => {
    const bold = { bold: true }
    const usd = { numberFormat: 'currency:USD:2' }
    const before = { A2: bold, B2: usd, A3: null, B3: null, A4: null, B4: { italic: true } }
    const out = formatsAfterSort([2, 0, 1], { r0: 1, c0: 0, r1: 3, c1: 1 }, before)
    expect(out).toEqual({ A2: null, B2: { italic: true }, A3: bold, B3: usd, A4: null, B4: null })
  })
})
