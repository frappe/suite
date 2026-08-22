import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

const { getInitialTableContent } = await import('@/apps/slides/stores/element')
const { useTextEditor } = await import('@/apps/slides/composables/useTextEditor')
const { setCellFill } = await import('./tableCells')

const { activeEditor, initTextEditor } = useTextEditor()

const openTable = (rows: number, columns: number, editable = false) =>
	initTextEditor('t1', getInitialTableContent(rows, columns, 150, { fontFamily: 'Inter' }), editable)

const filledCells = () => activeEditor.value.getHTML().match(/background-color/g)?.length ?? 0

afterEach(() => {
	activeEditor.value?.destroy()
	activeEditor.value = null
})

describe('setCellFill', () => {
	// a table selected but not focused reads as a whole, the way typography does
	it('fills every cell of an uneditable table', () => {
		openTable(2, 2)

		setCellFill('#ff0000')

		expect(filledCells()).toBe(4)
	})

	it('fills only the cell the caret is in', () => {
		openTable(2, 2, true)

		setCellFill('#ff0000')

		expect(filledCells()).toBe(1)
	})
})
