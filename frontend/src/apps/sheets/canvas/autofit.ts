// How wide a column or how tall a row must be to fit its contents.
//
// Used for double-clicking a header or resize edge (fit exactly) and for a
// committed multi-line value (grow the row, never shrink it). Text is
// measured with the same fonts and wrapping the cell painter uses, so a
// fitted size matches what's drawn. This module only measures; the grid
// applies the size.

import { cellId, colLabel, parseCellId } from '../utils/cells.js'
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

export interface Autofit {
  /** Width that fits the column's header and every unwrapped value. */
  fitColWidth(c: number): number
  /** Height that fits every value in the row. */
  fitRowHeight(r: number): number
  /** Height a multi-line value needs, or null when `current` already fits it. */
  grownRowHeight(r: number, c: number, value: CellValue, current: number): number | null
}

const CELL_PAD = 12 // the painter's left + right text padding
const HEADER_PAD = 16
const MIN_COL_W = 40
const MAX_COL_W = 600
const ROW_PAD = 6
const MAX_ROW_H = 400
const GROW_PAD = 8
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
  function* cellsWhere(
    match: (row: number, col: number) => boolean,
  ): Generator<{ id: string; row: number; col: number; value: CellValue }> {
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

  function fitRowHeight(r: number): number {
    let tallest = minRowH
    for (const cell of cellsWhere((row) => row === r)) {
      const fmt = o.formatAt(cell.id)
      tallest = Math.max(
        tallest,
        visualLines(cell.value, cell.col, fmt) * lineHeightFor(fmt) + ROW_PAD,
      )
    }
    return clamp(Math.ceil(tallest), minRowH, MAX_ROW_H)
  }

  // Only plain text with a hard newline (Cmd+Enter) grows a row, as in
  // Google Sheets. Formulas never do.
  function grownRowHeight(r: number, c: number, value: CellValue, current: number): number | null {
    if (typeof value !== 'string' || value.startsWith('=') || !value.includes('\n')) return null
    const fmt = o.formatAt(cellId(r, c))
    const needed = Math.min(MAX_ROW_H, visualLines(value, c, fmt) * lineHeightFor(fmt) + GROW_PAD)
    return needed > current ? needed : null
  }

  return { fitColWidth, fitRowHeight, grownRowHeight }
}
