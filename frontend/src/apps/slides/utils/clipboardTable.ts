import tinycolor from 'tinycolor2'
import { getDocFromHTML } from './helpers'

const MAX_ROWS = 50
const MAX_COLUMNS = 20

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
const ALIGNS = new Set(['left', 'center', 'right'])

type CellStyle = {
	bold: boolean
	italic: boolean
	underline: boolean
	strike: boolean
	align: string | null
	color: string | null
	fill: string | null
	size: number
}

type PastedCell = { lines: string[]; colspan: number; rowspan: number; style?: CellStyle }

// null: the slot sits under a merged cell
type Slot = PastedCell | null

const cleanText = (text: string) => text.replace(/\u200b/g, '').replace(/\s/g, ' ').trim()

// text outside the table would be lost, so only a bare table passes
const getWholeTable = (html: string) => {
	const body = getDocFromHTML(html).body
	body.querySelectorAll('style, script').forEach((node) => node.remove())
	const tables = body.querySelectorAll('table')
	if (tables.length !== 1) return null
	return cleanText(body.textContent || '') === cleanText(tables[0].textContent || '')
		? tables[0]
		: null
}

const collectLines = (node: Node, lines: string[]) => {
	const endLine = () => lines[lines.length - 1].trim() && lines.push('')
	for (const child of node.childNodes) {
		const isBlock = BLOCK_TAGS.has(child.nodeName)
		if (isBlock) endLine()
		if (child.nodeType === Node.TEXT_NODE) lines[lines.length - 1] += child.textContent
		else if (child.nodeName === 'BR') lines.push('')
		else collectLines(child, lines)
		if (isBlock) endLine()
	}
	return lines
}

const readLines = (cell: Element) => {
	const lines = collectLines(cell, ['']).map(cleanText)
	while (lines.length && !lines[0]) lines.shift()
	while (lines.length && !lines[lines.length - 1]) lines.pop()
	return lines
}

const readColor = (value: string) => {
	const color = tinycolor(value)
	return color.isValid() && color.getAlpha() > 0 ? color.toHex8String() : null
}

const readFontSize = (value: string) => {
	const size = parseFloat(value)
	if (!(size > 0)) return null
	if (value.endsWith('pt')) return size * (4 / 3)
	return value.endsWith('px') ? size : null
}

const readStyle = (cell: HTMLTableCellElement, baseSize: number | null): CellStyle => {
	const { style } = cell
	const align = style.textAlign || cell.getAttribute('align') || ''
	const size = readFontSize(style.fontSize)
	return {
		bold: style.fontWeight === 'bold' || parseInt(style.fontWeight, 10) >= 600,
		italic: style.fontStyle === 'italic',
		underline: style.textDecoration.includes('underline'),
		strike: style.textDecoration.includes('line-through'),
		align: ALIGNS.has(align) ? align : null,
		color: readColor(style.color),
		fill: readColor(style.backgroundColor),
		size: baseSize && size ? size / baseSize : 1,
	}
}

const readSpan = (cell: Element, name: string, max: number) => {
	const span = parseInt(cell.getAttribute(name) || '', 10)
	return span > 0 ? Math.min(span, max) : 1
}

// null: a filled cell sits past the column limit, so the table is over it however it is trimmed
const readGrid = (rows: HTMLTableRowElement[], baseSize: number | null) => {
	const grid: (Slot | undefined)[][] = []
	for (const [row, tableRow] of rows.entries()) {
		let column = 0
		for (const cell of tableRow.cells) {
			while (grid[row]?.[column] !== undefined) column++
			const colspan = readSpan(cell, 'colspan', MAX_COLUMNS)
			const rowspan = readSpan(cell, 'rowspan', rows.length - row)
			const lines = readLines(cell)
			if (lines.length && column + colspan > MAX_COLUMNS) return null
			for (let r = row; r < row + rowspan; r++) {
				grid[r] ??= []
				for (let c = column; c < column + colspan; c++) grid[r][c] = null
			}
			grid[row][column] = { lines, colspan, rowspan, style: readStyle(cell, baseSize) }
			column += colspan
		}
	}
	return grid
}

// a whole-row copy brings every empty column of the sheet along
const trimToFilled = (grid: (Slot | undefined)[][]) => {
	let rows = 0
	let columns = 0
	grid.forEach((row, r) =>
		row?.forEach((cell, c) => {
			if (!cell?.lines.length) return
			rows = Math.max(rows, r + cell.rowspan)
			columns = Math.max(columns, c + cell.colspan)
		}),
	)
	return Array.from({ length: rows }, (_, r) =>
		Array.from({ length: columns }, (_, c): Slot => {
			const cell = grid[r]?.[c]
			if (cell === undefined) return { lines: [], colspan: 1, rowspan: 1 }
			if (cell === null) return null
			return {
				...cell,
				colspan: Math.min(cell.colspan, columns - c),
				rowspan: Math.min(cell.rowspan, rows - r),
			}
		}),
	)
}

const readColumnRatios = (table: HTMLTableElement, columns: number) => {
	const widths = Array.from(table.querySelectorAll('col')).flatMap((col) => {
		const width = parseFloat(col.getAttribute('width') || col.style.width)
		return Array(parseInt(col.getAttribute('span') || '', 10) || 1).fill(width)
	})
	const ratios = widths.slice(0, columns)
	return ratios.length === columns && ratios.every((width) => width > 0) ? ratios : null
}

// null keeps today's paste: no table, a single cell, or more than the limit
export const getClipboardTable = (html: string) => {
	const table = getWholeTable(html)
	if (!table) return null
	// a whole-column copy brings every empty row of the sheet along
	const rows = Array.from(table.rows)
	while (rows.length && !cleanText(rows[rows.length - 1].textContent || '')) rows.pop()
	if (rows.length > MAX_ROWS) return null
	const grid = readGrid(rows, readFontSize(table.style.fontSize))
	if (!grid) return null
	const cells = trimToFilled(grid)
	const columns = cells[0]?.length || 0
	if (cells.length * columns < 2) return null
	return { cells, columnRatios: readColumnRatios(table, columns) }
}
