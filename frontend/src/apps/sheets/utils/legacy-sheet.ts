// Opens a sheet last saved by the develop editor (the engine before IronCalc).
//
// That editor saved its cells in `sheets_data.sheet`: what the user typed in
// each cell, per sheet (decoded by `unpackSheet`), and no IronCalc `engine`.
// The side stores (formats, merges, comments, …) were saved in the same shapes
// they use today, so only the cells need converting. They are typed into a
// fresh IronCalc workbook as one batch, which recalculates once at its end:
// the same as if the user had typed every cell again.
//
//   const plan = planLegacySheet(saved.sheet)
//   const { ok } = await applyLegacyPlan(client, plan)
//   …restore the side stores, send the defined names…
//   const unknown = await unknownFunctionCells(client, plan.formulas)

import type { WorkbookClient } from '../core/client'
import type { BatchCommand, NonBatchCommand } from '../core/commands'
import { renameSheetInFormula } from '../engine/formula-adjust'
import { parseSparkline } from '../engine/sparkline'
import { colLabel, parseCellId } from './cells'
import { unpackSheet } from './sheet-codec'

// IronCalc's grid: 1,048,576 rows × 16,384 columns (XFD), as in Excel.
const MAX_ROW = 1048576
const MAX_COL = 16384
// IronCalc's own sheet-name rules, as in Excel.
const MAX_NAME = 31
const BAD_NAME_CHAR = /[[\]:*?/\\]/
const BAD_NAME_CHARS = new RegExp(BAD_NAME_CHAR, 'g')
// A new workbook starts with this one sheet.
const FIRST_SHEET = 'Sheet1'
// Cells per readCells request when checking formula results.
const READ_CHUNK = 5000

/** A formula cell, 1-based, as typed into IronCalc. */
export interface LegacyFormulaCell {
  sheet: string
  row: number
  col: number
  input: string
}

/** A formula whose function IronCalc does not know (it shows #NAME?). */
export interface UnknownFormula {
  sheet: string
  cell: string
  formula: string
}

export interface LegacyPlan {
  /** One batch command: the sheets, then every cell. Empty when there is nothing to type. */
  commands: BatchCommand[]
  /** Old name → new name, for the names IronCalc refuses. */
  renamed: Record<string, string>
  /** The tab the develop editor had open, under its new name. */
  current: string | null
  /** Cells typed in. */
  cells: number
  /** Cells left out: beyond IronCalc's grid, or not a value it can take. */
  skipped: number
  /** Formula cells to check once names are sent (sparklines left out). */
  formulas: LegacyFormulaCell[]
}

let seq = 0
function envelope() {
  return { id: `legacy-${seq++}`, actor: 'local', ts: Date.now() }
}
function command<T extends NonBatchCommand['type']>(
  type: T,
  payload: Extract<NonBatchCommand, { type: T }>['payload'],
): NonBatchCommand {
  return { ...envelope(), type, payload } as NonBatchCommand
}

// What the develop editor stored, as IronCalc input. It stored strings, but
// imports could leave numbers and booleans. Anything else can't be typed.
function asInput(v: unknown): string | null {
  if (typeof v === 'string') return v === '' ? null : v
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return null
}

/**
 * New names for the sheet names IronCalc refuses (characters `[ ] : * ? / \`,
 * more than 31 characters, empty, or the same as an earlier name but for
 * case). Valid names keep theirs; a new name never clashes with another.
 */
export function ironcalcSheetNames(names: string[]): Record<string, string> {
  const taken = new Set<string>()
  const refused: string[] = []
  for (const name of names) {
    const key = name.toLowerCase()
    const valid = name !== '' && name.length <= MAX_NAME && !BAD_NAME_CHAR.test(name)
    if (valid && !taken.has(key)) taken.add(key)
    else refused.push(name)
  }
  const out: Record<string, string> = {}
  for (const name of refused) {
    const base = name.replace(BAD_NAME_CHARS, '_').slice(0, MAX_NAME) || 'Sheet'
    let next = base
    for (let n = 2; taken.has(next.toLowerCase()); n++) {
      const suffix = ` (${n})`
      next = base.slice(0, MAX_NAME - suffix.length) + suffix
    }
    taken.add(next.toLowerCase())
    out[name] = next
  }
  return out
}

/**
 * The commands that rebuild a develop sheet (`sheets_data.sheet`, packed or
 * not) in an empty IronCalc workbook. Null when it holds no sheets.
 */
export function planLegacySheet(data: unknown): LegacyPlan | null {
  const snap = unpackSheet(data)
  if (!snap || typeof snap !== 'object') return null
  const { sheets, current } = snap as { sheets?: unknown; current?: unknown }
  if (!sheets || typeof sheets !== 'object') return null
  const oldNames = Object.keys(sheets)
  if (!oldNames.length) return null

  const renamed = ironcalcSheetNames(oldNames)
  const newName = (n: string) => renamed[n] ?? n
  const names = oldNames.map(newName)
  const subs: NonBatchCommand[] = []

  // The workbook starts with Sheet1: it becomes the first sheet. A rename
  // that only changes case goes through another name first.
  const first = names[0] ?? FIRST_SHEET
  if (first !== FIRST_SHEET) {
    if (first.toLowerCase() === FIRST_SHEET.toLowerCase()) {
      subs.push(command('renameSheet', { sheet: FIRST_SHEET, name: '_legacy_' }))
      subs.push(command('renameSheet', { sheet: '_legacy_', name: first }))
    } else {
      subs.push(command('renameSheet', { sheet: FIRST_SHEET, name: first }))
    }
  }
  for (const name of names.slice(1)) subs.push(command('addSheet', { name }))

  let cells = 0
  let skipped = 0
  const formulas: LegacyFormulaCell[] = []
  for (const oldName of oldNames) {
    const sheet = newName(oldName)
    const map = (sheets as Record<string, unknown>)[oldName]
    if (!map || typeof map !== 'object') continue
    for (const [id, value] of Object.entries(map)) {
      let input = asInput(value)
      const pos = parseCellId(id)
      if (input == null || !pos || pos.row + 1 > MAX_ROW || pos.col + 1 > MAX_COL) {
        if (value != null && value !== '') skipped++
        continue
      }
      if (input.startsWith('=')) {
        for (const [from, to] of Object.entries(renamed))
          input = renameSheetInFormula(input, from, to)
      }
      const row = pos.row + 1
      const col = pos.col + 1
      subs.push(command('setInput', { sheet, row, col, input }))
      cells++
      // A sparkline is drawn by the grid; IronCalc showing #NAME? is expected.
      if (input.startsWith('=') && !parseSparkline(input)) formulas.push({ sheet, row, col, input })
    }
  }

  const open = typeof current === 'string' && oldNames.includes(current) ? newName(current) : null
  // The validator refuses an empty batch: a lone, empty Sheet1 needs nothing.
  const commands: BatchCommand[] = subs.length
    ? [{ ...envelope(), type: 'batch', payload: { commands: subs } }]
    : []
  return { commands, renamed, current: open, cells, skipped, formulas }
}

type ConvertClient = Pick<WorkbookClient, 'dispatch' | 'idle' | 'onCommandError'>

/**
 * Types the plan into the workbook and waits for it. IronCalc applies the
 * batch whole or not at all, so `ok: false` leaves the workbook as it was.
 */
export async function applyLegacyPlan(
  client: ConvertClient,
  plan: LegacyPlan,
): Promise<{ ok: boolean; error?: string }> {
  let error: string | undefined
  const ids = new Set(plan.commands.map((c) => c.id))
  const off = client.onCommandError((f) => {
    if (ids.has(f.command.id)) error = f.error
  })
  try {
    for (const cmd of plan.commands) client.dispatch(cmd)
    await client.idle()
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  } finally {
    off()
  }
  return error === undefined ? { ok: true } : { ok: false, error }
}

/** The formulas that came out #NAME?: functions IronCalc does not have. */
export async function unknownFunctionCells(
  client: Pick<WorkbookClient, 'readCells'>,
  formulas: LegacyFormulaCell[],
): Promise<UnknownFormula[]> {
  const out: UnknownFormula[] = []
  const bySheet = new Map<string, LegacyFormulaCell[]>()
  for (const f of formulas) {
    const list = bySheet.get(f.sheet) ?? []
    list.push(f)
    bySheet.set(f.sheet, list)
  }
  for (const [sheet, list] of bySheet) {
    for (let i = 0; i < list.length; i += READ_CHUNK) {
      const chunk = list.slice(i, i + READ_CHUNK)
      const res = await client.readCells({
        sheet,
        cells: chunk.map(({ row, col }) => ({ row, col })),
        what: ['display'],
      })
      res.cells.forEach((c, j) => {
        const f = chunk[j]
        if (f && c.display === '#NAME?')
          out.push({ sheet, cell: colLabel(f.col - 1) + f.row, formula: f.input })
      })
    }
  }
  return out
}
