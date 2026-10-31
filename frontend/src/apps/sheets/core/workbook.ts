// IronCalc-backed workbook adapter. Translates the command schema in
// commands.ts into calls on @ironcalc/wasm's Model.
//
// Callers must initialise the wasm module first (init / initSync from
// '@ironcalc/wasm'); createWorkbook assumes it is ready.
//
// Commands address sheets by name; IronCalc addresses them by index. Names
// resolve against the live worksheet list on every call, so the mapping can
// never drift after sheet ops or undo/redo.

import { Model, type ExtendedCellStyle } from '@ironcalc/wasm'

import { CommandTypes, validateCommand, type Command, type CommandType } from './commands.js'
import { isDateDifference, isDateFormat } from './date-diff.js'
import { shrinkRangesForDelete, type DeleteSpan } from './delete-ranges.js'
import { MAX_ROWS } from './limits.js'
import { percentFormatFor } from './percent-format.js'
import { typedCurrency, withSymbol } from './typed-currency.js'

const LANGUAGE = 'en'

export interface WorkbookErrorOptions {
  command?: unknown
  cause?: unknown
}

export class WorkbookError extends Error {
  // The command that failed, as received (it may not have passed validation).
  command: unknown

  constructor(message: string, { command = null, cause = null }: WorkbookErrorOptions = {}) {
    super(message, { cause })
    this.name = 'WorkbookError'
    this.command = command
  }
}

// IronCalc throws Error objects or plain strings across the wasm boundary.
function messageOf(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  return String(e)
}

function asWorkbookError(e: unknown, command: unknown): WorkbookError {
  if (e instanceof WorkbookError) {
    if (command && !e.command) e.command = command
    return e
  }
  return new WorkbookError(messageOf(e), { command, cause: e })
}

// Commands whose translation spans more than one engine call. A failure
// halfway through would leave partial state, so apply() snapshots first
// and restores on error.
const MULTI_CALL: ReadonlySet<CommandType> = new Set<CommandType>([
  CommandTypes.batch,
  CommandTypes.setFrozen,
  CommandTypes.setRangeStyle,
  CommandTypes.addSheet,
  CommandTypes.duplicateSheet,
  CommandTypes.setDefinedName,
])

export interface CreateWorkbookOptions {
  loadBytes?: Uint8Array | null
  name?: string
  locale?: string
  timezone?: string
  /** The version to count on from, so a restore keeps versions increasing. */
  startVersion?: number
}

export interface VersionResult {
  version: number
}

export interface FoundCell {
  row: number
  col: number
  input: string
}

export interface RangeStats {
  /** Non-empty cells. */
  count: number
  /** Cells holding a number (a formula result included). */
  numCount: number
  sum: number
}

// IronCalc's cell type for a number (getCellType).
const NUMBER_CELL = 1

// A number cell's value from its shown text: IronCalc exposes no raw value,
// so drop grouping and currency marks and read a trailing % as /100.
export function numberFromShown(shown: string): number {
  const t = shown.replace(/[,\s$€£¥₹]/g, '')
  return t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t)
}

export interface Workbook {
  apply(cmd: unknown): VersionResult
  undo(): VersionResult
  redo(): VersionResult
  canUndo(): boolean
  canRedo(): boolean
  getDisplayValue(sheet: string, row: number, col: number): string
  /** The editable string: the formula (with '=') or the raw value. */
  getInput(sheet: string, row: number, col: number): string
  getStyle(sheet: string, row: number, col: number): ExtendedCellStyle
  /** Whether the cell holds a number (a formula result included). */
  isNumber(sheet: string, row: number, col: number): boolean
  getSheets(): string[]
  getFrozen(sheet: string): { rows: number; cols: number }
  getColumnWidth(sheet: string, col: number): number
  getRowHeight(sheet: string, row: number): number
  /**
   * Cells whose input contains `query` (case-insensitive), in reading
   * order (row by row), at most `limit` of them.
   */
  findInputs(sheet: string, query: string, limit: number): FoundCell[]
  /** Every non-empty cell as flat [row, col, row, col, …] (1-based), row by row. */
  usedCells(sheet: string): number[]
  /** Count / numeric count / sum over a range (1-based, inclusive). */
  rangeStats(sheet: string, r1: number, c1: number, r2: number, c2: number): RangeStats
  toBytes(): Uint8Array
  getVersion(): number
}

export function createWorkbook({
  loadBytes = null,
  name = 'Workbook',
  locale = 'en',
  timezone = 'UTC',
  startVersion = 0,
}: CreateWorkbookOptions = {}): Workbook {
  let model: Model
  try {
    model = loadBytes
      ? Model.fromBytes(loadBytes, LANGUAGE)
      : new Model(name, locale, timezone, LANGUAGE)
  } catch (e) {
    throw asWorkbookError(e, null)
  }

  let version = startVersion

  // No formula sits below this row on any sheet (null: not known). It bounds
  // the formula scan before a delete (rangeFixes), which would otherwise ask
  // all 1,048,576 rows of every sheet (about 60 ms a sheet). Only setInput and
  // setArrayFormula write formulas; insertRows and moveRows push them down;
  // undo and redo can do anything.
  let formulaRowBound: number | null = loadBytes ? null : 0
  let inBatch = false
  const raiseFormulaRowBound = (row: number) => {
    if (formulaRowBound !== null) formulaRowBound = Math.max(formulaRowBound, row)
  }

  // No input sits below this row on any sheet (null: a loaded workbook not
  // counted yet). It bounds the cell scans (scanCells), which would otherwise
  // ask all 1,048,576 rows (about 100 ms a sheet) after every edit (ISSUES
  // #81). It only goes up, so undo and redo can't beat it: they bring back a
  // state this workbook was in since the count, and every input was above
  // the bound then. Spill and array cells hold values below their formula;
  // scanCells follows those itself.
  let inputRowBound: number | null = loadBytes ? null : 0
  const raiseInputRowBound = (row: number) => {
    inputRowBound = Math.max(inputRows(), row)
  }

  // Counted before the first command runs, so the history holds nothing
  // older than the count.
  function inputRows(): number {
    if (inputRowBound === null) {
      inputRowBound = 0
      model.getWorksheetsProperties().forEach((_, sheet) => {
        for (let row = MAX_ROWS; row > inputRowBound!; row--) {
          if (model.getFirstNonEmptyInRowAfterColumn(sheet, row, 0) === undefined) continue
          inputRowBound = row
          break
        }
      })
    }
    return inputRowBound
  }

  // Each non-empty cell on a sheet, row by row, until visit returns true.
  // Spill and array cells below the bound are reached from their formula,
  // which is always above them.
  function scanCells(idx: number, visit: (row: number, col: number, input: string) => unknown) {
    let last = inputRows()
    for (let row = 1; row <= last; row++) {
      for (const col of model.getColumnsWithData(idx, row)) {
        const input = model.getCellContent(idx, row, col)
        // A styled but empty cell is listed too.
        if (input === '') continue
        if (input.startsWith('=')) {
          const shape = model.getCellArrayStructure(idx, row, col)
          const size =
            typeof shape === 'object' &&
            ('ArrayAnchor' in shape
              ? shape.ArrayAnchor
              : 'DynamicAnchor' in shape
                ? shape.DynamicAnchor
                : null)
          if (size) last = Math.min(MAX_ROWS, Math.max(last, row + size[1] - 1))
        }
        if (visit(row, col, input)) return
      }
    }
  }

  function sheetIndex(sheetName: string): number {
    const i = model.getWorksheetsProperties().findIndex((p) => p.name === sheetName)
    if (i === -1) throw new WorkbookError(`unknown sheet "${sheetName}"`)
    return i
  }

  function scopeIndex(scope: string | null | undefined): number | null {
    return scope == null ? null : sheetIndex(scope)
  }

  function read<T>(fn: () => T): T {
    try {
      return fn()
    } catch (e) {
      throw asWorkbookError(e, null)
    }
  }

  // Rebuilding from bytes resets the native undo history. Only the failure
  // path of a multi-call command pays that cost, and a failed command is a
  // protocol error, so this is acceptable.
  function restore(bytes: Uint8Array): void {
    try {
      const fresh = Model.fromBytes(bytes, LANGUAGE)
      model.free()
      model = fresh
    } catch {
      // Keep the current model if the restore itself fails.
    }
  }

  function apply(input: unknown): VersionResult {
    let cmd: Command
    try {
      cmd = validateCommand(input)
    } catch (e) {
      throw asWorkbookError(e, input)
    }
    const snapshot = MULTI_CALL.has(cmd.type) ? model.toBytes() : null
    try {
      inputRows()
      applyOne(cmd)
    } catch (e) {
      if (snapshot) restore(snapshot)
      throw asWorkbookError(e, cmd)
    }
    version += 1
    return { version }
  }

  // A typed input, as IronCalc's setUserInput, plus the formats IronCalc
  // gets wrong (Google Sheets is the reference):
  //   - a ₹ or £ amount is a number with that currency (typed-currency.ts);
  //   - a formula scaling one percent cell by plain numbers shows a percent
  //     (percent-format.ts);
  //   - one date minus another shows the days between (date-diff.ts).
  function setInput(si: number, row: number, col: number, input: string): void {
    const area = { sheet: si, row, column: col, width: 1, height: 1 }
    const numFmt = (sheet: string | null, r: number, c: number) =>
      model.getCellStyle(sheet == null ? si : sheetIndex(sheet), r, c).style.num_fmt
    const currency = typedCurrency(input)
    model.setUserInput(si, row, col, currency ? currency.input : input)
    const fmt = numFmt(null, row, col)
    if (currency) {
      if (fmt.includes('$'))
        model.updateRangeStyle(area, 'num_fmt', withSymbol(fmt, currency.symbol))
      return
    }
    if (!input.startsWith('=')) return
    if (/^general$/i.test(fmt)) {
      // Only a cell IronCalc left unformatted: a format it inferred stays.
      const percent = percentFormatFor(input, numFmt)
      if (percent) model.updateRangeStyle(area, 'num_fmt', percent)
    } else if (isDateFormat(fmt) && isDateDifference(input, numFmt)) {
      model.updateRangeStyle(area, 'num_fmt', 'general')
    }
  }

  // Deletes rows or columns, first pulling in the range ends IronCalc would
  // turn into #REF! (delete-ranges.ts, ISSUES #9). Finding them reads every
  // formula, down to formulaRowBound.
  function deleteSpan(span: Omit<DeleteSpan, 'formulaSheet'>): void {
    const si = sheetIndex(span.sheet)
    const del = () =>
      span.axis === 'row'
        ? model.deleteRows(si, span.at, span.count)
        : model.deleteColumns(si, span.at, span.count)
    const fixes = rangeFixes(span)
    if (fixes.length === 0) return del()
    // Inside a batch, evaluation is paused already and stays paused until
    // the batch ends.
    const pause = !inBatch
    if (pause) model.pauseEvaluation()
    // If a rewrite or the delete fails, put back the formulas rewritten so far.
    let done = 0
    try {
      for (const f of fixes) {
        setFormula(f, f.after)
        done++
      }
      del()
    } catch (e) {
      for (const f of fixes.slice(0, done)) setFormula(f, f.before)
      throw e
    } finally {
      if (pause) {
        model.resumeEvaluation()
        model.evaluate()
      }
    }
  }

  interface RangeFix {
    sheet: number
    row: number
    col: number
    before: string
    after: string
  }

  function rangeFixes(span: Omit<DeleteSpan, 'formulaSheet'>): RangeFix[] {
    const fixes: RangeFix[] = []
    const target = sheetIndex(span.sheet)
    const last = span.at + span.count - 1
    const lastRow = formulaRowBound ?? inputRows()
    let lastFormulaRow = 0
    model.getWorksheetsProperties().forEach(({ name }, sheet) => {
      for (let row = 1; row <= lastRow; row++) {
        // Half the cost of asking every row for its columns.
        if (model.getFirstNonEmptyInRowAfterColumn(sheet, row, 0) === undefined) continue
        for (const col of model.getColumnsWithData(sheet, row)) {
          const before = model.getCellContent(sheet, row, col)
          if (!before.startsWith('=')) continue
          lastFormulaRow = row
          // A formula the delete removes needs nothing.
          const pos = span.axis === 'row' ? row : col
          if (sheet === target && pos >= span.at && pos <= last) continue
          if (!before.includes(':')) continue
          const after = shrinkRangesForDelete(before, { ...span, formulaSheet: name })
          if (after !== before) fixes.push({ sheet, row, col, before, after })
        }
      }
    })
    // The delete only moves formulas up, so the bound found holds after it.
    formulaRowBound = lastFormulaRow
    return fixes
  }

  // A CSE array keeps its size (IronCalc won't write over one, so clear it
  // first); anything else is typed in as is.
  function setFormula(f: RangeFix, input: string): void {
    const shape = model.getCellArrayStructure(f.sheet, f.row, f.col)
    if (typeof shape === 'object' && 'ArrayAnchor' in shape) {
      const [width, height] = shape.ArrayAnchor
      model.rangeClearContents(f.sheet, f.row, f.col, f.row + height - 1, f.col + width - 1)
      model.setUserArrayFormula(f.sheet, f.row, f.col, width, height, input)
    } else {
      model.setUserInput(f.sheet, f.row, f.col, input)
    }
  }

  function applyOne(cmd: Command): void {
    switch (cmd.type) {
      case CommandTypes.setInput: {
        const p = cmd.payload
        raiseFormulaRowBound(p.row)
        raiseInputRowBound(p.row)
        setInput(sheetIndex(p.sheet), p.row, p.col, p.input)
        return
      }
      // setUserArrayFormula pins the result to a fixed width × height
      // (CSE-style array). Dynamic-array spills go through setInput.
      case CommandTypes.setArrayFormula: {
        const p = cmd.payload
        raiseFormulaRowBound(p.row)
        raiseInputRowBound(p.row)
        model.setUserArrayFormula(
          sheetIndex(p.sheet),
          p.row,
          p.col,
          p.width ?? 1,
          p.height ?? 1,
          p.input,
        )
        return
      }
      case CommandTypes.clearContents: {
        const {
          sheet,
          range: { r1, c1, r2, c2 },
        } = cmd.payload
        model.rangeClearContents(sheetIndex(sheet), r1, c1, r2, c2)
        return
      }
      // updateRangeStyle takes one (path, value) string pair per call,
      // e.g. ('font.b', 'true') or ('fill.color', '#FFEE00').
      case CommandTypes.setRangeStyle: {
        const {
          sheet,
          range: { r1, c1, r2, c2 },
          style,
        } = cmd.payload
        const area = {
          sheet: sheetIndex(sheet),
          row: r1,
          column: c1,
          width: c2 - c1 + 1,
          height: r2 - r1 + 1,
        }
        for (const [path, value] of Object.entries(style)) {
          model.updateRangeStyle(area, path, String(value))
        }
        return
      }
      case CommandTypes.setColumnsWidth: {
        const p = cmd.payload
        model.setColumnsWidth(sheetIndex(p.sheet), p.c1, p.c2, p.width)
        return
      }
      case CommandTypes.setRowsHeight: {
        const p = cmd.payload
        model.setRowsHeight(sheetIndex(p.sheet), p.r1, p.r2, p.height)
        return
      }
      case CommandTypes.insertRows: {
        const p = cmd.payload
        if (formulaRowBound !== null) formulaRowBound += p.count
        inputRowBound = Math.min(MAX_ROWS, inputRows() + p.count)
        model.insertRows(sheetIndex(p.sheet), p.row, p.count)
        return
      }
      case CommandTypes.deleteRows: {
        const p = cmd.payload
        deleteSpan({ sheet: p.sheet, axis: 'row', at: p.row, count: p.count })
        return
      }
      case CommandTypes.insertColumns: {
        const p = cmd.payload
        model.insertColumns(sheetIndex(p.sheet), p.col, p.count)
        return
      }
      case CommandTypes.deleteColumns: {
        const p = cmd.payload
        deleteSpan({ sheet: p.sheet, axis: 'col', at: p.col, count: p.count })
        return
      }
      case CommandTypes.moveRows: {
        const p = cmd.payload
        // Moving up pushes the rows passed over down, to at most the block's old end.
        const lowest = p.row + p.count - 1 + Math.max(0, p.delta)
        raiseFormulaRowBound(lowest)
        raiseInputRowBound(lowest)
        model.moveRows(sheetIndex(p.sheet), p.row, p.count, p.delta)
        return
      }
      case CommandTypes.moveColumns: {
        const p = cmd.payload
        model.moveColumns(sheetIndex(p.sheet), p.col, p.count, p.delta)
        return
      }
      case CommandTypes.setFrozen: {
        const p = cmd.payload
        const idx = sheetIndex(p.sheet)
        model.setFrozenRowsCount(idx, p.rows)
        model.setFrozenColumnsCount(idx, p.cols)
        return
      }
      // newSheet() takes no name; the sheet is appended, then renamed.
      case CommandTypes.addSheet: {
        model.newSheet()
        if (cmd.payload.name) {
          model.renameSheet(model.getWorksheetsProperties().length - 1, cmd.payload.name)
        }
        return
      }
      case CommandTypes.deleteSheet:
        model.deleteSheet(sheetIndex(cmd.payload.sheet))
        return
      case CommandTypes.renameSheet:
        model.renameSheet(sheetIndex(cmd.payload.sheet), cmd.payload.name)
        return
      // IronCalc names the copy itself; find it and rename it when asked.
      case CommandTypes.duplicateSheet: {
        const p = cmd.payload
        const before = new Set(model.getWorksheetsProperties().map((s) => s.name))
        model.duplicateSheet(sheetIndex(p.sheet))
        if (p.name) {
          const i = model.getWorksheetsProperties().findIndex((s) => !before.has(s.name))
          model.renameSheet(i, p.name)
        }
        return
      }
      case CommandTypes.moveSheet:
        model.moveSheet(sheetIndex(cmd.payload.sheet), cmd.payload.index)
        return
      // Upsert: IronCalc splits create/update, the command does not.
      case CommandTypes.setDefinedName: {
        const p = cmd.payload
        const scope = scopeIndex(p.scope)
        const existing = model
          .getDefinedNameList()
          .find((d) => d.name === p.name && (d.scope ?? null) === scope)
        if (existing) model.updateDefinedName(p.name, scope, p.name, scope, p.formula)
        else model.newDefinedName(p.name, scope, p.formula)
        return
      }
      // A name IronCalc doesn't hold is already deleted: the editor drops a
      // name whose cells are gone without knowing whether it was sent.
      case CommandTypes.deleteDefinedName: {
        const p = cmd.payload
        const scope = scopeIndex(p.scope)
        const held = model
          .getDefinedNameList()
          .some((d) => d.name === p.name && (d.scope ?? null) === scope)
        if (held) model.deleteDefinedName(p.name, scope)
        return
      }
      case CommandTypes.batch: {
        model.pauseEvaluation()
        inBatch = true
        try {
          for (const sub of cmd.payload.commands) applyOne(sub)
        } finally {
          inBatch = false
          model.resumeEvaluation()
        }
        model.evaluate()
        return
      }
    }
  }

  // Undo/redo are local (native IronCalc). They mutate state, so they bump
  // the version like any applied command. A no-op returns the version as is.
  function undo(): VersionResult {
    if (!read(() => model.canUndo())) return { version }
    read(() => model.undo())
    formulaRowBound = null
    version += 1
    return { version }
  }

  function redo(): VersionResult {
    if (!read(() => model.canRedo())) return { version }
    read(() => model.redo())
    formulaRowBound = null
    version += 1
    return { version }
  }

  return {
    apply,
    undo,
    redo,
    canUndo: () => read(() => model.canUndo()),
    canRedo: () => read(() => model.canRedo()),
    getDisplayValue: (sheet, row, col) =>
      read(() => model.getFormattedCellValue(sheetIndex(sheet), row, col)),
    getInput: (sheet, row, col) => read(() => model.getCellContent(sheetIndex(sheet), row, col)),
    getStyle: (sheet, row, col) => read(() => model.getCellStyle(sheetIndex(sheet), row, col)),
    // An empty cell reports the number type too.
    isNumber: (sheet, row, col) =>
      read(() => {
        const idx = sheetIndex(sheet)
        return (
          model.getCellContent(idx, row, col) !== '' &&
          model.getCellType(idx, row, col) === NUMBER_CELL
        )
      }),
    getSheets: () => read(() => model.getWorksheetsProperties().map((p) => p.name)),
    getFrozen: (sheet) =>
      read(() => {
        const idx = sheetIndex(sheet)
        return { rows: model.getFrozenRowsCount(idx), cols: model.getFrozenColumnsCount(idx) }
      }),
    getColumnWidth: (sheet, col) => read(() => model.getColumnWidth(sheetIndex(sheet), col)),
    getRowHeight: (sheet, row) => read(() => model.getRowHeight(sheetIndex(sheet), row)),
    // IronCalc has no "all cells" call; scanCells asks each used row for its
    // columns.
    findInputs: (sheet, query, limit) =>
      read(() => {
        const found: FoundCell[] = []
        const q = query.toLowerCase()
        if (!q) return found
        scanCells(sheetIndex(sheet), (row, col, input) => {
          if (input.toLowerCase().includes(q)) found.push({ row, col, input })
          return found.length >= limit
        })
        return found
      }),
    usedCells: (sheet) =>
      read(() => {
        const out: number[] = []
        scanCells(sheetIndex(sheet), (row, col) => {
          out.push(row, col)
        })
        return out
      }),
    // The status bar's Count / Sum / Avg. Same row scan as findInputs, so a
    // whole-column selection costs the used rows, not a million reads.
    rangeStats: (sheet, r1, c1, r2, c2) =>
      read(() => {
        const idx = sheetIndex(sheet)
        const stats: RangeStats = { count: 0, numCount: 0, sum: 0 }
        for (let row = Math.max(1, r1); row <= Math.min(r2, MAX_ROWS); row++) {
          for (const col of model.getColumnsWithData(idx, row)) {
            // A styled but empty cell is listed too.
            if (col < c1 || col > c2 || model.getCellContent(idx, row, col) === '') continue
            stats.count++
            if (model.getCellType(idx, row, col) !== NUMBER_CELL) continue
            const shown = model.getFormattedCellValue(idx, row, col)
            // A date counts but isn't added up: its shown 2026-01-15 read
            // as the number 2026 (ISSUES #67). Only text that looks like a
            // date pays for the style read.
            const dateLike = /\d[-/]\d|[A-Za-z]{3}/.test(shown)
            if (dateLike && isDateFormat(model.getCellStyle(idx, row, col).style.num_fmt)) continue
            const n = numberFromShown(shown)
            if (Number.isFinite(n)) {
              stats.numCount++
              stats.sum += n
            }
          }
        }
        return stats
      }),
    toBytes: () => read(() => model.toBytes()),
    getVersion: () => version,
  }
}
