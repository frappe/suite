import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

const { getInitialTableContent } = await import('@/apps/slides/stores/element')
const { useTextEditor } = await import('@/apps/slides/composables/useTextEditor')
const {
	setRowCount,
	setColumnCount,
	setTableHeaders,
	runTableCommand,
	distributeColumns,
	mergeCells,
} = await import('./tableStructure')
const { getCells } = await import('@/apps/slides/stores/tiptapSetup')
const { getTableSize, getTableWidth, getTableInfo } = await import('./tableWidths')
const { CellSelection } = await import('prosemirror-tables')

const { activeEditor, initTextEditor } = useTextEditor()

const openTable = (rows: number, columns: number) =>
	initTextEditor('t1', getInitialTableContent(rows, columns, 150, { fontFamily: 'Inter' }))

const html = () => activeEditor.value.getHTML()

afterEach(() => {
	activeEditor.value?.destroy()
	activeEditor.value = null
})

// the context menu only shows on a focused table, where the caret and any cell
// selection are the editor's own
const selectCells = (first: number, last: number) => {
	activeEditor.value.setEditable(true)
	activeEditor.value
		.chain()
		.command(({ tr }) => {
			const cells = getCells(tr.doc)
			tr.setSelection(CellSelection.create(tr.doc, cells[first].pos, cells[last].pos))
			return true
		})
		.run()
}

const typeInFirstCell = (text: string) => {
	activeEditor.value.setEditable(true)
	const [first] = getCells(activeEditor.value.state.doc)
	activeEditor.value.chain().setTextSelection(first.pos + 2).insertContent(text).run()
}

const setColumnWidth = (column: number, width: number, columns: number) =>
	activeEditor.value
		.chain()
		.command(({ tr }) => {
			getCells(tr.doc).forEach(({ pos }, index) => {
				if (index % columns === column) tr.setNodeAttribute(pos, 'colwidth', [width])
			})
			return true
		})
		.run()

describe('setRowCount', () => {
	// the cursor of an editor nobody has typed in sits in the first cell, and the
	// commands go by the cursor
	it('adds and removes rows at the trailing edge', () => {
		openTable(2, 2)

		setRowCount(4, 2)
		expect(getTableSize(html()).rows).toBe(4)

		setRowCount(2, 4)
		expect(getTableSize(html())).toEqual({ rows: 2, columns: 2 })
	})
})

describe('setColumnCount', () => {
	it('adds and removes columns at the trailing edge', () => {
		openTable(2, 2)

		setColumnCount(3, 2)
		expect(getTableSize(html()).columns).toBe(3)

		setColumnCount(1, 3)
		expect(getTableSize(html())).toEqual({ rows: 2, columns: 1 })
	})

	// without a width of its own the new column leaves the table unable to say how
	// wide it is, and the frame around it stops following
	it('gives a new column the width the others carry', () => {
		openTable(2, 2)

		setColumnCount(3, 2)

		expect(getTableWidth(html())).toBe(450)
	})

	// a mark needs text to sit on, so a bare new cell would read as unstyled
	it('seeds a new cell with the styles the panel edits', () => {
		openTable(2, 2)

		setColumnCount(3, 2)

		expect(html().match(/Inter/g)).toHaveLength(6)
	})

	// a bare paragraph carries no alignment, which a header cell reads as the
	// browser's centred default and the rest of the table reads as left
	it('seeds a new cell with the alignment the others carry', () => {
		openTable(2, 2)
		activeEditor.value.chain().selectAll().setTextAlign('center').run()

		setColumnCount(3, 2)

		expect(html().match(/text-align: center/g)).toHaveLength(6)
	})
})

describe('mergeCells', () => {
	// prosemirror zeroes the absorbed column's width and repairs it from the rows below,
	// so the table forgets how wide it is if the merge leaves no row to repair from
	it('keeps the table width when cells merge', () => {
		openTable(2, 2)
		selectCells(0, 1)

		mergeCells()

		expect(getTableWidth(html())).toBe(300)
	})

	// prosemirror only drops a cell's content when the cell is truly empty, and a
	// seeded one is not, so its paragraph used to land in the merge as a blank line
	it('leaves the merged cell a single paragraph', () => {
		openTable(2, 2)
		selectCells(0, 1)

		mergeCells()

		expect(html().match(/<p/g)).toHaveLength(3)
	})

	it('keeps the text when a filled cell merges with an empty one', () => {
		openTable(2, 2)
		typeInFirstCell('one')
		selectCells(0, 1)

		mergeCells()

		expect(html()).toContain('one')
		expect(html().match(/<p/g)).toHaveLength(3)
	})
})

describe('distributeColumns', () => {
	// the frame follows the columns, so evening them out must leave the total alone
	it('gives every column the same width', () => {
		openTable(2, 2)
		setColumnWidth(0, 250, 2)

		distributeColumns()

		expect(html().match(/colwidth="200"/g)).toHaveLength(4)
		expect(getTableWidth(html())).toBe(400)
		expect(html()).toContain('width: 400px')
	})
})

describe('setTableHeaders', () => {
	// a new table already comes with its first row as headers
	it('reaches every combination from any other', () => {
		openTable(2, 2)
		expect(getTableInfo(html()).headers).toEqual({ row: true, column: false })

		setTableHeaders({ row: true, column: true })
		expect(getTableInfo(html()).headers).toEqual({ row: true, column: true })

		setTableHeaders({ row: false, column: true })
		expect(getTableInfo(html()).headers).toEqual({ row: false, column: true })

		setTableHeaders({ row: false, column: false })
		expect(getTableInfo(html()).headers).toEqual({ row: false, column: false })

		setTableHeaders({ row: true, column: false })
		expect(getTableInfo(html()).headers).toEqual({ row: true, column: false })
	})

	it('keeps the width a header cell carries', () => {
		openTable(2, 2)

		setTableHeaders({ row: false, column: false })

		expect(getTableWidth(html())).toBe(300)
	})

	// prosemirror's toggles skip the corner cell, which on these tables is every cell
	// they were given, so a header could neither be turned off nor named honestly
	it('turns the header off on a table one row deep', () => {
		openTable(1, 3)
		expect(getTableInfo(html()).headers).toEqual({ row: true, column: false })

		setTableHeaders({ row: false, column: false })

		expect(getTableInfo(html()).headers).toEqual({ row: false, column: false })
	})

	// a merged cell covers column 0 from the row above, so the row below has no cell of
	// its own there and the one it does have belongs to column 1
	it('reads a column of merged header cells as a column header', () => {
		openTable(2, 2)
		selectCells(0, 2)
		mergeCells()

		expect(getTableInfo(html()).headers).toEqual({ row: true, column: true })
	})

	it('writes a column header onto the cell that covers column 0', () => {
		openTable(2, 2)
		selectCells(0, 2)
		mergeCells()

		setTableHeaders({ row: false, column: true })

		expect(html().match(/<th/g)).toHaveLength(1)
		expect(getTableInfo(html()).headers).toEqual({ row: false, column: true })
	})

	it('turns the header off on a table one column wide', () => {
		openTable(3, 1)
		setTableHeaders({ row: false, column: true })
		expect(getTableInfo(html()).headers).toEqual({ row: false, column: true })

		setTableHeaders({ row: false, column: false })

		expect(getTableInfo(html()).headers).toEqual({ row: false, column: false })
	})
})
