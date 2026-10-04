// Types for constants.js, so strict TypeScript can import it.

export const COL_HEADER_H: number
export const ROW_HEADER_W: number
export const DEFAULT_COL_W: number
export const DEFAULT_ROW_H: number
export const SCROLLBAR_THICK: number
export const DEFAULT_TOTAL_ROWS: number
export const DEFAULT_TOTAL_COLS: number

/** Live row/column counts; grow with setTotalRows / setTotalCols. */
export let TOTAL_ROWS: number
export let TOTAL_COLS: number
export function setTotalRows(n: number): void
export function setTotalCols(n: number): void

/** Theme colours, resolved from the frappe-ui CSS tokens on each read. */
export const COLORS: {
	readonly white: string
	readonly gridLine: string
	readonly headerBg: string
	readonly headerText: string
	readonly cellText: string
	readonly inkOnLight: string
	readonly inkOnDark: string
	readonly sparkline: string
	readonly selFill: string
	readonly selBorder: string
	readonly selHandle: string
	readonly activeHeader: string
	readonly rangeHeader: string
	readonly freezeLine: string
	readonly pickerFill: string
	readonly pickerBorder: string
	readonly chipFill: string
	readonly chipCaret: string
	readonly invalidMark: string
}
