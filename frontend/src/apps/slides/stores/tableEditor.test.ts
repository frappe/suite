import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { CellSelection } from 'prosemirror-tables'
import { AllSelection } from 'prosemirror-state'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

const { getInitialTableContent, activeElementIds, focusElementId, setEditableState } =
	await import('./element')
const { slides, slideIndex } = await import('./slide')
const { hasTableNode, ZWSP } = await import('./tiptapSetup')
const { useTextEditor } = await import('@/apps/slides/composables/useTextEditor')
const { useCommandHistory } = await import('@/apps/slides/composables/useCommandHistory')
const { actionOrder, actions, setCommandHistory } = await import('./historyMeta')
const { setRowCount } = await import('@/apps/slides/utils/tableStructure')
const { getTableWidth } = await import('@/apps/slides/utils/tableWidths')

const { activeEditor, initTextEditor } = useTextEditor()

const filled =
	'<table><tbody><tr><td><p>one</p></td><td><p>two</p></td></tr><tr><td><p>three</p></td><td><p>four</p></td></tr></tbody></table>'

const seeded = (rows = 2, columns = 2) =>
	getInitialTableContent(rows, columns, 150, { fontFamily: 'Inter', fontSize: 18 })

const bareTable = (rows: number, columns: number) =>
	`<table><tbody>${`<tr>${'<td><p>x</p></td>'.repeat(columns)}</tr>`.repeat(rows)}</tbody></table>`

const cellPositions = () => {
	const positions: number[] = []
	activeEditor.value.state.doc.descendants((node: any, pos: number) => {
		if (['tableCell', 'tableHeader'].includes(node.type.name)) positions.push(pos)
	})
	return positions
}

const caretInCell = (index = 0) => {
	const pos = cellPositions().at(index) + 2
	activeEditor.value.commands.setTextSelection(pos)
	return pos
}

const selectCells = (from: number, to: number) => {
	const { view } = activeEditor.value
	view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, from, to)))
}

// the bindings under test are Table's own, so the press has to reach the keymap
const pressKey = (key: string) =>
	activeEditor.value.view.someProp('handleKeyDown', (handler: any) =>
		handler(activeEditor.value.view, new KeyboardEvent('keydown', { key })),
	)

const typedText = () => activeEditor.value.state.doc.textContent.replaceAll(ZWSP, '')

// the element store re-runs its editor lifecycle on a selection change, so build
// the editor under test after those watchers settle
const mountTable = async (content: string, editable = true) => {
	slides.value = [{ clientId: 'c1', elements: [{ id: 1, type: 'table', content }] }] as any
	slideIndex.value = 0
	activeElementIds.value = [1]
	focusElementId.value = editable ? 1 : null
	await nextTick()

	initTextEditor(1, content, editable)
	await nextTick()
}

beforeEach(async () => {
	activeElementIds.value = []
	focusElementId.value = null
	await nextTick()
})

afterEach(() => {
	activeEditor.value?.destroy()
	activeEditor.value = null
})

// frappe-ui's editor stylesheets are global in this bundle and scroll any
// .ProseMirror .tableWrapper, so the editor must render the same bare table
// the static v-html render does
describe('how the editor draws a table', () => {
	it('renders no wrapper element around it', () => {
		initTextEditor('t1', filled, true)

		expect(activeEditor.value.view.dom.querySelector('.tableWrapper')).toBe(null)
		expect(activeEditor.value.view.dom.querySelector('table')?.parentElement).toBe(
			activeEditor.value.view.dom,
		)
	})
})

describe('where Tab leaves the caret', () => {
	it('collapses to a caret in a cell that has not been typed in', async () => {
		await mountTable(seeded())
		caretInCell()

		activeEditor.value.commands.goToNextCell(1)

		expect(activeEditor.value.state.selection.empty).toBe(true)
	})

	it('still selects the contents of a cell that has text', async () => {
		await mountTable(filled)
		caretInCell()

		activeEditor.value.commands.goToNextCell(1)

		const { from, to } = activeEditor.value.state.selection
		expect(activeEditor.value.state.doc.textBetween(from, to)).toBe('two')
	})

	// stock adds the row bare, and a cell with no alignment of its own reads the
	// browser's centred default the moment it is made a header
	it('seeds the row it appends at the last cell', async () => {
		await mountTable(seeded())
		caretInCell(-1)

		pressKey('Tab')

		const html = activeEditor.value.getHTML()
		expect(html.match(/text-align: left/g)).toHaveLength(6)
		expect(html.match(/font-size: 18px/g)).toHaveLength(6)
	})

	// a range drawn across lines holds only the blank one's placeholder, and collapsing
	// it hands the next styling the whole cell
	it('leaves a selection the user drew across two lines alone', async () => {
		await mountTable(
			`<table><tbody><tr><td><p>abc</p><p>${ZWSP}</p></td><td><p>two</p></td></tr></tbody></table>`,
		)
		const cell = caretInCell()

		activeEditor.value.commands.setTextSelection({ from: cell + 3, to: cell + 6 })

		expect(activeEditor.value.state.selection.empty).toBe(false)
	})
})

describe('where undo leaves the caret', () => {
	// the caret sat past the text the undo removed, so its old position names another cell
	it('keeps it where it was after undoing a run of typing', async () => {
		const history = useCommandHistory(slides, { actionOrder, actions })
		setCommandHistory(history)

		await mountTable(filled)
		const endOfFirstCell = caretInCell() + 'one'.length
		activeEditor.value.commands.setTextSelection(endOfFirstCell)

		activeEditor.value.commands.insertContent('ABCDEFGHIJ')
		await nextTick()

		await history.undo()
		await nextTick()
		await nextTick()

		expect(activeEditor.value.state.selection.from).toBe(endOfFirstCell)
	})

	// no caret is visible yet, so a selection parked at the end surfaces on the next entry
	it('keeps it there when the undo lands on an element nobody is editing', async () => {
		await mountTable(filled, false)
		const pos = caretInCell()

		slides.value[0].elements[0].content = filled.replace('one', 'edited')
		await nextTick()

		setEditableState()

		expect(activeEditor.value.state.selection.from).toBe(pos)
	})

	// cell selections end on the cells themselves, and putting one of those back as a
	// text selection leaves a range the next keystroke resolves into some other cell
	it('leaves a position a caret can actually sit in when cells were selected', async () => {
		await mountTable(filled)
		const cells = cellPositions()
		selectCells(cells[0], cells.at(-1))

		slides.value[0].elements[0].content = filled.replace('one', 'edited')
		await nextTick()

		expect(activeEditor.value.state.selection.$from.parent.inlineContent).toBe(true)
	})

	// replacing only the differing range cuts mid-node, and prosemirror fits the pieces
	// back by nesting a table inside a cell, which only shows up on redo
	it('puts the same table back on redo', async () => {
		const history = useCommandHistory(slides, { actionOrder, actions })
		setCommandHistory(history)

		await mountTable(filled)
		caretInCell()

		activeEditor.value.commands.insertContent('XYZ')
		await nextTick()
		const edited = activeEditor.value.getHTML()

		await history.undo()
		await nextTick()
		await nextTick()
		await history.redo()
		await nextTick()
		await nextTick()

		expect(activeEditor.value.getHTML()).toBe(edited)
	})

	// the row and column commands run on the last cell, borrowing the caret to get there
	it('puts it back in the cell the panel borrowed it from', async () => {
		await mountTable(filled)
		const pos = caretInCell()

		setRowCount(3, 2)

		expect(activeEditor.value.state.selection.from).toBe(pos)
	})
})

// stock deletes the table once every cell is selected, leaving an empty paragraph
describe('backspace over a whole table', () => {
	it('empties the cells and leaves the table standing', () => {
		initTextEditor('t1', filled, true)
		const cells = cellPositions()
		selectCells(cells[0], cells.at(-1))

		pressKey('Backspace')

		expect(hasTableNode(activeEditor.value.state.doc)).toBe(true)
		expect(typedText()).toBe('')
	})

	it('empties the cells when the whole document is selected instead', () => {
		initTextEditor('t2', filled, true)
		const { view } = activeEditor.value
		view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))

		pressKey('Backspace')

		expect(hasTableNode(activeEditor.value.state.doc)).toBe(true)
		expect(typedText()).toBe('')
	})

	it('still empties just the cells that are selected', () => {
		initTextEditor('t3', filled, true)
		const cells = cellPositions()
		selectCells(cells[0], cells[1])

		pressKey('Backspace')

		expect(typedText()).toBe('threefour')
	})

	// with nothing for them to sit on the cell's marks go with the text, and every
	// styling the panel does afterwards is a no-op
	it('leaves the cells something for their styles to sit on', () => {
		initTextEditor('t4', seeded(), true)
		const cells = cellPositions()
		selectCells(cells[0], cells.at(-1))

		pressKey('Backspace')

		expect(typedText()).toBe('')
		expect(activeEditor.value.getHTML().match(/font-size: 18px/g)).toHaveLength(4)
	})
})

// a width-less column leaves getTableWidth nothing to report, and the frame stops
// following the table
describe('what the table can still say about its own width', () => {
	it('stays measurable after a paste grows it by a column', () => {
		initTextEditor('t1', seeded(), true)
		caretInCell(2)

		activeEditor.value.view.pasteHTML(bareTable(1, 3), {} as any)

		expect(getTableWidth(activeEditor.value.getHTML())).toBe(450)
	})

	it('stays measurable after tab appends a row at the last cell', () => {
		initTextEditor('t2', seeded(), true)
		caretInCell(-1)

		activeEditor.value.commands.addRowAfter()

		const html = activeEditor.value.getHTML()
		expect(getTableWidth(html)).toBe(300)
		expect(html.match(/colwidth="150"/g)).toHaveLength(6)
	})

	it('invents no widths for a table that states none', () => {
		initTextEditor('t3', bareTable(1, 2), true)

		activeEditor.value.commands.addRowAfter()

		expect(activeEditor.value.getHTML()).not.toContain('colwidth')
	})

	// a drag writes the width it was given on one column, and the other two are still
	// meant to lay themselves out inside the frame
	it('leaves the other columns alone when one of them is dragged', () => {
		initTextEditor('t4', bareTable(2, 3), true)
		const cells = cellPositions()

		const { view } = activeEditor.value
		const tr = view.state.tr
		// what a drag on the middle column commits: that width on every cell in it
		;[cells[1], cells[4]].forEach((pos) => tr.setNodeAttribute(pos, 'colwidth', [400]))
		view.dispatch(tr)

		expect(activeEditor.value.getHTML().match(/colwidth="400"/g)).toHaveLength(2)
		expect(getTableWidth(activeEditor.value.getHTML())).toBe(null)
	})
})
