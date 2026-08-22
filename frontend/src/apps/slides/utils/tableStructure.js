import { TextSelection } from 'prosemirror-state'
import { TableMap } from 'prosemirror-tables'

import { activeEditor } from '@/apps/slides/composables/useTextEditor'
import { ZWSP, getCells, seedNewCells } from '@/apps/slides/stores/tiptapSetup'

// the row and column commands act on the cell the selection is in, and an editor
// nobody has typed in leaves it in the first one
const selectLastCell = ({ tr }) => {
	const cells = getCells(tr.doc)
	if (!cells.length) return false

	tr.setSelection(TextSelection.create(tr.doc, cells[cells.length - 1].pos + 2))
	return true
}

const getFirstRow = (doc) => {
	const [first] = getCells(doc)
	return first ? doc.resolve(first.pos).parent : null
}

// a column states its width on every cell in it, so evening the columns out means
// writing the same number into all of them
const setEvenColumnWidths = ({ tr }) => {
	const firstRow = getFirstRow(tr.doc)
	if (!firstRow) return false

	const widths = []
	firstRow.forEach((cell) => widths.push(...(cell.attrs.colwidth || [])))
	if (!widths.length || widths.some((width) => !width)) return false

	const even = Math.round(widths.reduce((total, width) => total + width, 0) / widths.length)
	getCells(tr.doc).forEach(({ pos, node }) => {
		tr.setNodeAttribute(pos, 'colwidth', Array(node.attrs.colspan).fill(even))
	})
	return true
}

const resizeTable = (command, times) => {
	if (times < 1 || !activeEditor.value) return

	// selectLastCell borrows the caret, and the user wants it back where they left it
	const caret = activeEditor.value.state.selection.from

	const chain = activeEditor.value.chain()
	for (let index = 0; index < times; index++) chain.command(selectLastCell)[command]()
	chain
		.command(seedNewCells)
		.command(({ tr }) => {
			tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(caret))))
			return true
		})
		.run()
}

// prosemirror carries a cell's content into the merge unless the cell is truly empty,
// and a seeded cell holds a zero-width space, so the blank ones stack up as blank lines
const dropSeededParagraphs = ({ tr }) => {
	const $cell = tr.selection.$anchorCell
	if (!$cell) return true

	const cell = $cell.nodeAfter
	const blanks = []
	cell.forEach((child, offset) => {
		if (child.textContent === ZWSP) blanks.push({ from: $cell.pos + 1 + offset, size: child.nodeSize })
	})

	blanks
		.reverse()
		.slice(0, cell.childCount - 1)
		.forEach(({ from, size }) => tr.delete(from, from + size))

	return true
}

export const mergeCells = () =>
	activeEditor.value?.chain().focus().mergeCells().command(dropSeededParagraphs).run()

// the context menu runs on the focused editor, so the commands land where the caret
// is and only the cells they leave behind need seeding. The menu holds the focus while
// it is open and hands it back to whatever it took it from, which leaves the caret
// nowhere, so each op focuses again on its way out.
export const runTableCommand = (command) =>
	activeEditor.value?.chain().focus()[command]().command(seedNewCells).run()

export const distributeColumns = () =>
	activeEditor.value?.chain().focus().command(setEvenColumnWidths).run()

// prosemirror's own header toggles read the cells to decide which way they turn, and
// skip the corner cell so the two headers don't fight over it. On a table one row deep
// or one column wide that leaves them nothing to act on. Naming the target outright
// reaches every state instead, and needs no focused editor either.
// Which cell sits in row 0 or column 0 is a question a merged cell makes non-obvious,
// so the table's own map answers it rather than the cell's index in its row
export const setTableHeaders = ({ row, column }) =>
	activeEditor.value?.commands.command(({ tr }) => {
		const { tableHeader, tableCell } = tr.doc.type.schema.nodes

		tr.doc.descendants((node, pos) => {
			if (node.type.name !== 'table') return

			const map = TableMap.get(node)
			const headers = new Set()
			map.map.forEach((offset, index) => {
				if ((row && index < map.width) || (column && index % map.width === 0)) headers.add(offset)
			})

			// setNodeMarkup leaves the doc the same size, so the offsets stay good
			new Set(map.map).forEach((offset) => {
				const cell = tr.doc.nodeAt(pos + 1 + offset)
				const type = headers.has(offset) ? tableHeader : tableCell
				if (cell.type !== type) tr.setNodeMarkup(pos + 1 + offset, type, cell.attrs)
			})

			return false
		})

		return true
	})

export const setRowCount = (count, current) =>
	count > current
		? resizeTable('addRowAfter', count - current)
		: resizeTable('deleteRow', current - count)

export const setColumnCount = (count, current) =>
	count > current
		? resizeTable('addColumnAfter', count - current)
		: resizeTable('deleteColumn', current - count)
