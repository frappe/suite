import { describe, expect, it } from 'vitest'

import { createChartEngine } from './charts.js'
import { createPivotEngine } from './pivot.js'

// ISSUES #25: charts and pivots kept the old sheet name after a rename, so
// the chart vanished (it was drawn on a sheet that no longer existed).

const pos = (sheet: string) => ({ sheet, x: 10, y: 20, width: 480, height: 320 })

describe('charts follow sheet operations', () => {
  it('rename moves a chart and its data source to the new name', () => {
    const c = createChartEngine()
    const id = c.add({ sourceSheet: 'Sheet2', sourceRange: 'A1:C5', position: pos('Sheet2') })
    c.renameSheet('Sheet2', 'Data Two')
    expect(c.get(id)?.sourceSheet).toBe('Data Two')
    expect(c.get(id)?.position?.sheet).toBe('Data Two')
    expect(c.listForSheet('Data Two')).toHaveLength(1)
  })

  it('rename updates a chart drawn elsewhere that reads the renamed sheet', () => {
    const c = createChartEngine()
    const id = c.add({ sourceSheet: 'Data', sourceRange: 'A1:B3', position: pos('Report') })
    c.renameSheet('Data', 'Raw')
    expect(c.get(id)?.sourceSheet).toBe('Raw')
    expect(c.get(id)?.position?.sheet).toBe('Report')
  })

  it('duplicate copies the sheet’s charts, reading the copy’s own data', () => {
    const c = createChartEngine()
    const id = c.add({ sourceSheet: 'S', sourceRange: 'A1:B3', position: pos('S') })
    c.duplicateSheet('S', 'S copy')
    const [copy] = c.listForSheet('S copy')
    expect(copy?.id).not.toBe(id)
    expect(copy?.sourceSheet).toBe('S copy')
    expect(c.get(id)?.position?.sheet).toBe('S')
  })

  it('delete removes the charts drawn on that sheet', () => {
    const c = createChartEngine()
    c.add({ sourceSheet: 'S', sourceRange: 'A1:B3', position: pos('S') })
    const kept = c.add({ sourceSheet: 'S', sourceRange: 'A1:B3', position: pos('Report') })
    c.deleteSheet('S')
    expect(c.list().map((ch) => ch.id)).toEqual([kept])
  })
})

describe('pivots follow sheet operations', () => {
  const spec = { sourceSheet: 'Sales', sourceRange: 'A1:D9', outputSheet: 'Pivot – Region' }

  it('rename of the source sheet updates the pivot’s source', () => {
    const p = createPivotEngine()
    const id = p.add(spec)
    p.renameSheet('Sales', 'Sales 2026')
    expect(p.get(id)?.sourceSheet).toBe('Sales 2026')
  })

  it('rename of the output sheet keeps it a pivot sheet', () => {
    const p = createPivotEngine()
    const id = p.add(spec)
    p.renameSheet('Pivot – Region', 'By region')
    expect(p.get(id)?.outputSheet).toBe('By region')
  })

  it('delete of the output sheet removes the pivot', () => {
    const p = createPivotEngine()
    p.add(spec)
    p.deleteSheet('Pivot – Region')
    expect(p.list()).toEqual([])
  })
})
