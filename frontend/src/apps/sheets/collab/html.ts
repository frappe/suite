// The readable copy of a collab doc: what people typed, as HTML. The server
// keeps it next to the doc (Sheet.html) for search and previews, the
// converter writes it for a converted sheet, and an open tab writes it as the
// room's `toHtml`, so both make the same copy.
//
// One table per sheet, in tab order, captioned with the sheet's name. A header
// row names the used columns (B, D) and each used row starts with its number,
// so a sheet with one cell far down stays one short row. Cells hold the typed
// input, formulas as typed (=SUM(A1:A3)), never results. A cell whose row or
// column id is no longer listed is left out, as the editor leaves it out.
//
// suite/sheets/content/readable_copy.py checks a copy holds every character of
// these inputs and sheet names: change both together.

import type * as Y from 'yjs'

import { colLabel } from '../utils/cells'
import { axis, parseCellKey, roots } from './schema'
import { docSheets } from './stores'

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ESCAPES[c]!)
}

/** The doc's readable copy: one HTML table per sheet. */
export function docToHtml(doc: Y.Doc): string {
  const sheets = docSheets(doc)
  // Every input by sheet id, then 0-based row → col → input.
  const grids = new Map(sheets.map((s) => [s.id, new Map<number, Map<number, string>>()]))
  const place = new Map(
    sheets.map((s) => [s.id, { rows: axis(doc, s.id, 'rows'), cols: axis(doc, s.id, 'cols') }]),
  )
  roots(doc).inputs.forEach((input, key) => {
    const cell = parseCellKey(key)
    const at = cell && place.get(cell.sheetId)
    if (!cell || !at) return
    const row = at.rows.posOf(cell.rowId)
    const col = at.cols.posOf(cell.colId)
    if (row < 0 || col < 0) return
    const grid = grids.get(cell.sheetId)!
    let cols = grid.get(row)
    if (!cols) grid.set(row, (cols = new Map()))
    cols.set(col, String(input))
  })

  return sheets
    .map((s) => {
      const grid = grids.get(s.id)!
      const rows = [...grid.keys()].sort((a, b) => a - b)
      const cols = [...new Set(rows.flatMap((r) => [...grid.get(r)!.keys()]))].sort((a, b) => a - b)
      const body = rows.length
        ? [
            `<tr><th></th>${cols.map((c) => `<th>${colLabel(c)}</th>`).join('')}</tr>`,
            ...rows.map((r) => {
              const cells = grid.get(r)!
              const tds = cols.map((c) => `<td>${escape(cells.get(c) ?? '')}</td>`).join('')
              return `<tr><th>${r + 1}</th>${tds}</tr>`
            }),
          ].join('')
        : ''
      return `<table><caption>${escape(s.name)}</caption><tbody>${body}</tbody></table>`
    })
    .join('')
}
