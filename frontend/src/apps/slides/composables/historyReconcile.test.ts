import { describe, it, expect, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

const { slides, slideIndex } = await import('@/apps/slides/stores/slide')
const { focusElementId } = await import('@/apps/slides/stores/element')
const { useTextEditor } = await import('./useTextEditor')

const { activeEditor } = useTextEditor()

const content = '<p>one</p><p>two</p>'

// the store builds the editor itself, one tick to drop the old one and one to
// mount the new
const editText = async () => {
	slides.value = [{ clientId: 'c1', elements: [{ id: 't1', type: 'text', content }] }]
	slideIndex.value = 0
	focusElementId.value = 't1'
	await nextTick()
	await nextTick()
}

// history writes the element's content, and the watch hands it to the mounted editor
const rewriteContent = async (html: string) => {
	slides.value[0].elements[0].content = html
	await nextTick()
}

const caret = () => {
	const { $from } = activeEditor.value.state.selection
	return { text: $from.parent.textContent, offset: $from.parentOffset }
}

afterEach(() => {
	activeEditor.value?.destroy()
	activeEditor.value = null
	focusElementId.value = null
	slides.value = []
})

// setContent replaces the whole doc and leaves the selection at its end, which
// dropped the caret out of the line the user was typing in on every undo
describe('the caret when history rewrites the content underneath the editor', () => {
	it('leaves a caret before the change where it was', async () => {
		await editText()
		activeEditor.value.commands.setTextSelection(2)

		await rewriteContent('<p>one</p><p>twoAB</p>')

		expect(caret()).toEqual({ text: 'one', offset: 1 })
	})

	it('moves a caret after the change by what the change added', async () => {
		await editText()
		activeEditor.value.commands.setTextSelection(7)

		await rewriteContent('<p>oneAB</p><p>two</p>')

		expect(caret()).toEqual({ text: 'two', offset: 1 })
	})

	it('carries a caret at the change over what the change added', async () => {
		await editText()
		activeEditor.value.commands.setTextSelection(4)

		await rewriteContent('<p>oneAB</p><p>two</p>')

		expect(caret()).toEqual({ text: 'oneAB', offset: 5 })
	})

	it('pulls a caret inside the change back to the start of it', async () => {
		await editText()
		activeEditor.value.commands.setTextSelection(3)

		await rewriteContent('<p>xyz</p><p>two</p>')

		expect(caret()).toEqual({ text: 'xyz', offset: 0 })
	})
})
