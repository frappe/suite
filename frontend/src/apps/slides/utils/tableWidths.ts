// Once every column carries a width, tiptap writes their total as an inline width on
// the <table>, and that beats any CSS the frame could impose. So resizing a table's
// frame means rescaling its columns, and the frame lands on whatever they add up to.

import { getDocFromHTML } from './helpers'

const getColumnWidths = (cell: Element) =>
	(cell.getAttribute('colwidth') || '').split(',').map((width) => parseInt(width, 10))

const getFirstRow = (content: string) => getDocFromHTML(content || '').body.querySelector('tr')

// null when the columns carry no widths: the table then stretches to its frame, and
// element.width is already the only thing saying how wide it is
export const getTableWidth = (content: string) => {
	const firstRow = getFirstRow(content)
	if (!firstRow) return null

	const widths = Array.from(firstRow.children).flatMap(getColumnWidths)
	if (!widths.length || widths.some((width) => !width)) return null

	return widths.reduce((total, width) => total + width, 0)
}

const countColumns = (row: Element) =>
	Array.from(row.children).reduce(
		(total, cell) => total + (parseInt(cell.getAttribute('colspan') || '', 10) || 1),
		0,
	)

// a column renders at least this wide whether or not it has a width of its own, so
// the table simply cannot draw inside a frame narrower than their sum
export const getMinTableWidth = (content: string, cellMinWidth = 25) => {
	const firstRow = getFirstRow(content)
	return firstRow ? countColumns(firstRow) * cellMinWidth : 0
}

const getRows = (content: string) =>
	Array.from(getDocFromHTML(content || '').body.querySelectorAll('tr'))

const readSize = (rows: Element[]) => ({
	rows: rows.length,
	columns: rows[0] ? countColumns(rows[0]) : 0,
})

// a cell seeded with a zero-width space holds nothing the user put there
const isCellFilled = (cell: Element) => !!cell.textContent?.replace(/\u200b/g, '').trim()

// the row and column counters stop here, so a spinner can never take content with it.
// dropping a filled row or column stays deliberate, through the context menu
const readMinSize = (rows: Element[]) => {
	const size = { rows: 1, columns: 1 }

	rows.forEach((row, index) => {
		let column = 0
		Array.from(row.children).forEach((cell) => {
			column += parseInt(cell.getAttribute('colspan') || '', 10) || 1
			if (!isCellFilled(cell)) return
			size.rows = Math.max(size.rows, index + 1)
			size.columns = Math.max(size.columns, column)
		})
	})

	return size
}

const isHeaderCell = (cell: Element | null) => cell?.tagName === 'TH'

// a cell merged downwards covers column 0 in the rows below it, and those rows hold no
// cell of their own there, so their first child is column 1
const getFirstColumnCells = (rows: Element[]) => {
	const cells: Element[] = []
	let covered = 0

	rows.forEach((row) => {
		if (covered > 0) {
			covered -= 1
			return
		}

		const cell = row.firstElementChild
		if (!cell) return

		cells.push(cell)
		covered = (parseInt(cell.getAttribute('rowspan') || '', 10) || 1) - 1
	})

	return cells
}

// a header is on when the whole row or column is header cells
const readHeaders = (rows: Element[]) => {
	const firstRowCells = Array.from(rows[0]?.children || [])
	const firstColumnCells = getFirstColumnCells(rows)

	const row = firstRowCells.length > 0 && firstRowCells.every(isHeaderCell)
	const column = firstColumnCells.length > 0 && firstColumnCells.every(isHeaderCell)

	// one row deep or one column wide, and either header paints the very same cells.
	// It reads as the one running the length of the table, so the panel names a state
	// the user can leave again instead of a permanent Both
	if (row && column) {
		if (rows.length === 1) return { row: true, column: false }
		if (countColumns(rows[0]) === 1) return { row: false, column: true }
	}

	return { row, column }
}

export const getTableSize = (content: string) => readSize(getRows(content))

// the panel reads all three off the same table on every keystroke, so they share
// the one parse rather than taking the html apart three times over
export const getTableInfo = (content: string) => {
	const rows = getRows(content)

	return { size: readSize(rows), minSize: readMinSize(rows), headers: readHeaders(rows) }
}

const setColgroup = (table: HTMLTableElement, widths: number[]) => {
	const colgroup = table.querySelector('colgroup') || table.insertBefore(
		table.ownerDocument.createElement('colgroup'),
		table.firstChild,
	)

	colgroup.replaceChildren(
		...widths.map((width) => {
			const col = table.ownerDocument.createElement('col')
			col.style.width = `${width}px`
			return col
		}),
	)
}

// null when the table has no widths of its own to scale: those lay themselves out
// evenly at whatever width the frame gives them, in the editor and the static render
// alike, so the frame resize alone is the whole change.
export const rescaleColumnWidths = (content: string, ratio: number, cellMinWidth = 25) => {
	if (!Number.isFinite(ratio) || ratio <= 0) return null

	const doc = getDocFromHTML(content || '')
	const table = doc.body.querySelector('table')
	const firstRow = table?.querySelector('tr')
	if (!table || !firstRow) return null

	const columnWidths = Array.from(firstRow.children).flatMap(getColumnWidths)
	if (!columnWidths.length || columnWidths.some((width) => !width)) return null

	const scale = (width: number) => Math.max(cellMinWidth, Math.round(width * ratio))

	// every row states the widths, so scaling in place keeps the columns agreeing
	// without having to map cells onto columns through colspans and rowspans
	table.querySelectorAll('[colwidth]').forEach((cell) => {
		cell.setAttribute('colwidth', getColumnWidths(cell).map(scale).join(','))
	})

	const scaledWidths = columnWidths.map(scale)
	setColgroup(table, scaledWidths)

	table.style.width = `${scaledWidths.reduce((total, width) => total + width, 0)}px`
	table.style.minWidth = ''

	return { content: doc.body.innerHTML, width: parseFloat(table.style.width) }
}

// on the table for as long as its frame is being dragged
export const frameResizeAttribute = 'data-frame-resizing'

const readRenderedColumns = (table: HTMLTableElement) => {
	const row = table.querySelector('tr')
	if (!row) return null

	const cols = Array.from(table.querySelectorAll('col'))
	const widths = Array.from(row.children).flatMap(getColumnWidths)
	if (!widths.length || widths.length !== cols.length) return null
	if (widths.some((width) => !width)) return null

	return { cols, widths, total: widths.reduce((sum, width) => sum + width, 0) }
}

// pixel columns would hold the table at its old size inside a moving frame, shares follow it
export const stretchColumnsToFrame = (table: HTMLTableElement) => {
	const columns = readRenderedColumns(table)
	if (!columns) return

	table.style.width = '100%'
	columns.cols.forEach((col, index) => {
		col.style.width = `${(columns.widths[index] / columns.total) * 100}%`
	})
}

export const restoreColumnWidths = (table: HTMLTableElement) => {
	const columns = readRenderedColumns(table)
	if (!columns) return

	table.style.width = `${columns.total}px`
	columns.cols.forEach((col, index) => {
		col.style.width = `${columns.widths[index]}px`
	})
}
