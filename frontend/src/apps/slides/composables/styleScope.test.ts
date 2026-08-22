import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

// element.js reaches back into this composable, so it has to pull it in
const { getInitialTableContent } = await import('@/apps/slides/stores/element')
const { useTextEditor } = await import('./useTextEditor')

const { activeEditor, initTextEditor, toggleMark, updateProperty, editorStyles } = useTextEditor()

const table = '<table><tbody><tr><td><p>one</p></td><td><p>two</p></td></tr></tbody></table>'

const cursorInFirstCell = () => {
	const editor = activeEditor.value
	let pos = -1
	editor.state.doc.descendants((node: any, nodePos: number) => {
		if (node.type.name === 'tableCell' && pos === -1) pos = nodePos + 2
	})
	editor.commands.setTextSelection(pos)
}

afterEach(() => {
	activeEditor.value?.destroy()
	activeEditor.value = null
})

describe('what an empty selection styles', () => {
	it('styles only the cell the cursor is in', () => {
		initTextEditor('t1', table, true)
		cursorInFirstCell()

		toggleMark('bold')

		const html = activeEditor.value.getHTML()
		expect(html).toContain('<strong>one</strong>')
		expect(html).not.toContain('<strong>two</strong>')
	})

	// a scrub is a burst of updates, and the first one used to push the selection
	// out of the cell it had just styled
	it('keeps a repeated update on the cell the cursor started in', () => {
		initTextEditor('t1', table, true)
		cursorInFirstCell()

		updateProperty('fontSize', 20)
		updateProperty('fontSize', 25)

		const html = activeEditor.value.getHTML()
		expect(html).toContain('font-size: 25px')
		expect(html.match(/font-size/g)).toHaveLength(1)
	})

	// a mark needs text to sit on, so empty cells read as unstyled
	it('styles a table that has not been typed in yet', () => {
		initTextEditor('t1', getInitialTableContent(2, 2, 150, { fontFamily: 'Inter', fontSize: 18 }))

		expect(editorStyles.fontFamily).toBe('Inter')

		updateProperty('fontFamily', 'Arial')

		expect(activeEditor.value.getHTML().match(/Arial/g)).toHaveLength(4)
	})

	it('styles the whole text box, cursor or not', () => {
		initTextEditor('t1', '<p>one</p><p>two</p>', true)
		activeEditor.value.commands.setTextSelection(2)

		toggleMark('bold')

		const html = activeEditor.value.getHTML()
		expect(html).toContain('<strong>one</strong>')
		expect(html).toContain('<strong>two</strong>')
	})
})
