import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { docToHtml } from './html'
import { addSheet, axis, cellKey, initDoc, roots } from './schema'

// A doc as the glue writes it: `cells` are { A1-style position: typed input }.
function docWith(sheets: Record<string, Record<string, string>>): Y.Doc {
  const doc = new Y.Doc()
  initDoc(doc)
  for (const [name, cells] of Object.entries(sheets)) {
    const sheetId = addSheet(doc, name)
    for (const [at, input] of Object.entries(cells)) {
      const col = at.charCodeAt(0) - 65
      const row = Number(at.slice(1)) - 1
      const key = cellKey(
        sheetId,
        axis(doc, sheetId, 'rows').ensure(row),
        axis(doc, sheetId, 'cols').ensure(col),
      )
      roots(doc).inputs.set(key, input)
    }
  }
  return doc
}

// The copy's tables as plain text grids, read back by the browser's own parser.
function tables(html: string): { caption: string; rows: string[][] }[] {
  const page = new DOMParser().parseFromString(html, 'text/html')
  return [...page.querySelectorAll('table')].map((table) => ({
    caption: table.querySelector('caption')?.textContent ?? '',
    rows: [...table.querySelectorAll('tr')].map((tr) =>
      [...tr.children].map((cell) => cell.textContent ?? ''),
    ),
  }))
}

describe('docToHtml: the readable copy', () => {
  it('is one table per sheet, in tab order, named by the sheet', () => {
    const html = docToHtml(docWith({ Budget: { A1: 'Rent' }, Costs: { A1: 'Food' } }))
    expect(tables(html).map((t) => t.caption)).toEqual(['Budget', 'Costs'])
  })

  it('shows what was typed, formulas as typed, never results', () => {
    const html = docToHtml(docWith({ Sheet1: { A1: '500', A2: '=SUM(A1:A1)*2' } }))
    expect(tables(html)[0]!.rows).toEqual([
      ['', 'A'],
      ['1', '500'],
      ['2', '=SUM(A1:A1)*2'],
    ])
  })

  it('labels rows and columns by their place and leaves out empty ones', () => {
    const html = docToHtml(docWith({ Sheet1: { B2: 'x', D5: 'y' } }))
    expect(tables(html)[0]!.rows).toEqual([
      ['', 'B', 'D'],
      ['2', 'x', ''],
      ['5', '', 'y'],
    ])
  })

  it('follows rows to where they moved', () => {
    const doc = docWith({ Sheet1: { A1: 'first', A2: 'second' } })
    const sheetId = roots(doc).sheets.get(0)
    axis(doc, sheetId, 'rows').insert(0, 1)
    expect(tables(docToHtml(doc))[0]!.rows).toEqual([
      ['', 'A'],
      ['2', 'first'],
      ['3', 'second'],
    ])
  })

  it('leaves out a cell whose row was deleted', () => {
    const doc = docWith({ Sheet1: { A1: 'kept', A2: 'gone' } })
    const sheetId = roots(doc).sheets.get(0)
    const goneRow = axis(doc, sheetId, 'rows').idAt(1)!
    const colId = axis(doc, sheetId, 'cols').idAt(0)!
    // Only the id goes, as when another tab deleted the row at the same moment (#46)
    roots(doc).rows.get(sheetId)!.delete(1, 1)
    expect(roots(doc).inputs.has(cellKey(sheetId, goneRow, colId))).toBe(true)
    expect(tables(docToHtml(doc))[0]!.rows).toEqual([
      ['', 'A'],
      ['1', 'kept'],
    ])
  })

  it('escapes what was typed, so a cell never becomes markup', () => {
    const html = docToHtml(docWith({ '<b>': { A1: '<img src=x onerror=alert(1)>&' } }))
    const page = new DOMParser().parseFromString(html, 'text/html')
    expect(page.querySelector('img')).toBeNull()
    expect(page.querySelector('b')).toBeNull()
    expect(tables(html)[0]!.rows[1]).toEqual(['1', '<img src=x onerror=alert(1)>&'])
  })

  it('an empty sheet is a table with no rows', () => {
    expect(tables(docToHtml(docWith({ Sheet1: {} })))).toEqual([{ caption: 'Sheet1', rows: [] }])
  })
})
