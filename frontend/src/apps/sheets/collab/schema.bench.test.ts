// Size and speed of the collab doc on 100k cells. Skipped in normal runs; run with
//   SHEETS_BENCH=1 yarn vitest run src/apps/sheets/collab/schema.bench.test.ts --silent=false
// Numbers go into COLLAB-DESIGN (Q11 load time, Q14 size limit).

/// <reference types="node" />

import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { addSheet, axis, cellKey, parseCellKey, roots } from './schema'

const LIMIT = 16 * 1024 * 1024 // max_state in the Sheets registration (Q14)

interface Shape {
  name: string
  rows: number
  cols: number
  /** Typed input for the cell at (r, c). */
  input: (r: number, c: number) => string
  /** Format object for the cell, if any. */
  format?: (r: number, c: number) => Record<string, unknown> | undefined
  /** One transaction per row (people typing) instead of one for the whole sheet (a converter). */
  perRow?: boolean
}

const colLetter = (c: number) => String.fromCharCode(65 + (c % 26))
const mixed = (r: number, c: number) => {
  const k = (r * 31 + c * 17) % 20
  if (k < 12) return String((r * 7919 + c * 104729) % 1000000) // 60% numbers, up to 6 digits
  if (k < 17) return `Customer ${r}-${c}` // 25% text
  return `=SUM(${colLetter(c)}${Math.max(1, r - 9)}:${colLetter(c)}${r + 1})` // 15% formulas
}
const someFormats = (r: number, c: number) => {
  const k = (r + c * 3) % 10
  if (k < 2) return { bold: true }
  if (k < 3) return { numFmt: '#,##0.00', align: 'right' }
  return undefined
}

const SHAPES: Shape[] = [
  { name: 'numbers 10,000×10', rows: 10000, cols: 10, input: (r, c) => String(r * 10 + c) },
  { name: 'mixed 10,000×10', rows: 10000, cols: 10, input: mixed },
  { name: 'mixed 10,000×10, typed row by row', rows: 10000, cols: 10, input: mixed, perRow: true },
  {
    name: 'mixed + 30% formats 10,000×10',
    rows: 10000,
    cols: 10,
    input: mixed,
    format: someFormats,
  },
  { name: 'mixed 1,000×100 (wide)', rows: 1000, cols: 100, input: mixed },
]

function time<T>(fn: () => T): [T, number] {
  const t = performance.now()
  const out = fn()
  return [out, performance.now() - t]
}

function build(shape: Shape): { doc: Y.Doc; sid: string } {
  const doc = new Y.Doc()
  const sid = addSheet(doc, 'Sheet1')
  const r = roots(doc)
  const fillRow = (row: number) => {
    const rowId = axis(doc, sid, 'rows').ensure(row)
    for (let c = 0; c < shape.cols; c++) {
      const key = cellKey(sid, rowId, axis(doc, sid, 'cols').ensure(c))
      r.inputs.set(key, shape.input(row, c))
      const f = shape.format?.(row, c)
      if (f) r.formats.set(key, f)
    }
  }
  if (shape.perRow) for (let row = 0; row < shape.rows; row++) doc.transact(() => fillRow(row))
  else
    doc.transact(() => {
      for (let row = 0; row < shape.rows; row++) fillRow(row)
    })
  return { doc, sid }
}

/** What a tab does on open: apply the doc, then read every cell back as (row, col, input). */
function load(update: Uint8Array): number {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, update)
  const r = roots(doc)
  const sid = r.sheets.get(0)
  const rows = axis(doc, sid, 'rows')
  const cols = axis(doc, sid, 'cols')
  let seen = 0
  for (const [key, value] of r.inputs.entries()) {
    const cell = parseCellKey(key)!
    if (rows.posOf(cell.rowId) >= 0 && cols.posOf(cell.colId) >= 0 && value) seen++
  }
  return seen
}

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`
const ms = (n: number) => `${n.toFixed(0)} ms`

describe.skipIf(!process.env.SHEETS_BENCH)('collab doc benchmark (100k cells)', () => {
  it('reports bytes per cell and encode / decode / load time', { timeout: 120_000 }, () => {
    const lines: string[] = []
    for (const shape of SHAPES) {
      const cells = shape.rows * shape.cols
      const [{ doc, sid }, buildMs] = time(() => build(shape))
      const [update, encodeMs] = time(() => Y.encodeStateAsUpdate(doc))
      const [, decodeMs] = time(() => Y.applyUpdate(new Y.Doc(), update))
      const [seen, loadMs] = time(() => load(update))
      expect(seen).toBe(cells)
      const v2 = Y.encodeStateAsUpdateV2(doc).length
      const gz = gzipSync(update).length
      const perCell = update.length / cells
      lines.push(
        `${shape.name.padEnd(36)} ${kb(update.length).padStart(8)}  ${perCell.toFixed(1).padStart(5)} B/cell` +
          `  (v2 ${(v2 / cells).toFixed(1)}, gzip ${(gz / cells).toFixed(1)})` +
          `  build ${ms(buildMs)}  encode ${ms(encodeMs)}  decode ${ms(decodeMs)}  load ${ms(loadMs)}` +
          `  → 16 MB holds ~${Math.floor(LIMIT / perCell / 1000)}k cells`,
      )
      if (shape.name === 'mixed 10,000×10') {
        const rows = axis(doc, sid, 'rows')
        const [, insertMs] = time(() => rows.insert(5000, 1))
        const [, removeMs] = time(() => rows.remove(5000, 1))
        const [, removeManyMs] = time(() => rows.remove(0, 1000))
        lines.push(
          `  structural on 100k cells: insert row ${ms(insertMs)}, delete row ${ms(removeMs)}, delete 1,000 rows ${ms(removeManyMs)}`,
        )
        // Churn: every cell retyped 3 times. Overwritten values become tombstones.
        const r = roots(doc)
        doc.transact(() => {
          for (let round = 1; round <= 3; round++) {
            for (const key of [...r.inputs.keys()]) r.inputs.set(key, String(round))
          }
        })
        const after = Y.encodeStateAsUpdate(doc).length
        lines.push(
          `  after deleting 1,000 rows and retyping the other ${r.inputs.size} cells 3 times: ${kb(after)} (${(after / r.inputs.size).toFixed(1)} B/cell)`,
        )
      }
    }
    console.log('\n' + lines.join('\n'))
  })
})
