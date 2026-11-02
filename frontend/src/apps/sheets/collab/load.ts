// Opening a collab doc, both ways:
//   buildWorkbookFromDoc  doc → a fresh IronCalc workbook + the side stores
//                         (every tab, on open: the doc is the source, Q11)
//   writeWorkbookToDoc    IronCalc workbook + side stores → an empty doc
//                         (a sheet opened for the first time; tests; the
//                         reference for the server-side convert, collab 5)

import type * as Y from 'yjs'

import type { WorkbookClient } from '../core/client'
import type { BatchCommand, NonBatchCommand } from '../core/commands'
import { computePivot, parseRangeRect, rangeReader } from '../engine/pivot'
import { addSheet, axis, cellKey, initDoc, parseCellKey, roots } from './schema'
import {
  docSheets,
  pivotOutput,
  readEntries,
  restoreStores,
  writeStores,
  type GlueStores,
} from './stores'

/** One cell as IronCalc holds it: 1-based position and typed input. */
export interface CellInput {
  row: number
  col: number
  input: string
}

let seq = 0
/** A command the glue sends IronCalc itself. */
export function glueCommand(type: NonBatchCommand['type'], payload: object): NonBatchCommand {
  return { id: `glue-${seq++}`, actor: 'glue', ts: Date.now(), type, payload } as NonBatchCommand
}

/** Several commands as one IronCalc apply (one recalc). */
export function glueBatch(commands: NonBatchCommand[]): BatchCommand {
  return {
    id: `glue-${seq++}`,
    actor: 'glue',
    ts: Date.now(),
    type: 'batch',
    payload: { commands },
  }
}

// readCells takes this many cells per request.
const READ_CHUNK = 10_000

/** Every non-empty cell of a sheet with its input, row by row. */
export async function readSheetInputs(client: WorkbookClient, sheet: string): Promise<CellInput[]> {
  const { cells: flat } = await client.usedCells({ sheet })
  const out: CellInput[] = []
  for (let i = 0; i < flat.length; i += READ_CHUNK * 2) {
    const cells = []
    for (let j = i; j < Math.min(flat.length, i + READ_CHUNK * 2); j += 2)
      cells.push({ row: flat[j]!, col: flat[j + 1]! })
    const res = await client.readCells({ sheet, cells, what: ['input'] })
    for (const c of res.cells) if (c.input) out.push({ row: c.row, col: c.col, input: c.input })
  }
  return out
}

/** A sheet's formula cells (inputs starting with "="). */
export async function readSheetFormulas(
  client: WorkbookClient,
  sheet: string,
): Promise<CellInput[]> {
  const { cells } = await client.findCells({ sheet, query: '=' })
  return cells.filter((c) => c.input.startsWith('='))
}

/**
 * Write a cell's input under its row/col ids, growing the id lists to reach it.
 * Positions are 1-based (IronCalc's). Call inside a transaction.
 */
export function putInput(doc: Y.Doc, sheetId: string, cell: CellInput): void {
  const key = cellKey(
    sheetId,
    axis(doc, sheetId, 'rows').ensure(cell.row - 1),
    axis(doc, sheetId, 'cols').ensure(cell.col - 1),
  )
  const inputs = roots(doc).inputs
  if (inputs.get(key) !== cell.input) inputs.set(key, cell.input)
}

export interface WriteOptions {
  /** The transaction origin (the glue's local origin, so the writes go out). */
  origin?: unknown
}

/**
 * Sets the output extent of each pivot that has not written its output this
 * session (an old sheet's, which saved it as cells): the table the pivot
 * computes from its source now, at its anchor, as the editor's rebuild writes
 * it. Cells beside the table are the person's and stay theirs.
 */
async function setPivotExtents(
  client: WorkbookClient,
  stores: GlueStores,
  cells: Map<string, CellInput[]>,
): Promise<void> {
  const pivot = stores.pivot
  for (const p of pivot?.list() ?? []) {
    const rect = parseRangeRect(p.sourceRange)
    const source = p.sourceSheet
    if (p._extent || !p.outputSheet || !source || !rect) continue
    // A range like A1:Z1048576 reads only as far as the sheet holds data.
    let lastRow = -1
    let lastCol = -1
    for (const c of cells.get(source) ?? []) {
      lastRow = Math.max(lastRow, c.row - 1)
      lastCol = Math.max(lastCol, c.col - 1)
    }
    const read = { ...rect, r1: Math.min(rect.r1, lastRow), c1: Math.min(rect.c1, lastCol) }
    if (read.r1 < read.r0 || read.c1 < read.c0) continue
    const values: string[][] = []
    const step = Math.max(1, Math.floor(READ_CHUNK / (read.c1 - read.c0 + 1)))
    for (let r = read.r0; r <= read.r1; r += step) {
      const part = await client.readViewport({
        sheet: source,
        r1: r + 1,
        c1: read.c0 + 1,
        r2: Math.min(r + step - 1, read.r1) + 1,
        c2: read.c1 + 1,
      })
      values.push(...part.values)
    }
    const table = computePivot(p, rangeReader(read, values))
    if (!table.length) continue
    const r0 = p.anchorRow ?? 0
    const c0 = p.anchorCol ?? 0
    const width = (table[0] as unknown[] | undefined)?.length || 1
    pivot?.setExtent(p.id, { r0, c0, r1: r0 + table.length - 1, c1: c0 + width - 1 })
  }
}

/**
 * Fill an empty doc from a running workbook and its side stores, in one
 * transaction. Pivot output stays out: every tab rebuilds it itself (Q8).
 */
export async function writeWorkbookToDoc(
  doc: Y.Doc,
  client: WorkbookClient,
  stores: GlueStores,
  { origin }: WriteOptions = {},
): Promise<void> {
  if (docSheets(doc).length) throw new Error('writeWorkbookToDoc needs an empty doc')
  const names = [...client.sheets]
  const cells = await Promise.all(names.map((sheet) => readSheetInputs(client, sheet)))
  await setPivotExtents(client, stores, new Map(names.map((name, i) => [name, cells[i]!])))
  const derived = pivotOutput(stores)
  doc.transact(() => {
    initDoc(doc)
    names.forEach((name, i) => {
      const sheetId = addSheet(doc, name)
      for (const cell of cells[i]!)
        if (!derived?.(name, cell.row - 1, cell.col - 1)) putInput(doc, sheetId, cell)
    })
    writeStores(doc, stores, docSheets(doc))
  }, origin)
}

// The starting sheet's name while the doc's sheets are added (one of them may
// be called Sheet1 too). No user names a sheet this.
const LOAD_TMP = '~glue~load'

/**
 * Build a fresh workbook from the doc: its sheets, in order, and every input,
 * in one IronCalc batch (one recalc); then the side stores. `client` must be a
 * new workbook (IronCalc starts one with a single empty sheet).
 */
export async function buildWorkbookFromDoc(
  doc: Y.Doc,
  client: WorkbookClient,
  stores: GlueStores,
): Promise<void> {
  const sheets = docSheets(doc)
  const [first] = client.sheets
  if (!sheets.length || first === undefined) throw new Error('nothing to build')
  const commands: NonBatchCommand[] = [
    glueCommand('renameSheet', { sheet: first, name: LOAD_TMP }),
    ...sheets.map((s) => glueCommand('addSheet', { name: s.name })),
    glueCommand('deleteSheet', { sheet: LOAD_TMP }),
  ]
  const nameOf = new Map(sheets.map((s) => [s.id, s.name]))
  for (const [key, input] of roots(doc).inputs.entries()) {
    const k = parseCellKey(key)
    const sheet = k && nameOf.get(k.sheetId)
    if (!k || sheet === undefined || !input) continue
    const row = axis(doc, k.sheetId, 'rows').posOf(k.rowId)
    const col = axis(doc, k.sheetId, 'cols').posOf(k.colId)
    if (row >= 0 && col >= 0)
      commands.push(glueCommand('setInput', { sheet, row: row + 1, col: col + 1, input }))
  }
  client.dispatch(glueBatch(commands))
  restoreStores(stores, readEntries(doc, sheets))
  await client.idle()
}
