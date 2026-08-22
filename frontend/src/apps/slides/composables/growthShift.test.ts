import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

// the growth math runs off the rendered width, which jsdom can't lay out
const { fakeDiv, renderedWidth } = vi.hoisted(() => {
	const renderedWidth = { measure: () => 100 }
	const fakeDiv = document.createElement('div')
	Object.defineProperty(fakeDiv, 'offsetWidth', {
		get: () => renderedWidth.measure(),
		set: (width) => (renderedWidth.measure = () => width),
	})
	fakeDiv.getBoundingClientRect = () => ({ width: renderedWidth.measure() }) as DOMRect
	return { fakeDiv, renderedWidth }
})
vi.mock('@/apps/slides/stores/elementRegistry', () => ({
	registerElementDiv: () => {},
	getElementDiv: () => fakeDiv,
}))

const { slides, slideIndex, slideBounds } = await import('@/apps/slides/stores/slide')
const { activeElementIds, focusElementId, setAutoWidth } = await import(
	'@/apps/slides/stores/element'
)
const { setCommandHistory } = await import('@/apps/slides/stores/historyMeta')
const { useCommandHistory } = await import('./useCommandHistory')
const { useTextEditor } = await import('./useTextEditor')

const { activeEditor } = useTextEditor()

const actionOrder = {
	execute: { editElement: ['execute'], batch: ['execute'] },
	undo: { editElement: ['undo'], batch: ['undo'] },
}

let history: ReturnType<typeof useCommandHistory>

const element = () => slides.value[0].elements[0]

// a tick to drop the old editor, one to mount the new, one to seed the baseline
const editText = async (content: string, overrides = {}) => {
	slides.value = [
		{ clientId: 'c1', elements: [{ id: 't1', type: 'text', content, left: 400, ...overrides }] },
	]
	slideIndex.value = 0
	focusElementId.value = 't1'
	fakeDiv.innerHTML = content
	await nextTick()
	await nextTick()
	await nextTick()
}

const typeAtEnd = (text: string, renderedWidth: number) => {
	fakeDiv.offsetWidth = renderedWidth
	const editor = activeEditor.value
	editor.commands.insertContentAt(editor.state.doc.content.size - 1, text)
}

beforeEach(() => {
	slideBounds.scale = 1
	fakeDiv.offsetWidth = 100
	fakeDiv.contains = () => true
	history = useCommandHistory(slides, { actionOrder, actions: {} })
	setCommandHistory(history)
})

afterEach(() => {
	activeEditor.value?.destroy()
	activeEditor.value = null
	focusElementId.value = null
	activeElementIds.value = []
	slides.value = []
})

describe('growth right after the panel switches back to auto', () => {
	// the box renders at its stored width until the switch clears it
	const switchToAuto = async (autoWidth: number) => {
		renderedWidth.measure = () => element().width ?? autoWidth
		activeElementIds.value = ['t1']
		await setAutoWidth()
		await nextTick()
	}

	it('anchors the first keystroke on the width it collapsed to', async () => {
		await editText('<p style="text-align: center">one</p>', { width: 300 })

		await switchToAuto(100)
		expect(element().left).toBe(500)

		typeAtEnd('x', 120)

		expect(element().left).toBe(490)
	})
})

describe('alignment-anchored growth of auto-width text', () => {
	it('keeps left-aligned text anchored at its left edge', async () => {
		await editText('<p>one</p>')

		typeAtEnd('x', 120)

		expect(element().left).toBe(400)
	})

	it('grows centered text symmetrically', async () => {
		await editText('<p style="text-align: center">one</p>')

		typeAtEnd('x', 120)

		expect(element().left).toBe(390)
	})

	it('grows right-aligned text leftward', async () => {
		await editText('<p style="text-align: right">one</p>')

		typeAtEnd('x', 120)

		expect(element().left).toBe(380)
	})

	it('shrinks centered text back toward its anchor on deletion', async () => {
		await editText('<p style="text-align: center">one</p>')

		fakeDiv.offsetWidth = 80
		activeEditor.value.commands.deleteRange({ from: 1, to: 2 })

		expect(element().left).toBe(410)
	})

	it('leaves mixed-alignment text anchored at its left edge', async () => {
		await editText('<p style="text-align: center">one</p><p>two</p>')

		typeAtEnd('x', 120)

		expect(element().left).toBe(400)
	})

	it('never moves a fixed-width element', async () => {
		await editText('<p style="text-align: center">one</p>', { width: 300 })

		typeAtEnd('x', 120)

		expect(element().left).toBe(400)
	})
})

describe('history of the growth shift', () => {
	it('undoes a coalesced burst back to the original content and left', async () => {
		await editText('<p style="text-align: center">one</p>')

		typeAtEnd('x', 120)
		await nextTick()
		typeAtEnd('y', 140)
		await nextTick()
		expect(element().left).toBe(380)

		history.undo()
		await nextTick()

		expect(element().content).toBe('<p style="text-align: center">one</p>')
		expect(element().left).toBe(400)
	})

	it('redoes a coalesced burst forward to the shifted left', async () => {
		await editText('<p style="text-align: center">one</p>')

		typeAtEnd('x', 120)
		await nextTick()

		fakeDiv.offsetWidth = 100
		history.undo()
		await nextTick()

		fakeDiv.offsetWidth = 120
		history.redo()
		await nextTick()

		expect(element().content).toContain('onex')
		expect(element().left).toBe(390)
	})

	it('drops a burst that types and deletes back to the start', async () => {
		// the pop compares against re-serialized content, so seed the normalized form
		await editText('<p style="text-align: center; line-height: 1.5;">one</p>')

		typeAtEnd('x', 120)
		await nextTick()
		fakeDiv.offsetWidth = 100
		activeEditor.value.commands.deleteRange({ from: 4, to: 5 })
		await nextTick()

		expect(element().left).toBe(400)
		expect(history.canUndo.value).toBe(false)
	})

	it('starts a fresh entry when the width turns fixed mid-burst', async () => {
		await editText('<p style="text-align: center">one</p>')

		typeAtEnd('x', 120)
		await nextTick()

		// a side-handle drag fixes the width without recording a command
		element().width = 300
		await nextTick()
		expect(() => typeAtEnd('y', 120)).not.toThrow()

		history.undo()
		await nextTick()
		expect(element().content).toContain('onex')
	})

	it('seeds the growth baseline from the mounted editor, not the empty shell', async () => {
		// the element div is an empty shell until EditorContent adopts the view
		fakeDiv.contains = () => false
		fakeDiv.offsetWidth = 2
		await editText('<p style="text-align: center">one</p>')

		// the view lands in the div and the user clicks a caret in
		fakeDiv.contains = () => true
		fakeDiv.offsetWidth = 100
		activeEditor.value.commands.setTextSelection(1)

		typeAtEnd('x', 120)

		expect(element().left).toBe(390)
	})

	it('rebases the growth baseline after a history rewrite', async () => {
		await editText('<p style="text-align: center">one</p>')

		typeAtEnd('x', 120)
		await nextTick()

		// the rewrite lands with the width the undone content renders at
		fakeDiv.offsetWidth = 100
		history.undo()
		await nextTick()

		typeAtEnd('z', 110)

		expect(element().left).toBe(395)
	})
})
