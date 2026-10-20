/**
 * The commands this editor dispatched that no landed save carries yet
 * (specs/sheets/002, "Unsaved edits"). When another editor saves first, the
 * editor loads the stored copy and dispatches these again on top of it, so
 * per cell the last writer wins. A command that moves cells or sheets cannot
 * be dispatched again safely: it blocks that, and is listed instead.
 *
 * Positions are absolute: `mark()` names the end of the log when a save takes
 * its bytes, and `confirm(mark)` drops what that save carried even if the log
 * was taken and refilled in between.
 */
import { translate as __ } from '@/platform/translation'

import type { CellRange, Command, NonBatchCommand } from '../../core/commands'
import type { Format, FormatsSnapshot } from '../../engine/formats'
import { colLabel } from '../../utils/cells.js'

/** A dispatched command, or the workbook replaced by older bytes (an undo). */
export type UnsentEdit = Command | 'restore'

/** Cells and sheet properties can be set again; anything that moves them cannot. */
const REPLAYABLE = new Set<string>([
  'setInput',
  'setArrayFormula',
  'clearContents',
  'setRangeStyle',
  'setColumnsWidth',
  'setRowsHeight',
  'setFrozen',
  'setDefinedName',
  'deleteDefinedName',
])

export interface UnsentCommands {
  record(edit: UnsentEdit): void
  /** The position a save taken now reaches. */
  mark(): number
  /** A save that took its bytes at `mark` landed. */
  confirm(mark: number): void
  /** Hand over every unsent edit and start an empty log. */
  take(): UnsentEdit[]
  clear(): void
  readonly size: number
  edits(): readonly UnsentEdit[]
}

export function createUnsentCommands(): UnsentCommands {
  let edits: UnsentEdit[] = []
  let start = 0
  return {
    record(edit) {
      edits.push(edit)
    },
    mark: () => start + edits.length,
    confirm(mark) {
      const sent = mark - start
      if (sent <= 0) return
      edits = edits.slice(sent)
      start = mark
    },
    take() {
      const taken = edits
      start += edits.length
      edits = []
      return taken
    },
    clear() {
      start += edits.length
      edits = []
    },
    get size() {
      return edits.length
    },
    edits: () => edits,
  }
}

/** Whether every edit can be dispatched again on another copy of the workbook. */
export function isReplayable(edit: UnsentEdit): edit is Command {
  if (edit === 'restore') return false
  if (edit.type === 'batch') return edit.payload.commands.every((c) => REPLAYABLE.has(c.type))
  return REPLAYABLE.has(edit.type)
}

/** The sheets an edit writes to. Defined names have none. */
export function sheetsOf(edit: Command): string[] {
  const commands: NonBatchCommand[] = edit.type === 'batch' ? edit.payload.commands : [edit]
  const names = new Set<string>()
  for (const command of commands) {
    const sheet = (command.payload as { sheet?: unknown }).sheet
    if (typeof sheet === 'string') names.add(sheet)
  }
  return [...names]
}

/** One line per edit, for the list of edits that could not be re-applied. */
export function describeEdits(edits: readonly UnsentEdit[]): string[] {
  return edits.flatMap((edit) => {
    if (edit === 'restore') return [__('Undid a change')]
    return edit.type === 'batch' ? edit.payload.commands.map(describe) : [describe(edit)]
  })
}

function describe(command: NonBatchCommand): string {
  switch (command.type) {
    case 'setInput':
    case 'setArrayFormula':
      return __('{0}: entered {1}', [
        at(command.payload.sheet, command.payload),
        quoted(command.payload.input),
      ])
    case 'clearContents':
      return __('{0}: cleared', [range(command.payload.sheet, command.payload.range)])
    case 'setRangeStyle':
      return __('{0}: changed formatting', [range(command.payload.sheet, command.payload.range)])
    case 'insertRows':
      return command.payload.count === 1
        ? __('{0}: inserted a row at row {1}', [command.payload.sheet, command.payload.row])
        : __('{0}: inserted {1} rows at row {2}', [
            command.payload.sheet,
            command.payload.count,
            command.payload.row,
          ])
    case 'deleteRows':
      return command.payload.count === 1
        ? __('{0}: deleted row {1}', [command.payload.sheet, command.payload.row])
        : __('{0}: deleted {1} rows at row {2}', [
            command.payload.sheet,
            command.payload.count,
            command.payload.row,
          ])
    case 'insertColumns':
      return command.payload.count === 1
        ? __('{0}: inserted a column at column {1}', [
            command.payload.sheet,
            colLabel(command.payload.col - 1),
          ])
        : __('{0}: inserted {1} columns at column {2}', [
            command.payload.sheet,
            command.payload.count,
            colLabel(command.payload.col - 1),
          ])
    case 'deleteColumns':
      return command.payload.count === 1
        ? __('{0}: deleted column {1}', [command.payload.sheet, colLabel(command.payload.col - 1)])
        : __('{0}: deleted {1} columns at column {2}', [
            command.payload.sheet,
            command.payload.count,
            colLabel(command.payload.col - 1),
          ])
    case 'moveRows':
      return __('{0}: moved rows', [command.payload.sheet])
    case 'moveColumns':
      return __('{0}: moved columns', [command.payload.sheet])
    case 'addSheet':
      return command.payload.name
        ? __('Added the sheet {0}', [command.payload.name])
        : __('Added a sheet')
    case 'deleteSheet':
      return __('Deleted the sheet {0}', [command.payload.sheet])
    case 'renameSheet':
      return __('Renamed the sheet {0} to {1}', [command.payload.sheet, command.payload.name])
    case 'duplicateSheet':
      return __('Duplicated the sheet {0}', [command.payload.sheet])
    case 'moveSheet':
      return __('Moved the sheet {0}', [command.payload.sheet])
    default:
      return __('Changed a setting of the workbook')
  }
}

function at(sheet: string, cell: { row: number; col: number }): string {
  return `${sheet}!${colLabel(cell.col - 1)}${cell.row}`
}

function range(sheet: string, r: CellRange): string {
  const first = `${colLabel(r.c1 - 1)}${r.r1}`
  const last = `${colLabel(r.c2 - 1)}${r.r2}`
  return `${sheet}!${first === last ? first : `${first}:${last}`}`
}

function quoted(input: string): string {
  return `“${input.length > 40 ? `${input.slice(0, 39)}…` : input}”`
}

// ── Format changes ───────────────────────────────────────────────────────────

/** Per sheet and layer, each key's new format; null where the format was removed. */
export type FormatChanges = Record<
  string,
  Partial<Record<'cells' | 'cols' | 'rows', Record<string, Format | null>>>
>

const LAYERS = ['cells', 'cols', 'rows'] as const

/** What changed from `base` to `mine`, per cell, column and row. */
export function formatChanges(base: FormatsSnapshot, mine: FormatsSnapshot): FormatChanges {
  const changes: FormatChanges = {}
  for (const sheet of new Set([...Object.keys(base), ...Object.keys(mine)])) {
    for (const layer of LAYERS) {
      const before = (base[sheet]?.[layer] ?? {}) as Record<string, Format>
      const after = (mine[sheet]?.[layer] ?? {}) as Record<string, Format>
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (JSON.stringify(before[key] ?? null) === JSON.stringify(after[key] ?? null)) continue
        const sheetChanges = (changes[sheet] ??= {})
        ;(sheetChanges[layer] ??= {})[key] = after[key] ?? null
      }
    }
  }
  return changes
}

/** The format store calls `applyFormatChanges` writes through. */
export interface FormatTarget {
  set(id: string, format: Format, sheet: string): void
  clear(id: string, sheet: string): void
  replaceCol(col: number, format: Format, sheet: string): void
  replaceRow(row: number, format: Format, sheet: string): void
}

/** Write each change over whatever the store holds, on the sheets that exist. */
export function applyFormatChanges(
  target: FormatTarget,
  changes: FormatChanges,
  sheets: ReadonlySet<string>,
): void {
  for (const [sheet, layers] of Object.entries(changes)) {
    if (!sheets.has(sheet)) continue
    for (const [id, format] of Object.entries(layers.cells ?? {})) {
      target.clear(id, sheet)
      if (format) target.set(id, format, sheet)
    }
    for (const [col, format] of Object.entries(layers.cols ?? {}))
      target.replaceCol(Number(col), format ?? {}, sheet)
    for (const [row, format] of Object.entries(layers.rows ?? {}))
      target.replaceRow(Number(row), format ?? {}, sheet)
  }
}

export function hasFormatChanges(changes: FormatChanges): boolean {
  return Object.keys(changes).length > 0
}
