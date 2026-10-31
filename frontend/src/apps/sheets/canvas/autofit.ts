// How wide a column or how tall a row must be to fit its contents.
//
// Used for double-clicking a header or resize edge (fit exactly), and for
// refitting a row to its wrapped or multi-line text after an edit or a
// column resize. Text is measured with the same fonts and wrapping the cell
// painter uses, so a fitted size matches what's drawn. This module only
// measures; the grid applies the size and decides which rows may change.

import { colLabel, parseCellId } from '../utils/cells.js'
import { getTextWrap, isWrapText, lineHeightFor, wrapLines } from '../utils/text-wrap.js'
import { chipFont } from './chip-geometry.js'
import type { CellFormat, CellValue } from './types.js'

export type MeasureContext = Pick<
  CanvasRenderingContext2D,
  'save' | 'restore' | 'measureText' | 'font'
>

export interface AutofitOptions {
  ctx: MeasureContext
  /** Current column width in logical px (wrapped text wraps to it). */
  colWidth(c: number): number
  /** Every non-empty cell id on the sheet. */
  cellIds(): Iterable<string>
  valueAt(id: string): CellValue
  formatAt(id: string): CellFormat
}

/** Values being written, by cell id, measured before the grid shows them. */
export type PendingWrites = Readonly<{ [id: string]: CellValue }>

export interface Autofit {
  /** Width that fits the column's header and every unwrapped value. */
  fitColWidth(c: number): number
  /** Height that fits every value in the row. */
  fitRowHeight(r: number): number
  /**
   * Every non-empty matching row's fitted height and whether it holds tall
   * text, in one pass over the cells (a whole-column wrap refits many rows),
   * with `writes` in place of what their cells show.
   */
  measureRows(
    match: (row: number) => boolean,
    writes?: PendingWrites,
  ): Map<number, { height: number; tall: boolean }>
  /** Rows with a wrapped cell in one of `cols`: their height follows the width. */
  wrappedRows(cols: ReadonlySet<number>): number[]
}

type RowCell = { id: string; row: number; col: number; value: CellValue }

const CELL_PAD = 12 // the painter's left + right text padding
const HEADER_PAD = 16
const MIN_COL_W = 40
const MAX_COL_W = 600
const ROW_PAD = 6
const MAX_ROW_H = 400
const BASE_FONT = '13px InterVar, Inter, ui-sans-serif, system-ui, sans-serif'

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export function createAutofit(o: AutofitOptions, minRowH: number): Autofit {
  const { ctx } = o

  function measureWidth(text: CellValue, fmt: CellFormat): number {
    ctx.save()
    ctx.font = `${fmt.italic ? 'italic' : 'normal'} ${fmt.bold ? 'bold' : 'normal'} ${BASE_FONT}`
    const w = ctx.measureText(String(text)).width
    ctx.restore()
    return w
  }

  // Lines a value takes in column c: hard newlines, plus soft wrapping to
  // the cell width (minus the painter's 8px inset) in wrap mode.
  function visualLines(value: CellValue, c: number, fmt: CellFormat): number {
    if (getTextWrap(fmt) !== 'wrap') return String(value).split('\n').length
    ctx.save()
    ctx.font = chipFont(fmt)
    const maxW = Math.max(1, o.colWidth(c) - 8)
    const n = wrapLines(value, maxW, (t) => ctx.measureText(t).width).length
    ctx.restore()
    return n
  }

  // Non-empty cells in one column or row, with their position.
  function* cellsWhere(match: (row: number, col: number) => boolean): Generator<RowCell> {
    for (const id of o.cellIds()) {
      const p = parseCellId(id)
      if (!p || !match(p.row, p.col)) continue
      const value = o.valueAt(id)
      if (value == null || value === '') continue
      yield { id, row: p.row, col: p.col, value }
    }
  }

  function fitColWidth(c: number): number {
    let widest = measureWidth(colLabel(c), { bold: true }) + HEADER_PAD
    for (const cell of cellsWhere((_, col) => col === c)) {
      const fmt = o.formatAt(cell.id)
      // Wrapped cells grow their row instead of the column.
      if (isWrapText(fmt)) continue
      widest = Math.max(widest, measureWidth(cell.value, fmt) + CELL_PAD)
    }
    return clamp(Math.ceil(widest), MIN_COL_W, MAX_COL_W)
  }

  function heightOf(cells: readonly RowCell[]): number {
    let tallest = minRowH
    for (const cell of cells) {
      const fmt = o.formatAt(cell.id)
      tallest = Math.max(
        tallest,
        visualLines(cell.value, cell.col, fmt) * lineHeightFor(fmt) + ROW_PAD,
      )
    }
    return clamp(Math.ceil(tallest), minRowH, MAX_ROW_H)
  }

  function tallIn(cells: readonly RowCell[]): boolean {
    return cells.some(
      (cell) => isWrapText(o.formatAt(cell.id)) || String(cell.value).includes('\n'),
    )
  }

  const fitRowHeight = (r: number) => heightOf([...cellsWhere((row) => row === r)])

  // A formula's result isn't known yet, so a formula write keeps the shown
  // value; any other write replaces it, and an empty one clears the cell.
  const isFormula = (v: CellValue) => typeof v === 'string' && v.startsWith('=')
  const blank = (v: CellValue) => v == null || v === ''

  function measureRows(match: (row: number) => boolean, writes: PendingWrites = {}) {
    const byRow = new Map<number, RowCell[]>()
    const add = (cell: RowCell) => {
      const list = byRow.get(cell.row)
      if (list) list.push(cell)
      else byRow.set(cell.row, [cell])
    }
    const written = new Map<string, CellValue>()
    for (const [id, value] of Object.entries(writes)) if (!isFormula(value)) written.set(id, value)
    for (const cell of cellsWhere((row) => match(row))) {
      if (!written.has(cell.id)) add(cell)
    }
    for (const [id, value] of written) {
      const p = parseCellId(id)
      if (p && match(p.row) && !blank(value)) add({ id, row: p.row, col: p.col, value })
    }
    const out = new Map<number, { height: number; tall: boolean }>()
    for (const [row, cells] of byRow) out.set(row, { height: heightOf(cells), tall: tallIn(cells) })
    return out
  }

  function wrappedRows(cols: ReadonlySet<number>): number[] {
    if (!cols.size) return []
    const rows = new Set<number>()
    for (const cell of cellsWhere((_, col) => cols.has(col))) {
      if (isWrapText(o.formatAt(cell.id))) rows.add(cell.row)
    }
    return [...rows]
  }

  return { fitColWidth, fitRowHeight, measureRows, wrappedRows }
}
