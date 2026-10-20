// The print view: the workbook as an HTML page the browser prints. Each cell
// shows what the grid shows (number formats, alignment, fills, conditional
// formatting, merges); charts and sparklines are not printed.

import type { CellFormat } from '../../canvas/types'
import { cellId } from '../../utils/cells.js'
import { applyNumberFmt } from '../../utils/format-number.js'

export type PrintFormat = CellFormat & { numberFormat?: string }

/** One sheet as the editor's stores describe it. */
export interface PrintableSheet {
  name: string
  /** IronCalc's shown values, A1 to the last used cell. */
  displays: string[][]
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
  const shown = sheet.displays[r]?.[c] ?? ''
  const format = sheet.format(id, shown)
  const isNumber = sheet.numbers.has(id)
  const text = format.numberFormat ? applyNumberFmt(shown, format.numberFormat) : shown
  const merge = sheet.mergeAt(id)
  const span = merge ? ` rowspan="${merge.rowSpan}" colspan="${merge.colSpan}"` : ''
  return `<td${span} style="${escape(cellStyle(format, isNumber))}">${escape(text)}</td>`
}

function sheetHtml(sheet: PrintableSheet) {
  const width = Math.max(0, ...sheet.displays.map((row) => row.length))
  const rows = sheet.displays.map((_, r) => {
    const cells = Array.from({ length: width }, (_, c) => cellHtml(sheet, r, c))
    return `<tr>${cells.join('')}</tr>`
  })
  return `<section><h2>${escape(sheet.name)}</h2><table>${rows.join('')}</table></section>`
}

/** The page to print: one table per sheet, each starting on a new page. */
export function printHtml(title: string, sheets: PrintableSheet[]) {
  const body = sheets.filter((sheet) => sheet.displays.length).map(sheetHtml)
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
