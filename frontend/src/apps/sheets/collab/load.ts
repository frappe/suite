// Opening a collab doc, both ways:
//   buildWorkbookFromDoc  doc → a fresh IronCalc workbook + the side stores
//                         (every tab, on open: the doc is the source, Q11)
//   writeWorkbookToDoc    IronCalc workbook + side stores → an empty doc
//                         (a sheet opened for the first time; tests; the
//                         reference for the server-side convert, collab 5)

import type * as Y from 'yjs'

import type { WorkbookClient } from '../core/client'
import type { BatchCommand, NonBatchCommand } from '../core/commands'
import { addSheet, axis, cellKey, initDoc, parseCellKey, roots } from './schema'
import { docSheets, readEntries, restoreStores, writeStores, type GlueStores } from './stores'

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
  /** Cells to leave out: pivot output, which every tab rebuilds itself (Q8). Positions 1-based. */
  skip?: (sheet: string, row: number, col: number) => boolean
}

/** Fill an empty doc from a running workbook and its side stores, in one transaction. */
export async function writeWorkbookToDoc(
  doc: Y.Doc,
  client: WorkbookClient,
  stores: GlueStores,
  { origin, skip }: WriteOptions = {},
): Promise<void> {
  if (docSheets(doc).length) throw new Error('writeWorkbookToDoc needs an empty doc')
  const names = [...client.sheets]
  const cells = await Promise.all(names.map((sheet) => readSheetInputs(client, sheet)))
  doc.transact(() => {
    initDoc(doc)
    names.forEach((name, i) => {
      const sheetId = addSheet(doc, name)
      for (const cell of cells[i]!)
        if (!skip?.(name, cell.row, cell.col)) putInput(doc, sheetId, cell)
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
