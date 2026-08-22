import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

// element and the editor composable import each other, and only this order leaves
// the composable defined by the time element reaches for it
await import('./element')
const { useTextEditor } = await import('@/apps/slides/composables/useTextEditor')
const { hasTableNode } = await import('./tiptapSetup')

const { activeEditor, initTextEditor } = useTextEditor()

const table = '<table><tbody><tr><td><p>one</p></td><td><p>two</p></td></tr></tbody></table>'

// a drop routes through the same clipboard parse, with no event to read plain text off,
// so this is what a table dragged into an element arrives as
const paste = (html: string) => activeEditor.value.view.pasteHTML(html, {} as any)

afterEach(() => {
	activeEditor.value?.destroy()
	activeEditor.value = null
})

describe('a table pasted into an element that is not one', () => {
	it('leaves its text behind as lines', () => {
		initTextEditor('t1', '<p>before</p>', true)

		paste(table)

		expect(hasTableNode(activeEditor.value.state.doc)).toBe(false)
		expect(activeEditor.value.state.doc.textContent).toContain('one')
		expect(activeEditor.value.state.doc.textContent).toContain('two')
	})

	it('keeps the text around it', () => {
		initTextEditor('t2', '<p>before</p>', true)

		paste(`<p>above</p>${table}<p>below</p>`)

		expect(hasTableNode(activeEditor.value.state.doc)).toBe(false)
		expect(activeEditor.value.state.doc.textContent).toContain('above')
		expect(activeEditor.value.state.doc.textContent).toContain('below')
	})

	it('lands whole in a table element', () => {
		initTextEditor('t3', table, true)

		paste(table)

		expect(hasTableNode(activeEditor.value.state.doc)).toBe(true)
	})
})
