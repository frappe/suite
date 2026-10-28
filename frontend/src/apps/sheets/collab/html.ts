// TEMPORARY stand-in for PR A's readable copy (Collab 4 owns this file).
// Dropped when this branch is rebased onto PR A.

import type * as Y from 'yjs'

import { axis, parseCellKey, roots } from './schema'
import { docSheets } from './stores'

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** One HTML table per sheet, cells as typed. */
export function docToHtml(doc: Y.Doc): string {
  const out: string[] = []
  for (const sheet of docSheets(doc)) {
    const rows = new Map<number, Map<number, string>>()
    for (const [key, input] of roots(doc).inputs.entries()) {
      const k = parseCellKey(key)
      if (k?.sheetId !== sheet.id) continue
      const r = axis(doc, sheet.id, 'rows').posOf(k.rowId)
      const c = axis(doc, sheet.id, 'cols').posOf(k.colId)
      if (r < 0 || c < 0) continue
      if (!rows.has(r)) rows.set(r, new Map())
      rows.get(r)!.set(c, input)
    }
    const body = [...rows.keys()]
      .sort((a, b) => a - b)
      .map((r) => {
        const cells = rows.get(r)!
        const width = Math.max(...cells.keys()) + 1
        const tds = Array.from(
          { length: width },
          (_, c) => `<td>${escape(cells.get(c) ?? '')}</td>`,
        )
        return `<tr>${tds.join('')}</tr>`
      })
    out.push(`<table data-sheet="${escape(sheet.name)}">${body.join('')}</table>`)
  }
  return out.join('')
}
