// The print view: the workbook as an HTML page the browser prints. Each cell
// shows what the grid shows (number formats, alignment, fills, conditional
// formatting, merges); charts and sparklines are not printed.

import { translate as __ } from '@/platform/translation'

import type { CellFormat } from '../../canvas/types'
import { cellId } from '../../utils/cells.js'
import { applyNumberFmt } from '../../utils/format-number.js'

export type PrintFormat = CellFormat & { numberFormat?: string }

/** One sheet as the editor's stores describe it. */
export interface PrintableSheet {
  name: string
  /** The rows and columns to print, in order. */
  rows: number[]
  cols: number[]
  /** IronCalc's shown value of a cell. */
  shown(id: string): string
  /** The ids of the cells that hold a number. */
  numbers: Set<string>
  /** The cell's format, with any conditional format for `value` on top. */
  format(id: string, value: string): PrintFormat
  /** The size of the merge whose top-left cell this is. */
  mergeAt(id: string): { rowSpan: number; colSpan: number } | null
  /** Whether a merge covers this cell from another one. */
  isCovered(id: string): boolean
}

function escape(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function cellStyle(format: PrintFormat, isNumber: boolean) {
  const decoration = [format.underline && 'underline', format.strikethrough && 'line-through']
  const rules = [
    `text-align:${format.align || (isNumber ? 'right' : 'left')}`,
    format.bold && 'font-weight:600',
    format.italic && 'font-style:italic',
    decoration.some(Boolean) && `text-decoration:${decoration.filter(Boolean).join(' ')}`,
    format.color && `color:${format.color}`,
    format.backgroundColor && `background:${format.backgroundColor}`,
    format.fontSize && `font-size:${format.fontSize}px`,
    format.fontFamily && `font-family:${format.fontFamily}`,
    format.valign && `vertical-align:${format.valign}`,
  ]
  return rules.filter(Boolean).join(';')
}

function cellHtml(sheet: PrintableSheet, r: number, c: number) {
  const id = cellId(r, c)
  if (sheet.isCovered(id)) return ''
  const shown = sheet.shown(id)
  const format = sheet.format(id, shown)
  const isNumber = sheet.numbers.has(id)
  const text = format.numberFormat ? applyNumberFmt(shown, format.numberFormat) : shown
  const merge = sheet.mergeAt(id)
  const span = merge ? ` rowspan="${merge.rowSpan}" colspan="${merge.colSpan}"` : ''
  return `<td${span} style="${escape(cellStyle(format, isNumber))}">${escape(text)}</td>`
}

function sheetHtml(sheet: PrintableSheet) {
  const heading = `<h2>${escape(sheet.name)}</h2>`
  if (!isPrintable(sheet.rows, sheet.cols)) {
    const message = __('This sheet is too large to print. Export it to XLSX instead.')
    return `<section>${heading}<p>${escape(message)}</p></section>`
  }
  const rows = sheet.rows.map((r) => {
    const cells = sheet.cols.map((c) => cellHtml(sheet, r, c))
    return `<tr>${cells.join('')}</tr>`
  })
  return `<section>${heading}<table>${rows.join('')}</table></section>`
}

/** Blank rows or columns up to this many in a row still print, as spacing; longer gaps close up. */
const LONGEST_PRINTED_GAP = 3
/** More cells than this freeze the tab that builds the page. */
const MOST_PRINTED_CELLS = 500_000

/** The rows and columns that hold something, with a merge's whole span, and short gaps kept. */
export function printedGrid(
  used: { row: number; col: number }[],
  mergeAt: (id: string) => { rowSpan: number; colSpan: number } | null,
) {
  const rows = new Set<number>()
  const cols = new Set<number>()
  for (const { row, col } of used) {
    const merge = mergeAt(cellId(row, col))
    for (let r = row; r < row + (merge?.rowSpan ?? 1); r++) rows.add(r)
    for (let c = col; c < col + (merge?.colSpan ?? 1); c++) cols.add(c)
  }
  return { rows: withShortGaps(rows), cols: withShortGaps(cols) }
}

export function isPrintable(rows: number[], cols: number[]) {
  return rows.length * cols.length <= MOST_PRINTED_CELLS
}

/** Sorted indexes as [first, last] runs of neighbours. */
export function indexRuns(indexes: number[]) {
  const runs: [number, number][] = []
  for (const index of indexes) {
    const run = runs.at(-1)
    if (run && run[1] === index - 1) run[1] = index
    else runs.push([index, index])
  }
  return runs
}

function withShortGaps(indexes: Set<number>) {
  const kept: number[] = []
  for (const index of [...indexes].sort((a, b) => a - b)) {
    const previous = kept.at(-1)
    if (previous !== undefined && index - previous - 1 <= LONGEST_PRINTED_GAP)
      for (let gap = previous + 1; gap < index; gap++) kept.push(gap)
    kept.push(index)
  }
  return kept
}

/** The page to print: one table per sheet, each starting on a new page. */
export function printHtml(title: string, sheets: PrintableSheet[]) {
  const body = sheets.filter((sheet) => sheet.rows.length).map(sheetHtml)
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${escape(title)}</title>
<style>
  body{font:11px/1.4 Inter,Arial,sans-serif;margin:20px;color:#171717}
  h1{font-size:15px;margin:0 0 12px}
  h2{font-size:13px;margin:0 0 8px}
  section + section{break-before:page}
  table{border-collapse:collapse}
  td{border:1px solid #d4d4d4;padding:3px 6px;white-space:nowrap;vertical-align:bottom}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  @page{margin:1.5cm}
</style></head>
<body><h1>${escape(title)}</h1>${body.join('')}</body></html>`
}
