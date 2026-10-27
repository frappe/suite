import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { createChartEngine } from '../engine/charts'
import { createCommentsEngine } from '../engine/comments'
import { createCondFormatEngine } from '../engine/cond-format'
import { createFormatsEngine } from '../engine/formats'
import { createMergeEngine } from '../engine/merge'
import { createNamedRanges } from '../engine/named-ranges'
import { createPivotEngine } from '../engine/pivot'
import { createSlicerEngine } from '../engine/slicers'
import { createValidationEngine } from '../engine/validation'
import { addSheet, axis, cellKey, lineKey, roots } from './schema'
import {
  docSheets,
  readEntries,
  restoreStores,
  storeEntries,
  writeStores,
  type GlueStores,
} from './stores'

function makeStores() {
  return {
    formats: createFormatsEngine(),
    comments: createCommentsEngine(),
    validation: createValidationEngine(),
    merge: createMergeEngine(),
    condFormat: createCondFormatEngine(),
    slicers: createSlicerEngine(),
    charts: createChartEngine(),
    pivot: createPivotEngine(),
    namedRanges: createNamedRanges(),
  } satisfies GlueStores
}

function sheetDoc(...names: string[]) {
  const doc = new Y.Doc()
  const ids = names.map((n) => addSheet(doc, n))
  return { doc, ids }
}

const sorted = (stores: GlueStores) =>
  storeEntries(stores)
    .map((e) => JSON.stringify(e))
    .sort()

describe('docSheets', () => {
  it('lists sheets in tab order with their names', () => {
    const { doc, ids } = sheetDoc('Budget', 'Costs')
    expect(docSheets(doc)).toEqual([
      { id: ids[0], name: 'Budget' },
      { id: ids[1], name: 'Costs' },
    ])
  })

  it('keeps two sheets given one name apart, the same way in every tab', () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    addSheet(a, 'Sheet2')
    addSheet(b, 'sheet2')
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const names = docSheets(a).map((s) => s.name)
    expect(names).toEqual(docSheets(b).map((s) => s.name))
    expect(names[1]).toMatch(/ \(2\)$/)
  })

  it('skips a sheet id listed twice or deleted', () => {
    const { doc, ids } = sheetDoc('A', 'B')
    roots(doc).sheets.push([ids[0]!])
    roots(doc).sheetMeta.delete(ids[1]!)
    expect(docSheets(doc).map((s) => s.name)).toEqual(['A'])
  })
})

describe('writeStores', () => {
  it('keys cell formats, comments and validation by row and column id', () => {
    const { doc, ids } = sheetDoc('Sheet1')
    const s = makeStores()
    s.formats.applyToRange(['B4'], { bold: true }, 'Sheet1')
    s.formats.setRow(2, { fill: '#eee' }, 'Sheet1')
    s.formats.setCol(0, { italic: true }, 'Sheet1')
    s.comments.addReply('C2', { author: 'a', name: 'A', text: 'hi', ts: 1 }, 'Sheet1')
    s.validation.set('A1', { type: 'list', options: ['x', 'y'] }, 'Sheet1')
    writeStores(doc, s, docSheets(doc))

    const rows = axis(doc, ids[0]!, 'rows')
    const cols = axis(doc, ids[0]!, 'cols')
    const r = roots(doc)
    expect(r.formats.get(cellKey(ids[0]!, rows.idAt(3)!, cols.idAt(1)!))).toEqual({ bold: true })
    expect(r.rowFormats.get(lineKey(ids[0]!, rows.idAt(2)!))).toEqual({ fill: '#eee' })
    expect(r.colFormats.get(lineKey(ids[0]!, cols.idAt(0)!))).toEqual({ italic: true })
    expect(r.comments.get(cellKey(ids[0]!, rows.idAt(1)!, cols.idAt(2)!))).toMatchObject({
      thread: [{ text: 'hi' }],
    })
    expect(r.validations.get(cellKey(ids[0]!, rows.idAt(0)!, cols.idAt(0)!))).toMatchObject({
      type: 'list',
    })
  })

  it('writes only what changed', () => {
    const { doc } = sheetDoc('Sheet1')
    const s = makeStores()
    s.formats.applyToRange(['A1', 'B2'], { bold: true }, 'Sheet1')
    writeStores(doc, s, docSheets(doc))
    let updates = 0
    doc.on('update', () => updates++)
    doc.transact(() => writeStores(doc, s, docSheets(doc)))
    expect(updates).toBe(0)
    s.formats.applyToRange(['B2'], { italic: true }, 'Sheet1')
    const changed: string[] = []
    roots(doc).formats.observe((e) => changed.push(...e.keysChanged))
    doc.transact(() => writeStores(doc, s, docSheets(doc)))
    expect(updates).toBe(1)
    expect(changed).toHaveLength(1)
  })

  it('deletes what the store no longer has, and nothing another store owns', () => {
    const { doc } = sheetDoc('Sheet1')
    const s = makeStores()
    s.comments.addReply('A1', { text: 'x' }, 'Sheet1')
    s.merge.merge(0, 0, 1, 1, 'Sheet1')
    writeStores(doc, s, docSheets(doc))
    s.comments.clear('A1', 'Sheet1')
    writeStores(doc, { comments: s.comments }, docSheets(doc))
    expect(roots(doc).comments.size).toBe(0)
    expect(roots(doc).sheetState.size).toBe(1) // the merge stays
  })

  it('shares widths and frozen panes but not zoom', () => {
    const { doc, ids } = sheetDoc('Sheet1')
    let view: Record<string, unknown> = {
      Sheet1: { colW: { 2: 180 }, freezeRows: 1, hiddenRows: [], zoom: 1.5 },
    }
    const viewStore = { snapshot: () => view, restore: (v: Record<string, unknown>) => (view = v) }
    writeStores(doc, { view: viewStore }, docSheets(doc))
    expect(roots(doc).sheetState.get(`${ids[0]}:view`)).toEqual({
      colW: { 2: 180 },
      freezeRows: 1,
      hiddenRows: [],
    })
  })

  it('stores per-sheet items under their own id with the sheet id and order', () => {
    const { doc, ids } = sheetDoc('Sheet1', 'Sheet2')
    const s = makeStores()
    const range = { r0: 0, c0: 0, r1: 4, c1: 0 }
    const first = s.condFormat.addRule({ range, condition: { type: 'gt', value: '1' } }, 'Sheet2')
    const second = s.condFormat.addRule({ range, condition: { type: 'lt', value: '9' } }, 'Sheet2')
    const chart = s.charts.add({ sourceSheet: 'Sheet1', sourceRange: 'A1:B3' })
    writeStores(doc, s, docSheets(doc))
    const r = roots(doc)
    expect(r.condFormats.get(String(first))).toMatchObject({ sheet: ids[1], at: 0 })
    expect(r.condFormats.get(String(second))).toMatchObject({ sheet: ids[1], at: 1 })
    expect(r.charts.get(chart)).toMatchObject({ sourceRange: 'A1:B3' })
  })
})

describe('readEntries + restoreStores', () => {
  it('round-trips every store through the doc', () => {
    const { doc } = sheetDoc('Sheet1', 'Data')
    const s = makeStores()
    s.formats.applyToRange(['B4', 'C9'], { bold: true }, 'Data')
    s.formats.setCol(3, { italic: true }, 'Sheet1')
    s.comments.addReply('C2', { text: 'hi', ts: 1 }, 'Sheet1')
    s.validation.set('A1', { type: 'checkbox' }, 'Data')
    s.merge.merge(1, 1, 2, 3, 'Sheet1')
    s.condFormat.addRule(
      { range: { r0: 0, c0: 0, r1: 3, c1: 0 }, condition: { type: 'gt', value: '1' } },
      'Data',
    )
    s.slicers.add(2, 10, 20, 'Data')
    s.charts.add({
      sourceSheet: 'Data',
      sourceRange: 'A1:B3',
      position: { sheet: 'Data', x: 0, y: 0, width: 480, height: 320 },
    })
    s.pivot.add({ sourceSheet: 'Data', sourceRange: 'A1:B3', outputSheet: 'Sheet1' })
    s.namedRanges.add({ name: 'Rev', sheet: 'Data', range: 'B2:B9' })
    writeStores(doc, s, docSheets(doc))

    const other = makeStores()
    restoreStores(other, readEntries(doc, docSheets(doc)))
    expect(sorted(other)).toEqual(sorted(s))
  })

  it('places a keyed item at its row after an insert above it', () => {
    const { doc, ids } = sheetDoc('Sheet1')
    const s = makeStores()
    s.comments.addReply('A3', { text: 'x', ts: 1 }, 'Sheet1')
    writeStores(doc, s, docSheets(doc))
    axis(doc, ids[0]!, 'rows').insert(0, 2)
    const other = makeStores()
    restoreStores(other, readEntries(doc, docSheets(doc)))
    expect(Object.keys(other.comments.snapshot().Sheet1 ?? {})).toEqual(['A5'])
  })

  it('skips an item whose row was deleted (delete wins)', () => {
    const { doc, ids } = sheetDoc('Sheet1')
    const s = makeStores()
    s.formats.applyToRange(['A3'], { bold: true }, 'Sheet1')
    writeStores(doc, s, docSheets(doc))
    const rowId = axis(doc, ids[0]!, 'rows').idAt(2)!
    // The format survives as an orphan, as when an edit races a row delete.
    roots(doc).rows.get(ids[0]!)!.delete(2, 1)
    expect(roots(doc).formats.get(cellKey(ids[0]!, rowId, 'e1'))).toBeTruthy()
    expect(readEntries(doc, docSheets(doc))).toEqual([])
  })

  it('restores only the stores asked for, and keeps a pivot output extent', () => {
    const { doc } = sheetDoc('Sheet1')
    const s = makeStores()
    const id = s.pivot.add({ sourceSheet: 'Sheet1', sourceRange: 'A1:B3', outputSheet: 'Sheet1' })
    writeStores(doc, s, docSheets(doc))
    s.pivot.setExtent(id, { r0: 0, c0: 0, r1: 5, c1: 2 })
    s.comments.addReply('A1', { text: 'local' }, 'Sheet1')
    restoreStores(s, readEntries(doc, docSheets(doc)), new Set(['pivot']))
    expect(s.pivot.get(id)?._extent).toEqual({ r0: 0, c0: 0, r1: 5, c1: 2 })
    expect(s.comments.getThread('A1', 'Sheet1')).toBeTruthy()
  })
})
