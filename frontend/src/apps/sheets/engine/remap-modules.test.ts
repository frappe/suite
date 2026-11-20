import { describe, expect, it } from 'vitest'

import { createChartEngine } from './charts.js'
import { createCondFormatEngine } from './cond-format.js'
import { createFormatsEngine } from './formats.js'
import { createMergeEngine } from './merge.js'
import { createNamedRanges } from './named-ranges.js'
import { createPivotEngine } from './pivot.js'
import { createProtectionEngine } from './protection.js'
import { deleteMap, insertMap, moveMap } from './ref-remap.js'
import { createSlicerEngine } from './slicers.js'
import { createSortFilter } from './sortFilter.js'
import { createValidationEngine } from './validation.js'

// Each structural op is one index map fanned across every module — these lock
// that each module permutes its column-indexed state correctly.

describe('formats.remapCols', () => {
  it('moves the per-column format layer and per-cell layer', () => {
    const f = createFormatsEngine()
    f.setCol(3, { bold: true }) // column D bold
    f.set('D1', { italic: true }) // cell D1 italic
    f.remapCols(moveMap(3, 1, 1)) // D → B
    expect(f.getCol(1).bold).toBe(true)
    expect(f.getCol(3).bold).toBeUndefined()
    expect(f.getCellFormat('B1').italic).toBe(true)
  })
})

describe('validation.remapCols', () => {
  it('relocates a rule to the moved column and drops deleted ones', () => {
    const v = createValidationEngine()
    v.set('D1', { type: 'number' })
    v.remapCols(moveMap(3, 1, 1))
    expect(v.get('B1')).toEqual({ type: 'number' })
    expect(v.get('D1')).toBeNull()

    v.remapCols(deleteMap(1, 1)) // delete column B (where the rule now is)
    expect(v.get('B1')).toBeNull()
  })
})

describe('sortFilter.remapCols', () => {
  it('remaps the range and the byCol specs', () => {
    const sf = createSortFilter({ getCell: () => '' })
    sf.setRange({ r0: 0, c0: 1, r1: 5, c1: 3 }, 'Sheet1') // B1:D6
    sf.setFilter(3, { values: ['x'] }, 'Sheet1') // spec on column D
    sf.remapCols(moveMap(3, 1, 1), 'Sheet1') // D → B
    const byCol = sf.getFilterConfig('Sheet1')
    expect(byCol[1]).toEqual({ values: ['x'] }) // now keyed at B
    expect(sf.getRange('Sheet1')).toEqual({ r0: 0, c0: 1, r1: 5, c1: 3 })
  })
})

describe('slicers.remapCols', () => {
  it('remaps the bound column and drops a deleted one', () => {
    const s = createSlicerEngine()
    s.add(3, 0, 0, 'Sheet1')
    s.remapCols(moveMap(3, 1, 1), 'Sheet1')
    expect(s.list('Sheet1')[0].col).toBe(1)
    s.remapCols(deleteMap(1, 1), 'Sheet1')
    expect(s.list('Sheet1').length).toBe(0)
  })
})

describe('protection.remapCols', () => {
  it('remaps a protected range', () => {
    const p = createProtectionEngine()
    p.addRange({ r0: 0, c0: 3, r1: 0, c1: 3 }, 'lock', 'Sheet1')
    p.remapCols(moveMap(3, 1, 1), 'Sheet1')
    expect(p.getRanges('Sheet1')[0]).toMatchObject({ c0: 1, c1: 1 })
  })
})

describe('cond-format.remapCols', () => {
  it('remaps a rule range', () => {
    const cf = createCondFormatEngine()
    cf.addRule({ range: { r0: 0, c0: 3, r1: 9, c1: 3 }, type: 'greaterThan', value: 5 }, 'Sheet1')
    cf.remapCols(moveMap(3, 1, 1), 'Sheet1')
    expect(cf.getRules('Sheet1')[0].range).toMatchObject({ c0: 1, c1: 1 })
  })
})

describe('merge.remapCols', () => {
  it('relocates a merged rectangle', () => {
    const m = createMergeEngine()
    m.merge(0, 3, 1, 4, 'Sheet1') // D1:E2
    m.remapCols(insertMap(0, 1), 'Sheet1') // insert a column at A → shifts right
    expect(m.getMasterInfo('E1', 'Sheet1')).toMatchObject({ r: 0, c: 4, rowSpan: 2, colSpan: 2 })
    expect(m.getMasterId('F2', 'Sheet1')).toBe('E1')
  })
})

describe('named-ranges.remapCols', () => {
  it('rewrites the range string for entries on the op sheet', () => {
    const nr = createNamedRanges()
    nr.add({ name: 'Revenue', sheet: 'Sheet1', range: 'D2:D100' })
    nr.remapCols(moveMap(3, 1, 1), 'Sheet1')
    expect(nr.get('Revenue').range).toBe('B2:B100')
  })
  it('leaves entries on other sheets alone', () => {
    const nr = createNamedRanges()
    nr.add({ name: 'Other', sheet: 'Sheet2', range: 'D2:D100' })
    nr.remapCols(moveMap(3, 1, 1), 'Sheet1')
    expect(nr.get('Other').range).toBe('D2:D100')
  })
})

describe('charts.remapCols', () => {
  it('remaps source range and range-local encoding indices', () => {
    const c = createChartEngine()
    // Source A1:D9; x = local col 0 (A), y = [3] (D). Move D → before A? Use a
    // move WITHIN the range so local indices actually permute.
    c.add({ id: 'ch1', sourceSheet: 'Sheet1', sourceRange: 'A1:D9', encoding: { x: 0, y: [3] } })
    c.remapCols(moveMap(3, 0, 1), 'Sheet1') // D(3) → before A(0): [D,A,B,C]
    const ch = c.get('ch1')
    expect(ch.sourceRange).toBe('A1:D9') // same columns, still bounding A..D
    expect(ch.encoding.x).toBe(1) // old A now at local 1
    expect(ch.encoding.y).toEqual([0]) // old D now at local 0
  })
})

describe('pivot.remapCols', () => {
  it('remaps the source range and output anchor column', () => {
    const p = createPivotEngine()
    const id = p.add({
      sourceSheet: 'Sheet1',
      sourceRange: 'A1:D9',
      outputSheet: 'Sheet1',
      anchorRow: 0,
      anchorCol: 3,
    })
    p.remapCols(insertMap(0, 1), 'Sheet1')
    const cfg = p.get(id)
    expect(cfg.sourceRange).toBe('B1:E9')
    expect(cfg.anchorCol).toBe(4)
  })
})
