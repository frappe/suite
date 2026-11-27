// The agent API's work on a spreadsheet (suite/sheets/content/agent.py), done in the
// converter child on the doc the server sends: a read of what was typed, the
// readable copy, and a write answered as one Yjs update the server applies on
// the write's session
//
// The server passes the agent's JSON through, so every check on it is here and
// a refusal names a reason the server words. A write changes the doc as a tab
// would: inputs under row and column ids grown with the tab's tail ids, a cleared
// cell's key deleted, a new sheet made by addSheet. Anything it would leave
// unchanged makes no update

import * as Y from 'yjs'

import { createFormatsEngine } from '../engine/formats'
import { cellId, colLabel, parseCellId } from '../utils/cells'
import { applyNumberFmt } from '../utils/format-number'
import { MAX_COL, MAX_ROW, validSheetName } from '../utils/legacy-sheet'
import { inProcessClient } from './conversion'
import { docToHtml } from './html'
import { buildWorkbookFromDoc } from './load'
import { addSheet, axis, cellKey, initDoc, parseCellKey, roots, stateKey } from './schema'
import { docSheets } from './stores'

// One write's values and a doc's sheets, as Excel bounds them
const CELLS_MAX = 10_000
const INPUT_MAX = 32_767
const SHEETS_MAX = 200
// A read's grid entries, its padding included, so a far cell can't make a huge answer
const READ_MAX = 1_000_000
// A values read's typed cells: IronCalc builds the whole workbook to work each one out
const VALUES_MAX = 50_000

type Value = string | number | boolean | null

/** What the server asks for, beside the doc's parts. */
export interface AgentHeader {
  read?: true
  render?: true
  values?: true
  write?: unknown
  /** The write session's client id: the update's structs are its. */
  client?: number
}

type Reason =
  | 'no_sheets'
  | 'too_many_sheets'
  | 'name'
  | 'taken'
  | 'no_sheet'
  | 'start'
  | 'rows'
  | 'value'
  | 'too_long'
  | 'too_many_cells'
  | 'past_grid'
  | 'merged'
  | 'protected'
  | 'too_large'
  | 'too_many_inputs'

interface Refused {
  reason: Reason
  sheet?: string
  cell?: string
}

class Refusal extends Error {
  constructor(readonly refused: Refused) {
    super(refused.reason)
  }
}

function refuse(reason: Reason, sheet?: string, cell?: string): never {
  const refused: Refused = { reason }
  if (sheet !== undefined) refused.sheet = sheet
  if (cell) refused.cell = cell
  throw new Refusal(refused)
}

/** The answer for an agent header, or undefined when the header asks for none. */
export function agentAnswer(header: AgentHeader, parts: Uint8Array[]) {
  if (!header.read && !header.render && header.write === undefined) return undefined
  const doc = docOf(parts, header.client)
  try {
    if (header.read) return { sheets: readSheets(doc) }
    if (header.render) return { html: docToHtml(doc) }
    return { update: writeUpdate(doc, header.write) }
  } catch (error) {
    if (error instanceof Refusal) return { refused: error.refused }
    throw error
  }
}

/** Each sheet as a tab shows it, in the typed read's shape: a formula as its result. */
export async function valuesAnswer(parts: Uint8Array[]) {
  const doc = docOf(parts)
  try {
    const sheets = readSheets(doc)
    const typed = sheets.map((sheet) =>
      sheet.rows.flatMap((row, r) =>
        row.flatMap((input, c) => (input ? [{ row: r + 1, col: c + 1 }] : [])),
      ),
    )
    if (typed.flat().length > VALUES_MAX) refuse('too_many_inputs')
    const client = await inProcessClient(null)
    const formats = createFormatsEngine()
    await buildWorkbookFromDoc(doc, client, { formats })
    for (const [i, sheet] of sheets.entries()) {
      const shown = await client.readCells({
        sheet: sheet.name,
        cells: typed[i]!,
        what: ['display'],
      })
      for (const cell of shown.cells) {
        const display = cell.display ?? ''
        // As the grid shows it: a toolbar format is in the formats store only, never in IronCalc
        const format = formats.get(cellId(cell.row - 1, cell.col - 1), sheet.name).numberFormat
        sheet.rows[cell.row - 1]![cell.col - 1] = format ? applyNumberFmt(display, format) : display
      }
    }
    client.terminate()
    return { sheets }
  } catch (error) {
    if (error instanceof Refusal) return { refused: error.refused }
    throw error
  }
}

function docOf(parts: Uint8Array[], client?: number): Y.Doc {
  const doc = new Y.Doc()
  if (client !== undefined) doc.clientID = client
  // A log with no checkpoint sends an empty frame in its place
  for (const part of parts) if (part.length) Y.applyUpdate(doc, part)
  return doc
}

/** Each sheet's typed inputs from A1 to its last used row, each row to its last used cell. */
function readSheets(doc: Y.Doc): { name: string; rows: string[][] }[] {
  const sheets = docSheets(doc)
  const grids = new Map<string, string[][]>(sheets.map((s) => [s.id, []]))
  const place = new Map(
    sheets.map((s) => [s.id, { rows: axis(doc, s.id, 'rows'), cols: axis(doc, s.id, 'cols') }]),
  )
  let entries = 0
  roots(doc).inputs.forEach((input, key) => {
    const cell = parseCellKey(key)
    const at = cell && place.get(cell.sheetId)
    if (!cell || !at) return
    const row = at.rows.posOf(cell.rowId)
    const col = at.cols.posOf(cell.colId)
    if (row < 0 || col < 0) return
    const grid = grids.get(cell.sheetId)!
    // Counted before the padding is built, so a far cell refuses without it
    entries += Math.max(0, row + 1 - grid.length)
    entries += Math.max(0, col + 1 - (grid[row]?.length ?? 0))
    if (entries > READ_MAX) refuse('too_large')
    while (grid.length <= row) grid.push([])
    const cells = grid[row]!
    while (cells.length < col) cells.push('')
    cells[col] = String(input)
  })
  return sheets.map((s) => ({ name: s.name, rows: grids.get(s.id)! }))
}

/** The write's update in base64, or null when it changes nothing. */
function writeUpdate(doc: Y.Doc, op: unknown): string | null {
  let update: Uint8Array | null = null
  doc.on('update', (u: Uint8Array) => (update = u))
  const write = checked(op)
  doc.transact(() => {
    initDoc(doc)
    if (write.kind === 'sheets') addSheets(doc, write.sheets)
    else {
      const { id, name } = sheetNamed(doc, write.sheet)
      const at =
        write.kind === 'cells'
          ? startCell(write.start, name)
          : { row: lastRow(doc, id) + 1, col: 0 }
      putBlock(doc, id, name, at, write.rows)
    }
  })
  return update && Buffer.from(update).toString('base64')
}

type Write =
  | { kind: 'sheets'; sheets: { name: string; rows: Value[][] }[] }
  | { kind: 'cells'; sheet: string; start: string; rows: Value[][] }
  | { kind: 'rows'; sheet: string; rows: Value[][] }

// The agent's write in its shape, every value one a cell can take, or a refusal
function checked(op: unknown): Write {
  const o: Record<string, unknown> = isRecord(op) ? op : {}
  if (o.kind === 'sheets') {
    if (!Array.isArray(o.sheets) || !o.sheets.length) refuse('no_sheets')
    const sheets = o.sheets.map((s: Record<string, unknown> | null) => {
      if (typeof s?.name !== 'string') refuse('name')
      return { name: s.name, rows: s.rows === undefined ? [] : checkedRows(s.rows, s.name) }
    })
    countCells(sheets.flatMap((s) => s.rows))
    return { kind: 'sheets', sheets }
  }
  if (typeof o.sheet !== 'string') refuse('no_sheet')
  const rows = checkedRows(o.rows, o.sheet)
  countCells(rows)
  if (o.kind === 'rows') return { kind: 'rows', sheet: o.sheet, rows }
  if (o.kind !== 'cells') throw new Error('the server asked for no known write')
  if (typeof o.start !== 'string') refuse('start', o.sheet)
  return { kind: 'cells', sheet: o.sheet, start: o.start, rows }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isValue(v: unknown): v is Value {
  return (
    v === null ||
    typeof v === 'string' ||
    typeof v === 'boolean' ||
    (typeof v === 'number' && Number.isFinite(v))
  )
}

function checkedRows(rows: unknown, sheet: string): Value[][] {
  if (!Array.isArray(rows) || !rows.every(Array.isArray)) refuse('rows', sheet)
  if (!rows.every((row: unknown[]) => row.every(isValue))) refuse('value', sheet)
  return rows
}

// An empty row counts as one, so a list of them can't run past the cap
function countCells(rows: Value[][]) {
  if (rows.reduce((n, row) => n + Math.max(1, row.length), 0) > CELLS_MAX) refuse('too_many_cells')
}

// A sheet as a tab names it, matched as IronCalc matches names: whatever the case
function sheetNamed(doc: Y.Doc, name: string) {
  const sheet = docSheets(doc).find((s) => s.name.toLowerCase() === name.toLowerCase())
  return sheet ?? refuse('no_sheet', name)
}

function startCell(start: string, sheet: string) {
  const at = parseCellId(start.toUpperCase())
  if (!at || at.row < 0 || at.row >= MAX_ROW || at.col >= MAX_COL) refuse('start', sheet)
  return at
}

// The last row with a listed input, -1 on an empty sheet
function lastRow(doc: Y.Doc, sheetId: string): number {
  const rows = axis(doc, sheetId, 'rows')
  const cols = axis(doc, sheetId, 'cols')
  let last = -1
  roots(doc).inputs.forEach((_, key) => {
    const cell = parseCellKey(key)
    if (cell?.sheetId !== sheetId || cols.posOf(cell.colId) < 0) return
    last = Math.max(last, rows.posOf(cell.rowId))
  })
  return last
}

function addSheets(doc: Y.Doc, sheets: { name: string; rows: Value[][] }[]) {
  const taken = new Set(docSheets(doc).map((s) => s.name.toLowerCase()))
  if (taken.size + sheets.length > SHEETS_MAX) refuse('too_many_sheets')
  for (const { name } of sheets) {
    if (!validSheetName(name)) refuse('name', name)
    if (taken.has(name.toLowerCase())) refuse('taken', name)
    taken.add(name.toLowerCase())
  }
  for (const { name, rows } of sheets) {
    putBlock(doc, addSheet(doc, name), name, { row: 0, col: 0 }, rows)
  }
}

// The block's values from `at` (0-based): null leaves a cell, "" clears it, the rest are typed
function putBlock(
  doc: Y.Doc,
  sheetId: string,
  sheet: string,
  at: { row: number; col: number },
  rows: Value[][],
) {
  const { inputs, sheetState } = roots(doc)
  const rowIds = axis(doc, sheetId, 'rows')
  const colIds = axis(doc, sheetId, 'cols')
  const widest = rows.reduce((n, row) => Math.max(n, row.length), 0)
  if (at.row + rows.length > MAX_ROW || at.col + widest > MAX_COL) refuse('past_grid', sheet)

  // SAFETY: only the glue writes these keys (stores.ts STATE_KEY), each as its engine's slice
  const covered = (sheetState.get(stateKey(sheetId, 'merge')) as MergeSlice | undefined)?.slaveMap
  // SAFETY: as for merges, engine/protection.ts's slice
  const locks = sheetState.get(stateKey(sheetId, 'protection')) as Protection | undefined
  const writes: { row: number; col: number; input: string }[] = []
  rows.forEach((values, r) =>
    values.forEach((value, c) => {
      if (value === null) return
      const row = at.row + r
      const col = at.col + c
      const input = typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value)
      const rowId = rowIds.idAt(row)
      const colId = colIds.idAt(col)
      const now = rowId && colId ? (inputs.get(cellKey(sheetId, rowId, colId)) ?? '') : ''
      if (input === now) return
      const cell = colLabel(col) + (row + 1)
      if (input.length > INPUT_MAX) refuse('too_long', sheet, cell)
      // A covered cell shows nothing, and a tab refuses edits to a protected one
      if (covered?.[cell]) refuse('merged', sheet, cell)
      if (locks && isLocked(locks, row, col)) refuse('protected', sheet, cell)
      writes.push({ row, col, input })
    }),
  )
  for (const { row, col, input } of writes) {
    if (input === '') {
      inputs.delete(cellKey(sheetId, rowIds.idAt(row)!, colIds.idAt(col)!))
    } else {
      inputs.set(cellKey(sheetId, rowIds.ensure(row), colIds.ensure(col)), input)
    }
  }
}

// engine/merge.ts and engine/protection.ts keep these in sheetState
interface MergeSlice {
  slaveMap: Record<string, string>
}

interface Protection {
  locked: boolean
  ranges: { r0: number; c0: number; r1: number; c1: number }[]
}

function isLocked(p: Protection, row: number, col: number): boolean {
  return p.locked || p.ranges.some((r) => row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1)
}
