import { afterEach, expect, it, vi } from 'vitest'

import { Editor } from '@tiptap/vue-3'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

const { extensions } = await import('@/apps/slides/stores/tiptapSetup')
// the stores and the composable import each other, and only this order resolves
await import('@/apps/slides/stores/slide')
const { useTextEditor } = await import('./useTextEditor')

const { activeEditor, updateProperty } = useTextEditor()

const edit = (content: string, editable = false) => {
	const element = document.createElement('div')
	document.body.appendChild(element)
	activeEditor.value = new Editor({ element, extensions, content, editable })
	return activeEditor.value
}

const markup = () => activeEditor.value.getHTML().replace(/ (style|lineheight)="[^"]*"/g, '')

afterEach(() => {
	activeEditor.value?.destroy()
	activeEditor.value = null
})

it('numbers a whole box as one list, title and separate lists included', () => {
	edit('<p>title</p><ul><li><p>one</p></li></ul><ul><li><p>two</p></li></ul>')

	updateProperty('list', 'ordered')

	expect(markup()).toBe(
		'<ol><li><p>title</p></li><li><p>one</p></li><li><p>two</p></li></ol>',
	)
})

it('changes only the level the caret is in', () => {
	const editor = edit('<ul><li><p>one</p><ul><li><p>two</p></li></ul></li></ul>', true)
	editor.commands.setTextSelection(11)

	updateProperty('list', 'ordered')

	expect(markup()).toBe('<ul><li><p>one</p><ol><li><p>two</p></li></ol></li></ul>')
})

it('takes a nested item out of its lists and leaves the rest one list', () => {
	const editor = edit(
		'<ol><li><p>one</p><ol><li><p>two</p></li><li><p>three</p></li></ol></li><li><p>four</p></li></ol>',
		true,
	)
	editor.commands.setTextSelection(11)

	updateProperty('list', 'none')

	expect(markup()).toBe(
		'<ol><li><p>one</p></li></ol><p>two</p><ol><li><p>three</p></li><li><p>four</p></li></ol>',
	)
})

it('recolours the marker with the text while the box is open', () => {
	const editor = edit('<ul><li><p>one</p></li></ul>')

	updateProperty('color', 'rgb(255, 0, 0)')

	expect(editor.view.dom.querySelector('li').style.color).toBe('rgb(255, 0, 0)')
})
