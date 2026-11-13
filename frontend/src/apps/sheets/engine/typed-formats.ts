// The number format IronCalc gives a typed value (15%, $1.50, a date) is not
// in the collab doc. Every tab, and a reload, infers it again from the typed
// input. To drop such a format for good, the input itself must change.

import { parseCellId } from '../utils/cells'

type Command = (type: string, payload: unknown) => unknown

/** 0-based, inclusive. */
export interface Rect {
  r0: number
  c0: number
  r1: number
  c1: number
}

export interface TypedFormatDeps {
  dispatch: (cmd: unknown) => void
  command: Command
  /** IronCalc's input per cell of a rect, row by row. */
  readInputs: (sheet: string, rect: Rect) => Promise<string[][]>
}

/** Commands that set cells (by id) back to IronCalc's general format. Not synced. */
export function resetFormatCommands(ids: string[], sheet: string, command: Command): unknown[] {
  const out = []
  for (const id of ids) {
    const p = parseCellId(id)
    if (!p) continue
    const range = { r1: p.row + 1, c1: p.col + 1, r2: p.row + 1, c2: p.col + 1 }
    out.push(command('setRangeStyle', { sheet, range, style: { num_fmt: 'general' } }))
  }
  return out
}

// Resets the cells' format, then stores each cell's plain value (0.15 for a
// typed 15%, 1.5 for $1.50, the serial for a date) as its input. IronCalc
// shows that value only after the reset, so the read comes between the two.
// The input reaches other tabs, undo and reload; there, workbook.setInput
// drops the typed format. Formulas keep their input.
export async function clearTypedFormats(
  ids: string[],
  sheet: string,
  { dispatch, command, readInputs }: TypedFormatDeps,
): Promise<void> {
  const resets = resetFormatCommands(ids, sheet, command)
  if (!resets.length) return
  dispatch(command('batch', { commands: resets }))
  const cells = ids.flatMap((id) => parseCellId(id) ?? [])
  const rect = {
    r0: Math.min(...cells.map((p) => p.row)),
    c0: Math.min(...cells.map((p) => p.col)),
    r1: Math.max(...cells.map((p) => p.row)),
    c1: Math.max(...cells.map((p) => p.col)),
  }
  const inputs = await readInputs(sheet, rect)
  const writes = []
  for (const p of cells) {
    const input = inputs[p.row - rect.r0]?.[p.col - rect.c0]
    if (!input || input.startsWith('=')) continue
    writes.push(command('setInput', { sheet, row: p.row + 1, col: p.col + 1, input }))
  }
  if (writes.length) dispatch(command('batch', { commands: writes }))
}
