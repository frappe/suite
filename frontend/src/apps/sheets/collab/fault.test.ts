import { judge } from '@suite/collab-client'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { sheetsFault } from './fault'
import { addSheet, axis, cellKey, initDoc, roots } from './schema'

// A doc the glue would write: a sheet with a typed cell, a format, a row format and a chart.
function goodDoc(): Y.Doc {
  const doc = new Y.Doc()
  initDoc(doc)
  const sheetId = addSheet(doc, 'Sheet1')
  const r = roots(doc)
  const rowId = axis(doc, sheetId, 'rows').ensure(4)
  const colId = axis(doc, sheetId, 'cols').ensure(1)
  r.inputs.set(cellKey(sheetId, rowId, colId), '=SUM(A1:A3)')
  r.formats.set(cellKey(sheetId, rowId, colId), { bold: true })
  r.rowFormats.set(`${sheetId}:${rowId}`, { fill: '#fff' })
  r.charts.set('c1', { type: 'bar', range: 'A1:B3' })
  r.sheetState.set(`${sheetId}:merge`, [{ r0: 0, c0: 0, r1: 1, c1: 1 }])
  return doc
}

// The doc as the server's checker sees it: rebuilt from its update alone.
function rebuilt(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc()
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
  return copy
}

describe('sheetsFault: what the checker refuses', () => {
  it('accepts a doc the glue wrote', () => {
    expect(sheetsFault(rebuilt(goodDoc()))).toBeNull()
  })

  it('accepts an empty doc', () => {
    expect(sheetsFault(new Y.Doc())).toBeNull()
  })

  it('refuses a root the schema has no place for', () => {
    const doc = goodDoc()
    doc.getMap('cells').set('x', 1)
    expect(sheetsFault(rebuilt(doc))).toBe('schema: unknown root')
  })

  it('refuses a root written as the wrong kind', () => {
    const asArray = new Y.Doc()
    asArray.getArray('inputs').push(['500'])
    expect(sheetsFault(rebuilt(asArray))).toBe('schema: inputs is not a map')

    const asMap = new Y.Doc()
    asMap.getMap('sheets').set('a', 'b')
    expect(sheetsFault(rebuilt(asMap))).toBe('schema: sheets is not a list')
  })

  it('refuses a cell input that is not a string or a number', () => {
    const doc = goodDoc()
    roots(doc).inputs.set('s:r:c', { value: 1 } as unknown as string)
    expect(sheetsFault(rebuilt(doc))).toBe('schema: inputs holds a bad value')
  })

  it('accepts a number typed as a number', () => {
    const doc = goodDoc()
    roots(doc).inputs.set('s:r:c', 500 as unknown as string)
    expect(sheetsFault(rebuilt(doc))).toBeNull()
  })

  it('refuses a row list that is not a list of string ids', () => {
    const notList = goodDoc()
    roots(notList).rows.set('s2', 'e1' as unknown as Y.Array<string>)
    expect(sheetsFault(rebuilt(notList))).toBe('schema: rows holds a bad value')

    const badId = goodDoc()
    const list = new Y.Array<string>()
    list.push([7 as unknown as string])
    roots(badId).cols.set('s2', list)
    expect(sheetsFault(rebuilt(badId))).toBe('schema: cols holds a bad value')
  })

  it('refuses a sheet id that is not a string, and a sheet with no name', () => {
    const badId = goodDoc()
    roots(badId).sheets.push([3 as unknown as string])
    expect(sheetsFault(rebuilt(badId))).toBe('schema: sheets holds a bad value')

    const noName = goodDoc()
    roots(noName).sheetMeta.set('s2', { title: 'x' } as never)
    expect(sheetsFault(rebuilt(noName))).toBe('schema: sheetMeta holds a bad value')
  })

  it('refuses a shared type where the glue stores plain JSON', () => {
    const doc = goodDoc()
    roots(doc).formats.set('s:r:c', new Y.Map() as never)
    expect(sheetsFault(rebuilt(doc))).toBe('schema: formats holds a bad value')
  })

  it('refuses a tail count that is not a number', () => {
    const doc = goodDoc()
    roots(doc).tails.set('s:rows:e', 'many' as unknown as number)
    expect(sheetsFault(rebuilt(doc))).toBe('schema: tails holds a bad value')
  })

  it('never names what a cell holds in its reason', () => {
    const doc = goodDoc()
    roots(doc).inputs.set('secret:key:here', { secret: 'salary 900' } as unknown as string)
    expect(sheetsFault(rebuilt(doc))).not.toMatch(/secret|salary/)
  })

  it("judge finds the first row that breaks a doc, as the server's checker does", () => {
    const doc = goodDoc()
    const checkpoint = Y.encodeStateAsUpdate(doc)
    const rows: Uint8Array[] = []
    doc.on('update', (update: Uint8Array) => rows.push(update))
    roots(doc).inputs.set('a:b:c', 'fine')
    roots(doc).inputs.set('a:b:d', [1, 2] as unknown as string)
    roots(doc).inputs.set('a:b:e', 'fine too')
    expect(judge(checkpoint, rows, sheetsFault, () => {})).toEqual({
      verdict: 'bad',
      index: 1,
      reason: 'schema: inputs holds a bad value',
    })
    expect(judge(checkpoint, rows.slice(0, 1), sheetsFault, () => {})).toEqual({
      verdict: 'clean',
    })
  })
})
